import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  db, hbsAuditLog, hbsDocumentReminders, hbsInvoices, hbsNotificationPreferences, hbsNotifications, hbsOfficeStaff,
  hbsPushSubscriptions, hbsRegistrationRequests, hbsServiceRequests, hbsWhatsappInbound, pool,
} from "@workspace/db";
import notificationsRouter, { MAX_STREAMS_PER_USER, openStreams } from "../src/routes/notifications";
import { createOfficeWhatsappRouter, type WhatsappSender } from "../src/routes/office-whatsapp";
import { emit, subscriberCount } from "../src/lib/notification-stream";
import { vatFor } from "../src/lib/money";

if (process.env.NODE_ENV === "production") throw new Error("Notification API tests must not run in production");

const officeEmail = "notifications-api-office@example.invalid";
const office = `notif-office-${randomUUID()}`;
const alice = `notif-alice-${randomUUID()}`;
const bob = `notif-bob-${randomUUID()}`;
const customers = [alice, bob];
const people = new Map([office, alice, bob].map((id) => [id, {
  id, primaryEmailAddressId: "primary",
  emailAddresses: [{ id: "primary", emailAddress: id === office ? officeEmail : `${id}@example.invalid`, verification: { status: "verified" } }],
}]));

const sent: { kind: "text" | "template"; to: string; text: string }[] = [];
let senderWorks = true;
const sender: WhatsappSender = {
  async sendText(to, text) { sent.push({ kind: "text", to, text }); return senderWorks; },
  async sendTemplate(to, text) { sent.push({ kind: "template", to, text }); return senderWorks; },
};

function testApp() {
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    // Only this ephemeral app supplies test identities; production auth is untouched.
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", notificationsRouter);
  app.use("/api", createOfficeWhatsappRouter(sender));
  return app;
}

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

type SseEvent = { event: string; data: unknown };

