import { clerkClient, getAuth } from "@clerk/express";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  db,
  hbsAuditLog,
  hbsInquiries,
  hbsLegacyImports,
  hbsLegacyRecords,
  hbsRegistrationRequests,
  hbsServiceRequests,
  type HbsInquiry,
  type HbsRegistrationRequest,
  type HbsServiceRequest,
} from "@workspace/db";
import {
  AnswerOfficeInquiryBody,
  AnswerOfficeInquiryParams,
  AnswerOfficeInquiryResponse,
  CreateInquiryBody,
  CreateInquiryResponse,
  CreateServiceRequestBody,
  CreateServiceRequestResponse,
  GetOfficeSummaryResponse,
  GetPortalMeResponse,
  GetPortalRegistrationResponse,
  GetPortalSummaryResponse,
  GetServiceRequestHistoryParams,
  GetServiceRequestHistoryResponse,
  GetServiceRequestParams,
  GetServiceRequestResponse,
  ListInquiriesResponse,
  ListOfficeInquiriesQueryParams,
  ListOfficeInquiriesResponse,
  ListOfficeRegistrationsResponse,
  ListOfficeServiceRequestsQueryParams,
  ListOfficeServiceRequestsResponse,
  PreviewLegacyBackupBody,
  PreviewLegacyBackupResponse,
  ImportLegacyBackupBody,
  ImportLegacyBackupResponse,
  ListLegacyImportsResponse,
  ListServiceRequestsResponse,
  UpdateOfficeServiceRequestBody,
  UpdateOfficeServiceRequestParams,
  UpdateOfficeServiceRequestResponse,
  ReviewOfficeRegistrationBody,
  ReviewOfficeRegistrationParams,
  ReviewOfficeRegistrationResponse,
  SubmitPortalRegistrationBody,
  SubmitPortalRegistrationResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import {
  inquiryAnsweredMail,
  notify,
  officeNewInquiryMail,
  officeNewRegistrationMail,
  officeNewRequestMail,
  registrationDecisionMail,
  statusChangedMail,
} from "../lib/notify";
import { statusHistory } from "../lib/request-history";
import { emptyLegacyGroup, groupLegacyIds, inspectLegacyBackup, legacyKinds } from "../lib/legacy-backup";
import {
  OFFICE_PAGE_SIZE,
  STALE_AFTER_DAYS,
  containsPattern,
  officeCustomer,
  requestIdFromReference,
  type OfficeCustomer,
} from "../lib/office-search";
import {
  clerkUsersById,
  getOfficeRole,
  requireOfficeOwner,
  requireOfficeStaff,
  verifiedEmailOf,
} from "../lib/office-access";

const router: IRouter = Router();

const requirePortalAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  next();
};

async function hasLegacyCustomerData(userId: string): Promise<boolean> {
  const [request] = await db.select({ id: hbsServiceRequests.id })
    .from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, userId)).limit(1);
  if (request) return true;
  const [inquiry] = await db.select({ id: hbsInquiries.id })
    .from(hbsInquiries).where(eq(hbsInquiries.userId, userId)).limit(1);
  return !!inquiry;
}

async function hasCustomerApproval(userId: string): Promise<boolean> {
  const [registration] = await db.select({ status: hbsRegistrationRequests.status })
    .from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, userId))
    .limit(1);
  return registration?.status === "approved" || hasLegacyCustomerData(userId);
}

export const requireApprovedCustomer: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  if (!(await hasCustomerApproval(userId))) {
    res.status(403).json({ error: "Customer registration approval required" });
    return;
  }
  next();
};

