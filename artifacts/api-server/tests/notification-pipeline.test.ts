import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db, hbsNotificationPreferences, hbsNotifications, hbsOfficeStaff, hbsPushSubscriptions, pool, type HbsNotification,
} from "@workspace/db";
import { notifyCustomer, notifyCustomerNow, notifyOffice } from "../src/lib/customer-contact";
import { deliverHeldNotifications, OFFICE_ACCESS_MAX_RETRIES, purgeOldNotifications, resetOfficeAccessRetries, type DigestDeps } from "../src/lib/notification-digest";
import { purgeFailedPushSubscriptions, sendPush as sendWebPush, type PushDeps } from "../src/lib/web-push";
import { nextRiyadhHour, riyadhParts } from "../src/lib/notification-intelligence";
import { subscribe, subscriberCount, type StreamEvent } from "../src/lib/notification-stream";
import { publishCustomer, publishOffice, unreadCount } from "../src/lib/notifications";
import { customerMessageMail, invoiceOverdueMail, officeNewRequestMail, type Mail } from "../src/lib/notify";

// The dispatch pipeline against a migrated test database, with the mail,
// push and WhatsApp senders injected so nothing leaves the process.

if (process.env.NODE_ENV === "production") throw new Error("Notification pipeline tests must not run in production");

const officeEmail = "notification-pipeline-owner@example.invalid";
const run = randomUUID().slice(0, 8);
const customer = `np-customer-${run}`;
const quiet = `np-quiet-${run}`;
const muted = `np-muted-${run}`;
const owner = `np-owner-${run}`;
const staff = `np-staff-${run}`;
const users = [customer, quiet, muted, owner, staff];

const request = { id: 41, reference: "HBS-2026-00041", service: "تجديد إقامة" };
const startedAt = new Date();
const rowsOf = (userId: string) => db.select().from(hbsNotifications).where(eq(hbsNotifications.userId, userId)).orderBy(hbsNotifications.id);
const rowById = async (id: number): Promise<HbsNotification> => (await db.select().from(hbsNotifications).where(eq(hbsNotifications.id, id)))[0];

