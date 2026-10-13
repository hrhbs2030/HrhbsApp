import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsInquiries, hbsInquiryMessages, hbsRegistrationRequests, hbsRequestMessages, hbsWhatsappInbound, type HbsWhatsappInbound } from "@workspace/db";
import {
  ListWhatsappInboxQueryParams, ListWhatsappInboxResponse, ReplyWhatsappInboxBody, ReplyWhatsappInboxParams, ReplyWhatsappInboxResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { intentOf, maskPhone, suggestReplies } from "../lib/notification-intelligence";
import { emitThreadEvent, type ThreadRef } from "../lib/messaging";
import { requireOfficeStaff } from "../lib/office-access";
import { freeTextWindowOpen, sendText, sendWhatsApp, whatsappConfigured } from "../lib/whatsapp";

// The office's WhatsApp inbox: inbound messages (routes/whatsapp-webhook.ts
// records them) with the intent the intelligence module reads from the text
// and reply drafts, and a reply endpoint. Meta allows free text for 24 hours
// after the customer's last message; after that only the approved template
// goes out (lib/whatsapp.ts).

// What sending needs from the outside, so the route can be tested without Meta.
export type WhatsappSender = {
  // Plain text: token and number only.
  sendText(to: string, text: string): Promise<boolean>;
  // The template path of sendWhatsApp (no window given).
  sendTemplate(to: string, text: string): Promise<boolean>;
};

export const whatsappSender: WhatsappSender = {
  sendText,
  sendTemplate: (to, text) => sendWhatsApp(to, text, null),
};

// Sending anything needs the token and the number; the template is needed
// only once the customer's window has closed.
const whatsappOn = () => Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

// The customer's latest message per number: the window is measured from it,
// not from the message being answered.
async function lastInboundByPhone(phones: string[]): Promise<Map<string, Date>> {
  if (!phones.length) return new Map();
  const rows = await db.select({ fromPhone: hbsWhatsappInbound.fromPhone, last: sql<Date>`max(${hbsWhatsappInbound.receivedAt})` })
    .from(hbsWhatsappInbound).where(inArray(hbsWhatsappInbound.fromPhone, [...new Set(phones)])).groupBy(hbsWhatsappInbound.fromPhone);
  return new Map(rows.map((row) => [row.fromPhone, new Date(row.last)]));
}

// The reply also goes into the thread the inbound message landed on, so the
// portal conversation shows both sides: the request when the row names one,
// else the inquiry the webhook created from this very text (hbs_whatsapp_inbound
// keeps no inquiry id, so it is found by owner and body). Nothing is recorded
// for unmatched numbers.
// Returns the thread the reply landed in, so the customer's inbox can be told.
async function recordReplyInThread(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], row: HbsWhatsappInbound, authorId: string, text: string): Promise<ThreadRef | null> {
  if (row.requestId) {
    await tx.insert(hbsRequestMessages).values({ requestId: row.requestId, authorId, authorRole: "office", body: text, channel: "whatsapp" });
    return { type: "request", id: row.requestId };
  }
  if (row.handled !== "inquiry" || !row.userId) return null;
  const [inquiry] = await tx.select({ id: hbsInquiries.id, answer: hbsInquiries.answer }).from(hbsInquiries)
    .where(and(eq(hbsInquiries.userId, row.userId), eq(hbsInquiries.message, row.body)))
    .orderBy(desc(hbsInquiries.createdAt), desc(hbsInquiries.id)).limit(1);
  if (!inquiry) return null;
  await tx.insert(hbsInquiryMessages).values({ inquiryId: inquiry.id, authorId, authorRole: "office", body: text, channel: "whatsapp" });
  // Compat with the single-answer inquiry model: the first office message is the answer.
  await tx.update(hbsInquiries).set({ status: "answered", ...(inquiry.answer === null ? { answer: text, answeredAt: new Date() } : {}) })
    .where(eq(hbsInquiries.id, inquiry.id));
  return { type: "inquiry", id: inquiry.id };
}