function publicRequest(record: HbsServiceRequest) {
  // Internal office notes must never be included in customer responses.
  return {
    id: record.id,
    reference: `HBS-${record.createdAt.getUTCFullYear()}-${String(record.id).padStart(5, "0")}`,
    category: record.category,
    service: record.service,
    description: record.description,
    contactPhone: record.contactPhone,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function officeRequest(record: HbsServiceRequest, customer: OfficeCustomer) {
  return { ...publicRequest(record), officeNote: record.officeNote, customer };
}

// The address the customer registered with, for notifications.
// Runs after the response is sent, so a lookup failure only skips the email.
async function customerEmail(userId: string): Promise<string | null> {
  try {
    const [registration] = await db.select({ email: hbsRegistrationRequests.email })
      .from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
    return registration?.email ?? null;
  } catch {
    return null;
  }
}

async function customerOf(userId: string): Promise<OfficeCustomer> {
  const [registration] = await db.select({
    fullName: hbsRegistrationRequests.fullName, email: hbsRegistrationRequests.email,
  }).from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
  return officeCustomer(registration?.fullName ?? null, registration?.email ?? null);
}

function linkedRequestContext(record: HbsServiceRequest) {
  return {
    reference: `HBS-${record.createdAt.getUTCFullYear()}-${String(record.id).padStart(5, "0")}`,
    category: record.category,
    service: record.service,
    description: record.description,
    status: record.status,
  };
}

function inquiry(record: HbsInquiry, linkedRequest?: HbsServiceRequest | null) {
  return {
    id: record.id,
    subject: record.subject,
    message: record.message,
    linkedServiceRequestReference: linkedRequest ? linkedRequestContext(linkedRequest).reference : null,
    status: record.status,
    answer: record.answer,
    createdAt: record.createdAt,
    answeredAt: record.answeredAt,
  };
}

function officeInquiry(record: HbsInquiry, linkedRequest: HbsServiceRequest | null, customer: OfficeCustomer) {
  return {
    ...inquiry(record, linkedRequest),
    linkedServiceRequest: linkedRequest ? linkedRequestContext(linkedRequest) : null,
    customer,
  };
}

function portalRegistration(record: HbsRegistrationRequest) {
  return {
    id: record.id,
    fullName: record.fullName,
    contactPhone: record.contactPhone,
    note: record.note,
    status: record.status,
    reason: record.reason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function verifiedRegistrationEmail(record: HbsRegistrationRequest): Promise<string | null> {
  return verifiedEmailOf(await clerkClient.users.getUser(record.userId), record.email);
}

function officeRegistration(record: HbsRegistrationRequest, email: string | null) {
  return {
    ...portalRegistration(record),
    email,
    reviewerId: record.reviewerId,
  };
}

router.get("/portal/me", requirePortalAuth, async (req, res): Promise<void> => {
  const officeRole = await getOfficeRole(req, true);
  const userId = getAuth(req).userId!;
  const [registration] = await db.select({ status: hbsRegistrationRequests.status })
    .from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, userId))
    .limit(1);
  const status = registration?.status === "approved" || await hasLegacyCustomerData(userId)
    ? "approved"
    : registration?.status ?? null;
  res.json(GetPortalMeResponse.parse({
    role: officeRole ? "staff" : "customer",
    officeRole,
    registrationStatus: status,
  }));
});

router.get("/portal/registration", requirePortalAuth, async (req, res): Promise<void> => {
  const [record] = await db.select().from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, getAuth(req).userId!)).limit(1);
  res.json(GetPortalRegistrationResponse.parse(record ? portalRegistration(record) : null));
});

router.post("/portal/registration", requirePortalAuth, async (req, res): Promise<void> => {
  const parsed = SubmitPortalRegistrationBody.safeParse(req.body);
  const fullName = parsed.success ? parsed.data.fullName.trim() : "";
  const contactPhone = parsed.success ? parsed.data.contactPhone.trim() : "";
  const note = parsed.success ? parsed.data.note?.trim() || null : null;
  if (!parsed.success || fullName.length < 2 || fullName.length > 120 ||
      contactPhone.length < 9 || contactPhone.length > 24 || (note?.length ?? 0) > 1000) {
    res.status(400).json({ error: "Invalid registration details" });
    return;
  }

  const userId = getAuth(req).userId!;
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find((entry) => entry.verification?.status === "verified")?.emailAddress;
  if (!email) {
    res.status(400).json({ error: "Verify an email address before registering" });
    return;
  }
  if (await hasCustomerApproval(userId)) {
    res.status(409).json({ error: "This account already has customer access" });
    return;
  }

  const [existing] = await db.select().from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
  if (existing?.status === "pending" || existing?.status === "approved") {
    res.status(409).json({ error: "A registration request is already pending or approved" });
    return;
  }

  let [record] = existing
    ? await db.update(hbsRegistrationRequests).set({
        email,
        fullName,
        contactPhone,
        note,
        status: "pending",
        reason: null,
        reviewerId: null,
        updatedAt: new Date(),
      }).where(and(
        eq(hbsRegistrationRequests.userId, userId),
        eq(hbsRegistrationRequests.status, "rejected"),
      )).returning()
    : await db.insert(hbsRegistrationRequests).values({
        userId,
        email,
        fullName,
        contactPhone,
        note,
      }).onConflictDoNothing().returning();
  if (!record) {
    res.status(409).json({ error: "A registration request already exists" });
    return;
  }
  res.status(201).json(SubmitPortalRegistrationResponse.parse(portalRegistration(record)));
  notify(officeNewRegistrationMail(record.fullName));
});

