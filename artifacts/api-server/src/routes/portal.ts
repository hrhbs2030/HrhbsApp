import { clerkClient, getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import {
  db,
  hbsInquiries,
  hbsLegacyImports,
  hbsLegacyRecords,
  hbsRegistrationRequests,
  hbsOfficeStaff,
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
  GetServiceRequestParams,
  GetServiceRequestResponse,
  ListInquiriesResponse,
  ListOfficeInquiriesResponse,
  ListOfficeRegistrationsResponse,
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
import { emptyLegacyGroup, groupLegacyIds, inspectLegacyBackup, legacyKinds } from "../lib/legacy-backup";

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

// Clerk results are reused for a minute per user: staff are re-verified at
// most once a minute, and a customer's frequent /portal/me polling does not
// look up the office email each time. The staff row is still checked on every
// request, so deleting it revokes access immediately.
const OFFICE_ACCESS_TTL_MS = 60_000;
const officeAccessVerifiedUntil = new Map<string, number>();
const officeBootstrapDeniedUntil = new Map<string, number>();

function remember(cache: Map<string, number>, userId: string): void {
  const now = Date.now();
  if (cache.size >= 10_000) {
    for (const [id, until] of cache) {
      if (until <= now) cache.delete(id);
    }
    if (cache.size >= 10_000) cache.clear();
  }
  cache.set(userId, now + OFFICE_ACCESS_TTL_MS);
}

function isFresh(cache: Map<string, number>, userId: string): boolean {
  return (cache.get(userId) ?? 0) > Date.now();
}

async function hasOfficeAccess(req: Request, bootstrap = false): Promise<boolean> {
  const approvedEmail = process.env.HBS_OFFICE_EMAIL?.trim().toLowerCase();
  const userId = getAuth(req).userId;
  if (!approvedEmail || !userId) return false;

  const [member] = await db.select({ userId: hbsOfficeStaff.userId })
    .from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, userId)).limit(1);
  if (!member && !bootstrap) return false;
  if (member && isFresh(officeAccessVerifiedUntil, userId)) return true;
  if (!member && isFresh(officeBootstrapDeniedUntil, userId)) return false;

  // A normal customer's /portal/me may provision only the verified owner of
  // the approved address. Do not request arbitrary customer IDs from Clerk.
  const user = member
    ? await clerkClient.users.getUser(userId)
    : (await clerkClient.users.getUserList({ emailAddress: [approvedEmail], limit: 10 }))
        .data.find((candidate) => candidate.id === userId);
  if (!user) {
    if (!member) remember(officeBootstrapDeniedUntil, userId);
    return false;
  }

  // Re-checked at least once a minute: an old role row alone cannot retain
  // access after the approved email is removed from a Clerk account.
  const verifiedOwner = user.emailAddresses.some(
    (entry) =>
      entry.emailAddress.toLowerCase() === approvedEmail &&
      entry.verification?.status === "verified",
  );
  if (!verifiedOwner) {
    officeAccessVerifiedUntil.delete(userId);
    if (!member) remember(officeBootstrapDeniedUntil, userId);
    return false;
  }

  if (!member) {
    await db.insert(hbsOfficeStaff).values({ userId }).onConflictDoNothing();
  }
  officeBootstrapDeniedUntil.delete(userId);
  remember(officeAccessVerifiedUntil, userId);
  return true;
}

