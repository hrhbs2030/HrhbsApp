import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsCustomerSettings, hbsInquiries, hbsRequestMessages, hbsServiceRequests, hbsWhatsappInbound } from "@workspace/db";
import { WhatsappWebhookVerifyQueryParams } from "@workspace/api-zod";
import { resumeAfterCustomerReply } from "../lib/automations";
import { logger } from "../lib/logger";
import { requestReference } from "../lib/money";
import { notify, officeMessageMail, officeNewInquiryMail } from "../lib/notify";
import { inboundPhoneLocal, parseInboundMessages, sendText, verifyWhatsappSignature, type InboundTextMessage } from "../lib/whatsapp";
import { staffEmail } from "./portal";

// WhatsApp inbound webhook (Meta Cloud API). No authentication: Meta calls
// these directly. Contract in lib/api-spec/openapi.yaml under the `webhooks`
// tag; rows in hbs_whatsapp_inbound; hbs_customer_settings.last_inbound_at is
// updated for matched customers.
//
// app.ts parses /api/webhooks/whatsapp with express.raw() so `req.body` here is
// a Buffer: the X-Hub-Signature-256 HMAC (WHATSAPP_APP_SECRET) is checked
// against the raw bytes before JSON.parse.
//
// A text message from a customer's registered number becomes a message on
// their one open request, or an inquiry when they have several (or none);
// other numbers are kept for the office to look at. Meta retries anything
// not answered 200 quickly, so a delivery is processed within a bound and
// always acknowledged.

export const MAX_MESSAGES_PER_DELIVERY = 20;
export const INQUIRY_SUBJECT = "رسالة واتساب";
export const SEVERAL_OPEN_REPLY = "وصلتنا رسالتك. لأنك تملك أكثر من طلب مفتوح، أضفناها كاستفسار وسيرد المكتب من البوابة.";
export const NO_OPEN_REPLY = "وصلتنا رسالتك وأضفناها كاستفسار، وسيرد المكتب من البوابة.";

export type InboundHandled = "request_message" | "inquiry" | "unmatched" | "ignored";

// What handling a message needs from the outside, so the routing can be
// tested without a database or Meta.
export type InboundDeps = {
  // Records the message once; false when Meta delivered it before.
  record(message: InboundTextMessage, fromPhone: string): Promise<boolean>;
  // The customer whose WhatsApp number is stored as `local` (05XXXXXXXX).
  customerByPhone(local: string): Promise<{ userId: string } | null>;
  touchInbound(userId: string): Promise<void>;
  // The customer's requests that are not completed, newest activity first (two are enough).
  openRequests(userId: string): Promise<{ id: number; createdAt: Date; service: string; assignedTo: string | null }[]>;
  addRequestMessage(requestId: number, userId: string, text: string): Promise<void>;
  createInquiry(userId: string, text: string): Promise<void>;
  finish(waMessageId: string, outcome: { userId: string | null; requestId: number | null; handled: InboundHandled }): Promise<void>;
  reply(to: string, text: string): Promise<void>;
};

export const inboundDeps: InboundDeps = {
  async record(message, fromPhone) {
    const inserted = await db.insert(hbsWhatsappInbound)
      .values({ waMessageId: message.id, fromPhone, body: message.text, handled: "ignored" })
      .onConflictDoNothing().returning({ id: hbsWhatsappInbound.waMessageId });
    return inserted.length > 0;
  },
  async customerByPhone(local) {
    const [row] = await db.select({ userId: hbsCustomerSettings.userId }).from(hbsCustomerSettings)
      .where(eq(hbsCustomerSettings.whatsappPhone, local))
      .orderBy(desc(hbsCustomerSettings.updatedAt)).limit(1);
    return row ?? null;
  },
  async touchInbound(userId) {
    await db.update(hbsCustomerSettings).set({ lastInboundAt: new Date() }).where(eq(hbsCustomerSettings.userId, userId));
  },
  async openRequests(userId) {
    return db.select({
      id: hbsServiceRequests.id, createdAt: hbsServiceRequests.createdAt, service: hbsServiceRequests.service, assignedTo: hbsServiceRequests.assignedTo,
    }).from(hbsServiceRequests)
      .where(and(eq(hbsServiceRequests.userId, userId), ne(hbsServiceRequests.status, "completed")))
      .orderBy(desc(hbsServiceRequests.updatedAt), desc(hbsServiceRequests.id)).limit(2);
  },
  async addRequestMessage(requestId, userId, text) {
    await db.insert(hbsRequestMessages).values({ requestId, authorId: userId, authorRole: "customer", body: text });
    await resumeAfterCustomerReply(requestId, "customer_message");
  },
  async createInquiry(userId, text) {
    await db.insert(hbsInquiries).values({ userId, subject: INQUIRY_SUBJECT, message: text });
  },
  async finish(waMessageId, outcome) {
    await db.update(hbsWhatsappInbound).set(outcome).where(eq(hbsWhatsappInbound.waMessageId, waMessageId));
  },
  async reply(to, text) {
    await sendText(to, text);
  },
};

