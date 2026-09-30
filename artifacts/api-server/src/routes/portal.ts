import { clerkClient, getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import {
  db,
  hbsAuditLog,
  hbsInquiries,
  hbsLegacyImports,
  hbsLegacyRecords,
  hbsRegistrationRequests,
  hbsServiceRequests,
  hbsRequestAttachments,
  type HbsInquiry,
  type HbsRegistrationRequest,
  type HbsServiceRequest,
  type HbsRequestAttachment,
} from "@workspace/db";
import {
  AnswerOfficeInquiryBody,
  AnswerOfficeInquiryParams,
  AnswerOfficeInquiryResponse,
  CreateInquiryBody,
  CreateInquiryResponse,
  CreateServiceRequestBody,
  CreateServiceRequestResponse,
  RequestServiceAttachmentUploadBody,
  RequestServiceAttachmentUploadResponse,
  RequestOfficeServiceAttachmentUploadBody,
  RequestOfficeServiceAttachmentUploadResponse,
  AttachServiceRequestFilesBody,
  AttachServiceRequestFilesParams,
  AttachServiceRequestFilesResponse,
  AttachOfficeServiceRequestFilesBody,
  AttachOfficeServiceRequestFilesParams,
  AttachOfficeServiceRequestFilesResponse,
  DeleteServiceRequestFileParams,
  DeleteOfficeServiceRequestFileParams,
  GetOfficeSummaryResponse,
  GetPortalMeResponse,
  GetPortalRegistrationResponse,
  GetPortalSummaryResponse,
  GetServiceRequestHistoryParams,
  GetServiceRequestHistoryResponse,
  GetServiceRequestParams,
  GetServiceRequestResponse,
  ListInquiriesResponse,
  ListOfficeInquiriesResponse,
  ListOfficeInquiriesQueryParams,
  ListOfficeRegistrationsResponse,
  ListOfficeServiceRequestsResponse,
  ListOfficeServiceRequestsQueryParams,
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
  customerNewFileMail,
  inquiryAnsweredMail,
  notify,
  officeNewFileMail,
  officeNewInquiryMail,
  officeNewRegistrationMail,
  officeNewRequestMail,
  registrationDecisionMail,
  statusChangedMail,
} from "../lib/notify";
import { statusHistory } from "../lib/request-history";
import { inspectLegacyBackup, legacyKinds, type LegacyKind } from "../lib/legacy-backup";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { officeCustomer, type OfficeCustomer } from "../lib/office-search";
import {
  getOfficeRole,
  requireOfficeOwner, requireOfficeStaff,
} from "../lib/office-access";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const allowedAttachmentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

export const MAX_ATTACHMENTS_PER_REQUEST = 10;

// Who added a file is read from the row: the request's owner, or office staff.
function attachmentInfo(row: HbsRequestAttachment, ownerId: string) {
  return {
    id: row.id, name: row.name, size: row.size, contentType: row.contentType,
    uploadedBy: row.userId === ownerId ? "customer" as const : "office" as const,
    createdAt: row.createdAt,
  };
}

async function attachmentsFor(requestIds: number[]) {
  const rows = requestIds.length
    ? await db.select({ attachment: hbsRequestAttachments, ownerId: hbsServiceRequests.userId })
      .from(hbsRequestAttachments)
      .innerJoin(hbsServiceRequests, eq(hbsRequestAttachments.requestId, hbsServiceRequests.id))
      .where(and(inArray(hbsRequestAttachments.requestId, requestIds), isNotNull(hbsRequestAttachments.requestId)))
      .orderBy(asc(hbsRequestAttachments.createdAt), asc(hbsRequestAttachments.id))
    : [];
  const grouped = new Map<number, ReturnType<typeof attachmentInfo>[]>();
  for (const { attachment, ownerId } of rows) {
    if (attachment.requestId === null) continue;
    grouped.set(attachment.requestId, [...(grouped.get(attachment.requestId) ?? []), attachmentInfo(attachment, ownerId)]);
  }
  return grouped;
}

class UploadError extends Error {}

// Checks a user's reserved uploads and copies each to a new private key, so a
// still-valid signed PUT can never overwrite a submitted file. On failure the
// copies made so far are removed and UploadError is thrown.
async function finalizeUploads(userId: string, ids: number[]) {
  const pending = ids.length ? await db.select().from(hbsRequestAttachments).where(and(
    inArray(hbsRequestAttachments.id, ids), eq(hbsRequestAttachments.userId, userId),
    sql`${hbsRequestAttachments.requestId} is null`, sql`${hbsRequestAttachments.expiresAt} > now()`,
  )) : [];
  if (pending.length !== ids.length) throw new UploadError("Invalid or expired attachment. Upload again.");
  const finalized: { row: HbsRequestAttachment; path: string }[] = [];
  try {
    for (const row of pending) {
      const source = await validObject(row.objectPath, row);
      const path = `/objects/submitted/${randomUUID()}`;
      const dir = storage.getPrivateObjectDir().replace(/\/$/, "");
      const [, ...prefix] = dir.replace(/^\//, "").split("/");
      const destination = source.bucket.file(`${prefix.join("/")}/submitted/${path.split("/").at(-1)}`);
      await source.copy(destination);
      finalized.push({ row, path });
      await validObject(path, row);
    }
  } catch (error) {
    await Promise.allSettled(finalized.map(async ({ path }) => (await storage.getObjectEntityFile(path)).delete()));
    throw new UploadError(error instanceof Error ? error.message : "File upload incomplete or invalid.");
  }
  return { pending, finalized };
}

// Moves finalized uploads onto a request inside a transaction, after locking
// the reservations so the same upload cannot be attached twice.
async function lockAndAttach(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string, ids: number[], requestId: number,
  finalized: { row: HbsRequestAttachment; path: string }[],
) {
  if (ids.length) {
    const locked = await tx.select().from(hbsRequestAttachments).where(and(
      inArray(hbsRequestAttachments.id, ids), eq(hbsRequestAttachments.userId, userId),
      sql`${hbsRequestAttachments.requestId} is null`, sql`${hbsRequestAttachments.expiresAt} > now()`,
    )).for("update");
    if (locked.length !== ids.length) throw new Error("Attachments already submitted or expired");
  }
  for (const { row, path } of finalized) {
    await tx.update(hbsRequestAttachments).set({ requestId, objectPath: path })
      .where(eq(hbsRequestAttachments.id, row.id));
  }
}

async function validObject(path: string, expected: HbsRequestAttachment) {
  const file = await storage.getObjectEntityFile(path);
  const [metadata, bytes] = await Promise.all([
    file.getMetadata(), file.download({ start: 0, end: 7 }),
  ]);
  const size = Number(metadata[0].size);
  const header = bytes[0];
  const matches = expected.contentType === "application/pdf"
    ? header.subarray(0, 5).toString() === "%PDF-"
    : expected.contentType === "image/jpeg"
      ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      : header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (size !== expected.size || size < 1 || size > MAX_ATTACHMENT_SIZE || !matches) {
    throw new Error("Invalid uploaded file");
  }
  return file;
}

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

function publicRequest(record: HbsServiceRequest, attachments: ReturnType<typeof attachmentInfo>[] = []) {
  // Internal office notes must never be included in customer responses.
  return {
    id: record.id,
    reference: `HBS-${record.createdAt.getUTCFullYear()}-${String(record.id).padStart(5, "0")}`,
    category: record.category,
    service: record.service,
    description: record.description,
    contactPhone: record.contactPhone,
    status: record.status,
    customerMessage: record.status === "waiting_on_customer" ? record.customerMessage : null,
    clientRequestId: record.clientRequestId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attachments,
  };
}

function officeRequest(
  record: HbsServiceRequest,
  attachments: ReturnType<typeof attachmentInfo>[] = [],
  customer?: OfficeCustomer,
) {
  return {
    ...publicRequest(record, attachments),
    officeNote: record.officeNote,
    ...(customer !== undefined ? { customer } : {}),
  };
}

// The address the customer registered with, for notifications.
// Runs after the response is sent, so a lookup failure only skips the email.
async function customerEmail(userId: string): Promise<string | null> {
  try {
    const [registration] = await db.select({ email: hbsRegistrationRequests.email })
      .from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
    if (registration?.email) return registration.email;
    // Customers from before registration existed: their verified sign-in email.
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    return primary?.verification?.status === "verified" ? primary.emailAddress : null;
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

function officeInquiry(
  record: HbsInquiry,
  linkedRequest?: HbsServiceRequest | null,
  customer?: OfficeCustomer,
) {
  return {
    ...inquiry(record, linkedRequest),
    linkedServiceRequest: linkedRequest ? linkedRequestContext(linkedRequest) : null,
    ...(customer !== undefined ? { customer } : {}),
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
  const user = await clerkClient.users.getUser(record.userId);
  return user.emailAddresses.find(
    (entry) => entry.emailAddress.toLowerCase() === record.email.toLowerCase() &&
      entry.verification?.status === "verified",
  )?.emailAddress ?? null;
}

async function officeRegistration(record: HbsRegistrationRequest) {
  return {
    ...portalRegistration(record),
    email: await verifiedRegistrationEmail(record),
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
  const attached = await attachmentsFor(recentRequests.map(r => r.id));
  res.json(GetPortalSummaryResponse.parse({
    totalRequests: requests.total,
    activeRequests: requests.active,
    completedRequests: requests.completed,
    openInquiries: inquiries.open,
    recentRequests: recentRequests.map(r => publicRequest(r, attached.get(r.id))),
    recentInquiries: recentInquiries.map(({ inquiry: record, request }) => inquiry(record, request)),
  }));
});

router.get("/service-requests", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const records = await db.select().from(hbsServiceRequests)
    .where(eq(hbsServiceRequests.userId, getAuth(req).userId!))
    .orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id));
  const attached = await attachmentsFor(records.map(r => r.id));
  res.json(ListServiceRequestsResponse.parse(records.map(r => publicRequest(r, attached.get(r.id)))));
});

router.post("/service-requests/attachments/upload-url", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const parsed = RequestServiceAttachmentUploadBody.safeParse(req.body);
  if (!parsed.success || !allowedAttachmentTypes.has(parsed.data.contentType) ||
      !parsed.data.name.trim() || /[/\\\x00-\x1f\x7f]/.test(parsed.data.name)) {
    res.status(400).json({ error: "Invalid attachment. Use PDF, JPEG or PNG up to 10 MB." });
    return;
  }
  const userId = getAuth(req).userId!;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(hbsRequestAttachments)
    .where(and(eq(hbsRequestAttachments.userId, userId), sql`${hbsRequestAttachments.requestId} is null`,
      sql`${hbsRequestAttachments.expiresAt} > now()`));
  if (count >= 12) {
    res.status(429).json({ error: "Too many pending uploads. Try again later." });
    return;
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  const [row] = await db.insert(hbsRequestAttachments).values({
    userId, objectPath, name: parsed.data.name.trim(),
    contentType: parsed.data.contentType, size: parsed.data.size,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  }).returning();
  res.json(RequestServiceAttachmentUploadResponse.parse({ attachmentId: row.id, uploadURL }));
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
  const userId = getAuth(req).userId!;
  const requestId = parsed.data.clientRequestId;
  const existingRequest = async () => {
    if (!requestId) return null;
    const [record] = await db.select().from(hbsServiceRequests).where(and(
      eq(hbsServiceRequests.userId, userId),
      eq(hbsServiceRequests.clientRequestId, requestId),
    )).limit(1);
    return record ?? null;
  };
  const respondExisting = async (record: HbsServiceRequest) => {
    if (record.category !== parsed.data.category ||
        record.service !== parsed.data.service.trim() ||
        record.description !== parsed.data.description.trim() ||
        record.contactPhone !== parsed.data.contactPhone.trim()) {
      res.status(409).json({ error: "This submission identifier was used for a different request." });
      return;
    }
    const attached = await attachmentsFor([record.id]);
    res.json(CreateServiceRequestResponse.parse(publicRequest(record, attached.get(record.id))));
  };
  const previous = await existingRequest();
  if (previous) {
    await respondExisting(previous);
    return;
  }
  const ids = parsed.data.attachmentIds ?? [];
  if (ids.length > MAX_ATTACHMENTS_PER_REQUEST) {
    res.status(400).json({ error: `Attach at most ${MAX_ATTACHMENTS_PER_REQUEST} files.` });
    return;
  }
  let pending: HbsRequestAttachment[];
  let finalized: { row: HbsRequestAttachment; path: string }[];
  try {
    ({ pending, finalized } = await finalizeUploads(userId, ids));
  } catch (error) {
    req.log.warn({ err: error }, "Attachment verification failed");
    res.status(400).json({ error: "File upload incomplete or invalid. Check each file and retry." });
    return;
  }
  let record: HbsServiceRequest;
  try {
    record = await db.transaction(async (tx) => {
      const [created] = await tx.insert(hbsServiceRequests).values({
        userId, category: parsed.data.category, service: parsed.data.service.trim(),
        description: parsed.data.description.trim(), contactPhone: parsed.data.contactPhone.trim(),
        clientRequestId: requestId ?? null,
      }).returning();
      await lockAndAttach(tx, userId, ids, created.id, finalized);
      return created;
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to save request and attachments");
    // A lost connection can throw after the transaction commits. Never delete
    // copied files here: committed attachment rows may already point to them.
    try {
      const previous = await existingRequest();
      if (previous) {
        await respondExisting(previous);
        return;
      }
    } catch (lookupError) {
      req.log.error({ err: lookupError }, "Could not reconcile uncertain request submission");
    }
    res.status(503).json({ error: "Could not confirm submission. Check your requests before retrying." });
    return;
  }
  // A response failure after commit must not delete the submitted copies.
  res.status(201).json(CreateServiceRequestResponse.parse(publicRequest(record,
    pending.map(row => attachmentInfo(row, userId)))));
  notify(officeNewRequestMail({
    id: record.id,
    reference: `HBS-${record.createdAt.getUTCFullYear()}-${String(record.id).padStart(5, "0")}`,
    service: record.service,
    category: record.category,
  }));
  // Cleanup is best-effort after the record has been committed; pending keys cannot be downloaded.
  void Promise.allSettled(pending.map(async row => (await storage.getObjectEntityFile(row.objectPath)).delete()));
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
  const attached = await attachmentsFor([record.id]);
  res.json(GetServiceRequestResponse.parse(publicRequest(record, attached.get(record.id))));
});

async function sendAttachment(req: Request, res: import("express").Response, staff: boolean) {
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) {
    res.status(404).json({ error: "Attachment not found" }); return;
  }
  const [row] = await db.select({ attachment: hbsRequestAttachments, request: hbsServiceRequests })
    .from(hbsRequestAttachments)
    .innerJoin(hbsServiceRequests, eq(hbsRequestAttachments.requestId, hbsServiceRequests.id))
    .where(and(eq(hbsRequestAttachments.id, attachmentId),
      ...(staff ? [] : [eq(hbsServiceRequests.userId, getAuth(req).userId!)]))).limit(1);
  if (!row) { res.status(404).json({ error: "Attachment not found" }); return; }
  try {
    const file = await storage.getObjectEntityFile(row.attachment.objectPath);
    if (staff) {
      // Who opened which client document is kept in the audit log.
      await db.transaction(tx => recordAudit(tx, {
        actorId: getAuth(req).userId!, action: "attachment.download", targetType: "service_request",
        targetId: row.request.id, details: { attachmentId: row.attachment.id, name: row.attachment.name },
      }));
    }
    res.setHeader("Content-Type", row.attachment.contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.attachment.name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    file.createReadStream().on("error", err => {
      req.log.error({ err }, "Attachment stream failed");
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    }).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) res.status(404).json({ error: "Attachment not found" });
    else { req.log.error({ err: error }, "Attachment download failed"); res.status(500).end(); }
  }
}

router.get("/service-requests/attachments/:attachmentId/download",
  requirePortalAuth, requireApprovedCustomer, (req, res) => sendAttachment(req, res, false));
router.get("/office/service-requests/attachments/:attachmentId/download",
  requireOfficeStaff, (req, res) => sendAttachment(req, res, true));

// Reserving an upload is the same for customers and office staff: a private,
// short-lived signed URL tied to the caller. Attaching it to a request is a
// separate step (below) so the file can be checked first.
async function reserveUpload(req: Request, res: import("express").Response, parsed: { name: string; size: number; contentType: string } | null) {
  if (!parsed || !allowedAttachmentTypes.has(parsed.contentType) || parsed.size < 1 || parsed.size > MAX_ATTACHMENT_SIZE ||
      !parsed.name.trim() || /[/\\\x00-\x1f\x7f]/.test(parsed.name)) {
    res.status(400).json({ error: "Invalid attachment. Use PDF, JPEG or PNG up to 10 MB." });
    return null;
  }
  const userId = getAuth(req).userId!;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(hbsRequestAttachments)
    .where(and(eq(hbsRequestAttachments.userId, userId), sql`${hbsRequestAttachments.requestId} is null`,
      sql`${hbsRequestAttachments.expiresAt} > now()`));
  if (count >= 12) {
    res.status(429).json({ error: "Too many pending uploads. Try again later." });
    return null;
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  const [row] = await db.insert(hbsRequestAttachments).values({
    userId, objectPath, name: parsed.name.trim(),
    contentType: parsed.contentType, size: parsed.size,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  }).returning();
  return { attachmentId: row.id, uploadURL };
}

router.post("/office/service-requests/attachments/upload-url", requireOfficeStaff, async (req, res): Promise<void> => {
  const parsed = RequestOfficeServiceAttachmentUploadBody.safeParse(req.body);
  const reservation = await reserveUpload(req, res, parsed.success ? parsed.data : null);
  if (reservation) res.json(RequestOfficeServiceAttachmentUploadResponse.parse(reservation));
});

// Adds uploaded files to an existing request. Customers: their own request,
// until it is completed. Office staff: any request (for example to send the
// customer a finished document).
class FullRequestError extends Error {}

async function attachToRequest(req: Request, res: import("express").Response, office: boolean) {
  const params = (office ? AttachOfficeServiceRequestFilesParams : AttachServiceRequestFilesParams).safeParse(req.params);
  const body = (office ? AttachOfficeServiceRequestFilesBody : AttachServiceRequestFilesBody).safeParse(req.body);
  if (!params.success || params.data.id < 1 || !body.success || new Set(body.data.attachmentIds).size !== body.data.attachmentIds.length) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const userId = getAuth(req).userId!;
  const ids = body.data.attachmentIds;
  const [request] = await db.select().from(hbsServiceRequests).where(office
    ? eq(hbsServiceRequests.id, params.data.id)
    : and(eq(hbsServiceRequests.id, params.data.id), eq(hbsServiceRequests.userId, userId))).limit(1);
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  if (!office && request.status === "completed") {
    res.status(409).json({ error: "The request is completed" });
    return;
  }
  const countFiles = async (runner: Pick<typeof db, "select">) => (await runner.select({ count: sql<number>`count(*)::int` })
    .from(hbsRequestAttachments).where(eq(hbsRequestAttachments.requestId, request.id)))[0].count;
  const full = `A request can hold ${MAX_ATTACHMENTS_PER_REQUEST} files`;
  if (await countFiles(db) + ids.length > MAX_ATTACHMENTS_PER_REQUEST) {
    res.status(409).json({ error: full });
    return;
  }
  let finalized: { row: HbsRequestAttachment; path: string }[];
  try {
    ({ finalized } = await finalizeUploads(userId, ids));
  } catch (error) {
    req.log.warn({ err: error }, "Attachment verification failed");
    res.status(400).json({ error: "File upload incomplete or invalid. Check each file and retry." });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      // Checked again under a lock on the request: two uploads at once cannot pass the limit.
      await tx.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests)
        .where(eq(hbsServiceRequests.id, request.id)).for("update");
      if (await countFiles(tx) + ids.length > MAX_ATTACHMENTS_PER_REQUEST) throw new FullRequestError();
      await lockAndAttach(tx, userId, ids, request.id, finalized);
      if (office) {
        for (const { row } of finalized) {
          await recordAudit(tx, {
            actorId: userId, action: "attachment.upload", targetType: "service_request",
            targetId: request.id, details: { attachmentId: row.id, name: row.name },
          });
        }
      }
    });
  } catch (error) {
    req.log.warn({ err: error }, "Could not attach files");
    await Promise.allSettled(finalized.map(async ({ path }) => (await storage.getObjectEntityFile(path)).delete()));
    res.status(409).json({ error: error instanceof FullRequestError ? full : "These uploads were already attached or have expired. Upload again." });
    return;
  }
  const attachments = (await attachmentsFor([request.id])).get(request.id) ?? [];
  if (office) res.json(AttachOfficeServiceRequestFilesResponse.parse(officeRequest(request, attachments, await customerOf(request.userId))));
  else res.json(AttachServiceRequestFilesResponse.parse(publicRequest(request, attachments)));
  // Temporary upload objects are no longer needed once copied.
  const moved = finalized.map(({ row }) => row.objectPath);
  void Promise.allSettled(moved.map(async path => (await storage.getObjectEntityFile(path)).delete()));
  const info = { id: request.id, reference: publicRequest(request).reference, service: request.service };
  const names = finalized.map(({ row }) => row.name).join("، ");
  if (office) notify(customerNewFileMail(await customerEmail(request.userId), info));
  else notify(officeNewFileMail(info, names));
}

router.post("/service-requests/:id/attachments", requirePortalAuth, requireApprovedCustomer,
  (req, res) => attachToRequest(req, res, false));
router.post("/office/service-requests/:id/attachments", requireOfficeStaff,
  (req, res) => attachToRequest(req, res, true));

// Customers may remove files they added while the request is open; office
// staff may remove any file (audited). The stored object is deleted too.
async function removeAttachment(req: Request, res: import("express").Response, office: boolean) {
  const params = (office ? DeleteOfficeServiceRequestFileParams : DeleteServiceRequestFileParams).safeParse(req.params);
  if (!params.success || params.data.attachmentId < 1) { res.status(404).json({ error: "Attachment not found" }); return; }
  const userId = getAuth(req).userId!;
  const [row] = await db.select({ attachment: hbsRequestAttachments, request: hbsServiceRequests })
    .from(hbsRequestAttachments)
    .innerJoin(hbsServiceRequests, eq(hbsRequestAttachments.requestId, hbsServiceRequests.id))
    .where(and(eq(hbsRequestAttachments.id, params.data.attachmentId),
      ...(office ? [] : [eq(hbsServiceRequests.userId, userId)]))).limit(1);
  if (!row) { res.status(404).json({ error: "Attachment not found" }); return; }
  if (!office && (row.attachment.userId !== userId || row.request.status === "completed")) {
    res.status(409).json({ error: "This file can no longer be removed" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(hbsRequestAttachments).where(eq(hbsRequestAttachments.id, row.attachment.id));
    if (office) {
      await recordAudit(tx, {
        actorId: userId, action: "attachment.delete", targetType: "service_request",
        targetId: row.request.id, details: { attachmentId: row.attachment.id, name: row.attachment.name },
      });
    }
  });
  // The row is gone, so the file is no longer listed or downloadable. A stored
  // object left behind by a failed delete is only logged.
  try {
    const file = await storage.getObjectEntityFile(row.attachment.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) req.log.error({ err: error, objectPath: row.attachment.objectPath }, "Could not delete attachment object");
  }
  res.status(204).end();
}

router.delete("/service-requests/attachments/:attachmentId", requirePortalAuth, requireApprovedCustomer,
  (req, res) => removeAttachment(req, res, false));
router.delete("/office/service-requests/attachments/:attachmentId", requireOfficeStaff,
  (req, res) => removeAttachment(req, res, true));

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
  const response = await Promise.all(records.map(officeRegistration));
  res.json(ListOfficeRegistrationsResponse.parse(response));
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

  // The decision and its audit entry are saved together: who granted access stays on record.
  const record = await db.transaction(async (tx) => {
    const [updated] = await tx.update(hbsRegistrationRequests).set({
      status: parsed.data.status,
      reason: parsed.data.reason?.trim() || null,
      reviewerId: getAuth(req).userId!,
      updatedAt: new Date(),
    }).where(and(
      eq(hbsRegistrationRequests.id, params.data.id),
      eq(hbsRegistrationRequests.status, "pending"),
    )).returning();
    if (updated) {
      await recordAudit(tx, {
        actorId: getAuth(req).userId!,
        action: updated.status === "approved" ? "registration.approve" : "registration.reject",
        targetType: "registration", targetId: updated.id,
        details: { email: updated.email, ...(updated.reason ? { reason: updated.reason } : {}) },
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
  res.json(ReviewOfficeRegistrationResponse.parse(await officeRegistration(record)));
  notify(registrationDecisionMail(record.email, record.status === "approved"));
});

router.get("/office/summary", requireOfficeStaff, async (_req, res): Promise<void> => {
  const [[requests], [inquiries]] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      received: sql<number>`count(*) filter (where status = 'received')::int`,
      active: sql<number>`count(*) filter (where status <> 'completed')::int`,
      stale: sql<number>`count(*) filter (where status <> 'completed' and updated_at <= now() - interval '3 days')::int`,
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

// Search uses literal substring matching, including % and _, matching the old local search.
function contains(column: AnyColumn | SQL, text: string) {
  return sql`position(lower(${text}) in lower(${column})) > 0`;
}
// The customer's registered name or email, so the office can search by who asked.
function customerMatches(userId: AnyColumn, text: string) {
  return sql`exists (select 1 from ${hbsRegistrationRequests} r where r.user_id = ${userId}
    and (position(lower(${text}) in lower(r.full_name)) > 0 or position(lower(${text}) in lower(r.email)) > 0))`;
}
function requestReference() {
  return sql`concat('HBS-', extract(year from ${hbsServiceRequests.createdAt})::int, '-', lpad(${hbsServiceRequests.id}::text, 5, '0'))`;
}

router.get("/office/service-requests", requireOfficeStaff, async (req, res): Promise<void> => {
  const parsed = ListOfficeServiceRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request filters" }); return; }
  const { page = 1, pageSize = 20, q, status, category, sort = "newest" } = parsed.data;
  const filter = and(
    status ? eq(hbsServiceRequests.status, status) : undefined,
    category ? eq(hbsServiceRequests.category, category) : undefined,
    q ? or(contains(hbsServiceRequests.service, q), contains(hbsServiceRequests.description, q),
      contains(hbsServiceRequests.contactPhone, q), contains(requestReference(), q),
      customerMatches(hbsServiceRequests.userId, q)) : undefined,
  );
  const [[{ total }], records] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(hbsServiceRequests).where(filter),
    db.select().from(hbsServiceRequests).where(filter)
      .orderBy(...(sort === "oldest_update"
        ? [asc(hbsServiceRequests.updatedAt), asc(hbsServiceRequests.id)]
        : [desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id)]))
      .limit(pageSize).offset((page - 1) * pageSize),
  ]);
  const attached = await attachmentsFor(records.map(r => r.id));
  const response = {
    items: await Promise.all(records.map(async r =>
      officeRequest(r, attached.get(r.id), await customerOf(r.userId)))),
    total, page, pageSize,
  };
  ListOfficeServiceRequestsResponse.parse(response);
  res.json(response);
});

router.patch("/office/service-requests/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = UpdateOfficeServiceRequestParams.safeParse(req.params);
  const parsed = UpdateOfficeServiceRequestBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid request update" });
    return;
  }
  const customerMessage = parsed.data.customerMessage?.trim() || null;
  if (parsed.data.status === "waiting_on_customer" && !customerMessage) {
    res.status(400).json({ error: "Explain to the customer what is needed." });
    return;
  }
  const updatedAt = new Date(Math.max(Date.now(), parsed.data.expectedUpdatedAt.getTime() + 1));
  let previousStatus: string | null = null;
  let stale = false;
  const record = await db.transaction(async tx => {
    const [previous] = await tx.select({
      status: hbsServiceRequests.status,
      officeNote: hbsServiceRequests.officeNote,
    }).from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.id, params.data.id)).for("update");
    if (!previous) return undefined;
    previousStatus = previous.status;
    const [updated] = await tx.update(hbsServiceRequests).set({
      status: parsed.data.status,
      ...(parsed.data.officeNote !== undefined ? { officeNote: parsed.data.officeNote } : {}),
      customerMessage: parsed.data.status === "waiting_on_customer" ? customerMessage : null,
      updatedAt,
    }).where(and(
      eq(hbsServiceRequests.id, params.data.id),
      sql`date_trunc('milliseconds', ${hbsServiceRequests.updatedAt}) = ${parsed.data.expectedUpdatedAt}`,
    )).returning();
    if (!updated) {
      stale = true;
      return undefined;
    }
    await recordAudit(tx, {
      actorId: getAuth(req).userId!,
      action: "service_request.update",
      targetType: "service_request",
      targetId: updated.id,
      details: {
        fromStatus: previous.status,
        toStatus: updated.status,
        noteChanged: (previous.officeNote ?? null) !== (updated.officeNote ?? null),
      },
    });
    return updated;
  });
  if (!record) {
    if (stale) {
      res.status(409).json({ error: "This request changed since you opened it. Refresh and review the latest version." });
      return;
    }
    res.status(404).json({ error: "Request not found" });
    return;
  }
  const customer = await customerOf(record.userId);
  const attached = await attachmentsFor([record.id]);
  const response = officeRequest(record, attached.get(record.id), customer);
  UpdateOfficeServiceRequestResponse.parse(response);
  res.json(response);
  if (previousStatus !== record.status) {
    notify(statusChangedMail(await customerEmail(record.userId),
      { id: record.id, reference: publicRequest(record).reference, service: record.service }, record.status,
      record.customerMessage));
  }
});

