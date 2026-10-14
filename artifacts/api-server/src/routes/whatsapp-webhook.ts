import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsCustomerSettings, hbsInquiries, hbsInquiryMessages, hbsRequestMessages, hbsServiceRequests, hbsWhatsappInbound } from "@workspace/db";
import { WhatsappWebhookVerifyQueryParams } from "@workspace/api-zod";
import { resumeAfterCustomerReply } from "../lib/automations";
import { notifyOffice, type OfficeNotifyMeta } from "../lib/customer-contact";
import { shuttingDown, trackJob } from "../lib/lifecycle";
import { logger } from "../lib/logger";
import { requestReference } from "../lib/money";
import { westernDigits } from "../lib/notification-intelligence";
import { emitThreadEvent, type ThreadRef } from "../lib/messaging";
import { officeMessageMail, officeNewInquiryMail } from "../lib/notify";
import { hashWhatsappChallenge, inboundPhoneLocal, parseInboundMessages, sendText, verifyWhatsappSignature, type InboundTextMessage } from "../lib/whatsapp";

// WhatsApp inbound webhook (Meta Cloud API). No authentication: Meta calls
// these directly. Contract in lib/api-spec/openapi.yaml under the `webhooks`
// tag; rows in hbs_whatsapp_inbound; hbs_customer_settings.last_inbound_at is
// updated for matched customers.
//
// app.ts parses /api/webhooks/whatsapp with express.raw() so `req.body` here is
// a Buffer: the X-Hub-Signature-256 HMAC (WHATSAPP_APP_SECRET) is checked
// against the raw bytes before JSON.parse.
//
// A text message from a customer's verified number is routed by what it
// quotes first: a full request reference (HBS-YYYY-NNNNN, as the portal's
// WhatsApp links prefill it) lands on that request even after completion,
// «استفسار #N» lands on that inquiry and reopens it. Otherwise it becomes a
// message on their one open request, or an inquiry when they have several
// (or none); other numbers are kept for the office to look at. Processing is bounded;
// failed database transactions return non-2xx so Meta can redeliver them.

export const MAX_MESSAGES_PER_DELIVERY = 20;
export const INQUIRY_SUBJECT = "رسالة واتساب";
export const SEVERAL_OPEN_REPLY = "وصلتنا رسالتك. لأنك تملك أكثر من طلب مفتوح، أضفناها كاستفسار وسيرد المكتب من البوابة.";
export const NO_OPEN_REPLY = "وصلتنا رسالتك وأضفناها كاستفسار، وسيرد المكتب من البوابة.";
export const VERIFICATION_CHALLENGE_PREFIX = "HBS WhatsApp verification:";
export const INBOUND_RETENTION_DAYS = 90;
export const UNMATCHED_BODY_CHARS = 200;

// Retention: message bodies older than INBOUND_RETENTION_DAYS are blanked
// (daily, startWhatsappInboundPurge). Message IDs are kept permanently so
// signed redelivery cannot create another transaction or attach an old
// message to a new phone owner.
export async function purgeOldWhatsappInbound(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INBOUND_RETENTION_DAYS * 86_400_000);
  const rows = await db.update(hbsWhatsappInbound).set({ body: "[WhatsApp message body removed by retention policy]" })
    .where(and(lt(hbsWhatsappInbound.receivedAt, cutoff),
      ne(hbsWhatsappInbound.body, "[WhatsApp message body removed by retention policy]")))
    .returning({ id: hbsWhatsappInbound.waMessageId });
  return rows.length;
}

const INBOUND_PURGE_INTERVAL_MS = 24 * 60 * 60_000;