router.get("/portal/summary", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const [[requests], [inquiries], recentRequests, recentInquiries] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status <> 'completed')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    }).from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, userId)),
    db.select({
      open: sql<number>`count(*) filter (where status = 'open')::int`,
    }).from(hbsInquiries).where(eq(hbsInquiries.userId, userId)),
    db.select().from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.userId, userId))
      .orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id)).limit(5),
    db.select({ inquiry: hbsInquiries, request: hbsServiceRequests })
      .from(hbsInquiries)
      .leftJoin(hbsServiceRequests, and(
        eq(hbsInquiries.linkedServiceRequestId, hbsServiceRequests.id),
        eq(hbsServiceRequests.userId, userId),
      ))
      .where(eq(hbsInquiries.userId, userId))
      .orderBy(desc(hbsInquiries.createdAt), desc(hbsInquiries.id)).limit(5),
  ]);
  res.json(GetPortalSummaryResponse.parse({
    totalRequests: requests.total,
    activeRequests: requests.active,
    completedRequests: requests.completed,
    openInquiries: inquiries.open,
    recentRequests: recentRequests.map(publicRequest),
    recentInquiries: recentInquiries.map(({ inquiry: record, request }) => inquiry(record, request)),
  }));
});

router.get("/service-requests", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const records = await db.select().from(hbsServiceRequests)
    .where(eq(hbsServiceRequests.userId, getAuth(req).userId!))
    .orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id));
  res.json(ListServiceRequestsResponse.parse(records.map(publicRequest)));
});

router.post("/service-requests", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const parsed = CreateServiceRequestBody.safeParse(req.body);
  if (!parsed.success ||
      !parsed.data.service.trim() ||
      !parsed.data.description.trim() ||
      !parsed.data.contactPhone.trim()) {
    res.status(400).json({ error: "Complete all request fields" });
    return;
  }
  const [record] = await db.insert(hbsServiceRequests).values({
    userId: getAuth(req).userId!,
    category: parsed.data.category,
    service: parsed.data.service.trim(),
    description: parsed.data.description.trim(),
    contactPhone: parsed.data.contactPhone.trim(),
  }).returning();
  const created = publicRequest(record);
  res.status(201).json(CreateServiceRequestResponse.parse(created));
  notify(officeNewRequestMail({ id: record.id, reference: created.reference, service: record.service, category: record.category }));
});

router.get("/service-requests/:id", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const params = GetServiceRequestParams.safeParse(req.params);
  if (!params.success || params.data.id < 1) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }
  const [record] = await db.select().from(hbsServiceRequests)
    .where(and(
      eq(hbsServiceRequests.id, params.data.id),
      eq(hbsServiceRequests.userId, getAuth(req).userId!),
    )).limit(1);
  if (!record) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json(GetServiceRequestResponse.parse(publicRequest(record)));
});

