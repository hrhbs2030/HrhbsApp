import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  freeTextWindowOpen, inboundPhoneLocal, parseInboundMessages, verifyWhatsappSignature,
} from "../src/lib/whatsapp";
import {
  INQUIRY_SUBJECT, MAX_MESSAGES_PER_DELIVERY, NO_OPEN_REPLY, SEVERAL_OPEN_REPLY,
  createWhatsappWebhookRouter, handleInboundMessage, processInboundPayload, type InboundDeps,
} from "../src/routes/whatsapp-webhook";

// No database here: routing goes through fake deps, and the HTTP checks
// stop at the signature or the verify token.

const secret = "app-secret-for-tests";
const sign = (body: string | Buffer) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const delivery = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages, ...extra } }] }],
});
const text = (id: string, from: string, body: string) => ({ id, from, type: "text", timestamp: "1", text: { body } });

test("signatures are checked over the raw bytes", () => {
  const raw = Buffer.from('{"a":1}');
  assert.ok(verifyWhatsappSignature(raw, sign(raw), secret));
  assert.ok(!verifyWhatsappSignature(raw, sign(Buffer.from('{"a":2}')), secret));
  assert.ok(!verifyWhatsappSignature(raw, sign(raw), "other-secret"));
  assert.ok(!verifyWhatsappSignature(raw, undefined, secret));
  assert.ok(!verifyWhatsappSignature(raw, sign(raw).slice("sha256=".length), secret), "the sha256= prefix is required");
  assert.ok(!verifyWhatsappSignature(raw, "sha256=zz", secret));
});

test("only text messages are parsed; statuses, media and malformed entries are ignored", () => {
  const parsed = parseInboundMessages(delivery([
    text("wamid.1", "966500000001", "  مرحبا  "),
    { id: "wamid.2", from: "966500000001", type: "image", image: { id: "x" } },
    { id: "wamid.3", from: "966500000001", type: "text", text: { body: "   " } },
    { id: "", from: "966500000001", type: "text", text: { body: "no id" } },
    { id: "wamid.4", type: "text", text: { body: "no sender" } },
    "junk", null,
  ], { statuses: [{ id: "wamid.9", status: "delivered" }] }));
  assert.deepEqual(parsed, [{ id: "wamid.1", from: "966500000001", text: "مرحبا" }]);
  assert.deepEqual(parseInboundMessages({ entry: "nope" }), []);
  assert.deepEqual(parseInboundMessages(null), []);
  assert.deepEqual(parseInboundMessages({ entry: [{ changes: [{ value: { statuses: [] } }] }, {}] }), []);
  const long = parseInboundMessages(delivery([text("wamid.5", "966500000001", "x".repeat(5000))]));
  assert.equal(long[0].text.length, 4000);
});

test("the sender's number is matched in the stored 05… spelling", () => {
  assert.equal(inboundPhoneLocal("966500000001"), "0500000001");
  assert.equal(inboundPhoneLocal("+966500000001"), "0500000001");
  assert.equal(inboundPhoneLocal("0500000001"), "0500000001");
  assert.equal(inboundPhoneLocal("971500000001"), null, "not a Saudi mobile");
  assert.equal(inboundPhoneLocal("96611234567"), null, "landlines do not receive WhatsApp");
  assert.equal(inboundPhoneLocal("abc"), null);
});

test("free text is allowed for 24 hours after the customer's last message", () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.ok(freeTextWindowOpen(new Date(now - 60_000), now));
  assert.ok(!freeTextWindowOpen(new Date(now - 24 * 60 * 60_000), now));
  assert.ok(!freeTextWindowOpen(null, now));
  assert.ok(!freeTextWindowOpen(undefined, now));
});

type Log = { kind: string; args: unknown[] }[];