// Idempotent and claim-free (two servers blanking the same rows is
// harmless). No timer holds the process open; nothing re-arms after
// shutdown began.
export function startWhatsappInboundPurge() {
  const purge = (delay: number) => {
    setTimeout(async () => {
      if (shuttingDown()) return;
      try {
        const removed = await trackJob(() => purgeOldWhatsappInbound());
        if (removed) logger.info({ removed }, "Removed WhatsApp message bodies older than 90 days");
      } catch (err) {
        logger.error({ err }, "WhatsApp inbound purge failed");
      } finally {
        if (!shuttingDown()) purge(INBOUND_PURGE_INTERVAL_MS);
      }
    }, delay).unref();
  };
  purge(20 * 60_000);
}

export type InboundHandled = "request_message" | "inquiry" | "unmatched" | "ignored";

// The full reference only (requestReference in lib/money.ts): a bare number
// is ambiguous between requests and inquiries, so it is not routed on.
const REQUEST_REFERENCE = /\bHBS-(\d{4})-(\d{5,9})\b/i;
const INQUIRY_REFERENCE = /استفسار\s*(?:رقم\s*)?#?\s*(\d{1,9})/;

// The request reference quoted in a text, in canonical spelling, or null.
export function quotedRequestReference(text: string): string | null {
  const match = westernDigits(text).match(REQUEST_REFERENCE);
  return match ? `HBS-${match[1]}-${match[2]}` : null;
}

// The inquiry number quoted as «استفسار #N» / «استفسار رقم N», or null.
export function quotedInquiryId(text: string): number | null {
  const match = westernDigits(text).match(INQUIRY_REFERENCE);
  const id = match ? Number(match[1]) : 0;
  return id > 0 ? id : null;
}

// What handling a message needs from the outside, so the routing can be
// tested without a database or Meta.
export type InboundOperations = {
  // Records the message once; false when Meta delivered it before.
  record(message: InboundTextMessage, fromPhone: string): Promise<boolean>;
  // The customer whose WhatsApp number is stored as `local` (05XXXXXXXX).
  customerByPhone(local: string): Promise<{ userId: string } | null>;
  // Consumes a matching, live phone-possession challenge. Does not reveal
  // whether a challenge exists or belongs to another portal account.
  verifyChallenge(local: string, text: string): Promise<boolean>;
  touchInbound(userId: string): Promise<void>;
  // The customer's requests that are not completed, newest activity first (two are enough).
  openRequests(userId: string): Promise<{ id: number; createdAt: Date; service: string; assignedTo: string | null }[]>;
  // The customer's request with that full reference, whatever its status.
  requestByReference(userId: string, reference: string): Promise<{ id: number; createdAt: Date; service: string } | null>;
  // The customer's inquiry with that id, answered or not.
  inquiryById(userId: string, id: number): Promise<{ id: number; subject: string } | null>;
  addRequestMessage(requestId: number, userId: string, text: string): Promise<void>;
  afterCustomerReply(requestId: number): Promise<void>;
  // A customer message on an existing inquiry thread; the inquiry is open again.
  addInquiryMessage(inquiryId: number, userId: string, text: string): Promise<void>;
  createInquiry(userId: string, text: string): Promise<number>;
  finish(waMessageId: string, outcome: { userId: string | null; requestId: number | null; handled: InboundHandled }, body?: string): Promise<void>;
  reply(to: string, text: string): Promise<void>;
};

export type InboundDeps = InboundOperations & {
  notifyOffice(build: Parameters<typeof notifyOffice>[0], meta: OfficeNotifyMeta): Promise<void>;
  // The live "thread" event for staff inboxes (lib/messaging.ts).
  emitThread(thread: ThreadRef, customerUserId: string): Promise<void>;
  // The inbound claim, verification mutation and tenant destination insert
  // share this transaction. A failed destination insert rolls the claim back
  // so Meta can safely redeliver it.
  atomic<T>(work: (operations: InboundOperations) => Promise<T>): Promise<T>;
};