export function createOfficeWhatsappRouter(sender: WhatsappSender = whatsappSender): IRouter {
  const router: IRouter = Router();

  router.get("/office/whatsapp/inbox", requireOfficeStaff, async (req, res): Promise<void> => {
    const query = ListWhatsappInboxQueryParams.safeParse(req.query);
    if (!query.success) { res.status(400).json({ error: "معاملات غير صالحة." }); return; }
    const rows = await db.select().from(hbsWhatsappInbound)
      .where(query.data.handled === "unmatched" ? eq(hbsWhatsappInbound.handled, "unmatched") : undefined)
      .orderBy(desc(hbsWhatsappInbound.receivedAt), desc(hbsWhatsappInbound.waMessageId)).limit(query.data.limit);
    const userIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null))];
    const [names, lastInbound] = await Promise.all([
      userIds.length
        ? db.select({ userId: hbsRegistrationRequests.userId, fullName: hbsRegistrationRequests.fullName })
          .from(hbsRegistrationRequests).where(inArray(hbsRegistrationRequests.userId, userIds))
        : Promise.resolve([]),
      lastInboundByPhone(rows.map((row) => row.fromPhone)),
    ]);
    const nameOf = new Map(names.map((row) => [row.userId, row.fullName]));
    const now = Date.now();
    res.json(ListWhatsappInboxResponse.parse(rows.map((row) => {
      const intent = intentOf(row.body);
      const customerName = row.userId ? nameOf.get(row.userId) ?? null : null;
      const canReplyFreeText = freeTextWindowOpen(lastInbound.get(row.fromPhone) ?? row.receivedAt, now);
      return {
        waMessageId: row.waMessageId, fromPhoneMasked: maskPhone(row.fromPhone), userId: row.userId, customerName,
        requestId: row.requestId, body: row.body, receivedAt: row.receivedAt, handled: row.handled, intent,
        suggestedReplies: suggestReplies(intent.intent, { customerName, reference: intent.reference, freeText: canReplyFreeText }),
        canReplyFreeText,
      };
    })));
  });

  router.post("/office/whatsapp/inbox/:waMessageId/reply", requireOfficeStaff, async (req, res): Promise<void> => {
    const params = ReplyWhatsappInboxParams.safeParse(req.params);
    if (!params.success) { res.status(404).json({ error: "الرسالة غير موجودة." }); return; }
    const body = ReplyWhatsappInboxBody.strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "اكتب نص الرد (حتى 1024 حرفًا)." }); return; }
    const [message] = await db.select().from(hbsWhatsappInbound)
      .where(eq(hbsWhatsappInbound.waMessageId, params.data.waMessageId)).limit(1);
    if (!message) { res.status(404).json({ error: "الرسالة غير موجودة." }); return; }
    if (!whatsappOn()) { res.status(503).json({ error: "خدمة واتساب غير مفعّلة على الخادم." }); return; }
    const lastInbound = (await lastInboundByPhone([message.fromPhone])).get(message.fromPhone) ?? message.receivedAt;
    const sentAs = freeTextWindowOpen(lastInbound) ? "text" : "template";
    if (sentAs === "template" && !whatsappConfigured()) {
      res.status(409).json({ error: "انتهت نافذة الرد الحر (24 ساعة) ولا يوجد قالب معتمد للإرسال." }); return;
    }
    const text = body.data.text.trim();
    if (!text) { res.status(400).json({ error: "اكتب نص الرد (حتى 1024 حرفًا)." }); return; }
    const sent = sentAs === "text" ? await sender.sendText(message.fromPhone, text) : await sender.sendTemplate(message.fromPhone, text);
    if (!sent) { res.status(502).json({ error: "تعذر إرسال الرسالة عبر واتساب. حاول مرة أخرى." }); return; }
    const actorId = getAuth(req).userId!;
    const thread = await db.transaction(async (tx) => {
      const recorded = await recordReplyInThread(tx, message, actorId, text);
      await recordAudit(tx, {
        actorId, action: "whatsapp.reply", targetType: "whatsapp_message", targetId: message.waMessageId,
        details: { waMessageId: message.waMessageId, chars: text.length, sentAs },
      });
      return recorded;
    });
    res.status(202).json(ReplyWhatsappInboxResponse.parse({ sentAs }));
    if (thread && message.userId) void emitThreadEvent(thread, "office", message.userId);
  });

  return router;
}

const router: IRouter = createOfficeWhatsappRouter();
export default router;
