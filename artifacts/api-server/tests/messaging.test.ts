import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  db, hbsCustomerSettings, hbsInquiries, hbsInquiryMessages, hbsNotifications, hbsOfficeStaff, hbsRegistrationRequests,
  hbsRequestMessages, hbsServiceRequests, hbsThreadReads, pool,
} from "@workspace/db";
import portalRouter from "../src/routes/portal";
import messagingRouter from "../src/routes/messaging";
import { setWhatsappSender, WHATSAPP_OFF_ERROR, WHATSAPP_SEND_FAILED_ERROR, WHATSAPP_UNVERIFIED_ERROR } from "../src/lib/messaging";
import { subscribe, type StreamEvent } from "../src/lib/notification-stream";
import { requestReference } from "../src/lib/money";

if (process.env.NODE_ENV === "production") throw new Error("Messaging tests must not run in production");

const officeEmail = "messaging-office@example.invalid";
const office = `msg-office-${randomUUID()}`;
const alice = `msg-alice-${randomUUID()}`;
const bob = `msg-bob-${randomUUID()}`;
const users = [office, alice, bob];
const people = new Map(users.map(id => [id, {
  id, primaryEmailAddressId: "primary",
  emailAddresses: [{ id: "primary", emailAddress: id === office ? officeEmail : `${id}@example.invalid`, verification: { status: "verified" } }],
}]));

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
  app.use("/api", portalRouter);
  app.use("/api", messagingRouter);
  return app;
}

// The next "thread" stream event for a user, or a failure after a second.
function nextThreadEvent(userId: string): Promise<StreamEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`no thread event for ${userId}`)); }, 1000);
    const unsubscribe = subscribe(userId, event => {
      if (event.type !== "thread") return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 150));

