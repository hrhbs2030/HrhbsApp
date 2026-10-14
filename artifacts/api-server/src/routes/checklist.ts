import { getAuth } from "@clerk/express";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, hbsRequestAttachments, hbsServiceRequests } from "@workspace/db";
import {
  LinkAttachmentToChecklistBody, LinkAttachmentToChecklistParams, LinkAttachmentToChecklistResponse,
  LinkOfficeAttachmentToChecklistBody, LinkOfficeAttachmentToChecklistParams, LinkOfficeAttachmentToChecklistResponse,
  SaveOfficeChecklistBody, SaveOfficeChecklistParams, SaveOfficeChecklistResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { CHECKLIST_KEY, checklistItems, linkChecklist, resumeIfChecklistComplete } from "../lib/checklist";
import { requireOfficeStaff } from "../lib/office-access";
import { customerId } from "../lib/company-access";
import { customerOf, detailsFor, officeRequest, publicRequest, requireApprovedCustomer } from "./portal";

// The document checklist on a request: the office edits the list, and the
// customer (or the office) links an uploaded file to each item.

const router: IRouter = Router();

router.put("/office/service-requests/:id/checklist", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = SaveOfficeChecklistParams.safeParse(req.params);
  const body = SaveOfficeChecklistBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.items.some(item => item.key !== undefined && !CHECKLIST_KEY.test(item.key))) {
    res.status(400).json({ error: "Invalid checklist" }); return;
  }
  const keys = body.data.items.flatMap(item => item.key ? [item.key] : []);
  if (new Set(keys).size !== keys.length) { res.status(400).json({ error: "Checklist keys must be unique" }); return; }
  const actorId = getAuth(req).userId!;
  const record = await db.transaction(async tx => {
    const [request] = await tx.select({ id: hbsServiceRequests.id, documentChecklist: hbsServiceRequests.documentChecklist }).from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.id, params.data.id)).for("update");
    if (!request) return null;
    const items = checklistItems(body.data.items, request.documentChecklist.map(item => item.key));
    const [updated] = await tx.update(hbsServiceRequests).set({ documentChecklist: items, updatedAt: new Date() })
      .where(eq(hbsServiceRequests.id, request.id)).returning();
    // Files linked to removed items are kept, only their link is dropped.
    await tx.update(hbsRequestAttachments).set({ checklistKey: null }).where(and(
      eq(hbsRequestAttachments.requestId, request.id), sql`${hbsRequestAttachments.checklistKey} is not null`,
      ...(items.length ? [notInArray(hbsRequestAttachments.checklistKey, items.map(item => item.key))] : [])));
    await recordAudit(tx, {
      actorId, action: "service_request.checklist", targetType: "service_request", targetId: request.id,
      details: { items: items.length },
    });
    return updated;
  });
  if (!record) { res.status(404).json({ error: "Request not found" }); return; }
  res.json(SaveOfficeChecklistResponse.parse(officeRequest(record, (await detailsFor([record])).get(record.id), await customerOf(record.userId))));
});

async function linkAttachment(req: Request, res: Response, office: boolean) {
  const params = (office ? LinkOfficeAttachmentToChecklistParams : LinkAttachmentToChecklistParams).safeParse(req.params);
  const body = (office ? LinkOfficeAttachmentToChecklistBody : LinkAttachmentToChecklistBody).safeParse(req.body);
  if (!params.success) { res.status(404).json({ error: "Request not found" }); return; }
  if (!body.success || (body.data.key !== null && !CHECKLIST_KEY.test(body.data.key))) { res.status(400).json({ error: "Invalid checklist item" }); return; }
  // Customers act for their company: the request and its files are the customer's.
  const userId = office ? getAuth(req).userId! : customerId(req);
  const key = body.data.key;
  const outcome = await db.transaction(async tx => {
    const [request] = await tx.select().from(hbsServiceRequests).where(office
      ? eq(hbsServiceRequests.id, params.data.id)
      : and(eq(hbsServiceRequests.id, params.data.id), eq(hbsServiceRequests.userId, userId))).for("update");
    if (!request) return "missing" as const;
    const [attachment] = await tx.select({ id: hbsRequestAttachments.id, userId: hbsRequestAttachments.userId }).from(hbsRequestAttachments)
      .where(and(eq(hbsRequestAttachments.id, params.data.attachmentId), eq(hbsRequestAttachments.requestId, request.id))).limit(1);
    // Customers link only their own files, and not on a completed request.
    if (!attachment || (!office && attachment.userId !== userId)) return "missing" as const;
    if (!office && request.status === "completed") return "completed" as const;
    if (key !== null && !request.documentChecklist.some(item => item.key === key)) return "unknown" as const;
    await linkChecklist(tx, request.id, attachment.id, key);
    return request;
  });
  if (outcome === "missing") { res.status(404).json({ error: "Attachment not found" }); return; }
  if (outcome === "completed") { res.status(409).json({ error: "The request is completed" }); return; }
  if (outcome === "unknown") { res.status(400).json({ error: "Unknown checklist item" }); return; }
  const current = (key !== null ? await resumeIfChecklistComplete(outcome.id) : null) ?? outcome;
  const details = (await detailsFor([current])).get(current.id);
  if (office) res.json(LinkOfficeAttachmentToChecklistResponse.parse(officeRequest(current, details, await customerOf(current.userId))));
  else res.json(LinkAttachmentToChecklistResponse.parse(publicRequest(current, details)));
}

router.put("/service-requests/:id/attachments/:attachmentId/checklist", requireApprovedCustomer, (req, res) => linkAttachment(req, res, false));
router.put("/office/service-requests/:id/attachments/:attachmentId/checklist", requireOfficeStaff, (req, res) => linkAttachment(req, res, true));

export default router;