router.get("/service-requests/:id/history", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const params = GetServiceRequestHistoryParams.safeParse(req.params);
  if (!params.success || params.data.id < 1) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }
  const [record] = await db.select({ id: hbsServiceRequests.id, createdAt: hbsServiceRequests.createdAt })
    .from(hbsServiceRequests)
    .where(and(
      eq(hbsServiceRequests.id, params.data.id),
      eq(hbsServiceRequests.userId, getAuth(req).userId!),
    )).limit(1);
  if (!record) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  // Only the status and its time reach the customer; who made the change
  // and internal notes stay in the office audit log.
  const updates = await db.select({ createdAt: hbsAuditLog.createdAt, details: hbsAuditLog.details })
    .from(hbsAuditLog)
    .where(and(
      eq(hbsAuditLog.targetType, "service_request"),
      eq(hbsAuditLog.targetId, String(record.id)),
      eq(hbsAuditLog.action, "service_request.update"),
    ))
    .orderBy(asc(hbsAuditLog.createdAt));
  res.json(GetServiceRequestHistoryResponse.parse(statusHistory(record.createdAt, updates)));
});

router.get("/inquiries", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const records = await db.select({ inquiry: hbsInquiries, request: hbsServiceRequests })
    .from(hbsInquiries)
    .leftJoin(hbsServiceRequests, and(
      eq(hbsInquiries.linkedServiceRequestId, hbsServiceRequests.id),
      eq(hbsServiceRequests.userId, userId),
    ))
    .where(eq(hbsInquiries.userId, userId))
    .orderBy(desc(hbsInquiries.createdAt), desc(hbsInquiries.id));
  res.json(ListInquiriesResponse.parse(records.map(({ inquiry: record, request }) => inquiry(record, request))));
});

router.post("/inquiries", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const parsed = CreateInquiryBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.subject.trim() || !parsed.data.message.trim()) {
    res.status(400).json({ error: "Complete the inquiry" });
    return;
  }
  let linkedRequest: HbsServiceRequest | null = null;
  if (parsed.data.linkedServiceRequestId != null) {
    [linkedRequest] = await db.select().from(hbsServiceRequests).where(and(
      eq(hbsServiceRequests.id, parsed.data.linkedServiceRequestId),
      eq(hbsServiceRequests.userId, getAuth(req).userId!),
    )).limit(1);
    if (!linkedRequest) {
      // Deliberately use the same response for missing and other-account IDs.
      res.status(400).json({ error: "Invalid linked service request" });
      return;
    }
  }
  const [record] = await db.insert(hbsInquiries).values({
    userId: getAuth(req).userId!,
    subject: parsed.data.subject.trim(),
    message: parsed.data.message.trim(),
    linkedServiceRequestId: parsed.data.linkedServiceRequestId ?? null,
  }).returning();
  res.status(201).json(CreateInquiryResponse.parse(inquiry(record, linkedRequest)));
  notify(officeNewInquiryMail(record.subject, linkedRequest ? publicRequest(linkedRequest).reference : null));
});

router.get("/office/registrations", requireOfficeStaff, async (_req, res): Promise<void> => {
  const records = await db.select().from(hbsRegistrationRequests)
    .orderBy(desc(hbsRegistrationRequests.createdAt), desc(hbsRegistrationRequests.id));
  const users = await clerkUsersById(records.map((record) => record.userId));
  res.json(ListOfficeRegistrationsResponse.parse(records.map((record) =>
    officeRegistration(record, verifiedEmailOf(users.get(record.userId), record.email)))));
});

