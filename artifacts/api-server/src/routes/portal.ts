import { clerkClient, getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
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
  hbsCustomerSettings,
  hbsDocumentReminders,
  hbsOfficeStaff,
  hbsCompanyEmployees,
  hbsCompanyLicenses,
  hbsInvoices,
  hbsRequestEmployees,
  hbsRequestMessages,
  hbsSubscriptions,
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
  ListServiceRequestMessagesResponse,
  SendServiceRequestMessageBody,
  SendServiceRequestMessageResponse,
  GetPortalSettingsResponse,
  RateServiceRequestBody,
  RateServiceRequestParams,
  RateServiceRequestResponse,
  SavePortalSettingsBody,
  SavePortalSettingsResponse,
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
  UpdateOfficeRequestEmployeeBody,
  UpdateOfficeRequestEmployeeParams,
  UpdateOfficeRequestEmployeeResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import {
  assignedMail,
  customerMessageMail,
  officeMessageMail,
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
import { notifyCustomer } from "../lib/customer-contact";
import { subjectLabels, subjectOf } from "../lib/company";
import { hasCustomerApproval, hasLegacyCustomerData, resolveCompanyAccess } from "../lib/company-access";
import { applyAssignmentRule, resumeAfterCustomerReply } from "../lib/automations";
import { checklistForService, checklistOf, linkChecklist, resumeIfChecklistComplete } from "../lib/checklist";
import { requestReference, vatFor } from "../lib/money";
import { saudiMobile, whatsappConfigured } from "../lib/whatsapp";
import { normalizePhone } from "../lib/phone";
import {
  UNPAID_INVOICE_ERROR, UNPAID_INVOICE_MOVE_ERROR, canTransition, needsInvoicesSettled, transitionError,
} from "../lib/request-status";
import { riyadhToday } from "../lib/document-reminders";
import { inspectLegacyBackup, legacyKinds, type LegacyKind } from "../lib/legacy-backup";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { officeCustomer, phoneMatches, type OfficeCustomer } from "../lib/office-search";
import {
  approvedOfficeEmail,
  clerkUsersById,
  getOfficeRole,
  verifiedEmailOf,
  requireOfficeOwner, requireOfficeStaff,
} from "../lib/office-access";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const allowedAttachmentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

export const MAX_ATTACHMENTS_PER_REQUEST = 10;
export const MAX_REQUEST_EMPLOYEES = 50;
// Largest value of a Postgres integer column; larger IDs cannot exist.
const MAX_ID = 2_147_483_647;

// Who added a file is read from the row: the request's owner, or office staff.
function attachmentInfo(row: HbsRequestAttachment, ownerId: string) {
  return {
    id: row.id, name: row.name, size: row.size, contentType: row.contentType,
    uploadedBy: row.userId === ownerId ? "customer" as const : "office" as const,
    createdAt: row.createdAt,
  };
}

// Attachment rows by request, with the request owner to tell who uploaded each.
async function attachmentsFor(requestIds: number[]) {
  const rows = requestIds.length
    ? await db.select({ attachment: hbsRequestAttachments, ownerId: hbsServiceRequests.userId })
      .from(hbsRequestAttachments)
      .innerJoin(hbsServiceRequests, eq(hbsRequestAttachments.requestId, hbsServiceRequests.id))
      .where(and(inArray(hbsRequestAttachments.requestId, requestIds), isNotNull(hbsRequestAttachments.requestId)))
      .orderBy(asc(hbsRequestAttachments.createdAt), asc(hbsRequestAttachments.id))
    : [];
  const grouped = new Map<number, { attachment: HbsRequestAttachment; ownerId: string }[]>();
  for (const row of rows) {
    if (row.attachment.requestId === null) continue;
    grouped.set(row.attachment.requestId, [...(grouped.get(row.attachment.requestId) ?? []), row]);
  }
  return grouped;
}

export type RequestEmployeeItem = { employeeId: number; fullName: string; itemStatus: string; note: string | null };

type RequestDetails = {
  attachments: ReturnType<typeof attachmentInfo>[];
  checklist: ReturnType<typeof checklistOf>;
  subject: ReturnType<typeof subjectOf>;
  lastMessage: { by: "customer" | "office"; at: Date } | null;
  employees: RequestEmployeeItem[];
};

// The employees a bulk request covers, by request, each with the office's
// progress on it. Employees since removed from the company file drop out
// with their rows (cascade), like the single-employee subject does.
async function requestEmployeesFor(requestIds: number[]) {
  const rows = requestIds.length
    ? await db.select({
      requestId: hbsRequestEmployees.requestId, employeeId: hbsRequestEmployees.employeeId,
      fullName: hbsCompanyEmployees.fullName, itemStatus: hbsRequestEmployees.itemStatus, note: hbsRequestEmployees.note,
    }).from(hbsRequestEmployees)
      .innerJoin(hbsCompanyEmployees, eq(hbsRequestEmployees.employeeId, hbsCompanyEmployees.id))
      .where(inArray(hbsRequestEmployees.requestId, requestIds))
      .orderBy(asc(hbsCompanyEmployees.fullName), asc(hbsRequestEmployees.employeeId))
    : [];
  const grouped = new Map<number, RequestEmployeeItem[]>();
  for (const { requestId, ...item } of rows) grouped.set(requestId, [...(grouped.get(requestId) ?? []), item]);
  return grouped;
}

// Everything shown with a request besides its own row: files and which
// checklist item each answers, the employee or license it is about, and who
// wrote last in its conversation.
export async function detailsFor(records: HbsServiceRequest[]): Promise<Map<number, RequestDetails>> {
  const ids = records.map(r => r.id);
  const [attached, employees, labels, last] = await Promise.all([
    attachmentsFor(ids),
    requestEmployeesFor(ids),
    subjectLabels(records.flatMap(r => r.employeeId ? [r.employeeId] : []), records.flatMap(r => r.licenseId ? [r.licenseId] : [])),
    ids.length ? db.selectDistinctOn([hbsRequestMessages.requestId], {
      requestId: hbsRequestMessages.requestId, by: hbsRequestMessages.authorRole, at: hbsRequestMessages.createdAt,
    }).from(hbsRequestMessages).where(inArray(hbsRequestMessages.requestId, ids))
      .orderBy(hbsRequestMessages.requestId, desc(hbsRequestMessages.createdAt), desc(hbsRequestMessages.id)) : [],
  ]);
  const lastBy = new Map(last.map(m => [m.requestId, { by: m.by as "customer" | "office", at: m.at }]));
  return new Map(records.map(r => [r.id, {
    attachments: (attached.get(r.id) ?? []).map(({ attachment, ownerId }) => attachmentInfo(attachment, ownerId)),
    checklist: checklistOf(r.documentChecklist, (attached.get(r.id) ?? []).map(({ attachment }) => attachment)),
    subject: subjectOf(r, labels), lastMessage: lastBy.get(r.id) ?? null,
    employees: employees.get(r.id) ?? [],
  }]));
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
  // The signed PUT for each temporary key stays valid for up to 15 minutes, so
  // deleting the key now would let it be re-uploaded with nothing tracking it.
  // Leave an already-expired reservation behind instead: it never counts
  // toward the pending-upload cap or can be attached, and the sweeper deletes
  // the key an hour later, after the signed URL has expired.
  if (finalized.length) {
    await tx.insert(hbsRequestAttachments).values(finalized.map(({ row }) => ({
      userId: row.userId, objectPath: row.objectPath, name: row.name,
      contentType: row.contentType, size: row.size, expiresAt: new Date(),
    })));
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

// Lives in lib/company-access (company members resolve against it too);
// re-exported for the routes that import it from here.
export { hasCustomerApproval };

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

// The office's quote as the customer sees it; VAT is added at acceptance
// exactly as the invoice will carry it.
function quoteOf(record: HbsServiceRequest) {
  if (record.quoteHalalas === null || record.quotedAt === null) return null;
  const vat = vatFor(record.quoteHalalas);
  return {
    amount: record.quoteHalalas, vat, total: record.quoteHalalas + vat, note: record.quoteNote,
    quotedAt: record.quotedAt, acceptedAt: record.quoteAcceptedAt, declinedAt: record.quoteDeclinedAt,
  };
}

export function publicRequest(record: HbsServiceRequest, details?: RequestDetails) {
  // Internal office notes must never be included in customer responses.
  return {
    id: record.id,
    reference: requestReference(record.id, record.createdAt),
    category: record.category,
    service: record.service,
    description: record.description,
    contactPhone: record.contactPhone,
    status: record.status,
    customerMessage: record.status === "waiting_on_customer" ? record.customerMessage : null,
    clientRequestId: record.clientRequestId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attachments: details?.attachments ?? [],
    rating: record.rating,
    ratingComment: record.ratingComment,
    ratedAt: record.ratedAt,
    subject: details?.subject ?? null,
    lastMessage: details?.lastMessage ?? null,
    quote: quoteOf(record),
    checklist: details?.checklist ?? [],
    employees: details?.employees ?? [],
  };
}

export function officeRequest(
  record: HbsServiceRequest,
  details?: RequestDetails,
  customer?: OfficeCustomer,
) {
  return {
    ...publicRequest(record, details),
    userId: record.userId,
    officeNote: record.officeNote,
    assignedTo: record.assignedTo,
    dueAt: record.dueAt,
    ...(customer !== undefined ? { customer } : {}),
  };
}

// One lookup for a whole page of rows; a customer without a registration
// maps to null like before.
async function customersOf(userIds: string[]): Promise<Map<string, OfficeCustomer>> {
  const unique = [...new Set(userIds)];
  const rows = unique.length ? await db.select({
    userId: hbsRegistrationRequests.userId, fullName: hbsRegistrationRequests.fullName, email: hbsRegistrationRequests.email,
  }).from(hbsRegistrationRequests).where(inArray(hbsRegistrationRequests.userId, unique)) : [];
  const found = new Map(rows.map(row => [row.userId, officeCustomer(row.fullName, row.email)]));
  return new Map(unique.map(userId => [userId, found.get(userId) ?? null]));
}

export async function customerOf(userId: string): Promise<OfficeCustomer> {
  return (await customersOf([userId])).get(userId) ?? null;
}

function linkedRequestContext(record: HbsServiceRequest) {
  return {
    reference: requestReference(record.id, record.createdAt),
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

// A registrant whose account was deleted has no verified email; that must not
// break the office's list or turn a review into a server error.
async function verifiedRegistrationEmail(record: HbsRegistrationRequest): Promise<string | null> {
  const user = await clerkClient.users.getUser(record.userId).catch(() => undefined);
  return verifiedEmailOf(user, record.email);
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
  // Stored in one spelling (05XXXXXXXX or +<code><number>) so the office finds it however it was typed.
  const contactPhone = parsed.success ? normalizePhone(parsed.data.contactPhone) : null;
  const note = parsed.success ? parsed.data.note?.trim() || null : null;
  if (!parsed.success || fullName.length < 2 || fullName.length > 120 || !contactPhone || (note?.length ?? 0) > 1000) {
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
  const [attached, [unpaid], expiring, [counts]] = await Promise.all([
    detailsFor(recentRequests),
    db.select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${hbsInvoices.totalHalalas}), 0)::bigint`.mapWith(Number) })
      // Request invoices and subscription invoices (request_id null) alike.
      .from(hbsInvoices).leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
      .leftJoin(hbsSubscriptions, eq(hbsInvoices.subscriptionId, hbsSubscriptions.id))
      .where(and(or(eq(hbsServiceRequests.userId, userId), eq(hbsSubscriptions.userId, userId)), eq(hbsInvoices.status, "issued"))),
    db.select().from(hbsDocumentReminders).where(and(eq(hbsDocumentReminders.userId, userId),
      sql`${hbsDocumentReminders.expiresOn} between ${riyadhToday()} - 30 and ${riyadhToday()} + 60`))
      .orderBy(asc(hbsDocumentReminders.expiresOn), asc(hbsDocumentReminders.id)).limit(8),
    db.select({
      employees: sql<number>`(select count(*)::int from ${hbsCompanyEmployees} where user_id = ${userId} and status = 'active')`,
      licenses: sql<number>`(select count(*)::int from ${hbsCompanyLicenses} where user_id = ${userId})`,
      company: sql<boolean>`exists (select 1 from hbs_companies where user_id = ${userId})`,
    }).from(sql`(select 1) as one`),
  ]);
  const response = {
    totalRequests: requests.total,
    activeRequests: requests.active,
    completedRequests: requests.completed,
    openInquiries: inquiries.open,
    recentRequests: recentRequests.map(r => publicRequest(r, attached.get(r.id))),
    recentInquiries: recentInquiries.map(({ inquiry: record, request }) => inquiry(record, request)),
    unpaidInvoices: unpaid.count,
    unpaidTotal: unpaid.total,
    expiringSoon: expiring.map(reminderInfo),
    employeesCount: counts.employees,
    licensesCount: counts.licenses,
    hasCompany: counts.company,
  };
  // Validated, then sent as is so calendar dates stay YYYY-MM-DD.
  GetPortalSummaryResponse.parse(response);
  res.json(response);
});

export function reminderInfo(row: typeof hbsDocumentReminders.$inferSelect) {
  return {
    id: row.id, kind: row.kind, label: row.label, expiresOn: row.expiresOn, note: row.note,
    addedBy: row.createdBy === row.userId ? "customer" as const : "office" as const,
    createdAt: row.createdAt,
    source: row.employeeId ? "employee" as const : row.licenseId ? "license" as const : "manual" as const,
    sourceId: row.employeeId ?? row.licenseId ?? null,
  };
}

router.get("/service-requests", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const records = await db.select().from(hbsServiceRequests)
    .where(eq(hbsServiceRequests.userId, getAuth(req).userId!))
    .orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id));
  const attached = await detailsFor(records);
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
  const contactPhone = parsed.success ? normalizePhone(parsed.data.contactPhone) : null;
  if (!parsed.success ||
      !parsed.data.service.trim() ||
      !parsed.data.description.trim()) {
    res.status(400).json({ error: "Complete all request fields" });
    return;
  }
  if (!contactPhone) {
    res.status(400).json({ error: "Enter a valid mobile number (05XXXXXXXX)." });
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
        record.contactPhone !== contactPhone) {
      res.status(409).json({ error: "This submission identifier was used for a different request." });
      return;
    }
    const attached = await detailsFor([record]);
    res.json(CreateServiceRequestResponse.parse(publicRequest(record, attached.get(record.id))));
  };
  const previous = await existingRequest();
  if (previous) {
    await respondExisting(previous);
    return;
  }
  // A bulk request names several employees, tracked one by one; it is also
  // linked to the first of them so the single-employee views still apply.
  const employeeIds = [...new Set(parsed.data.employeeIds ?? [])];
  if (employeeIds.length > MAX_REQUEST_EMPLOYEES) {
    res.status(400).json({ error: `A request can cover at most ${MAX_REQUEST_EMPLOYEES} employees.` });
    return;
  }
  const employeeId = employeeIds[0] ?? parsed.data.employeeId ?? null;
  const licenseId = parsed.data.licenseId ?? null;
  if (employeeId && licenseId) {
    res.status(400).json({ error: "Link the request to one employee or one license." });
    return;
  }
  if (employeeId || licenseId) {
    // Employees come from the company the caller works in: their own, or the
    // one they are a member of. The request itself stays theirs.
    const companyUserId = (await resolveCompanyAccess(req))?.companyUserId ?? userId;
    const wanted = employeeIds.length ? employeeIds : employeeId ? [employeeId] : [];
    const owned = wanted.length
      ? await db.select({ id: hbsCompanyEmployees.id }).from(hbsCompanyEmployees)
        .where(and(inArray(hbsCompanyEmployees.id, wanted), eq(hbsCompanyEmployees.userId, companyUserId)))
      : await db.select({ id: hbsCompanyLicenses.id }).from(hbsCompanyLicenses)
        .where(and(eq(hbsCompanyLicenses.id, licenseId!), eq(hbsCompanyLicenses.userId, companyUserId))).limit(1);
    if (owned.length !== Math.max(wanted.length, 1)) {
      // Same answer for missing and other-customer IDs.
      res.status(400).json({ error: "Invalid employee or license" });
      return;
    }
  }
  const ids = parsed.data.attachmentIds ?? [];
  if (ids.length > MAX_ATTACHMENTS_PER_REQUEST) {
    res.status(400).json({ error: `Attach at most ${MAX_ATTACHMENTS_PER_REQUEST} files.` });
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
  let record: HbsServiceRequest;
  try {
    record = await db.transaction(async (tx) => {
      const [created] = await tx.insert(hbsServiceRequests).values({
        userId, category: parsed.data.category, service: parsed.data.service.trim(),
        description: parsed.data.description.trim(), contactPhone,
        clientRequestId: requestId ?? null, employeeId, licenseId,
        // The office's published list of required documents becomes the
        // request's checklist, for the customer to tick off with uploads.
        documentChecklist: await checklistForService(tx, parsed.data.serviceSlug, parsed.data.service.trim()),
      }).returning();
      if (employeeIds.length) {
        await tx.insert(hbsRequestEmployees).values(employeeIds.map(id => ({ requestId: created.id, employeeId: id })));
      }
      await lockAndAttach(tx, userId, ids, created.id, finalized);
      return applyAssignmentRule(tx, created);
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
    (await detailsFor([record])).get(record.id))));
  const created = {
    id: record.id,
    reference: requestReference(record.id, record.createdAt),
    service: record.service,
    category: record.category,
  };
  notify(officeNewRequestMail(created));
  if (record.assignedTo) {
    notify(assignedMail(await staffEmail(record.assignedTo), created,
      record.dueAt ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "long", timeZone: "Asia/Riyadh" }).format(record.dueAt) : null));
  }
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
  const attached = await detailsFor([record]);
  res.json(GetServiceRequestResponse.parse(publicRequest(record, attached.get(record.id))));
});

async function sendAttachment(req: Request, res: import("express").Response, staff: boolean) {
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(attachmentId) || attachmentId < 1 || attachmentId > MAX_ID) {
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
  // Uploads may be assigned to checklist items in the same call: each named
  // upload must be in this batch and each item must exist, once.
  const links = body.data.checklist ?? [];
  const known = new Set(request.documentChecklist.map(item => item.key));
  if (links.some(link => !ids.includes(link.attachmentId) || !known.has(link.key)) ||
      new Set(links.map(link => link.key)).size !== links.length || new Set(links.map(link => link.attachmentId)).size !== links.length) {
    res.status(400).json({ error: "Unknown checklist item or upload" });
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
      for (const link of links) await linkChecklist(tx, request.id, link.attachmentId, link.key);
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
  // A customer's document answers a request waiting on them: back to review
  // first. An office upload that completes the checklist does the same.
  const current = !office ? (await resumeAfterCustomerReply(request.id, "customer_file")) ?? request
    : links.length ? (await resumeIfChecklistComplete(request.id)) ?? request : request;
  const details = (await detailsFor([current])).get(current.id);
  if (office) res.json(AttachOfficeServiceRequestFilesResponse.parse(officeRequest(current, details, await customerOf(current.userId))));
  else res.json(AttachServiceRequestFilesResponse.parse(publicRequest(current, details)));
  const info = { id: request.id, reference: publicRequest(request).reference, service: request.service };
  const names = finalized.map(({ row }) => row.name).join("، ");
  if (office) void notifyCustomer(request.userId, to => customerNewFileMail(to, info));
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
  const users = await clerkUsersById(records.map((record) => record.userId));
  const response = records.map((record) => ({
    ...portalRegistration(record),
    email: verifiedEmailOf(users.get(record.userId), record.email),
    reviewerId: record.reviewerId,
  }));
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

// An office member's address: their staff email, or the owner's approved email.
export async function staffEmail(userId: string): Promise<string | null> {
  const [member] = await db.select({ email: hbsOfficeStaff.email }).from(hbsOfficeStaff)
    .where(eq(hbsOfficeStaff.userId, userId)).limit(1);
  if (!member) return null;
  return member.email ?? approvedOfficeEmail();
}

router.post("/service-requests/:id/rating", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const params = RateServiceRequestParams.safeParse(req.params);
  const body = RateServiceRequestBody.safeParse(req.body);
  if (!params.success || params.data.id < 1 || !body.success) {
    res.status(400).json({ error: "Choose a rating from 1 to 5." });
    return;
  }
  const userId = getAuth(req).userId!;
  const [record] = await db.update(hbsServiceRequests).set({
    rating: body.data.rating,
    ratingComment: body.data.comment?.trim() || null,
    ratedAt: new Date(),
  }).where(and(
    eq(hbsServiceRequests.id, params.data.id), eq(hbsServiceRequests.userId, userId),
    eq(hbsServiceRequests.status, "completed"), isNull(hbsServiceRequests.rating),
  )).returning();
  if (!record) {
    const [existing] = await db.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests)
      .where(and(eq(hbsServiceRequests.id, params.data.id), eq(hbsServiceRequests.userId, userId))).limit(1);
    if (!existing) res.status(404).json({ error: "Request not found" });
    else res.status(409).json({ error: "Only a completed request can be rated, once." });
    return;
  }
  const attached = await detailsFor([record]);
  res.json(RateServiceRequestResponse.parse(publicRequest(record, attached.get(record.id))));
});

router.get("/portal/settings", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(hbsCustomerSettings)
    .where(eq(hbsCustomerSettings.userId, getAuth(req).userId!)).limit(1);
  res.json(GetPortalSettingsResponse.parse({
    whatsappOptIn: settings?.whatsappOptIn ?? false,
    whatsappPhone: settings?.whatsappPhone ?? null,
    whatsappAvailable: whatsappConfigured(),
    lastInboundAt: settings?.lastInboundAt ?? null,
  }));
});

router.put("/portal/settings", requirePortalAuth, requireApprovedCustomer, async (req, res): Promise<void> => {
  const body = SavePortalSettingsBody.safeParse(req.body);
  const typed = body.success ? body.data.whatsappPhone?.trim() || null : null;
  // Stored as 05XXXXXXXX; only Saudi mobiles can receive the office's WhatsApp template.
  const phone = typed ? normalizePhone(typed) : null;
  if (!body.success || (typed && !(phone && saudiMobile(phone))) || (body.data.whatsappOptIn && !phone)) {
    res.status(400).json({ error: "Enter a Saudi mobile number (05XXXXXXXX) to receive WhatsApp messages." });
    return;
  }
  const values = { whatsappOptIn: body.data.whatsappOptIn, whatsappPhone: phone, updatedAt: new Date() };
  const [settings] = await db.insert(hbsCustomerSettings).values({ userId: getAuth(req).userId!, ...values })
    .onConflictDoUpdate({ target: hbsCustomerSettings.userId, set: values }).returning();
  res.json(SavePortalSettingsResponse.parse({
    whatsappOptIn: settings.whatsappOptIn, whatsappPhone: settings.whatsappPhone, whatsappAvailable: whatsappConfigured(),
    lastInboundAt: settings.lastInboundAt,
  }));
});

// ---- conversation on a request -------------------------------------------------

const MESSAGES_PER_10_MINUTES = 20;

function message(row: typeof hbsRequestMessages.$inferSelect) {
  return { id: row.id, authorRole: row.authorRole, body: row.body, createdAt: row.createdAt };
}

// The request, if the caller may see it: the customer's own, or any for staff.
async function conversationRequest(req: Request, office: boolean) {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId) || requestId < 1 || requestId > MAX_ID) return null;
  const [record] = await db.select().from(hbsServiceRequests).where(office
    ? eq(hbsServiceRequests.id, requestId)
    : and(eq(hbsServiceRequests.id, requestId), eq(hbsServiceRequests.userId, getAuth(req).userId!))).limit(1);
  return record ?? null;
}

async function listMessages(req: Request, res: import("express").Response, office: boolean) {
  const record = await conversationRequest(req, office);
  if (!record) { res.status(404).json({ error: "Request not found" }); return; }
  const rows = await db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, record.id))
    .orderBy(asc(hbsRequestMessages.createdAt), asc(hbsRequestMessages.id)).limit(500);
  res.json(ListServiceRequestMessagesResponse.parse(rows.map(message)));
}

async function sendMessage(req: Request, res: import("express").Response, office: boolean) {
  const body = SendServiceRequestMessageBody.safeParse(req.body);
  const text = body.success ? body.data.body.trim() : "";
  if (!text) { res.status(400).json({ error: "Write a message." }); return; }
  const record = await conversationRequest(req, office);
  if (!record) { res.status(404).json({ error: "Request not found" }); return; }
  if (!office && record.status === "completed") {
    res.status(409).json({ error: "The request is completed. Send an inquiry instead." });
    return;
  }
  const authorId = getAuth(req).userId!;
  const [{ recent }] = await db.select({ recent: sql<number>`count(*)::int` }).from(hbsRequestMessages).where(and(
    eq(hbsRequestMessages.requestId, record.id), eq(hbsRequestMessages.authorId, authorId),
    sql`${hbsRequestMessages.createdAt} > now() - interval '10 minutes'`));
  if (recent >= MESSAGES_PER_10_MINUTES) { res.status(429).json({ error: "Too many messages. Wait a few minutes." }); return; }
  const [row] = await db.insert(hbsRequestMessages).values({
    requestId: record.id, authorId, authorRole: office ? "office" : "customer", body: text,
  }).returning();
  // Before answering, so the customer's next view already shows the new status.
  if (!office) await resumeAfterCustomerReply(record.id, "customer_message");
  res.status(201).json(SendServiceRequestMessageResponse.parse(message(row)));
  // Emails say that a message arrived, never what it says.
  const info = { id: record.id, reference: publicRequest(record).reference, service: record.service };
  if (office) void notifyCustomer(record.userId, to => customerMessageMail(to, info));
  else notify(officeMessageMail(record.assignedTo ? await staffEmail(record.assignedTo) : null, info));
}

router.get("/service-requests/:id/messages", requirePortalAuth, requireApprovedCustomer, (req, res) => listMessages(req, res, false));
router.post("/service-requests/:id/messages", requirePortalAuth, requireApprovedCustomer, (req, res) => sendMessage(req, res, false));
router.get("/office/service-requests/:id/messages", requireOfficeStaff, (req, res) => listMessages(req, res, true));
router.post("/office/service-requests/:id/messages", requireOfficeStaff, (req, res) => sendMessage(req, res, true));

router.get("/office/summary", requireOfficeStaff, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const [[requests], [inquiries], [documents]] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      received: sql<number>`count(*) filter (where status = 'received')::int`,
      active: sql<number>`count(*) filter (where status <> 'completed')::int`,
      stale: sql<number>`count(*) filter (where status <> 'completed' and updated_at <= now() - interval '3 days')::int`,
      mine: sql<number>`count(*) filter (where status <> 'completed' and assigned_to = ${userId})::int`,
      overdue: sql<number>`count(*) filter (where status <> 'completed' and due_at < now())::int`,
      awaitingReply: sql<number>`count(*) filter (where status <> 'completed' and (
        select m.author_role from ${hbsRequestMessages} m where m.request_id = hbs_service_requests.id
        order by m.created_at desc, m.id desc limit 1) = 'customer')::int`,
    }).from(hbsServiceRequests),
    db.select({
      open: sql<number>`count(*) filter (where status = 'open')::int`,
    }).from(hbsInquiries),
    db.select({ expiring: sql<number>`count(*)::int` }).from(hbsDocumentReminders)
      .where(sql`${hbsDocumentReminders.expiresOn} between ${riyadhToday()} and ${riyadhToday()} + 30`),
  ]);
  res.json(GetOfficeSummaryResponse.parse({
    totalRequests: requests.total,
    newRequests: requests.received,
    activeRequests: requests.active,
    staleRequests: requests.stale,
    openInquiries: inquiries.open,
    myRequests: requests.mine,
    overdueRequests: requests.overdue,
    expiringDocuments: documents.expiring,
    awaitingReply: requests.awaitingReply,
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
function overdueFilter() {
  return sql`${hbsServiceRequests.status} <> 'completed' and ${hbsServiceRequests.dueAt} < now()`;
}
function requestReferenceSql() {
  return sql`concat('HBS-', extract(year from ${hbsServiceRequests.createdAt} at time zone 'Asia/Riyadh')::int, '-', lpad(${hbsServiceRequests.id}::text, 5, '0'))`;
}

router.get("/office/service-requests", requireOfficeStaff, async (req, res): Promise<void> => {
  const parsed = ListOfficeServiceRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request filters" }); return; }
  const { page = 1, pageSize = 20, q, status, category, sort = "newest", assignee } = parsed.data;
  // The generated schema coerces any non-empty string to true; only "true" filters.
  const overdue = req.query.overdue === "true";
  const awaitingReply = req.query.awaitingReply === "true";
  const filter = and(
    status ? eq(hbsServiceRequests.status, status) : undefined,
    category ? eq(hbsServiceRequests.category, category) : undefined,
    assignee === "unassigned" ? isNull(hbsServiceRequests.assignedTo)
      : assignee ? eq(hbsServiceRequests.assignedTo, assignee === "me" ? getAuth(req).userId! : assignee) : undefined,
    overdue ? overdueFilter() : undefined,
    awaitingReply ? sql`${hbsServiceRequests.status} <> 'completed' and (select m.author_role from ${hbsRequestMessages} m
      where m.request_id = hbs_service_requests.id order by m.created_at desc, m.id desc limit 1) = 'customer'` : undefined,
    q ? or(contains(hbsServiceRequests.service, q), contains(hbsServiceRequests.description, q),
      phoneMatches(hbsServiceRequests.contactPhone, q), contains(requestReferenceSql(), q),
      customerMatches(hbsServiceRequests.userId, q)) : undefined,
  );
  const [[{ total }], records] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(hbsServiceRequests).where(filter),
    db.select().from(hbsServiceRequests).where(filter)
      .orderBy(...(sort === "oldest_update"
        ? [asc(hbsServiceRequests.updatedAt), asc(hbsServiceRequests.id)]
        : sort === "due_soon"
          ? [sql`${hbsServiceRequests.dueAt} asc nulls last`, asc(hbsServiceRequests.id)]
          : [desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id)]))
      .limit(pageSize).offset((page - 1) * pageSize),
  ]);
  const [attached, customers] = await Promise.all([detailsFor(records), customersOf(records.map(r => r.userId))]);
  const response = {
    items: records.map(r => officeRequest(r, attached.get(r.id), customers.get(r.userId) ?? null)),
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
  const { assignedTo, dueAt } = parsed.data;
  if (assignedTo) {
    const [member] = await db.select({ userId: hbsOfficeStaff.userId }).from(hbsOfficeStaff)
      .where(eq(hbsOfficeStaff.userId, assignedTo)).limit(1);
    if (!member) {
      res.status(400).json({ error: "The request can only be assigned to an office member." });
      return;
    }
  }
  const updatedAt = new Date(Math.max(Date.now(), parsed.data.expectedUpdatedAt.getTime() + 1));
  let previousStatus: string | null = null;
  let previousAssignee: string | null = null;
  let stale = false;
  // Held in an object: the transaction callback sets it, which narrowing of a plain variable would not see.
  const refusal: { value: { status: number; error: string } | null } = { value: null };
  const record = await db.transaction(async tx => {
    const [previous] = await tx.select({
      status: hbsServiceRequests.status,
      officeNote: hbsServiceRequests.officeNote,
      customerMessage: hbsServiceRequests.customerMessage,
      assignedTo: hbsServiceRequests.assignedTo,
      dueAt: hbsServiceRequests.dueAt,
      updatedAt: hbsServiceRequests.updatedAt,
    }).from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.id, params.data.id)).for("update");
    if (!previous) return undefined;
    // A stale editor hears that first: a rule refusal would describe a
    // transition from a status they never saw.
    if (previous.updatedAt.getTime() !== parsed.data.expectedUpdatedAt.getTime()) {
      stale = true;
      return undefined;
    }
    previousStatus = previous.status;
    previousAssignee = previous.assignedTo;
    const status = parsed.data.status;
    if (!canTransition(previous.status, status)) {
      refusal.value = { status: 409, error: transitionError(previous.status, status) };
      return undefined;
    }
    if (needsInvoicesSettled(previous.status, status)) {
      const [open] = await tx.select({ id: hbsInvoices.id }).from(hbsInvoices)
        .where(and(eq(hbsInvoices.requestId, params.data.id), eq(hbsInvoices.status, "issued"))).limit(1);
      if (open) {
        refusal.value = { status: 409, error: status === "completed" ? UNPAID_INVOICE_ERROR : UNPAID_INVOICE_MOVE_ERROR };
        return undefined;
      }
    }
    // The message to the customer is kept while the status stays, replaced
    // when a new one is sent, and cleared once the request moves on.
    const customerMessage = parsed.data.customerMessage !== undefined
      ? parsed.data.customerMessage?.trim() || null : previous.customerMessage;
    if (status === "waiting_on_customer" && !customerMessage) {
      refusal.value = { status: 400, error: "Explain to the customer what is needed." };
      return undefined;
    }
    const [updated] = await tx.update(hbsServiceRequests).set({
      status,
      ...(parsed.data.officeNote !== undefined ? { officeNote: parsed.data.officeNote } : {}),
      ...(assignedTo !== undefined ? { assignedTo } : {}),
      ...(dueAt !== undefined ? { dueAt } : {}),
      customerMessage: status === previous.status || status === "waiting_on_customer" ? customerMessage : null,
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
        ...(previous.assignedTo !== updated.assignedTo ? { fromAssignee: previous.assignedTo, toAssignee: updated.assignedTo } : {}),
        ...((previous.dueAt?.getTime() ?? null) !== (updated.dueAt?.getTime() ?? null) ? { dueAt: updated.dueAt } : {}),
      },
    });
    return updated;
  });
  if (!record) {
    if (refusal.value) {
      res.status(refusal.value.status).json({ error: refusal.value.error });
      return;
    }
    if (stale) {
      res.status(409).json({ error: "This request changed since you opened it. Refresh and review the latest version." });
      return;
    }
    res.status(404).json({ error: "Request not found" });
    return;
  }
  const customer = await customerOf(record.userId);
  const attached = await detailsFor([record]);
  const response = officeRequest(record, attached.get(record.id), customer);
  UpdateOfficeServiceRequestResponse.parse(response);
  res.json(response);
  const info = { id: record.id, reference: publicRequest(record).reference, service: record.service };
  if (previousStatus !== record.status) {
    void notifyCustomer(record.userId, to => statusChangedMail(to, info, record.status, record.customerMessage));
  }
  if (record.assignedTo && record.assignedTo !== previousAssignee && record.assignedTo !== getAuth(req).userId) {
    notify(assignedMail(await staffEmail(record.assignedTo), info,
      record.dueAt ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "long", timeZone: "Asia/Riyadh" }).format(record.dueAt) : null));
  }
});

// One employee's progress on a bulk request. Items are the office's own
// tracking: when every item is done the office still completes the request
// itself.
router.patch("/office/service-requests/:id/employees/:employeeId", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = UpdateOfficeRequestEmployeeParams.safeParse(req.params);
  const body = UpdateOfficeRequestEmployeeBody.safeParse(req.body);
  if (!params.success) { res.status(404).json({ error: "Request not found" }); return; }
  if (!body.success) { res.status(400).json({ error: "Invalid update" }); return; }
  const note = body.data.note === undefined ? undefined : body.data.note?.trim() || null;
  const actorId = getAuth(req).userId!;
  const record = await db.transaction(async tx => {
    const [item] = await tx.update(hbsRequestEmployees)
      .set({ itemStatus: body.data.itemStatus, ...(note === undefined ? {} : { note }), updatedAt: new Date() })
      .where(and(eq(hbsRequestEmployees.requestId, params.data.id), eq(hbsRequestEmployees.employeeId, params.data.employeeId)))
      .returning();
    if (!item) return null;
    await recordAudit(tx, {
      actorId, action: "service_request.employee_item", targetType: "service_request", targetId: item.requestId,
      details: { employeeId: item.employeeId, itemStatus: item.itemStatus, noteChanged: note !== undefined },
    });
    const [current] = await tx.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, item.requestId)).limit(1);
    return current ?? null;
  });
  if (!record) { res.status(404).json({ error: "Request or employee not found" }); return; }
  const response = officeRequest(record, (await detailsFor([record])).get(record.id), await customerOf(record.userId));
  UpdateOfficeRequestEmployeeResponse.parse(response);
  res.json(response);
});

router.get("/office/inquiries", requireOfficeStaff, async (req, res): Promise<void> => {
  const parsed = ListOfficeInquiriesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid inquiry filters" }); return; }
  const { page = 1, pageSize = 20, q, status } = parsed.data;
  const filter = and(
    status ? eq(hbsInquiries.status, status) : undefined,
    q ? or(contains(hbsInquiries.subject, q), contains(hbsInquiries.message, q),
      contains(requestReferenceSql(), q), customerMatches(hbsInquiries.userId, q)) : undefined,
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
  const customers = await customersOf(records.map(({ inquiry: record }) => record.userId));
  const response = {
    items: records.map(({ inquiry: record, request }) => officeInquiry(record, request, customers.get(record.userId) ?? null)),
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
  if (firstAnswer) void notifyCustomer(record.userId, to => inquiryAnsweredMail(to, record.subject));
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
  // The identifiers are grouped in the database: one row per batch and
  // kind instead of every imported record coming back to be sorted here.
  const [batches, groups] = await Promise.all([
    db.select().from(hbsLegacyImports).orderBy(desc(hbsLegacyImports.importedAt)),
    db.select({
      importId: hbsLegacyRecords.importId, kind: hbsLegacyRecords.kind,
      legacyIds: sql<string[]>`array_agg(${hbsLegacyRecords.legacyId} order by ${hbsLegacyRecords.legacyId} collate "C")`,
    }).from(hbsLegacyRecords).where(inArray(hbsLegacyRecords.kind, [...legacyKinds]))
      .groupBy(hbsLegacyRecords.importId, hbsLegacyRecords.kind),
  ]);
  res.json(ListLegacyImportsResponse.parse(batches.map(batch => {
    const ids: Record<LegacyKind, string[]> = { clients: [], transactions: [], tasks: [], notes: [] };
    for (const group of groups) {
      if (group.importId === batch.id) ids[group.kind as LegacyKind] = group.legacyIds;
    }
    const counts = Object.fromEntries(legacyKinds.map(kind => [kind, ids[kind].length]));
    return { id: batch.id, importedAt: batch.importedAt, exportedAt: batch.exportedAt, digest: batch.digest, ids, counts };
  })));
});

export default router;