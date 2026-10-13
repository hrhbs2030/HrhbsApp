import { getAuth } from "@clerk/express";
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  GetWhatsappLinkQueryParams, GetWhatsappLinkResponse,
  ListInquiryMessagesParams, ListInquiryMessagesResponse, ListMessageThreadsQueryParams, ListMessageThreadsResponse,
  ListOfficeInquiryMessagesParams, ListOfficeInquiryMessagesResponse, ListOfficeMessageThreadsQueryParams, ListOfficeMessageThreadsResponse,
  MarkOfficeThreadReadParams, MarkOfficeThreadReadResponse, MarkThreadReadParams, MarkThreadReadResponse,
  SendInquiryMessageBody, SendInquiryMessageParams, SendInquiryMessageResponse,
  SendOfficeInquiryMessageBody, SendOfficeInquiryMessageParams, SendOfficeInquiryMessageResponse,
} from "@workspace/api-zod";
import {
  MESSAGES_PER_10_MINUTES, afterMessageRecorded, listThreadMessages, listThreads, loadThread, markRead, officeFollowUpLink,
  recentMessagesBy, recordMessage, sendViaWhatsapp, serializeMessage, type Viewer,
} from "../lib/messaging";
import { requireOfficeStaff } from "../lib/office-access";
import { requireApprovedCustomer } from "./portal";

// The unified inbox («الرسائل») for customers and staff, inquiry threads and
// the customer's WhatsApp follow-up link. Request threads keep their routes
// in routes/portal.ts; both go through lib/messaging.ts.

const router: IRouter = Router();

export const TOO_MANY_MESSAGES_ERROR = "Too many messages. Wait a few minutes.";
export const NOT_FOUND_ERROR = "Inquiry not found";

const viewerOf = (req: Request, role: Viewer["role"]): Viewer => ({ userId: getAuth(req).userId!, role });

async function threads(req: Request, res: Response, role: Viewer["role"]) {
  const parsed = role === "office" ? ListOfficeMessageThreadsQueryParams.safeParse(req.query) : ListMessageThreadsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid thread filters" }); return; }
  const list = await listThreads(viewerOf(req, role), parsed.data);
  res.json((role === "office" ? ListOfficeMessageThreadsResponse : ListMessageThreadsResponse).parse(list));
}

async function read(req: Request, res: Response, role: Viewer["role"]) {
  const params = (role === "office" ? MarkOfficeThreadReadParams : MarkThreadReadParams).safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Thread not found" }); return; }
  const result = await markRead(viewerOf(req, role), params.data);
  if (!result) { res.status(404).json({ error: "Thread not found" }); return; }
  res.json((role === "office" ? MarkOfficeThreadReadResponse : MarkThreadReadResponse).parse(result));
}

async function inquiryMessages(req: Request, res: Response, role: Viewer["role"]) {
  const params = (role === "office" ? ListOfficeInquiryMessagesParams : ListInquiryMessagesParams).safeParse(req.params);
  const info = params.success ? await loadThread({ type: "inquiry", id: params.data.id }, viewerOf(req, role)) : null;
  if (!info) { res.status(404).json({ error: NOT_FOUND_ERROR }); return; }
  const rows = await listThreadMessages(info);
  res.json((role === "office" ? ListOfficeInquiryMessagesResponse : ListInquiryMessagesResponse).parse(rows.map(serializeMessage)));
}

async function sendInquiryMessage(req: Request, res: Response, role: Viewer["role"]) {
  const params = (role === "office" ? SendOfficeInquiryMessageParams : SendInquiryMessageParams).safeParse(req.params);
  const body = role === "office" ? SendOfficeInquiryMessageBody.safeParse(req.body) : SendInquiryMessageBody.safeParse(req.body);
  const text = body.success ? body.data.body.trim() : "";
  if (!text) { res.status(400).json({ error: "Write a message." }); return; }
  const thread = params.success ? { type: "inquiry" as const, id: params.data.id } : null;
  const info = thread ? await loadThread(thread, viewerOf(req, role)) : null;
  if (!thread || !info) { res.status(404).json({ error: NOT_FOUND_ERROR }); return; }
  const authorId = getAuth(req).userId!;
  if ((await recentMessagesBy(thread, authorId)) >= MESSAGES_PER_10_MINUTES) { res.status(429).json({ error: TOO_MANY_MESSAGES_ERROR }); return; }
  // Sent on WhatsApp before it is saved, so a refusal records nothing and
  // staff can simply try again.
  const viaWhatsapp = role === "office" && body.success && "viaWhatsapp" in body.data && body.data.viaWhatsapp;
  if (viaWhatsapp) {
    const sent = await sendViaWhatsapp(info, text);
    if (!sent.ok) { res.status(sent.status).json({ error: sent.error }); return; }
  }
  const row = await recordMessage(db, { thread, authorId, authorRole: role, body: text, channel: viaWhatsapp ? "whatsapp" : "portal" });
  res.status(201).json((role === "office" ? SendOfficeInquiryMessageResponse : SendInquiryMessageResponse).parse(serializeMessage(row)));
  void afterMessageRecorded(thread, row, { customerUserId: info.customerUserId, info });
}

router.get("/messages/threads", requireApprovedCustomer, (req, res) => threads(req, res, "customer"));
router.get("/office/messages/threads", requireOfficeStaff, (req, res) => threads(req, res, "office"));
router.post("/messages/threads/:type/:id/read", requireApprovedCustomer, (req, res) => read(req, res, "customer"));
router.post("/office/messages/threads/:type/:id/read", requireOfficeStaff, (req, res) => read(req, res, "office"));
router.get("/inquiries/:id/messages", requireApprovedCustomer, (req, res) => inquiryMessages(req, res, "customer"));
router.post("/inquiries/:id/messages", requireApprovedCustomer, (req, res) => sendInquiryMessage(req, res, "customer"));
router.get("/office/inquiries/:id/messages", requireOfficeStaff, (req, res) => inquiryMessages(req, res, "office"));
router.post("/office/inquiries/:id/messages", requireOfficeStaff, (req, res) => sendInquiryMessage(req, res, "office"));

// The wa.me link to the office number with the thread's reference prefilled.
router.get("/messages/whatsapp-link", requireApprovedCustomer, async (req, res): Promise<void> => {
  const query = GetWhatsappLinkQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid thread" }); return; }
  const info = await loadThread(query.data, viewerOf(req, "customer"));
  if (!info) { res.status(404).json({ error: "Thread not found" }); return; }
  res.json(GetWhatsappLinkResponse.parse(officeFollowUpLink(info)));
});

export default router;