function operationsFor(executor: any): InboundOperations {
  return {
    async record(message, fromPhone) {
      const inserted = await executor.insert(hbsWhatsappInbound)
        .values({ waMessageId: message.id, fromPhone, body: message.text, handled: "ignored" })
        .onConflictDoNothing().returning({ id: hbsWhatsappInbound.waMessageId });
      return inserted.length > 0;
    },
    async customerByPhone(local) {
      const [row] = await executor.select({ userId: hbsCustomerSettings.userId }).from(hbsCustomerSettings)
        .where(and(eq(hbsCustomerSettings.whatsappPhone, local), eq(hbsCustomerSettings.whatsappVerified, true)))
        .limit(1);
      return row ?? null;
    },
    async verifyChallenge(local, text) {
      if (!text.startsWith(VERIFICATION_CHALLENGE_PREFIX)) return false;
      const now = new Date();
      const challenges = await executor.select({
        userId: hbsCustomerSettings.userId,
        hash: hbsCustomerSettings.whatsappVerificationChallengeHash,
      }).from(hbsCustomerSettings).where(and(
        eq(hbsCustomerSettings.whatsappPhone, local),
        eq(hbsCustomerSettings.whatsappVerified, false),
        gt(hbsCustomerSettings.whatsappVerificationExpiresAt, now),
      ));
      const challenge = challenges.find((candidate: { userId: string; hash: string | null }) => {
        if (!candidate.hash) return false;
        const actual = Buffer.from(candidate.hash, "hex");
        const expected = Buffer.from(hashWhatsappChallenge(candidate.userId, local, text), "hex");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
      });
      if (!challenge) return false;
      const expectedHash = hashWhatsappChallenge(challenge.userId, local, text);

      // Serialize ownership checks for this number, then let the partial
      // unique index be the final concurrency guard.
      await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${local}))`);
      const [owner] = await executor.select({ userId: hbsCustomerSettings.userId }).from(hbsCustomerSettings)
        .where(and(
          eq(hbsCustomerSettings.whatsappPhone, local),
          eq(hbsCustomerSettings.whatsappVerified, true),
        )).limit(1);
      if (owner && owner.userId !== challenge.userId) return false;
      const verified = await executor.update(hbsCustomerSettings).set({
        whatsappVerified: true,
        whatsappVerificationChallengeHash: null,
        whatsappVerificationExpiresAt: null,
        lastInboundAt: now,
        updatedAt: now,
      }).where(and(
        eq(hbsCustomerSettings.userId, challenge.userId),
        eq(hbsCustomerSettings.whatsappPhone, local),
        eq(hbsCustomerSettings.whatsappVerificationChallengeHash, expectedHash),
        gt(hbsCustomerSettings.whatsappVerificationExpiresAt, now),
      )).returning({ userId: hbsCustomerSettings.userId });
      return verified.length > 0;
    },
    async touchInbound(userId) {
      await executor.update(hbsCustomerSettings).set({ lastInboundAt: new Date() }).where(eq(hbsCustomerSettings.userId, userId));
    },
    async openRequests(userId) {
      return executor.select({
        id: hbsServiceRequests.id, createdAt: hbsServiceRequests.createdAt, service: hbsServiceRequests.service, assignedTo: hbsServiceRequests.assignedTo,
      }).from(hbsServiceRequests)
        .where(and(eq(hbsServiceRequests.userId, userId), ne(hbsServiceRequests.status, "completed")))
        .orderBy(desc(hbsServiceRequests.updatedAt), desc(hbsServiceRequests.id)).limit(2);
    },
    async requestByReference(userId, reference) {
      // The sequence is the id; the year is checked by re-deriving the reference.
      const id = Number(reference.slice(reference.lastIndexOf("-") + 1));
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const [row] = await executor.select({
        id: hbsServiceRequests.id, createdAt: hbsServiceRequests.createdAt, service: hbsServiceRequests.service,
      }).from(hbsServiceRequests).where(and(eq(hbsServiceRequests.id, id), eq(hbsServiceRequests.userId, userId))).limit(1);
      return row && requestReference(row.id, row.createdAt) === reference ? row : null;
    },
    async inquiryById(userId, id) {
      const [row] = await executor.select({ id: hbsInquiries.id, subject: hbsInquiries.subject }).from(hbsInquiries)
        .where(and(eq(hbsInquiries.id, id), eq(hbsInquiries.userId, userId))).limit(1);
      return row ?? null;
    },
    async addRequestMessage(requestId, userId, text) {
      await executor.insert(hbsRequestMessages).values({ requestId, authorId: userId, authorRole: "customer", body: text, channel: "whatsapp" });
    },
    async addInquiryMessage(inquiryId, userId, text) {
      await executor.insert(hbsInquiryMessages).values({ inquiryId, authorId: userId, authorRole: "customer", body: text, channel: "whatsapp" });
      await executor.update(hbsInquiries).set({ status: "open" }).where(eq(hbsInquiries.id, inquiryId));
    },
    async afterCustomerReply(requestId) {
      await resumeAfterCustomerReply(requestId, "customer_message");
    },
    async createInquiry(userId, text) {
      const [row] = await executor.insert(hbsInquiries).values({ userId, subject: INQUIRY_SUBJECT, message: text })
        .returning({ id: hbsInquiries.id });
      return row.id;
    },
    async finish(waMessageId, outcome, body) {
      await executor.update(hbsWhatsappInbound).set({ ...outcome, ...(body === undefined ? {} : { body }) })
        .where(eq(hbsWhatsappInbound.waMessageId, waMessageId));
    },
    async reply(to, text) {
      await sendText(to, text);
    },
  };
}

const databaseOps = operationsFor(db);
export const inboundDeps: InboundDeps = {
  ...databaseOps,
  notifyOffice,
  emitThread: (thread, customerUserId) => emitThreadEvent(thread, "customer", customerUserId),
  async atomic(work) {
    return db.transaction(tx => work(operationsFor(tx)));
  },
};

export const UNMATCHED_PREVIEW_CHARS = 80;

// Routes one text message. Returns what was done, or null for a repeat delivery.
export async function handleInboundMessage(message: InboundTextMessage, deps: InboundDeps = inboundDeps): Promise<InboundHandled | null> {
  const fromPhone = message.from.replace(/\D/g, "").slice(0, 20);
  const local = inboundPhoneLocal(message.from);
  const result = await deps.atomic(async ops => {
    const storedMessage = message.text.startsWith(VERIFICATION_CHALLENGE_PREFIX)
      ? { ...message, text: "[WhatsApp verification challenge]" }
      : message;
    if (!(await ops.record(storedMessage, fromPhone))) return null;
    if (local && message.text.startsWith(VERIFICATION_CHALLENGE_PREFIX)) {
      const verified = await ops.verifyChallenge(local, message.text);
      await ops.finish(message.id, { userId: null, requestId: null, handled: verified ? "ignored" : "unmatched" });
      return verified ? "ignored" as const : "unmatched" as const;
    }
    const customer = local ? await ops.customerByPhone(local) : null;
    if (!customer) {
      await ops.finish(message.id, { userId: null, requestId: null, handled: "unmatched" }, message.text.slice(0, UNMATCHED_BODY_CHARS));
      const masked = `${fromPhone.slice(0, 4)}••••••${fromPhone.slice(-2)}`;
      return { handled: "unmatched" as const, afterCommit: async () => {
        await deps.notifyOffice(() => null, {
          kind: "office.whatsapp_unmatched", targetType: "whatsapp_phone", targetId: masked,
          signals: { text: message.text },
          copy: { title: "رسالة واتساب من رقم غير معروف", body: `${masked}: ${message.text.slice(0, UNMATCHED_PREVIEW_CHARS)}`, path: "/office/whatsapp" },
        });
      } };
    }
    await ops.touchInbound(customer.userId);
    // A quoted reference wins over the open-request rule; a reference that is
    // not the customer's own is ignored rather than refused, so the text still
    // reaches the office through the fallbacks.
    const reference = quotedRequestReference(message.text);
    const referenced = reference ? await ops.requestByReference(customer.userId, reference) : null;
    const quotedInquiry = referenced ? null : quotedInquiryId(message.text);
    const inquiry = quotedInquiry ? await ops.inquiryById(customer.userId, quotedInquiry) : null;
    if (inquiry) {
      await ops.addInquiryMessage(inquiry.id, customer.userId, message.text);
      await ops.finish(message.id, { userId: customer.userId, requestId: null, handled: "inquiry" });
      return { handled: "inquiry" as const, afterCommit: async () => {
        await deps.emitThread({ type: "inquiry", id: inquiry.id }, customer.userId);
        await deps.notifyOffice(() => officeNewInquiryMail(inquiry.subject, null),
          { kind: "office.inquiry_message", targetType: "inquiry", targetId: inquiry.id, signals: { text: message.text } });
      } };
    }
    const open = referenced ? [referenced] : await ops.openRequests(customer.userId);
    if (open.length === 1) {
      const [request] = open;
      await ops.addRequestMessage(request.id, customer.userId, message.text);
      await ops.finish(message.id, { userId: customer.userId, requestId: request.id, handled: "request_message" });
      return { handled: "request_message" as const, afterCommit: async () => {
        await ops.afterCustomerReply(request.id);
        await deps.emitThread({ type: "request", id: request.id }, customer.userId);
        await deps.notifyOffice(() => officeMessageMail(null,
          { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service }),
        { kind: "office.whatsapp_message", targetType: "service_request", targetId: request.id, signals: { text: message.text } });
      } };
    }
    const inquiryId = await ops.createInquiry(customer.userId, message.text);
    await ops.finish(message.id, { userId: customer.userId, requestId: null, handled: "inquiry" });
    return { handled: "inquiry" as const, afterCommit: async () => {
      await deps.emitThread({ type: "inquiry", id: inquiryId }, customer.userId);
      await deps.notifyOffice(() => officeNewInquiryMail(INQUIRY_SUBJECT, null),
        { kind: "office.whatsapp_message", targetType: "inquiry", targetId: inquiryId, signals: { text: message.text } });
      // The customer's own message opened the 24-hour window, so plain text is allowed.
      await ops.reply(fromPhone, open.length ? SEVERAL_OPEN_REPLY : NO_OPEN_REPLY);
    } };
  });
  if (!result) return null;
  if (typeof result === "string") return result;
  try {
    await result.afterCommit();
  } catch (err) {
    logger.error({ err }, "WhatsApp post-commit notification failed");
  }
  return result.handled;
}

export async function processInboundPayload(payload: unknown, deps: InboundDeps = inboundDeps): Promise<Record<InboundHandled | "duplicate", number>> {
  const counts = { request_message: 0, inquiry: 0, unmatched: 0, ignored: 0, duplicate: 0 };
  let failed = false;
  for (const message of parseInboundMessages(payload).slice(0, MAX_MESSAGES_PER_DELIVERY)) {
    try {
      counts[(await handleInboundMessage(message, deps)) ?? "duplicate"]++;
    } catch (err) {
      // The DB transaction rolls back the dedupe claim along with a failed
      // destination write, allowing Meta's signed redelivery to retry.
      failed = true;
      logger.error({ err }, "WhatsApp inbound message was not handled");
    }
  }
  if (failed) throw new Error("One or more WhatsApp messages were not durably handled");
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
    try {
      const counts = await processInboundPayload(payload, deps);
      if (Object.values(counts).some(Boolean)) req.log.info(counts, "WhatsApp inbound delivery handled");
      res.status(200).end();
    } catch {
      // A non-2xx response asks Meta to redeliver signed messages whose
      // destination transaction rolled back.
      res.status(500).end();
    }
  });

  return router;
}

export default createWhatsappWebhookRouter();