router.patch("/office/registrations/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = ReviewOfficeRegistrationParams.safeParse(req.params);
  const parsed = ReviewOfficeRegistrationBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid registration review" });
    return;
  }

  if (parsed.data.status === "approved") {
    const [pending] = await db.select().from(hbsRegistrationRequests)
      .where(and(
        eq(hbsRegistrationRequests.id, params.data.id),
        eq(hbsRegistrationRequests.status, "pending"),
      )).limit(1);
    if (pending && !(await verifiedRegistrationEmail(pending))) {
      res.status(409).json({ error: "Applicant must have a verified email before approval" });
      return;
    }
  }

  const actorId = getAuth(req).userId!;
  const reason = parsed.data.reason?.trim() || null;
  const record = await db.transaction(async tx => {
    const [updated] = await tx.update(hbsRegistrationRequests).set({
      status: parsed.data.status,
      reason,
      reviewerId: actorId,
      updatedAt: new Date(),
    }).where(and(
      eq(hbsRegistrationRequests.id, params.data.id),
      eq(hbsRegistrationRequests.status, "pending"),
    )).returning();
    if (updated) {
      await recordAudit(tx, {
        actorId, action: "registration.review", targetType: "registration", targetId: updated.id,
        details: { status: updated.status, ...(reason ? { reason } : {}) },
      });
    }
    return updated;
  });
  if (!record) {
    const [existing] = await db.select({ id: hbsRegistrationRequests.id, status: hbsRegistrationRequests.status })
      .from(hbsRegistrationRequests)
      .where(eq(hbsRegistrationRequests.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Registration request not found" });
      return;
    }
    res.status(409).json({ error: "Registration request is no longer pending" });
    return;
  }
  res.json(ReviewOfficeRegistrationResponse.parse(
    officeRegistration(record, await verifiedRegistrationEmail(record))));
  notify(registrationDecisionMail(record.email, record.status === "approved"));
});

router.get("/office/summary", requireOfficeStaff, async (_req, res): Promise<void> => {
  const [[requests], [inquiries]] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      received: sql<number>`count(*) filter (where status = 'received')::int`,
      active: sql<number>`count(*) filter (where status <> 'completed')::int`,
      stale: sql<number>`count(*) filter (where status <> 'completed' and updated_at < now() - make_interval(days => ${STALE_AFTER_DAYS}))::int`,
    }).from(hbsServiceRequests),
    db.select({
      open: sql<number>`count(*) filter (where status = 'open')::int`,
    }).from(hbsInquiries),
  ]);
  res.json(GetOfficeSummaryResponse.parse({
    totalRequests: requests.total,
    newRequests: requests.received,
    activeRequests: requests.active,
    staleRequests: requests.stale,
    openInquiries: inquiries.open,
  }));
});

router.get("/office/service-requests", requireOfficeStaff, async (req, res): Promise<void> => {
  const query = ListOfficeServiceRequestsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid filter" });
    return;
  }
  const { status, category, sort, page } = query.data;
  const text = query.data.q?.trim();
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(hbsServiceRequests.status, status));
  if (category) conditions.push(eq(hbsServiceRequests.category, category));
  if (text) {
    const pattern = containsPattern(text);
    const id = requestIdFromReference(text);
    conditions.push(or(
      ilike(hbsServiceRequests.service, pattern),
      ilike(hbsServiceRequests.description, pattern),
      ilike(hbsServiceRequests.contactPhone, pattern),
      ilike(hbsRegistrationRequests.fullName, pattern),
      ilike(hbsRegistrationRequests.email, pattern),
      ...(id ? [eq(hbsServiceRequests.id, id)] : []),
    )!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const customerJoin = eq(hbsRegistrationRequests.userId, hbsServiceRequests.userId);
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      request: hbsServiceRequests,
      fullName: hbsRegistrationRequests.fullName,
      email: hbsRegistrationRequests.email,
    }).from(hbsServiceRequests)
      .leftJoin(hbsRegistrationRequests, customerJoin)
      .where(where)
      .orderBy(...(sort === "oldest_update"
        ? [asc(hbsServiceRequests.updatedAt), asc(hbsServiceRequests.id)]
        : [desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id)]))
      .limit(OFFICE_PAGE_SIZE)
      .offset((page - 1) * OFFICE_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(hbsServiceRequests)
      .leftJoin(hbsRegistrationRequests, customerJoin)
      .where(where),
  ]);
  res.json(ListOfficeServiceRequestsResponse.parse({
    items: rows.map(({ request, fullName, email }) => officeRequest(request, officeCustomer(fullName, email))),
    total,
    page,
    pageSize: OFFICE_PAGE_SIZE,
  }));
});