test("notification pipeline", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  delete process.env.SMTP_HOST;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  // Customers have no registration row here: their address comes from Clerk.
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId, primaryEmailAddressId: "e1",
    emailAddresses: [{ id: "e1", emailAddress: userId === owner ? officeEmail : `${userId}@example.invalid`, verification: { status: "verified" } }],
  }));
  await db.insert(hbsOfficeStaff).values([{ userId: owner }, { userId: staff, email: `${staff}@example.invalid` }]).onConflictDoNothing();
  const mails: Mail[] = [];
  const pushes: { userId: string; id: number }[] = [];
  const sendMail = async (mail: Mail) => { mails.push(mail); };
  const sendPush = async (userId: string, payload: { id: number }) => { pushes.push({ userId, id: payload.id }); return "sent" as const; };
  try {
    await t.test("a customer event becomes one row, reaches open streams and counts as unread", async () => {
      const events: StreamEvent[] = [];
      const stop = subscribe(customer, event => events.push(event));
      assert.equal(subscriberCount(customer), 1);
      const result = await publishCustomer(customer, {
        kind: "request.message", title: "رسالة جديدة من المكتب", body: "كتب لك المكتب بخصوص طلبك.", path: "/requests/41#messages",
        targetType: "service_request", targetId: 41, mail: customerMessageMail(`${customer}@example.invalid`, request), whatsapp: true,
      }, { sendMail, sendPush });
      assert.ok(result && !result.coalesced);
      const row = result.notification;
      assert.equal(row.audience, "customer");
      assert.equal(row.priority, "normal");
      assert.equal(row.groupKey, "request.message:service_request:41");
      assert.equal(row.targetId, "41");
      assert.equal(row.deliverAfter, null);
      assert.deepEqual((await rowById(row.id)).delivered, { email: "sent", push: "sent", whatsapp: "skipped" }, "WhatsApp is off in tests");
      assert.equal(mails.length, 1);
      assert.equal(mails[0].to, `${customer}@example.invalid`);
      assert.deepEqual(pushes, [{ userId: customer, id: row.id }]);
      assert.deepEqual(events.map(e => e.type), ["notification", "unread"]);
      assert.equal((events[0].data as { id: number }).id, row.id);
      assert.deepEqual(events[1].data, { count: 1 });
      assert.equal(await unreadCount(customer), 1);
      stop();
      assert.equal(subscriberCount(customer), 0);
    });

    await t.test("a second event on the same target within the hour folds into the row without a second mail", async () => {
      mails.length = 0; pushes.length = 0;
      const result = await publishCustomer(customer, {
        kind: "request.message", title: "رسالة جديدة من المكتب", body: "رسالة ثانية.", path: "/requests/41#messages",
        targetType: "service_request", targetId: 41, mail: customerMessageMail(`${customer}@example.invalid`, request),
      }, { sendMail, sendPush });
      assert.ok(result?.coalesced);
      const rows = await rowsOf(customer);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].count, 2);
      assert.match(rows[0].title, /^رسالتان جديدتان في الطلب/);
      assert.equal(rows[0].body, "آخر تحديث: رسالة ثانية.");
      assert.equal(mails.length, 0, "the mail for this row already went out");
      assert.equal(pushes.length, 0);
      assert.equal(await unreadCount(customer), 1);
      // Read rows are left alone: the next event starts a new row.
      await db.update(hbsNotifications).set({ readAt: new Date() }).where(eq(hbsNotifications.id, rows[0].id));
      const fresh = await publishCustomer(customer, {
        kind: "request.message", title: "رسالة جديدة من المكتب", body: "ثالثة.", targetType: "service_request", targetId: 41,
      }, { sendMail, sendPush });
      assert.ok(fresh && !fresh.coalesced);
      assert.equal((await rowsOf(customer)).length, 2);
      assert.equal(await unreadCount(customer), 1);
    });

    await t.test("a dedupe key records the event once", async () => {
      const input = { kind: "company.invite" as const, title: "دعوة", body: "دعوة للانضمام", dedupeKey: `np-invite-${run}` };
      const first = await publishCustomer(customer, input, { sendMail, sendPush });
      assert.ok(first && !first.coalesced);
      assert.equal(await publishCustomer(customer, input, { sendMail, sendPush }), null);
      assert.equal((await rowsOf(customer)).filter(r => r.dedupeKey === input.dedupeKey).length, 1);
    });

    await t.test("notifyCustomerNow rejects when the mail fails, and the retry sends it", async () => {
      mails.length = 0;
      const build = (to: string | null) => invoiceOverdueMail(to, request, { id: 9, reference: "INV-9", total: "1,150.00 ر.س", days: 9 });
      const meta = { kind: "invoice.overdue" as const, targetType: "invoice", targetId: 9, signals: { daysOverdue: 9 } };
      await assert.rejects(notifyCustomerNow(customer, build, meta, async () => { throw new Error("mail server down"); }), /mail server down/);
      const [failed] = (await rowsOf(customer)).filter(r => r.kind === "invoice.overdue");
      assert.equal(failed.priority, "urgent", "nine days overdue");
      assert.equal(failed.delivered.email, "failed");
      // The sweep gives its claim back and tries again: same row, mail sent this time.
      await notifyCustomerNow(customer, build, meta, sendMail);
      const [retried] = (await rowsOf(customer)).filter(r => r.kind === "invoice.overdue");
      assert.equal(retried.id, failed.id);
      assert.equal(retried.count, 2);
      assert.equal(retried.delivered.email, "sent");
      assert.equal(mails.length, 1);
      assert.match(mails[0].subject, /INV-9/);
    });

    await t.test("notifyCustomer still records the event when the builder has no address to mail", async (t) => {
      t.mock.method(clerkClient.users, "getUser", async () => { throw new Error("no such user"); });
      await notifyCustomer(muted, to => customerMessageMail(to, request), { kind: "request.file", targetType: "service_request", targetId: 41 });
      const rows = await rowsOf(muted);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title, "رسالة جديدة من المكتب");
      assert.equal(rows[0].path, "/requests/41#messages");
      assert.equal(rows[0].delivered.email, "skipped");
      await db.delete(hbsNotifications).where(eq(hbsNotifications.userId, muted));
    });

    await t.test("a muted kind stays in-app only", async () => {
      mails.length = 0; pushes.length = 0;
      await db.insert(hbsNotificationPreferences).values({ userId: muted, mutedKinds: ["request.status"] });
      const result = await publishCustomer(muted, {
        kind: "request.status", title: "طلبك قيد المراجعة", body: "بدأ المكتب العمل.", targetType: "service_request", targetId: 41,
        mail: { to: `${muted}@example.invalid`, subject: "s", heading: "h", lines: ["l"] }, whatsapp: true,
      }, { sendMail, sendPush });
      assert.ok(result);
      assert.deepEqual((await rowById(result.notification.id)).delivered, { email: "skipped", push: "skipped", whatsapp: "skipped" });
      assert.equal(mails.length, 0);
      assert.equal(pushes.length, 0);
      assert.equal(await unreadCount(muted), 1);
    });

    await t.test("quiet hours hold mail and push; the sweep sends one digest and the pushes once", async () => {
      mails.length = 0; pushes.length = 0;
      const now = new Date();
      const hour = riyadhParts(now).hour;
      await db.insert(hbsNotificationPreferences).values({ userId: quiet, quietStart: hour, quietEnd: (hour + 2) % 24 });
      const publish = (body: string, targetId: number) => publishCustomer(quiet, {
        kind: "request.file", title: "أرفق المكتب مستندًا على طلبك", body, path: `/requests/${targetId}`, targetType: "service_request", targetId,
        mail: { to: `${quiet}@example.invalid`, subject: "s", heading: "h", lines: [body] },
      }, { sendMail, sendPush, now: () => now });
      const first = await publish("ملف 1", 1);
      const second = await publish("ملف 2", 2);
      assert.ok(first && second);
      const releaseAt = nextRiyadhHour(now, (hour + 2) % 24);
      assert.equal(first.notification.deliverAfter?.getTime(), releaseAt.getTime());
      assert.deepEqual(first.notification.delivered, { email: "held", push: "held", whatsapp: "skipped" });
      assert.equal(mails.length, 0);
      assert.equal(pushes.length, 0);
      assert.equal(await unreadCount(quiet), 2, "held rows are still in the inbox");

      const deps: DigestDeps = { sendMail, sendPush, emailFor: async userId => `${userId}@digest.invalid` };
      const early = await deliverHeldNotifications(new Date(releaseAt.getTime() - 60_000), deps);
      assert.equal(early.users, 0, "not due yet");
      // A failed digest mail gives the claim back; the pushes do not repeat.
      const failing = { ...deps, sendMail: async () => { throw new Error("mail server down"); } };
      assert.deepEqual(await deliverHeldNotifications(releaseAt, failing), { users: 1, mails: 0, pushes: 2 });
      assert.equal((await rowById(first.notification.id)).digestedAt, null);
      assert.equal((await rowById(first.notification.id)).delivered.push, "sent");
      pushes.length = 0;
      assert.deepEqual(await deliverHeldNotifications(releaseAt, deps), { users: 1, mails: 1, pushes: 0 });
      assert.equal(mails.length, 1);
      assert.equal(mails[0].to, `${quiet}@digest.invalid`);
      assert.equal(mails[0].subject, "ملخص إشعاراتك اليومي");
      assert.ok(mails[0].lines.some(line => line.includes("ملف جديد في الطلب (2)")), mails[0].lines.join("\n"));
      const after = await rowById(second.notification.id);
      assert.ok(after.digestedAt);
      assert.deepEqual(after.delivered, { email: "sent", push: "sent", whatsapp: "skipped" });
      assert.deepEqual(await deliverHeldNotifications(releaseAt, deps), { users: 0, mails: 0, pushes: 0 }, "nothing twice");
    });

    await t.test("an office event fans out to every staff member with one inbox mail", async () => {
      mails.length = 0; pushes.length = 0;
      const mail = officeNewRequestMail({ ...request, category: "passports" });
      assert.ok(mail);
      const results = await publishOffice({
        kind: "office.request_new", title: mail.heading, body: mail.lines.join(" "), path: mail.action?.path, targetType: "service_request", targetId: 41, mail,
      }, { sendMail, sendPush });
      // Other suites may leave staff rows behind; this run's two members are what matters.
      const mine = results.filter(r => [owner, staff].includes(r.notification.userId));
      assert.deepEqual(mine.map(r => r.notification.userId).sort(), [owner, staff].sort());
      assert.ok(results.every(r => r.notification.audience === "office" && r.notification.priority === "high"));
      assert.ok(mine.every(r => r.notification.delivered.email === "sent"));
      assert.equal(mails.length, 1, "one office inbox mail, not one per member");
      assert.equal(mails[0].to, officeEmail);
      assert.deepEqual(pushes.filter(p => [owner, staff].includes(p.userId)).map(p => p.userId).sort(), [owner, staff].sort(), "each member's own devices");
      assert.equal(await unreadCount(staff, true), 1);

      // A named recipient (an assignment) reaches only that member; a copy
      // stands in when there is no mail to take the words from.
      await notifyOffice(() => null, {
        kind: "office.whatsapp_unmatched", recipients: [staff], targetType: "whatsapp_phone", targetId: "9665••••••02",
        copy: { title: "رسالة واتساب من رقم غير معروف", body: "9665••••••02: السلام عليكم", path: "/office/whatsapp" },
      });
      const unmatched = (await rowsOf(staff)).find(r => r.kind === "office.whatsapp_unmatched");
      assert.ok(unmatched);
      assert.equal(unmatched.body, "9665••••••02: السلام عليكم");
      assert.equal(unmatched.path, "/office/whatsapp");
      assert.equal((await rowsOf(owner)).some(r => r.kind === "office.whatsapp_unmatched"), false);
    });

    await t.test("a staff check that fails leaves held office rows for the next sweep, then gives up after bounded retries", async () => {
      resetOfficeAccessRetries();
      const now = new Date();
      const [held] = await db.insert(hbsNotifications).values({
        userId: staff, audience: "office", kind: "office.inquiry_new", title: "استفسار جديد", body: "b", priority: "normal",
        groupKey: `held-${run}`, deliverAfter: new Date(now.getTime() - 60_000), delivered: { email: "held", push: "held", whatsapp: "skipped" },
      }).returning();
      const down: DigestDeps = { sendMail, sendPush, emailFor: async () => null, officeAccess: async () => { throw new Error("Clerk unreachable"); } };
      for (let attempt = 1; attempt < OFFICE_ACCESS_MAX_RETRIES; attempt++) {
        assert.deepEqual(await deliverHeldNotifications(now, down), { users: 0, mails: 0, pushes: 0 });
        const row = await rowById(held.id);
        assert.equal(row.digestedAt, null, `attempt ${attempt}: the row is still held, not skipped`);
        assert.equal(row.delivered.push, "held");
      }
      // Clerk back: the row is delivered as usual.
      pushes.length = 0;
      const up: DigestDeps = { ...down, officeAccess: async () => true };
      assert.deepEqual(await deliverHeldNotifications(now, up), { users: 1, mails: 0, pushes: 1 });
      assert.deepEqual(pushes, [{ userId: staff, id: held.id }]);
      // Still down after the retry budget: the rows are given up on, not held forever.
      const [stuck] = await db.insert(hbsNotifications).values({
        userId: staff, audience: "office", kind: "office.inquiry_new", title: "استفسار آخر", body: "b", priority: "normal",
        groupKey: `stuck-${run}`, deliverAfter: new Date(now.getTime() - 60_000), delivered: { email: "held", push: "held", whatsapp: "skipped" },
      }).returning();
      resetOfficeAccessRetries();
      for (let attempt = 1; attempt < OFFICE_ACCESS_MAX_RETRIES; attempt++) {
        await deliverHeldNotifications(now, down);
        assert.equal((await rowById(stuck.id)).digestedAt, null);
      }
      await deliverHeldNotifications(now, down);
      const given = await rowById(stuck.id);
      assert.ok(given.digestedAt, "skipped after the retry budget");
      assert.equal(given.delivered.push, "skipped");
      // A revoked member (Clerk answers "no") is skipped at once.
      const [revoked] = await db.insert(hbsNotifications).values({
        userId: staff, audience: "office", kind: "office.inquiry_new", title: "ثالث", body: "b", priority: "normal",
        groupKey: `revoked-${run}`, deliverAfter: new Date(now.getTime() - 60_000), delivered: { email: "held", push: "held", whatsapp: "skipped" },
      }).returning();
      await deliverHeldNotifications(now, { ...down, officeAccess: async () => false });
      assert.equal((await rowById(revoked.id)).delivered.email, "skipped");
    });

    await t.test("sendPush sends to every device at once with a timeout, drops gone devices and purges failed ones after 30 days", async () => {
      process.env.VAPID_PUBLIC_KEY = "test-public-key";
      process.env.VAPID_PRIVATE_KEY = "test-private-key";
      process.env.VAPID_SUBJECT = "mailto:test@example.invalid";
      const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/np-${run}-${n}`;
      try {
        await db.insert(hbsPushSubscriptions).values([
          { endpoint: endpoint("ok"), userId: customer, p256dh: "p", auth: "a" },
          { endpoint: endpoint("gone"), userId: customer, p256dh: "p", auth: "a" },
          { endpoint: endpoint("slow"), userId: customer, p256dh: "p", auth: "a" },
        ]);
        let inFlight = 0;
        let peak = 0;
        const deps: PushDeps = {
          async send(subscription, _payload, options) {
            inFlight++; peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 20));
            inFlight--;
            assert.equal(options.timeout, 10_000, "web-push gets a socket timeout");
            if (subscription.endpoint === endpoint("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
            if (subscription.endpoint === endpoint("slow")) throw Object.assign(new Error("timeout"), { statusCode: 504 });
            return {};
          },
        };
        assert.equal(await sendWebPush(customer, { title: "t", body: "b", path: null, id: 1 }, deps), "sent");
        assert.equal(peak, 3, "all devices in parallel, not one after the other");
        const rows = await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.userId, customer));
        assert.deepEqual(rows.map(r => r.endpoint).sort(), [endpoint("ok"), endpoint("slow")].sort(), "410 deletes the device");
        assert.ok(rows.find(r => r.endpoint === endpoint("ok"))?.lastUsedAt);
        assert.ok(rows.find(r => r.endpoint === endpoint("slow"))?.failedAt);
        // Still failing a month later: purged. A recent failure and a working device stay.
        const monthAgo = new Date(Date.now() - 31 * 86_400_000);
        await db.update(hbsPushSubscriptions).set({ failedAt: monthAgo }).where(eq(hbsPushSubscriptions.endpoint, endpoint("slow")));
        assert.equal(await purgeFailedPushSubscriptions(new Date(Date.now() - 2 * 86_400_000)), 0, "not yet 30 days at that time");
        assert.equal(await purgeFailedPushSubscriptions(), 1);
        assert.deepEqual((await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.userId, customer))).map(r => r.endpoint), [endpoint("ok")]);
      } finally {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        delete process.env.VAPID_SUBJECT;
        await db.delete(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.userId, customer));
      }
    });

    await t.test("read rows older than 180 days are purged; unread ones stay", async () => {
      const old = new Date(Date.now() - 200 * 86_400_000);
      const [read, unread] = await db.insert(hbsNotifications).values([
        { userId: customer, audience: "customer", kind: "request.status", title: "t", body: "b", priority: "low", createdAt: old, readAt: old },
        { userId: customer, audience: "customer", kind: "request.status", title: "t", body: "b", priority: "low", createdAt: old },
      ]).returning();
      assert.equal(await purgeOldNotifications(), 1);
      assert.equal((await db.select().from(hbsNotifications).where(inArray(hbsNotifications.id, [read.id, unread.id]))).length, 1);
    });
  } finally {
    await db.delete(hbsNotifications).where(inArray(hbsNotifications.userId, users));
    // The fan-out above also reached staff rows other suites left behind.
    await db.delete(hbsNotifications).where(and(eq(hbsNotifications.groupKey, "office.request_new:service_request:41"), gte(hbsNotifications.createdAt, startedAt)));
    await db.delete(hbsNotificationPreferences).where(inArray(hbsNotificationPreferences.userId, users));
    await db.delete(hbsOfficeStaff).where(and(inArray(hbsOfficeStaff.userId, [owner, staff])));
    await pool.end();
  }
});