// Routes one text message. Returns what was done, or null for a repeat delivery.
export async function handleInboundMessage(message: InboundTextMessage, deps: InboundDeps = inboundDeps): Promise<InboundHandled | null> {
  const fromPhone = message.from.replace(/\D/g, "").slice(0, 20);
  if (!(await deps.record(message, fromPhone))) return null;
  const local = inboundPhoneLocal(message.from);
  const customer = local ? await deps.customerByPhone(local) : null;
  if (!customer) {
    await deps.finish(message.id, { userId: null, requestId: null, handled: "unmatched" });
    return "unmatched";
  }
  await deps.touchInbound(customer.userId);
  const open = await deps.openRequests(customer.userId);
  if (open.length === 1) {
    const [request] = open;
    await deps.addRequestMessage(request.id, customer.userId, message.text);
    await deps.finish(message.id, { userId: customer.userId, requestId: request.id, handled: "request_message" });
    notify(officeMessageMail(request.assignedTo ? await staffEmail(request.assignedTo) : null,
      { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service }));
    return "request_message";
  }
  await deps.createInquiry(customer.userId, message.text);
  await deps.finish(message.id, { userId: customer.userId, requestId: null, handled: "inquiry" });
  notify(officeNewInquiryMail(INQUIRY_SUBJECT, null));
  // The customer's own message opened the 24-hour window, so plain text is allowed.
  await deps.reply(fromPhone, open.length ? SEVERAL_OPEN_REPLY : NO_OPEN_REPLY);
  return "inquiry";
}

export async function processInboundPayload(payload: unknown, deps: InboundDeps = inboundDeps): Promise<Record<InboundHandled | "duplicate", number>> {
  const counts = { request_message: 0, inquiry: 0, unmatched: 0, ignored: 0, duplicate: 0 };
  for (const message of parseInboundMessages(payload).slice(0, MAX_MESSAGES_PER_DELIVERY)) {
    try {
      counts[(await handleInboundMessage(message, deps)) ?? "duplicate"]++;
    } catch (err) {
      // The row (if recorded) keeps handled 'ignored' for the office to look at.
      logger.error({ err }, "WhatsApp inbound message was not handled");
    }
  }
  return counts;
}

export function createWhatsappWebhookRouter(deps: InboundDeps = inboundDeps): IRouter {
  const router: IRouter = Router();

  router.get("/webhooks/whatsapp", (req, res): void => {
    const token = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!token) { res.status(404).end(); return; }
    // The generated schema coerces a missing parameter to the string
    // "undefined", so presence is checked first.
    const present = ["hub.mode", "hub.verify_token", "hub.challenge"].every(key => typeof req.query[key] === "string");
    const query = present ? WhatsappWebhookVerifyQueryParams.safeParse(req.query) : null;
    const given = query?.success ? Buffer.from(query.data["hub.verify_token"]) : Buffer.alloc(0);
    const expected = Buffer.from(token);
    if (!query?.success || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(403).end();
      return;
    }
    res.status(200).type("text/plain").send(query.data["hub.challenge"]);
  });

  router.post("/webhooks/whatsapp", async (req, res): Promise<void> => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) { res.status(404).end(); return; }
    if (!Buffer.isBuffer(req.body)) { res.status(400).end(); return; }
    if (!verifyWhatsappSignature(req.body, req.header("x-hub-signature-256"), secret)) { res.status(401).end(); return; }
    let payload: unknown;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      // Signed by Meta but not JSON: nothing to do, and nothing to retry.
      res.status(200).end();
      return;
    }
    const counts = await processInboundPayload(payload, deps);
    if (Object.values(counts).some(Boolean)) req.log.info(counts, "WhatsApp inbound delivery handled");
    res.status(200).end();
  });

  return router;
}

export default createWhatsappWebhookRouter();