router.patch("/office/service-requests/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = UpdateOfficeServiceRequestParams.safeParse(req.params);
  const parsed = UpdateOfficeServiceRequestBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid request update" });
    return;
  }
  let previousStatus: string | null = null;
  const record = await db.transaction(async tx => {
    const [previous] = await tx.select({ status: hbsServiceRequests.status, officeNote: hbsServiceRequests.officeNote })
      .from(hbsServiceRequests).where(eq(hbsServiceRequests.id, params.data.id)).for("update");
    if (!previous) return undefined;
    previousStatus = previous.status;
    const [updated] = await tx.update(hbsServiceRequests).set({
      status: parsed.data.status,
      ...(parsed.data.officeNote !== undefined ? { officeNote: parsed.data.officeNote } : {}),
      updatedAt: new Date(),
    }).where(eq(hbsServiceRequests.id, params.data.id)).returning();
    await recordAudit(tx, {
      actorId: getAuth(req).userId!, action: "service_request.update",
      targetType: "service_request", targetId: updated.id,
      details: {
        fromStatus: previous.status,
        toStatus: updated.status,
        noteChanged: (previous.officeNote ?? null) !== (updated.officeNote ?? null),
      },
    });
    return updated;
  });
  if (!record) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  const customer = await customerOf(record.userId);
  res.json(UpdateOfficeServiceRequestResponse.parse(officeRequest(record, customer)));
  if (previousStatus !== record.status) {
    notify(statusChangedMail(await customerEmail(record.userId),
      { id: record.id, reference: publicRequest(record).reference, service: record.service }, record.status));
  }
});

router.get("/office/inquiries", requireOfficeStaff, async (req, res): Promise<void> => {
  const query = ListOfficeInquiriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid filter" });
    return;
  }
  const { status, page } = query.data;
  const text = query.data.q?.trim();
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(hbsInquiries.status, status));
  if (text) {
    const pattern = containsPattern(text);
    conditions.push(or(
      ilike(hbsInquiries.subject, pattern),
      ilike(hbsInquiries.message, pattern),
      ilike(hbsRegistrationRequests.fullName, pattern),
      ilike(hbsRegistrationRequests.email, pattern),
    )!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const customerJoin = eq(hbsRegistrationRequests.userId, hbsInquiries.userId);
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      inquiry: hbsInquiries,
      request: hbsServiceRequests,
      fullName: hbsRegistrationRequests.fullName,
      email: hbsRegistrationRequests.email,
    }).from(hbsInquiries)
      .leftJoin(hbsServiceRequests, eq(hbsInquiries.linkedServiceRequestId, hbsServiceRequests.id))
      .leftJoin(hbsRegistrationRequests, customerJoin)
      .where(where)
      .orderBy(desc(hbsInquiries.createdAt), desc(hbsInquiries.id))
      .limit(OFFICE_PAGE_SIZE)
      .offset((page - 1) * OFFICE_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(hbsInquiries)
      .leftJoin(hbsRegistrationRequests, customerJoin)
      .where(where),
  ]);
  res.json(ListOfficeInquiriesResponse.parse({
    items: rows.map(({ inquiry: record, request, fullName, email }) =>
      officeInquiry(record, request, officeCustomer(fullName, email))),
    total,
    page,
    pageSize: OFFICE_PAGE_SIZE,
  }));
});

router.patch("/office/inquiries/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = AnswerOfficeInquiryParams.safeParse(req.params);
  const parsed = AnswerOfficeInquiryBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !parsed.success || !parsed.data.answer.trim()) {
    res.status(400).json({ error: "Invalid inquiry answer" });
    return;
  }
  let firstAnswer = false;
  const record = await db.transaction(async tx => {
    const [previous] = await tx.select({ status: hbsInquiries.status })
      .from(hbsInquiries).where(eq(hbsInquiries.id, params.data.id)).for("update");
    if (!previous) return undefined;
    firstAnswer = previous.status !== "answered";
    const [updated] = await tx.update(hbsInquiries).set({
      answer: parsed.data.answer.trim(),
      status: "answered",
      answeredAt: new Date(),
    }).where(eq(hbsInquiries.id, params.data.id)).returning();
    await recordAudit(tx, {
      actorId: getAuth(req).userId!, action: "inquiry.answer", targetType: "inquiry", targetId: updated.id,
      details: { edited: previous.status === "answered" },
    });
    return updated;
  });
  if (!record) {
    res.status(404).json({ error: "Inquiry not found" });
    return;
  }
  let linkedRequest: HbsServiceRequest | null = null;
  if (record.linkedServiceRequestId != null) {
    [linkedRequest] = await db.select().from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.id, record.linkedServiceRequestId)).limit(1);
  }
  res.json(AnswerOfficeInquiryResponse.parse(officeInquiry(record, linkedRequest, await customerOf(record.userId))));
  if (firstAnswer) notify(inquiryAnsweredMail(await customerEmail(record.userId), record.subject));
});

