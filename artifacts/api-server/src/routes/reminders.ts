import { getAuth } from "@clerk/express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, hbsDocumentReminders, hbsRegistrationRequests, hbsRequestAttachments, hbsServiceRequests,
  type HbsDocumentReminder,
} from "@workspace/db";
import {
  CreateOfficeReminderBody, CreateOfficeReminderParams, CreateReminderBody, CreateReminderResponse,
  DeleteReminderParams, ExtractOfficeAttachmentDocumentParams, ExtractOfficeAttachmentDocumentResponse,
  ListOfficeRemindersQueryParams, ListOfficeRemindersResponse, ListRemindersResponse,
  UpdateReminderBody, UpdateReminderParams, UpdateReminderResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { parseExtraction, readDocumentWithClaude, type DocumentReader } from "../lib/document-extraction";
import { riyadhToday } from "../lib/document-reminders";
import { ObjectStorageService } from "../lib/objectStorage";
import { officeCustomer } from "../lib/office-search";
import { requireOfficeStaff } from "../lib/office-access";
import { requireApprovedCustomer } from "./portal";

const MAX_REMINDERS_PER_CUSTOMER = 50;
const storage = new ObjectStorageService();

function reminder(row: HbsDocumentReminder) {
  return {
    id: row.id, kind: row.kind, label: row.label, expiresOn: row.expiresOn, note: row.note,
    addedBy: row.createdBy === row.userId ? "customer" as const : "office" as const,
    createdAt: row.createdAt,
  };
}

type Input = { kind: HbsDocumentReminder["kind"]; label: string; expiresOn: string; note: string | null };

// The body's date is coerced to a Date at UTC midnight; keep the calendar
// date the customer picked and reject anything that is not YYYY-MM-DD.
function readInput(req: Request, schema: typeof CreateReminderBody): Input | null {
  const parsed = schema.safeParse(req.body);
  const raw = (req.body as { expiresOn?: unknown })?.expiresOn;
  if (!parsed.success || typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const label = parsed.data.label.trim();
  if (label.length < 2) return null;
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100 || parsed.data.expiresOn.toISOString().slice(0, 10) !== raw) return null;
  return { kind: parsed.data.kind, label, expiresOn: raw, note: parsed.data.note?.trim() || null };
}

function send<T>(res: Response, status: number, schema: { parse: (v: unknown) => unknown }, body: T) {
  // Validate, but send the row as is: expiresOn stays a calendar date string.
  schema.parse(body);
  res.status(status).json(body);
}

export function createRemindersRouter(readDocument: DocumentReader = readDocumentWithClaude): IRouter {
  const router: IRouter = Router();

  router.get("/reminders", requireApprovedCustomer, async (req, res): Promise<void> => {
    const rows = await db.select().from(hbsDocumentReminders)
      .where(eq(hbsDocumentReminders.userId, getAuth(req).userId!))
      .orderBy(asc(hbsDocumentReminders.expiresOn), asc(hbsDocumentReminders.id));
    send(res, 200, ListRemindersResponse, rows.map(reminder));
  });

  router.post("/reminders", requireApprovedCustomer, async (req, res): Promise<void> => {
    const input = readInput(req, CreateReminderBody);
    if (!input) { res.status(400).json({ error: "Complete the document type, name and expiry date." }); return; }
    const userId = getAuth(req).userId!;
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(hbsDocumentReminders)
      .where(eq(hbsDocumentReminders.userId, userId));
    if (count >= MAX_REMINDERS_PER_CUSTOMER) {
      res.status(409).json({ error: `You can keep up to ${MAX_REMINDERS_PER_CUSTOMER} reminders.` });
      return;
    }
    const [row] = await db.insert(hbsDocumentReminders).values({ userId, createdBy: userId, ...input }).returning();
    send(res, 201, CreateReminderResponse, reminder(row));
  });

  router.put("/reminders/:id", requireApprovedCustomer, async (req, res): Promise<void> => {
    const params = UpdateReminderParams.safeParse(req.params);
    const input = readInput(req, UpdateReminderBody);
    if (!params.success || !input) { res.status(400).json({ error: "Complete the document type, name and expiry date." }); return; }
    const userId = getAuth(req).userId!;
    const [row] = await db.update(hbsDocumentReminders).set({
      ...input,
      // A new expiry date starts the reminders again.
      lastReminderDays: sql`case when ${hbsDocumentReminders.expiresOn} = ${input.expiresOn}::date then ${hbsDocumentReminders.lastReminderDays} else null end`,
      updatedAt: new Date(),
    }).where(and(eq(hbsDocumentReminders.id, params.data.id), eq(hbsDocumentReminders.userId, userId))).returning();
    if (!row) { res.status(404).json({ error: "Reminder not found" }); return; }
    send(res, 200, UpdateReminderResponse, reminder(row));
  });

  router.delete("/reminders/:id", requireApprovedCustomer, async (req, res): Promise<void> => {
    const params = DeleteReminderParams.safeParse(req.params);
    if (!params.success) { res.status(404).json({ error: "Reminder not found" }); return; }
    const [row] = await db.delete(hbsDocumentReminders).where(and(
      eq(hbsDocumentReminders.id, params.data.id), eq(hbsDocumentReminders.userId, getAuth(req).userId!),
    )).returning({ id: hbsDocumentReminders.id });
    if (!row) { res.status(404).json({ error: "Reminder not found" }); return; }
    res.status(204).end();
  });

  router.get("/office/reminders", requireOfficeStaff, async (req, res): Promise<void> => {
    const query = ListOfficeRemindersQueryParams.safeParse(req.query);
    if (!query.success) { res.status(400).json({ error: "Invalid filter" }); return; }
    const within = query.data.withinDays ?? 60;
    const rows = await db.select({ reminder: hbsDocumentReminders, registration: hbsRegistrationRequests })
      .from(hbsDocumentReminders)
      .leftJoin(hbsRegistrationRequests, eq(hbsRegistrationRequests.userId, hbsDocumentReminders.userId))
      .where(sql`${hbsDocumentReminders.expiresOn} between ${riyadhToday()} and ${riyadhToday()} + ${within}::int`)
      .orderBy(asc(hbsDocumentReminders.expiresOn), asc(hbsDocumentReminders.id))
      .limit(500);
    send(res, 200, ListOfficeRemindersResponse, rows.map(({ reminder: row, registration }) => ({
      ...reminder(row),
      customer: officeCustomer(registration?.fullName ?? null, registration?.email ?? null),
      contactPhone: registration?.contactPhone ?? null,
    })));
  });

  router.post("/office/service-requests/:id/reminders", requireOfficeStaff, async (req, res): Promise<void> => {
    const params = CreateOfficeReminderParams.safeParse(req.params);
    const input = readInput(req, CreateOfficeReminderBody);
    if (!params.success || !input) { res.status(400).json({ error: "Complete the document type, name and expiry date." }); return; }
    const [request] = await db.select({ id: hbsServiceRequests.id, userId: hbsServiceRequests.userId })
      .from(hbsServiceRequests).where(eq(hbsServiceRequests.id, params.data.id)).limit(1);
    if (!request) { res.status(404).json({ error: "Request not found" }); return; }
    const actorId = getAuth(req).userId!;
    const row = await db.transaction(async tx => {
      const [created] = await tx.insert(hbsDocumentReminders).values({ userId: request.userId, createdBy: actorId, ...input }).returning();
      await recordAudit(tx, {
        actorId, action: "reminder.create", targetType: "service_request", targetId: request.id,
        details: { reminderId: created.id, kind: created.kind, expiresOn: created.expiresOn },
      });
      return created;
    });
    send(res, 201, CreateReminderResponse, reminder(row));
  });

  // AI reading of a customer's document spends credits and reads private
  // data: office staff only, and every use is audited like a download.
  router.post("/office/service-requests/attachments/:attachmentId/extract", requireOfficeStaff, async (req, res): Promise<void> => {
    const params = ExtractOfficeAttachmentDocumentParams.safeParse(req.params);
    if (!params.success || params.data.attachmentId < 1) { res.status(404).json({ error: "Attachment not found" }); return; }
    const [row] = await db.select({ attachment: hbsRequestAttachments }).from(hbsRequestAttachments)
      .innerJoin(hbsServiceRequests, eq(hbsRequestAttachments.requestId, hbsServiceRequests.id))
      .where(and(eq(hbsRequestAttachments.id, params.data.attachmentId),
        inArray(hbsRequestAttachments.contentType, ["application/pdf", "image/jpeg", "image/png"]))).limit(1);
    if (!row) { res.status(404).json({ error: "Attachment not found" }); return; }
    try {
      await db.transaction(tx => recordAudit(tx, {
        actorId: getAuth(req).userId!, action: "attachment.extract", targetType: "service_request",
        targetId: row.attachment.requestId!, details: { attachmentId: row.attachment.id, name: row.attachment.name },
      }));
      const file = await storage.getObjectEntityFile(row.attachment.objectPath);
      const [data] = await file.download();
      const result = parseExtraction(await readDocument({ data, contentType: row.attachment.contentType }));
      ExtractOfficeAttachmentDocumentResponse.parse(result);
      res.json(result);
    } catch (error) {
      req.log.error({ err: error }, "Document extraction failed");
      res.status(502).json({ error: "تعذّرت قراءة المستند. أدخل البيانات يدويًا." });
    }
  });

  return router;
}

export default createRemindersRouter();
