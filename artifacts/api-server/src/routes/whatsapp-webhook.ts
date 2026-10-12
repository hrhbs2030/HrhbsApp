import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsCustomerSettings, hbsInquiries, hbsRequestMessages, hbsServiceRequests, hbsWhatsappInbound } from "@workspace/db";
import { WhatsappWebhookVerifyQueryParams } from "@workspace/api-zod";
import { resumeAfterCustomerReply } from "../lib/automations";
import { notifyOffice, type OfficeNotifyMeta } from "../lib/customer-contact";
import { logger } from "../lib/logger";
import { requestReference } from "../lib/money";
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
// A text message from a customer's registered number becomes a message on
// their one open request, or an inquiry when they have several (or none);
// other numbers are kept for the office to look at. Processing is bounded;
// failed database transactions return non-2xx so Meta can redeliver them.

export const MAX_MESSAGES_PER_DELIVERY = 20;
export const INQUIRY_SUBJECT = "رسالة واتساب";
export const SEVERAL_OPEN_REPLY = "وصلتنا رسالتك. لأنك تملك أكثر من طلب مفتوح، أضفناها كاستفسار وسيرد المكتب من البوابة.";
export const NO_OPEN_REPLY = "وصلتنا رسالتك وأضفناها كاستفسار، وسيرد المكتب من البوابة.";
export const VERIFICATION_CHALLENGE_PREFIX = "HBS WhatsApp verification:";
export const INBOUND_RETENTION_DAYS = 90;
export const UNMATCHED_BODY_CHARS = 200;

// Optional maintenance only; never scheduled without an approved retention
// policy. Keep message IDs permanently so signed redelivery cannot create
// another transaction or attach an old message to a new phone owner.
export async function purgeOldWhatsappInbound(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INBOUND_RETENTION_DAYS * 86_400_000);
  const rows = await db.update(hbsWhatsappInbound).set({ body: "[WhatsApp message body removed by retention policy]" })
    .where(and(lt(hbsWhatsappInbound.receivedAt, cutoff),
      ne(hbsWhatsappInbound.body, "[WhatsApp message body removed by retention policy]")))
    .returning({ id: hbsWhatsappInbound.waMessageId });
  return rows.length;
}

export type InboundHandled = "request_message" | "inquiry" | "unmatched" | "ignored";

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
  addRequestMessage(requestId: number, userId: string, text: string): Promise<void>;
  afterCustomerReply(requestId: number): Promise<void>;
  createInquiry(userId: string, text: string): Promise<number>;
  finish(waMessageId: string, outcome: { userId: string | null; requestId: number | null; handled: InboundHandled }, body?: string): Promise<void>;
  reply(to: string, text: string): Promise<void>;
};

export type InboundDeps = InboundOperations & {
  notifyOffice(build: Parameters<typeof notifyOffice>[0], meta: OfficeNotifyMeta): Promise<void>;
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
    async addRequestMessage(requestId, userId, text) {
      await executor.insert(hbsRequestMessages).values({ requestId, authorId: userId, authorRole: "customer", body: text });
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
    const open = await ops.openRequests(customer.userId);
    if (open.length === 1) {
      const [request] = open;
      await ops.addRequestMessage(request.id, customer.userId, message.text);
      await ops.finish(message.id, { userId: customer.userId, requestId: request.id, handled: "request_message" });
      return { handled: "request_message" as const, afterCommit: async () => {
        await ops.afterCustomerReply(request.id);
        await deps.notifyOffice(() => officeMessageMail(null,
          { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service }),
        { kind: "office.whatsapp_message", targetType: "service_request", targetId: request.id, signals: { text: message.text } });
      } };
    }
    const inquiryId = await ops.createInquiry(customer.userId, message.text);
    await ops.finish(message.id, { userId: customer.userId, requestId: null, handled: "inquiry" });
    return { handled: "inquiry" as const, afterCommit: async () => {
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