router.post("/office/legacy/preview", requireOfficeOwner, async (req, res): Promise<void> => {
  const body = PreviewLegacyBackupBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "حجم النسخة أو صيغة الطلب غير صالحة." }); return; }
  try {
    const { exportedAt, digest, counts, ids } = inspectLegacyBackup(body.data.contents);
    res.json(PreviewLegacyBackupResponse.parse({ exportedAt, digest, counts, ids }));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/office/legacy/import", requireOfficeOwner, async (req, res): Promise<void> => {
  const body = ImportLegacyBackupBody.safeParse(req.body);
  if (!body.success || body.data.confirmed !== true) {
    res.status(400).json({ error: "يجب مراجعة النسخة والموافقة صراحةً قبل الاستيراد." }); return;
  }
  let preview: ReturnType<typeof inspectLegacyBackup>;
  try { preview = inspectLegacyBackup(body.data.contents); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if (preview.digest !== body.data.digest) {
    res.status(400).json({ error: "تغيّر الملف منذ المعاينة. عاين النسخة من جديد." }); return;
  }
  const imported = await db.transaction(async tx => {
    const [batch] = await tx.insert(hbsLegacyImports).values({
      digest: preview.digest, exportedAt: preview.exportedAt, importedBy: getAuth(req).userId!,
    }).onConflictDoNothing().returning();
    if (!batch) return null;
    for (const kind of legacyKinds) {
      const rows = preview.records[kind].map(item => ({
        importId: batch.id, kind, legacyId: item.id, data: item,
      }));
      if (rows.length) await tx.insert(hbsLegacyRecords).values(rows);
    }
    await recordAudit(tx, {
      actorId: batch.importedBy, action: "legacy.import", targetType: "legacy_import", targetId: batch.id,
      details: { digest: batch.digest, counts: preview.counts },
    });
    return batch;
  });
  if (!imported) { res.status(409).json({ error: "هذه النسخة مستوردة مسبقًا. تحقق من سجل الاستيراد." }); return; }
  const savedRows = await db.select({
    importId: hbsLegacyRecords.importId, kind: hbsLegacyRecords.kind, legacyId: hbsLegacyRecords.legacyId,
  }).from(hbsLegacyRecords).where(eq(hbsLegacyRecords.importId, imported.id));
  const { ids: savedIds, counts: savedCounts } = groupLegacyIds(savedRows).get(imported.id) ?? emptyLegacyGroup();
  res.status(201).json(ImportLegacyBackupResponse.parse({
    id: imported.id, importedAt: imported.importedAt,
    exportedAt: imported.exportedAt, digest: imported.digest, counts: savedCounts, ids: savedIds,
  }));
});

router.get("/office/legacy/imports", requireOfficeOwner, async (_req, res): Promise<void> => {
  const batches = await db.select().from(hbsLegacyImports).orderBy(desc(hbsLegacyImports.importedAt));
  const records = await db.select({
    importId: hbsLegacyRecords.importId, kind: hbsLegacyRecords.kind, legacyId: hbsLegacyRecords.legacyId,
  }).from(hbsLegacyRecords);
  const grouped = groupLegacyIds(records);
  res.json(ListLegacyImportsResponse.parse(batches.map(batch => {
    const { ids, counts } = grouped.get(batch.id) ?? emptyLegacyGroup();
    return { id: batch.id, importedAt: batch.importedAt, exportedAt: batch.exportedAt, digest: batch.digest, ids, counts };
  })));
});

export default router;