function fakeDeps(options: { customers?: Record<string, string>; open?: Record<string, number[]>; seen?: Set<string> } = {}) {
  const log: Log = [];
  const seen = options.seen ?? new Set<string>();
  const deps: InboundDeps = {
    async record(message, fromPhone) {
      log.push({ kind: "record", args: [message.id, fromPhone] });
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    },
    async customerByPhone(local) {
      const userId = options.customers?.[local];
      return userId ? { userId } : null;
    },
    async touchInbound(userId) { log.push({ kind: "touch", args: [userId] }); },
    async openRequests(userId) {
      return (options.open?.[userId] ?? []).map(id => ({ id, createdAt: new Date(0), service: "خدمة", assignedTo: null }));
    },
    async addRequestMessage(requestId, userId, body) { log.push({ kind: "message", args: [requestId, userId, body] }); },
    async createInquiry(userId, body) { log.push({ kind: "inquiry", args: [userId, body] }); return 7; },
    async finish(id, outcome) { log.push({ kind: "finish", args: [id, outcome] }); },
    async reply(to, body) { log.push({ kind: "reply", args: [to, body] }); },
    async notifyOffice(build, meta) { log.push({ kind: "notify", args: [meta, build()] }); },
  };
  return { deps, log };
}

const message = { id: "wamid.a", from: "966500000001", text: "هل اكتمل الطلب؟" };

test("a known number with one open request adds a message to it", async () => {
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" }, open: { "user-1": [41] } });
  assert.equal(await handleInboundMessage(message, deps), "request_message");
  assert.deepEqual(log.map(entry => entry.kind), ["record", "touch", "message", "finish", "notify"]);
  assert.deepEqual(log[2].args, [41, "user-1", "هل اكتمل الطلب؟"]);
  assert.deepEqual(log[3].args, ["wamid.a", { userId: "user-1", requestId: 41, handled: "request_message" }]);
  // The office is told in-app which request the message landed on; the text itself only feeds the urgency.
  const meta = log[4].args[0] as { kind: string; targetType: string; targetId: number; signals: { text: string } };
  assert.equal(meta.kind, "office.whatsapp_message");
  assert.deepEqual([meta.targetType, meta.targetId, meta.signals.text], ["service_request", 41, "هل اكتمل الطلب؟"]);
});

test("several open requests make an inquiry and a free-text reply", async () => {
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" }, open: { "user-1": [41, 42] } });
  assert.equal(await handleInboundMessage(message, deps), "inquiry");
  assert.deepEqual(log.map(entry => entry.kind), ["record", "touch", "inquiry", "finish", "notify", "reply"]);
  assert.deepEqual(log[2].args, ["user-1", "هل اكتمل الطلب؟"]);
  assert.deepEqual(log[3].args, ["wamid.a", { userId: "user-1", requestId: null, handled: "inquiry" }]);
  const meta = log[4].args[0] as { kind: string; targetType: string; targetId: number };
  assert.deepEqual([meta.kind, meta.targetType, meta.targetId], ["office.whatsapp_message", "inquiry", 7]);
  assert.deepEqual(log[5].args, ["966500000001", SEVERAL_OPEN_REPLY]);
  assert.ok(INQUIRY_SUBJECT.length);
});

test("no open request also makes an inquiry, with its own reply", async () => {
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" } });
  assert.equal(await handleInboundMessage(message, deps), "inquiry");
  assert.deepEqual(log.at(-1)?.args, ["966500000001", NO_OPEN_REPLY]);
});

test("an unknown or foreign number is kept as unmatched without a reply", async () => {
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" }, open: { "user-1": [41] } });
  assert.equal(await handleInboundMessage({ ...message, from: "966500000002" }, deps), "unmatched");
  assert.deepEqual(log.map(entry => entry.kind), ["record", "finish", "notify"]);
  assert.deepEqual(log[1].args, ["wamid.a", { userId: null, requestId: null, handled: "unmatched" }]);
  // No mail for an unknown number; the office sees a masked number and the start of the text.
  const [meta, mail] = log[2].args as [{ kind: string; targetId: string; copy: { title: string; body: string; path: string } }, unknown];
  assert.equal(mail, null);
  assert.equal(meta.kind, "office.whatsapp_unmatched");
  assert.equal(meta.targetId, "9665••••••02");
  assert.equal(meta.copy.body, "9665••••••02: هل اكتمل الطلب؟");
  assert.equal(meta.copy.path, "/office/whatsapp");
  const foreign = fakeDeps({ customers: { "0500000001": "user-1" } });
  assert.equal(await handleInboundMessage({ ...message, from: "+44 7700 900123" }, foreign.deps), "unmatched");
  assert.equal(foreign.log[0].args[1], "447700900123", "the stored number keeps digits only");
});