export const requireOfficeStaff: RequestHandler = async (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  if (!(await hasOfficeAccess(req))) {
    res.status(403).json({ error: "Office access required" });
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

function officeRequest(record: HbsServiceRequest) {
  return { ...publicRequest(record), officeNote: record.officeNote };
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

function officeInquiry(record: HbsInquiry, linkedRequest?: HbsServiceRequest | null) {
  return {
    ...inquiry(record, linkedRequest),
    linkedServiceRequest: linkedRequest ? linkedRequestContext(linkedRequest) : null,
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

type ClerkEmailOwner = {
  emailAddresses: { emailAddress: string; verification: { status: string } | null }[];
};

export function verifiedEmailOf(user: ClerkEmailOwner | undefined, email: string): string | null {
  return user?.emailAddresses.find(
    (entry) => entry.emailAddress.toLowerCase() === email.toLowerCase() &&
      entry.verification?.status === "verified",
  )?.emailAddress ?? null;
}

async function verifiedRegistrationEmail(record: HbsRegistrationRequest): Promise<string | null> {
  return verifiedEmailOf(await clerkClient.users.getUser(record.userId), record.email);
}

const CLERK_USER_BATCH = 100;

// One Clerk call per 100 applicants instead of one per registration. A deleted
// Clerk account simply shows no verified email.
async function clerkUsersById(userIds: string[]): Promise<Map<string, ClerkEmailOwner>> {
  const unique = [...new Set(userIds)];
  const users = new Map<string, ClerkEmailOwner>();
  for (let start = 0; start < unique.length; start += CLERK_USER_BATCH) {
    const batch = unique.slice(start, start + CLERK_USER_BATCH);
    const { data } = await clerkClient.users.getUserList({ userId: batch, limit: batch.length });
    for (const user of data) users.set(user.id, user);
  }
  return users;
}

function officeRegistration(record: HbsRegistrationRequest, email: string | null) {
  return {
    ...portalRegistration(record),
    email,
    reviewerId: record.reviewerId,
  };
}

router.get("/portal/me", requirePortalAuth, async (req, res): Promise<void> => {
  const staff = await hasOfficeAccess(req, true);
  const userId = getAuth(req).userId!;
  const [registration] = await db.select({ status: hbsRegistrationRequests.status })
    .from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, userId))
    .limit(1);
  const status = registration?.status === "approved" || await hasLegacyCustomerData(userId)
    ? "approved"
    : registration?.status ?? null;
  res.json(GetPortalMeResponse.parse({ role: staff ? "staff" : "customer", registrationStatus: status }));
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
  res.status(201).json(CreateServiceRequestResponse.parse(publicRequest(record)));
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

  const [record] = await db.update(hbsRegistrationRequests).set({
    status: parsed.data.status,
    reason: parsed.data.reason?.trim() || null,
    reviewerId: getAuth(req).userId!,
    updatedAt: new Date(),
  }).where(and(
    eq(hbsRegistrationRequests.id, params.data.id),
    eq(hbsRegistrationRequests.status, "pending"),
  )).returning();
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
});

router.get("/office/summary", requireOfficeStaff, async (_req, res): Promise<void> => {
  const [[requests], [inquiries]] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      received: sql<number>`count(*) filter (where status = 'received')::int`,
      active: sql<number>`count(*) filter (where status <> 'completed')::int`,
    }).from(hbsServiceRequests),
    db.select({
      open: sql<number>`count(*) filter (where status = 'open')::int`,
    }).from(hbsInquiries),
  ]);
  res.json(GetOfficeSummaryResponse.parse({
    totalRequests: requests.total,
    newRequests: requests.received,
    activeRequests: requests.active,
    openInquiries: inquiries.open,
  }));
});

router.get("/office/service-requests", requireOfficeStaff, async (_req, res): Promise<void> => {
  const records = await db.select().from(hbsServiceRequests)
    .orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id));
  res.json(ListOfficeServiceRequestsResponse.parse(records.map(officeRequest)));
});

router.patch("/office/service-requests/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = UpdateOfficeServiceRequestParams.safeParse(req.params);
  const parsed = UpdateOfficeServiceRequestBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid request update" });
    return;
  }
  const [record] = await db.update(hbsServiceRequests).set({
    status: parsed.data.status,
    ...(parsed.data.officeNote !== undefined ? { officeNote: parsed.data.officeNote } : {}),
    updatedAt: new Date(),
  }).where(eq(hbsServiceRequests.id, params.data.id)).returning();
  if (!record) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json(UpdateOfficeServiceRequestResponse.parse(officeRequest(record)));
});

router.get("/office/inquiries", requireOfficeStaff, async (_req, res): Promise<void> => {
  const records = await db.select({ inquiry: hbsInquiries, request: hbsServiceRequests })
    .from(hbsInquiries)
    .leftJoin(hbsServiceRequests, eq(hbsInquiries.linkedServiceRequestId, hbsServiceRequests.id))
    .orderBy(desc(hbsInquiries.createdAt), desc(hbsInquiries.id));
  res.json(ListOfficeInquiriesResponse.parse(records.map(({ inquiry: record, request }) => officeInquiry(record, request))));
});

router.patch("/office/inquiries/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = AnswerOfficeInquiryParams.safeParse(req.params);
  const parsed = AnswerOfficeInquiryBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !parsed.success || !parsed.data.answer.trim()) {
    res.status(400).json({ error: "Invalid inquiry answer" });
    return;
  }
  const [record] = await db.update(hbsInquiries).set({
    answer: parsed.data.answer.trim(),
    status: "answered",
    answeredAt: new Date(),
  }).where(eq(hbsInquiries.id, params.data.id)).returning();
  if (!record) {
    res.status(404).json({ error: "Inquiry not found" });
    return;
  }
  let linkedRequest: HbsServiceRequest | null = null;
  if (record.linkedServiceRequestId != null) {
    [linkedRequest] = await db.select().from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.id, record.linkedServiceRequestId)).limit(1);
  }
  res.json(AnswerOfficeInquiryResponse.parse(officeInquiry(record, linkedRequest)));
});

router.post("/office/legacy/preview", requireOfficeStaff, async (req, res): Promise<void> => {
  const body = PreviewLegacyBackupBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "حجم النسخة أو صيغة الطلب غير صالحة." }); return; }
  try {
    const { exportedAt, digest, counts, ids } = inspectLegacyBackup(body.data.contents);
    res.json(PreviewLegacyBackupResponse.parse({ exportedAt, digest, counts, ids }));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/office/legacy/import", requireOfficeStaff, async (req, res): Promise<void> => {
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

router.get("/office/legacy/imports", requireOfficeStaff, async (_req, res): Promise<void> => {
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