router.get("/office/inquiries", requireOfficeStaff, async (req, res): Promise<void> => {
  const parsed = ListOfficeInquiriesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid inquiry filters" }); return; }
  const { page = 1, pageSize = 20, q, status } = parsed.data;
  const filter = and(
    status ? eq(hbsInquiries.status, status) : undefined,
    q ? or(contains(hbsInquiries.subject, q), contains(hbsInquiries.message, q),
      contains(requestReference(), q), customerMatches(hbsInquiries.userId, q)) : undefined,
  );
  const base = () => db.select({ inquiry: hbsInquiries, request: hbsServiceRequests })
    .from(hbsInquiries)
    .leftJoin(hbsServiceRequests, eq(hbsInquiries.linkedServiceRequestId, hbsServiceRequests.id));
  const [[{ total }], records] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(hbsInquiries)
      .leftJoin(hbsServiceRequests, eq(hbsInquiries.linkedServiceRequestId, hbsServiceRequests.id)).where(filter),
    base().where(filter).orderBy(desc(hbsInquiries.createdAt), desc(hbsInquiries.id))
      .limit(pageSize).offset((page - 1) * pageSize),
  ]);
  const response = {
    items: await Promise.all(records.map(async ({ inquiry: record, request }) =>
      officeInquiry(record, request, await customerOf(record.userId)))),
    total, page, pageSize,
  };
  ListOfficeInquiriesResponse.parse(response);
  res.json(response);
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
  const response = officeInquiry(record, linkedRequest, await customerOf(record.userId));
  AnswerOfficeInquiryResponse.parse(response);
  res.json(response);
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
    return batch;
  });
  if (!imported) { res.status(409).json({ error: "هذه النسخة مستوردة مسبقًا. تحقق من سجل الاستيراد." }); return; }
  const savedRows = await db.select({
    kind: hbsLegacyRecords.kind, legacyId: hbsLegacyRecords.legacyId,
  }).from(hbsLegacyRecords).where(eq(hbsLegacyRecords.importId, imported.id));
  const savedIds: Record<LegacyKind, string[]> = { clients: [], transactions: [], tasks: [], notes: [] };
  for (const row of savedRows) {
    if (legacyKinds.includes(row.kind as LegacyKind)) savedIds[row.kind as LegacyKind].push(row.legacyId);
  }
  for (const kind of legacyKinds) savedIds[kind].sort();
  const savedCounts = Object.fromEntries(legacyKinds.map(kind => [kind, savedIds[kind].length]));
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
  res.json(ListLegacyImportsResponse.parse(batches.map(batch => {
    const ids: Record<LegacyKind, string[]> = { clients: [], transactions: [], tasks: [], notes: [] };
    for (const row of records) {
      if (row.importId === batch.id && legacyKinds.includes(row.kind as LegacyKind))
        ids[row.kind as LegacyKind].push(row.legacyId);
    }
    for (const kind of legacyKinds) ids[kind].sort();
    const counts = Object.fromEntries(legacyKinds.map(kind => [kind, ids[kind].length]));
    return { id: batch.id, importedAt: batch.importedAt, exportedAt: batch.exportedAt, digest: batch.digest, ids, counts };
  })));
});

export default router;