test("a redelivered message is skipped before anything is done", async () => {
  const seen = new Set(["wamid.a"]);
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" }, open: { "user-1": [41] }, seen });
  assert.equal(await handleInboundMessage(message, deps), null);
  assert.deepEqual(log.map(entry => entry.kind), ["record"]);
});

test("a delivery is processed in order, bounded, and one failure does not stop the rest", async () => {
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" }, open: { "user-1": [41] } });
  let failures = 0;
  const failing: InboundDeps = { ...deps, async addRequestMessage(...args) { if (failures++ === 0) throw new Error("db down"); return deps.addRequestMessage(...args); } };
  const messages = Array.from({ length: MAX_MESSAGES_PER_DELIVERY + 5 }, (_, i) => text(`wamid.${i}`, "966500000001", `رسالة ${i}`));
  const counts = await processInboundPayload(delivery([...messages, text("wamid.0", "966500000001", "again")]), failing);
  assert.deepEqual(counts, { request_message: MAX_MESSAGES_PER_DELIVERY - 1, inquiry: 0, unmatched: 0, ignored: 0, duplicate: 0 });
  assert.equal(log.filter(entry => entry.kind === "record").length, MAX_MESSAGES_PER_DELIVERY);
  assert.equal(log.filter(entry => entry.kind === "message").length, MAX_MESSAGES_PER_DELIVERY - 1);
});

test("the webhook verifies the token on GET and the signature on POST", async () => {
  const { deps, log } = fakeDeps({ customers: { "0500000001": "user-1" }, open: { "user-1": [41] } });
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use("/api/webhooks/whatsapp", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json());
  app.use("/api", createWhatsappWebhookRouter(deps));
  const server = app.listen(0);
  const previous = { token: process.env.WHATSAPP_VERIFY_TOKEN, secret: process.env.WHATSAPP_APP_SECRET };
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api/webhooks/whatsapp`;
    const verify = (query: Record<string, string>) => fetch(`${base}?${new URLSearchParams(query)}`);
    const post = (body: string, headers: Record<string, string> = {}) =>
      fetch(base, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
    assert.equal((await verify({ "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "c" })).status, 404, "off until configured");
    assert.equal((await post("{}", { "x-hub-signature-256": sign("{}") })).status, 404);

    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
    process.env.WHATSAPP_APP_SECRET = secret;
    const ok = await verify({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "challenge-123" });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(await ok.text(), "challenge-123");
    assert.equal((await verify({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "c" })).status, 403);
    assert.equal((await verify({ "hub.mode": "unsubscribe", "hub.verify_token": "verify-me", "hub.challenge": "c" })).status, 403);
    assert.equal((await verify({ "hub.mode": "subscribe", "hub.verify_token": "verify-me" })).status, 403);

    const body = JSON.stringify(delivery([text("wamid.http", "966500000001", "مرحبا")]));
    assert.equal((await post(body)).status, 401, "unsigned");
    assert.equal((await post(body, { "x-hub-signature-256": sign(body + " ") })).status, 401, "signed over other bytes");
    assert.equal(log.length, 0, "nothing is processed before the signature passes");
    assert.equal((await post(body, { "x-hub-signature-256": sign(body) })).status, 200);
    assert.deepEqual(log.map(entry => entry.kind), ["record", "touch", "message", "finish", "notify"]);
    assert.equal((await post("not json", { "x-hub-signature-256": sign("not json") })).status, 200, "acknowledged so Meta does not retry");
    const form = await fetch(base, { method: "POST", headers: { "content-type": "text/plain", "x-hub-signature-256": sign(body) }, body });
    assert.equal(form.status, 400, "the raw JSON body is required");
  } finally {
    if (previous.token === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN; else process.env.WHATSAPP_VERIFY_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = previous.secret;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