test("messaging: inbox threads, inquiry conversations, read markers, live events and WhatsApp", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) =>
    (people.get(userId) ?? { id: userId, primaryEmailAddressId: null, emailAddresses: [] }) as never);
  delete process.env.SMTP_HOST;
  for (const key of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME"]) delete process.env[key];
  const server = testApp().listen(0);
  const requestIds: number[] = [];
  const inquiryIds: number[] = [];
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const call = async (user: string, method: string, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method, headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null };
    };

    await db.insert(hbsOfficeStaff).values({ userId: office });
    await db.insert(hbsRegistrationRequests).values([
      { userId: alice, email: `${alice}@example.invalid`, fullName: "عليا الأحمد", contactPhone: "0500000001", status: "approved" },
      { userId: bob, email: `${bob}@example.invalid`, fullName: "بدر السالم", contactPhone: "0500000002", status: "approved" },
    ]);
    const [request] = await db.insert(hbsServiceRequests).values({
      userId: alice, category: "labor", service: "نقل كفالة", description: "نقل عامل.", contactPhone: "0500000001",
    }).returning();
    requestIds.push(request.id);
    const reference = requestReference(request.id, request.createdAt);
    const [aliceInquiry] = await db.insert(hbsInquiries).values({ userId: alice, subject: "رسوم الخدمة", message: "كم تبلغ رسوم نقل الكفالة؟" }).returning();
    const [bobInquiry] = await db.insert(hbsInquiries).values({ userId: bob, subject: "استفسار بدر", message: "هل تقدمون خدمة التأشيرات؟" }).returning();
    inquiryIds.push(aliceInquiry.id, bobInquiry.id);

    await t.test("a customer's inbox lists their own requests and inquiries with the office WhatsApp link", async () => {
      const list = await call(alice, "GET", "/messages/threads");
      assert.equal(list.status, 200, JSON.stringify(list.data));
      assert.equal(list.data.total, 2);
      assert.equal(list.data.unreadTotal, 0);
      assert.deepEqual(list.data.items.map((item: { type: string; id: number }) => [item.type, item.id]),
        [["inquiry", aliceInquiry.id], ["request", request.id]], "most recently active first");
      const [inquiryThread, requestThread] = list.data.items;
      assert.equal(requestThread.reference, reference);
      assert.equal(requestThread.title, "نقل كفالة");
      assert.equal(requestThread.lastMessage, null, "no messages yet");
      assert.equal(requestThread.customer, null, "customers never see the office's customer card");
      assert.equal(requestThread.whatsapp.number, "966555208213");
      assert.ok(requestThread.whatsapp.link.startsWith("https://wa.me/966555208213?text="));
      assert.ok(decodeURIComponent(requestThread.whatsapp.link).includes(reference), "the prefilled text carries the reference");
      assert.equal(requestThread.whatsapp.verified, true);
      assert.equal(inquiryThread.reference, `استفسار #${aliceInquiry.id}`);
      assert.deepEqual({ ...inquiryThread.lastMessage, createdAt: undefined },
        { authorRole: "customer", preview: "كم تبلغ رسوم نقل الكفالة؟", channel: "portal", createdAt: undefined }, "the inquiry text opens the thread");
      assert.ok(decodeURIComponent(inquiryThread.whatsapp.link).includes(`استفسار #${aliceInquiry.id}: `));

      const link = await call(alice, "GET", `/messages/whatsapp-link?type=request&id=${request.id}`);
      assert.equal(link.status, 200);
      assert.deepEqual(link.data, { link: `https://wa.me/966555208213?text=${encodeURIComponent(`طلب ${reference}: `)}`, number: "966555208213", text: `طلب ${reference}: ` });
      assert.equal((await call(bob, "GET", `/messages/whatsapp-link?type=request&id=${request.id}`)).status, 404, "another customer's request");
      assert.equal((await call(alice, "GET", "/messages/whatsapp-link?type=request")).status, 400);
      assert.equal((await call(bob, "GET", "/messages/threads")).data.total, 1, "bob sees only his inquiry");
    });

    await t.test("the office inbox lists every customer's threads; new inquiries count as unread", async () => {
      // Other suites leave requests behind in the shared test database, so
      // office-wide counts are checked relative to the page, not absolutely.
      const list = await call(office, "GET", "/office/messages/threads?pageSize=100");
      assert.equal(list.status, 200, JSON.stringify(list.data));
      type Item = { type: string; id: number; unread: number; customer: { fullName: string; email: string } | null; whatsapp: unknown };
      const items: Item[] = list.data.items;
      assert.equal(list.data.total, items.length);
      assert.equal(list.data.unreadTotal, items.reduce((sum, item) => sum + item.unread, 0), "the unread total is the sum over every thread");
      const byKey = new Map(items.map(item => [`${item.type}:${item.id}`, item]));
      const bobThread = byKey.get(`inquiry:${bobInquiry.id}`)!;
      assert.equal(bobThread.unread, 1, "a new inquiry's own text is unread for staff");
      assert.equal(byKey.get(`inquiry:${aliceInquiry.id}`)!.unread, 1);
      assert.deepEqual(bobThread.customer, { fullName: "بدر السالم", email: `${bob}@example.invalid` });
      assert.deepEqual(bobThread.whatsapp, { link: null, number: null, verified: false }, "no verified number yet");
      assert.equal(byKey.get(`request:${request.id}`)!.unread, 0);

      const inquiries = await call(office, "GET", "/office/messages/threads?type=inquiry&pageSize=100");
      assert.ok(inquiries.data.items.every((item: Item) => item.type === "inquiry"));
      assert.deepEqual(inquiries.data.items.map((item: Item) => item.id).filter((id: number) => inquiryIds.includes(id)).sort(), [...inquiryIds].sort());
      const requests = await call(office, "GET", "/office/messages/threads?type=request&pageSize=100");
      assert.ok(requests.data.items.every((item: Item) => item.type === "request"));
      assert.ok(requests.data.items.some((item: Item) => item.id === request.id));
      const search = await call(office, "GET", `/office/messages/threads?q=${encodeURIComponent("بدر")}`);
      assert.deepEqual(search.data.items.map((item: Item) => item.id), [bobInquiry.id], "staff search by customer name");
      const byReference = await call(office, "GET", `/office/messages/threads?q=${encodeURIComponent(reference)}`);
      assert.deepEqual(byReference.data.items.map((item: Item) => [item.type, item.id]), [["request", request.id]]);
      const unread = await call(office, "GET", "/office/messages/threads?unread=true&pageSize=100");
      assert.ok(unread.data.items.every((item: Item) => item.unread > 0));
      assert.ok(unread.data.items.some((item: Item) => item.id === bobInquiry.id && item.type === "inquiry"));
      assert.equal((await call(office, "GET", "/office/messages/threads?pageSize=1&page=2")).data.items.length, 1);
      assert.equal((await call(office, "GET", "/office/messages/threads?pageSize=0")).status, 400);
      assert.equal((await call(alice, "GET", "/office/messages/threads")).status, 403);
    });

    await t.test("an inquiry is a conversation: both sides reply, status and answer stay compatible", async () => {
      const opening = await call(alice, "GET", `/inquiries/${aliceInquiry.id}/messages`);
      assert.equal(opening.status, 200);
      assert.equal(opening.data.length, 1);
      assert.deepEqual({ ...opening.data[0], createdAt: undefined },
        { id: 0, authorRole: "customer", body: "كم تبلغ رسوم نقل الكفالة؟", channel: "portal", createdAt: undefined });
      assert.equal(new Date(opening.data[0].createdAt).getTime(), aliceInquiry.createdAt.getTime());
      assert.equal((await call(bob, "GET", `/inquiries/${aliceInquiry.id}/messages`)).status, 404, "another customer's inquiry");
      assert.equal((await call(bob, "POST", `/inquiries/${aliceInquiry.id}/messages`, { body: "تطفل" })).status, 404);
      assert.equal((await call(alice, "POST", `/inquiries/${aliceInquiry.id}/messages`, { body: "  " })).status, 400);

      const answer = await call(office, "POST", `/office/inquiries/${aliceInquiry.id}/messages`, { body: "الرسوم 500 ريال." });
      assert.equal(answer.status, 201, JSON.stringify(answer.data));
      assert.equal(answer.data.authorRole, "office");
      assert.equal(answer.data.channel, "portal");
      let [row] = await db.select().from(hbsInquiries).where(eq(hbsInquiries.id, aliceInquiry.id));
      assert.deepEqual({ status: row.status, answer: row.answer }, { status: "answered", answer: "الرسوم 500 ريال." }, "the first office message is the answer");
      assert.ok(row.answeredAt);

      const forAlice = await call(alice, "GET", "/messages/threads");
      assert.equal(forAlice.data.unreadTotal, 1);
      assert.deepEqual([forAlice.data.items[0].unread, forAlice.data.items[0].lastMessage.authorRole], [1, "office"]);
      assert.equal((await call(alice, "GET", "/messages/threads?unread=true")).data.total, 1);
      const read = await call(alice, "POST", `/messages/threads/inquiry/${aliceInquiry.id}/read`);
      assert.deepEqual(read, { status: 200, data: { unread: 0, unreadTotal: 0 } });
      assert.equal((await call(alice, "GET", "/messages/threads")).data.items[0].unread, 0);
      assert.equal((await call(bob, "POST", `/messages/threads/inquiry/${aliceInquiry.id}/read`)).status, 404);
      assert.equal((await call(alice, "POST", `/messages/threads/letter/${aliceInquiry.id}/read`)).status, 404);

      const followUp = await call(alice, "POST", `/inquiries/${aliceInquiry.id}/messages`, { body: "وهل تشمل الرسوم الحكومية؟" });
      assert.equal(followUp.status, 201);
      [row] = await db.select().from(hbsInquiries).where(eq(hbsInquiries.id, aliceInquiry.id));
      assert.deepEqual({ status: row.status, answer: row.answer }, { status: "open", answer: "الرسوم 500 ريال." }, "reopened, the answer kept");
      const officeView = await call(office, "GET", "/office/messages/threads?type=inquiry");
      const thread = officeView.data.items.find((item: { id: number }) => item.id === aliceInquiry.id);
      assert.equal(thread.unread, 2, "the opening and the follow-up are unread for staff");
      assert.equal(thread.lastMessage.preview, "وهل تشمل الرسوم الحكومية؟");
      assert.equal(officeView.data.items[0].id, aliceInquiry.id, "the active thread moved to the top");
      const officeBefore = officeView.data.unreadTotal;
      const officeRead = await call(office, "POST", `/office/messages/threads/inquiry/${aliceInquiry.id}/read`);
      assert.deepEqual(officeRead.data, { unread: 0, unreadTotal: officeBefore - 2 }, "bob's inquiry (and other suites' threads) stay unread");

      const second = await call(office, "POST", `/office/inquiries/${aliceInquiry.id}/messages`, { body: "لا، الرسوم الحكومية تُضاف." });
      assert.equal(second.status, 201);
      [row] = await db.select().from(hbsInquiries).where(eq(hbsInquiries.id, aliceInquiry.id));
      assert.deepEqual({ status: row.status, answer: row.answer }, { status: "answered", answer: "الرسوم 500 ريال." }, "later messages keep the first answer");
      const all = await call(alice, "GET", `/inquiries/${aliceInquiry.id}/messages`);
      assert.deepEqual(all.data.map((message: { id: number; authorRole: string }) => [message.id === 0 ? 0 : "row", message.authorRole]),
        [[0, "customer"], ["row", "office"], ["row", "customer"], ["row", "office"]]);
      assert.equal((await call(office, "GET", `/office/inquiries/${aliceInquiry.id}/messages`)).data.length, 4);
      assert.equal((await call(office, "GET", "/office/inquiries/2147483647/messages")).status, 404);
    });

    await t.test("an answer recorded before threads existed still shows in the conversation", async () => {
      await db.update(hbsInquiries).set({ answer: "نعم، نقدمها.", answeredAt: new Date(), status: "answered" }).where(eq(hbsInquiries.id, bobInquiry.id));
      const thread = await call(bob, "GET", `/inquiries/${bobInquiry.id}/messages`);
      assert.deepEqual(thread.data.map((message: { id: number; authorRole: string; body: string }) => [message.id, message.authorRole, message.body]),
        [[0, "customer", "هل تقدمون خدمة التأشيرات؟"], [-1, "office", "نعم، نقدمها."]]);
    });

    await t.test("customers are limited to 20 messages per thread in ten minutes", async () => {
      await db.insert(hbsInquiryMessages).values(Array.from({ length: 20 }, (_, i) => ({
        inquiryId: bobInquiry.id, authorId: bob, authorRole: "customer", body: `رسالة ${i}`,
      })));
      const refused = await call(bob, "POST", `/inquiries/${bobInquiry.id}/messages`, { body: "واحدة زيادة" });
      assert.equal(refused.status, 429);
      await db.delete(hbsInquiryMessages).where(eq(hbsInquiryMessages.inquiryId, bobInquiry.id));
    });

    await t.test("a new message reaches the other side's open streams as a thread event", async () => {
      const officeBefore = (await call(office, "GET", "/office/messages/threads")).data.unreadTotal;
      const officeEvent = nextThreadEvent(office);
      const sent = await call(alice, "POST", `/service-requests/${request.id}/messages`, { body: "متى يبدأ العمل؟" });
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
      assert.equal(sent.data.channel, "portal");
      assert.deepEqual((await officeEvent).data, { type: "request", id: request.id, unreadTotal: officeBefore + 1 });
      const aliceEvent = nextThreadEvent(alice);
      const reply = await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "غدًا." });
      assert.equal(reply.status, 201);
      assert.deepEqual((await aliceEvent).data, { type: "request", id: request.id, unreadTotal: 2 }, "the office's later inquiry message and this reply");
      const messages = await call(alice, "GET", `/service-requests/${request.id}/messages`);
      assert.deepEqual(messages.data.map((message: { authorRole: string; channel: string }) => [message.authorRole, message.channel]),
        [["customer", "portal"], ["office", "portal"]]);
      const list = await call(alice, "GET", "/messages/threads");
      assert.deepEqual([list.data.items[0].type, list.data.items[0].unread, list.data.items[0].lastMessage.preview], ["request", 1, "غدًا."]);
      await settle();
      const rows = await db.select({ kind: hbsNotifications.kind, userId: hbsNotifications.userId }).from(hbsNotifications)
        .where(inArray(hbsNotifications.userId, users));
      assert.ok(rows.some(row => row.kind === "office.message_new" && row.userId === office), "the office is notified of the customer's message");
      assert.ok(rows.some(row => row.kind === "request.message" && row.userId === alice), "the customer is notified of the office's message");
      assert.ok(rows.some(row => row.kind === "inquiry.answered" && row.userId === alice), "the first inquiry answer");
      assert.ok(rows.some(row => row.kind === "inquiry.message" && row.userId === alice), "later inquiry messages");
      assert.ok(rows.some(row => row.kind === "office.inquiry_message" && row.userId === office), "the customer's inquiry follow-up");
    });

    await t.test("long last messages are previewed", async () => {
      const long = "كلمة ".repeat(60).trim();
      await db.insert(hbsRequestMessages).values({ requestId: request.id, authorId: office, authorRole: "office", body: long });
      const list = await call(alice, "GET", "/messages/threads?type=request");
      const { preview } = list.data.items[0].lastMessage;
      assert.ok(preview.length <= 120 && preview.endsWith("…"), preview);
    });

    await t.test("office messages can also go out on WhatsApp, only to a verified opted-in number", async () => {
      const sent: { to: string; text: string; lastInboundAt: Date | null | undefined }[] = [];
      let senderWorks = true;
      setWhatsappSender(async (to, text, lastInboundAt) => { sent.push({ to, text, lastInboundAt }); return senderWorks; });
      try {
        const off = await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "تم.", viaWhatsapp: true });
        assert.deepEqual(off, { status: 409, data: { error: WHATSAPP_OFF_ERROR } });
        process.env.WHATSAPP_ACCESS_TOKEN = "token";
        process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
        process.env.WHATSAPP_TEMPLATE_NAME = "hbs_update";
        const unverified = await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "تم.", viaWhatsapp: true });
        assert.deepEqual(unverified, { status: 409, data: { error: WHATSAPP_UNVERIFIED_ERROR } });
        await db.insert(hbsCustomerSettings).values({ userId: alice, whatsappOptIn: true, whatsappPhone: "0500000001", whatsappVerified: false });
        assert.equal((await call(office, "POST", `/office/inquiries/${aliceInquiry.id}/messages`, { body: "تم.", viaWhatsapp: true })).status, 409, "entered but not verified");
        const lastInboundAt = new Date(Date.now() - 3_600_000);
        await db.update(hbsCustomerSettings).set({ whatsappVerified: true, lastInboundAt }).where(eq(hbsCustomerSettings.userId, alice));
        assert.equal(sent.length, 0, "nothing was sent for the refusals");

        const before = (await db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, request.id))).length;
        const ok = await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "تم نقل الكفالة.", viaWhatsapp: true });
        assert.equal(ok.status, 201, JSON.stringify(ok.data));
        assert.equal(ok.data.channel, "whatsapp");
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, "966500000001");
        assert.equal(sent[0].text, `طلب ${reference}: تم نقل الكفالة.`, "the text starts with the reference so a reply routes back");
        assert.equal(sent[0].lastInboundAt?.getTime(), lastInboundAt.getTime(), "the customer's window decides text vs template");
        const stored = await db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, request.id));
        assert.equal(stored.length, before + 1);
        assert.equal(stored[stored.length - 1].channel, "whatsapp");

        const onInquiry = await call(office, "POST", `/office/inquiries/${aliceInquiry.id}/messages`, { body: "أضفنا التفاصيل.", viaWhatsapp: true });
        assert.equal(onInquiry.status, 201);
        assert.equal(sent[1].text, `استفسار #${aliceInquiry.id}: أضفنا التفاصيل.`);
        const list = await call(alice, "GET", `/inquiries/${aliceInquiry.id}/messages`);
        assert.equal(list.data[list.data.length - 1].channel, "whatsapp", "the customer sees where it went");

        senderWorks = false;
        const failed = await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "مرة أخرى", viaWhatsapp: true });
        assert.deepEqual(failed, { status: 502, data: { error: WHATSAPP_SEND_FAILED_ERROR } });
        assert.equal((await db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, request.id))).length, before + 1, "a refused send records nothing");
        senderWorks = true;
        const plain = await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "عبر البوابة فقط" });
        assert.deepEqual([plain.status, plain.data.channel, sent.length], [201, "portal", 3], "a portal-only message calls no sender");

        const officeList = await call(office, "GET", "/office/messages/threads?type=request");
        assert.deepEqual(officeList.data.items[0].whatsapp, { link: "https://wa.me/966500000001", number: "966500000001", verified: true });
        await db.update(hbsCustomerSettings).set({ whatsappOptIn: false }).where(eq(hbsCustomerSettings.userId, alice));
        assert.equal((await call(office, "GET", "/office/messages/threads?type=request")).data.items[0].whatsapp.verified, false, "opted out: not reachable");
        assert.equal((await call(office, "POST", `/office/service-requests/${request.id}/messages`, { body: "تم.", viaWhatsapp: true })).status, 409);
        assert.equal((await call(alice, "POST", `/service-requests/${request.id}/messages`, { body: "شكرًا", viaWhatsapp: true })).status, 201, "customers cannot send on WhatsApp; the flag is ignored");
      } finally {
        setWhatsappSender(null);
        for (const key of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME"]) delete process.env[key];
      }
    });
  } finally {
    // Let the background follow-ups of the last messages finish before the pool closes.
    await settle();
    await db.delete(hbsThreadReads).where(inArray(hbsThreadReads.userId, users));
    await db.delete(hbsNotifications).where(inArray(hbsNotifications.userId, users));
    if (inquiryIds.length) await db.delete(hbsInquiries).where(inArray(hbsInquiries.id, inquiryIds));
    if (requestIds.length) await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.id, requestIds));
    await db.delete(hbsCustomerSettings).where(inArray(hbsCustomerSettings.userId, users));
    await db.delete(hbsRegistrationRequests).where(inArray(hbsRegistrationRequests.userId, users));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, office));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