// One raw SSE connection: events are parsed as they arrive and awaited by name.
function openStream(port: number, user: string) {
  const events: SseEvent[] = [];
  const waiters: { event: string; resolve: (e: SseEvent) => void }[] = [];
  let buffer = "";
  let response: http.IncomingMessage | null = null;
  let ended = false;
  const request = http.get({ host: "127.0.0.1", port, path: "/api/notifications/stream", headers: { "x-test-user": user } });
  const ready = new Promise<http.IncomingMessage>((resolve, reject) => {
    request.on("response", (res) => {
      response = res;
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (block.startsWith(":")) { events.push({ event: "comment", data: block }); continue; }
          const name = block.match(/^event: (.+)$/m)?.[1] ?? "message";
          const data = block.match(/^data: (.+)$/m)?.[1];
          const parsed = { event: name, data: data ? JSON.parse(data) : null };
          events.push(parsed);
          const waiting = waiters.findIndex((w) => w.event === name);
          if (waiting !== -1) waiters.splice(waiting, 1)[0].resolve(parsed);
        }
      });
      res.on("end", () => { ended = true; });
      resolve(res);
    });
    request.on("error", reject);
  });
  return {
    ready, events,
    get ended() { return ended; },
    next(event: string): Promise<SseEvent> {
      const seen = events.find((e) => e.event === event);
      if (seen) { events.splice(events.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((resolve) => waiters.push({ event, resolve }));
    },
    close() { response?.destroy(); request.destroy(); },
  };
}

async function until(check: () => boolean, what: string, timeoutMs = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("notification centre, preferences, push, brief, WhatsApp inbox and the live stream", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => (people.get(userId) ?? { id: userId, primaryEmailAddressId: null, emailAddresses: [] }) as never);
  mock.method(clerkClient.users, "getUserList", async (query: { emailAddress?: string[]; userId?: string[] }) => ({
    data: [...people.values()].filter((user) => query.userId?.includes(user.id) ||
      query.emailAddress?.some((email) => user.emailAddresses.some((entry) => entry.emailAddress.toLowerCase() === email.toLowerCase()))),
  }) as never);
  for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME"]) {
    delete process.env[key];
  }
  const server = testApp().listen(0);
  const requestIds: number[] = [];
  const invoiceIds: number[] = [];
  const waIds: string[] = [];
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    const call = async (user: string | null, method: string, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method, headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
    };

    await db.insert(hbsOfficeStaff).values({ userId: office });
    const row = (userId: string, kind: string, title: string, extra: Partial<typeof hbsNotifications.$inferInsert> = {}) => ({
      userId, audience: kind.startsWith("office.") ? "office" : "customer", kind, title, body: `${title} body`, path: "/requests/1",
      priority: "normal", ...extra,
    });
    const [n1, n2, n3, bobs] = await db.insert(hbsNotifications).values([
      row(alice, "request.status", "first", { createdAt: daysAgo(3), readAt: daysAgo(2) }),
      row(alice, "request.message", "second", { createdAt: daysAgo(2), count: 3 }),
      row(alice, "invoice.issued", "third", { createdAt: daysAgo(1), priority: "high" }),
      row(bob, "request.status", "bob's", { createdAt: daysAgo(1) }),
    ]).returning();

    await t.test("the list is the signed-in user's rows, newest first, with cursor and unread filter", async () => {
      assert.equal((await call(null, "GET", "/notifications")).status, 401);
      const all = await call(alice, "GET", "/notifications");
      assert.equal(all.status, 200);
      assert.deepEqual(all.data.items.map((n: any) => n.title), ["third", "second", "first"]);
      assert.equal(all.data.unreadCount, 2);
      assert.equal(all.data.items[1].count, 3);
      assert.equal(all.data.items[2].readAt !== null, true);
      const unread = await call(alice, "GET", "/notifications?unread=true");
      assert.deepEqual(unread.data.items.map((n: any) => n.id), [n3.id, n2.id]);
      assert.deepEqual((await call(alice, "GET", "/notifications?unread=false")).data.items.length, 3, "unread=false is not a filter");
      const page = await call(alice, "GET", `/notifications?limit=1&before=${n3.id}`);
      assert.deepEqual(page.data.items.map((n: any) => n.id), [n2.id]);
      assert.equal((await call(alice, "GET", "/notifications?limit=0")).status, 400);
      const bobList = await call(bob, "GET", "/notifications");
      assert.deepEqual(bobList.data.items.map((n: any) => n.id), [bobs.id]);
      assert.equal(bobList.data.unreadCount, 1);
    });

    await t.test("marking read is per user; read-all counts what changed", async () => {
      assert.equal((await call(alice, "POST", `/notifications/${bobs.id}/read`)).status, 404, "another user's row");
      assert.equal((await call(alice, "POST", "/notifications/999999999/read")).status, 404);
      assert.equal((await call(alice, "POST", "/notifications/abc/read")).status, 404);
      const read = await call(alice, "POST", `/notifications/${n3.id}/read`);
      assert.equal(read.status, 200);
      assert.ok(read.data.readAt);
      const again = await call(alice, "POST", `/notifications/${n3.id}/read`);
      assert.equal(again.data.readAt, read.data.readAt, "idempotent");
      const first = await call(alice, "POST", `/notifications/${n1.id}/read`);
      assert.equal(new Date(first.data.readAt).getTime(), n1.readAt!.getTime(), "an earlier read time is kept");
      assert.equal((await call(alice, "GET", "/notifications")).data.unreadCount, 1);
      assert.deepEqual((await call(alice, "POST", "/notifications/read-all")).data, { updated: 1 });
      assert.deepEqual((await call(alice, "POST", "/notifications/read-all")).data, { updated: 0 });
      assert.equal((await call(alice, "GET", "/notifications")).data.unreadCount, 0);
      assert.equal((await call(bob, "GET", "/notifications")).data.unreadCount, 1, "bob's row is untouched");
    });

    await t.test("preferences default, round-trip, validate and are audited", async () => {
      const defaults = await call(alice, "GET", "/notifications/preferences");
      assert.equal(defaults.status, 200);
      assert.deepEqual(defaults.data, {
        emailEnabled: true, pushEnabled: true, quietStart: null, quietEnd: null, digest: "instant", mutedKinds: [],
        pushAvailable: false, whatsappAvailable: false,
      });
      const input = { emailEnabled: true, pushEnabled: false, quietStart: 22, quietEnd: 7, digest: "daily", mutedKinds: ["request.file", "request.file"] };
      const saved = await call(alice, "PUT", "/notifications/preferences", input);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.deepEqual(saved.data, { ...input, mutedKinds: ["request.file"], pushAvailable: false, whatsappAvailable: false });
      assert.deepEqual((await call(alice, "GET", "/notifications/preferences")).data, saved.data);
      assert.deepEqual((await call(bob, "GET", "/notifications/preferences")).data.digest, "instant", "bob keeps the defaults");
      for (const bad of [
        { ...input, quietStart: 25 },
        { ...input, quietEnd: null },
        { ...input, digest: "weekly" },
        { ...input, mutedKinds: ["nope"] },
        { ...input, extra: true },
        { emailEnabled: true },
      ]) {
        assert.equal((await call(alice, "PUT", "/notifications/preferences", bad)).status, 400, JSON.stringify(bad));
      }
      // Saving the same values again is not a change worth an audit row.
      assert.equal((await call(alice, "PUT", "/notifications/preferences", input)).status, 200);
      const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.action, "notification.preferences"), eq(hbsAuditLog.targetId, alice)));
      assert.equal(audits.length, 1);
      assert.equal(audits[0].actorId, alice);
      assert.deepEqual((audits[0].details as any).changed.sort(), ["digest", "mutedKinds", "pushEnabled", "quietEnd", "quietStart"]);
    });

    await t.test("push: key and subscriptions follow the VAPID settings", async () => {
      const subscription = { endpoint: "https://push.example.invalid/sub/1", keys: { p256dh: "p", auth: "a" }, userAgent: "test" };
      assert.deepEqual((await call(alice, "GET", "/notifications/push/key")).data, { publicKey: null });
      assert.equal((await call(alice, "PUT", "/notifications/push/subscriptions", subscription)).status, 503);
      assert.equal((await call(null, "GET", "/notifications/push/key")).status, 401);
      // Dummy keys for this process only; nothing is sent.
      process.env.VAPID_PUBLIC_KEY = "test-public-key";
      process.env.VAPID_PRIVATE_KEY = "test-private-key";
      process.env.VAPID_SUBJECT = "mailto:test@example.invalid";
      try {
        assert.deepEqual((await call(alice, "GET", "/notifications/push/key")).data, { publicKey: "test-public-key" });
        assert.equal((await call(alice, "GET", "/notifications/preferences")).data.pushAvailable, true);
        assert.equal((await call(alice, "PUT", "/notifications/push/subscriptions", subscription)).status, 204);
        assert.equal((await call(alice, "PUT", "/notifications/push/subscriptions", { endpoint: "not a url", keys: subscription.keys })).status, 400);
        assert.equal((await call(alice, "PUT", "/notifications/push/subscriptions", { ...subscription, extra: 1 })).status, 400);
        // The same browser signs in as bob: the endpoint moves to bob.
        assert.equal((await call(bob, "PUT", "/notifications/push/subscriptions", { ...subscription, keys: { p256dh: "p2", auth: "a2" } })).status, 204);
        const rows = await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].userId, bob);
        assert.equal(rows[0].p256dh, "p2");
        assert.equal((await call(alice, "DELETE", "/notifications/push/subscriptions", { endpoint: subscription.endpoint })).status, 204, "not alice's any more");
        assert.equal((await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint))).length, 1);
        assert.equal((await call(bob, "DELETE", "/notifications/push/subscriptions", { endpoint: subscription.endpoint })).status, 204);
        assert.equal((await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint))).length, 0);
        assert.equal((await call(bob, "DELETE", "/notifications/push/subscriptions", { endpoint: subscription.endpoint })).status, 204, "absent is fine");
        assert.equal((await call(bob, "DELETE", "/notifications/push/subscriptions", {})).status, 400);
      } finally {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        delete process.env.VAPID_SUBJECT;
      }
      assert.equal((await call(alice, "PUT", "/notifications/push/subscriptions", subscription)).status, 503);
    });

    await t.test("the brief ranks what needs attention for a customer and for the office", async () => {
      const [waiting, unassigned] = await db.insert(hbsServiceRequests).values([
        { userId: alice, category: "labor", service: "تجديد رخصة", description: "Waiting on the customer.", contactPhone: "0500000000", status: "waiting_on_customer", createdAt: daysAgo(12) },
        { userId: bob, category: "other", service: "خدمة", description: "Nobody assigned yet.", contactPhone: "0500000000" },
      ]).returning();
      requestIds.push(waiting.id, unassigned.id);
      const amount = 50_000;
      const [invoice] = await db.insert(hbsInvoices).values({
        requestId: waiting.id, description: "رسوم", amountHalalas: amount, vatRateBasisPoints: 1500, vatHalalas: vatFor(amount),
        totalHalalas: amount + vatFor(amount), issuedBy: office, issuedAt: daysAgo(10),
      }).returning();
      invoiceIds.push(invoice.id);
      await db.insert(hbsDocumentReminders).values({ userId: alice, kind: "iqama", label: "إقامة أحمد", expiresOn: dateIn(5), createdBy: alice });
      const [unreadRow] = await db.insert(hbsNotifications).values(row(alice, "quote.sent", "quote waiting", { priority: "high" })).returning();

      const brief = await call(alice, "GET", "/notifications/brief");
      assert.equal(brief.status, 200, JSON.stringify(brief.data));
      assert.notEqual(brief.data.headline, "كل شيء هادئ، لا يوجد ما يحتاج انتباهك الآن.");
      const kinds = brief.data.items.map((i: any) => i.kind);
      assert.deepEqual(kinds.slice(0, 2).sort(), ["invoice.overdue", "reminder.expiring"], "urgent items lead");
      const overdue = brief.data.items.find((i: any) => i.kind === "invoice.overdue");
      assert.equal(overdue.priority, "urgent");
      assert.match(overdue.title, new RegExp(`INV-\\d{4}-${String(invoice.id).padStart(5, "0")}`));
      assert.equal(overdue.path, `/requests/${waiting.id}`);
      assert.match(overdue.reason, /10 أيام|١٠ يومًا|10 يومًا/);
      const reminder = brief.data.items.find((i: any) => i.kind === "reminder.expiring");
      assert.match(reminder.title, /إقامة أحمد/);
      assert.equal(reminder.priority, "urgent");
      const request = brief.data.items.find((i: any) => i.kind === "request.status" && i.path === `/requests/${waiting.id}`);
      assert.match(request.title, /تجديد رخصة/);
      assert.equal(request.priority, "high");
      const quote = brief.data.items.find((i: any) => i.kind === "quote.sent");
      assert.equal(quote.title, "quote waiting");
      await db.update(hbsNotifications).set({ readAt: new Date() }).where(eq(hbsNotifications.id, unreadRow.id));

      const quiet = await call(bob, "GET", "/notifications/brief");
      assert.equal(quiet.data.items.filter((i: any) => i.kind !== "request.status").length, 0, "bob has only his unread row");

      const staff = await call(office, "GET", "/notifications/brief");
      assert.equal(staff.status, 200, JSON.stringify(staff.data));
      const unassignedItem = staff.data.items.find((i: any) => i.kind === "office.request_new");
      assert.ok(unassignedItem, "the office sees unassigned requests");
      assert.equal(unassignedItem.path, "/office/requests");
      const money = staff.data.items.find((i: any) => i.kind === "office.invoice_paid");
      assert.match(money.title, /فواتير متأخرة/);
      assert.equal(staff.data.items.some((i: any) => i.kind === "invoice.overdue"), false, "no customer lines for staff");
    });

    const freshId = `wamid.fresh.${randomUUID()}`;
    const staleId = `wamid.stale.${randomUUID()}`;
    const knownId = `wamid.known.${randomUUID()}`;
    waIds.push(freshId, staleId, knownId);
    await t.test("the WhatsApp inbox reads intent, masks numbers and names customers", async () => {
      await db.insert(hbsRegistrationRequests).values({ userId: alice, email: `${alice}@example.invalid`, fullName: "أحمد العلي", contactPhone: "0500000001", status: "approved" });
      await db.insert(hbsWhatsappInbound).values([
        { waMessageId: freshId, fromPhone: "966512345678", body: "السلام عليكم، وش صار على طلبي رقم HBS-2025-00012؟ الموضوع عاجل", handled: "unmatched", receivedAt: daysAgo(0.1) },
        { waMessageId: staleId, fromPhone: "966598765432", body: "شكرا لكم", handled: "unmatched", receivedAt: daysAgo(3) },
        { waMessageId: knownId, fromPhone: "966500000001", userId: alice, requestId: requestIds[0], body: "أرسلت الإيصال", handled: "request_message", receivedAt: daysAgo(2) },
      ]);
      assert.equal((await call(alice, "GET", "/office/whatsapp/inbox")).status, 403);
      assert.equal((await call(null, "GET", "/office/whatsapp/inbox")).status, 401);
      const inbox = await call(office, "GET", "/office/whatsapp/inbox");
      assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
      const ours = inbox.data.filter((m: any) => waIds.includes(m.waMessageId));
      assert.deepEqual(ours.map((m: any) => m.waMessageId), [freshId, staleId], "unmatched only, newest first");
      const fresh = ours[0];
      assert.equal(fresh.fromPhoneMasked, "9665••••••78");
      assert.equal(fresh.intent.intent, "status_question");
      assert.equal(fresh.intent.urgent, true);
      assert.equal(fresh.intent.reference, "HBS-2025-00012");
      assert.equal(fresh.canReplyFreeText, true);
      assert.ok(fresh.suggestedReplies.length >= 1 && fresh.suggestedReplies.length <= 3);
      assert.ok(fresh.suggestedReplies.some((r: string) => r.includes("HBS-2025-00012")), "drafts quote the reference");
      assert.equal(fresh.customerName, null);
      const stale = ours[1];
      assert.equal(stale.intent.intent, "thanks");
      assert.equal(stale.canReplyFreeText, false);
      assert.equal((await call(office, "GET", "/office/whatsapp/inbox?handled=all&limit=200")).status, 400);
      const all = await call(office, "GET", "/office/whatsapp/inbox?handled=all&limit=100");
      const known = all.data.find((m: any) => m.waMessageId === knownId);
      assert.equal(known.customerName, "أحمد العلي");
      assert.equal(known.userId, alice);
      assert.equal(known.requestId, requestIds[0]);
      assert.equal(known.intent.intent, "payment");
      assert.ok(known.suggestedReplies[0].includes("أحمد العلي"));
    });

    await t.test("replies go as text inside the window, as the template after it, or are refused", async () => {
      const reply = (id: string, text = "تم استلام رسالتكم وسنرد قريبًا.") => call(office, "POST", `/office/whatsapp/inbox/${id}/reply`, { text });
      assert.equal((await call(alice, "POST", `/office/whatsapp/inbox/${freshId}/reply`, { text: "x" })).status, 403);
      assert.equal((await reply("wamid.missing")).status, 404);
      assert.equal((await reply(freshId)).status, 503, "WhatsApp is off");
      process.env.WHATSAPP_ACCESS_TOKEN = "token";
      process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
      try {
        assert.equal((await reply(freshId, "")).status, 400);
        assert.equal((await reply(freshId, "   ")).status, 400);
        assert.equal((await reply(freshId, "x".repeat(1025))).status, 400);
        const text = await reply(freshId);
        assert.equal(text.status, 202, JSON.stringify(text.data));
        assert.deepEqual(text.data, { sentAs: "text" });
        assert.deepEqual(sent.at(-1), { kind: "text", to: "966512345678", text: "تم استلام رسالتكم وسنرد قريبًا." });
        const closed = await reply(staleId);
        assert.equal(closed.status, 409, "window closed and no template");
        process.env.WHATSAPP_TEMPLATE_NAME = "hbs_update";
        const template = await reply(staleId);
        assert.equal(template.status, 202);
        assert.deepEqual(template.data, { sentAs: "template" });
        assert.equal(sent.at(-1)?.kind, "template");
        assert.equal(sent.at(-1)?.to, "966598765432");
        senderWorks = false;
        assert.equal((await reply(freshId)).status, 502);
        senderWorks = true;
        assert.equal(sent.length, 3);
        const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.action, "whatsapp.reply"), inArray(hbsAuditLog.targetId, waIds)));
        assert.deepEqual(audits.map((a) => [a.actorId, a.targetId, (a.details as any).sentAs, (a.details as any).chars]).sort(), [
          [office, freshId, "text", "تم استلام رسالتكم وسنرد قريبًا.".length],
          [office, staleId, "template", "تم استلام رسالتكم وسنرد قريبًا.".length],
        ].sort());
      } finally {
        delete process.env.WHATSAPP_ACCESS_TOKEN;
        delete process.env.WHATSAPP_PHONE_NUMBER_ID;
        delete process.env.WHATSAPP_TEMPLATE_NAME;
      }
    });

    await t.test("the stream opens with the unread count, relays events, and is capped per user", async () => {
      const unauthorized = await fetch(`http://127.0.0.1:${port}/api/notifications/stream`);
      assert.equal(unauthorized.status, 401);
      await unauthorized.text();

      const stream = openStream(port, bob);
      const response = await stream.ready;
      assert.equal(response.statusCode, 200);
      assert.match(response.headers["content-type"] ?? "", /^text\/event-stream/);
      assert.equal(response.headers["cache-control"], "no-cache");
      assert.equal(response.headers["x-accel-buffering"], "no");
      assert.deepEqual(await stream.next("unread"), { event: "unread", data: { count: 1 } });
      assert.equal(openStreams(bob), 1);
      assert.equal(subscriberCount(bob), 1);

      const payload = { id: 1, kind: "request.message", title: "live", body: "hello", path: "/requests/1" };
      emit(bob, { type: "notification", data: payload });
      assert.deepEqual(await stream.next("notification"), { event: "notification", data: payload });
      // Reading a row in another tab updates the badge here.
      assert.equal((await call(bob, "POST", `/notifications/${bobs.id}/read`)).status, 200);
      assert.deepEqual(await stream.next("unread"), { event: "unread", data: { count: 0 } });
      // Alice's events never reach bob.
      emit(alice, { type: "notification", data: { ...payload, title: "not yours" } });

      stream.close();
      await until(() => openStreams(bob) === 0 && subscriberCount(bob) === 0, "stream cleanup");
      assert.equal(stream.events.some((e) => (e.data as { title?: string } | null)?.title === "not yours"), false, "nothing else arrived");

      const streams = Array.from({ length: MAX_STREAMS_PER_USER + 1 }, () => openStream(port, alice));
      for (const s of streams) { await s.ready; await s.next("unread"); }
      await until(() => streams[0].ended, "the oldest stream to be closed");
      assert.equal(openStreams(alice), MAX_STREAMS_PER_USER);
      for (const s of streams) s.close();
      await until(() => openStreams(alice) === 0, "all streams closed");
    });
    await t.test("revoked staff cannot read old office rows or receive them over an open stream", async () => {
      const [privateRow] = await db.insert(hbsNotifications).values({
        userId: office, audience: "office", kind: "office.message_new",
        title: "Private office receipt", body: "Office-only information", priority: "normal", groupKey: `revocation-${office}`,
      }).returning();
      const stream = openStream(port, office);
      try {
        await stream.ready; await stream.next("unread");
        await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, office));
        emit(office, { type: "notification", data: { audience: "office", title: "private after revocation" } });
        await until(() => stream.ended, "revoked office stream to close");
        assert.equal(stream.events.some(event => (event.data as { title?: string })?.title === "private after revocation"), false);
        const list = await call(office, "GET", "/notifications");
        assert.equal(list.status, 200);
        assert.equal(list.data.items.some((row: { id: number }) => row.id === privateRow.id), false);
        assert.equal((await call(office, "POST", `/notifications/${privateRow.id}/read`)).status, 404);
        await call(office, "POST", "/notifications/read-all");
        const [untouched] = await db.select().from(hbsNotifications).where(eq(hbsNotifications.id, privateRow.id));
        assert.equal(untouched.readAt, null, "read-all cannot affect hidden office rows");
        const brief = await call(office, "GET", "/notifications/brief");
        assert.equal(brief.status, 200);
        assert.equal(JSON.stringify(brief.data).includes(privateRow.title), false);
        assert.equal(JSON.stringify(brief.data).includes('"/office'), false, "revoked staff receive no office-only actions");
      } finally {
        stream.close();
        await db.insert(hbsOfficeStaff).values({ userId: office }).onConflictDoNothing();
      }
    });
  } finally {
    await db.delete(hbsAuditLog).where(inArray(hbsAuditLog.targetId, [...customers, ...waIds]));
    await db.delete(hbsWhatsappInbound).where(inArray(hbsWhatsappInbound.waMessageId, waIds));
    await db.delete(hbsRegistrationRequests).where(inArray(hbsRegistrationRequests.userId, customers));
    await db.delete(hbsNotifications).where(inArray(hbsNotifications.userId, customers));
    await db.delete(hbsNotificationPreferences).where(inArray(hbsNotificationPreferences.userId, customers));
    await db.delete(hbsPushSubscriptions).where(inArray(hbsPushSubscriptions.userId, customers));
    await db.delete(hbsDocumentReminders).where(inArray(hbsDocumentReminders.userId, customers));
    if (invoiceIds.length) await db.delete(hbsInvoices).where(inArray(hbsInvoices.id, invoiceIds));
    if (requestIds.length) await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.id, requestIds));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, office));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});
