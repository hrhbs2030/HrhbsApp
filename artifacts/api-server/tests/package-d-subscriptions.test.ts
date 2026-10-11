import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { and, eq, inArray, like } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  db, hbsAuditLog, hbsCompanies, hbsCompanyEmployees, hbsCompanyMembers, hbsCustomerSettings, hbsDocumentReminders, hbsInquiries,
  hbsInvoices, hbsOfficeStaff, hbsPlans, hbsRegistrationRequests, hbsRequestEmployees, hbsRequestMessages, hbsServiceRequests,
  hbsSubscriptions, hbsWhatsappInbound, pool,
} from "@workspace/db";
import billingRouter from "../src/routes/billing";
import subscriptionsRouter from "../src/routes/subscriptions";
import whatsappWebhookRouter from "../src/routes/whatsapp-webhook";
import { sendDueReminders, autoRenewalClientRequestId, AUTO_RENEWAL_DESCRIPTION } from "../src/lib/document-reminders";
import { remindOverdueInvoices } from "../src/lib/invoice-reminders";
import { addRiyadhMonth, onSubscriptionInvoicePaid, renewSubscriptions, riyadhMonthName } from "../src/lib/subscriptions";
import { purgeOldWhatsappInbound } from "../src/routes/whatsapp-webhook";
import type { Mail } from "../src/lib/notify";
import { vatFor } from "../src/lib/money";

if (process.env.NODE_ENV === "production") throw new Error("Package D subscription tests must not run in production");

const officeEmail = "package-d-owner@example.invalid";
const owner = `package-d-owner-${randomUUID()}`;
const customer = `package-d-customer-${randomUUID()}`;
const viewer = `package-d-viewer-${randomUUID()}`;
const finance = `package-d-finance-${randomUUID()}`;
const unsubscribed = `package-d-plain-${randomUUID()}`;
// Past due and never paid: the sweep closes this one.
const lapsed = `package-d-lapsed-${randomUUID()}`;
const customers = [customer, unsubscribed, lapsed];
const slugPrefix = `pkg-d-${randomUUID().slice(0, 8)}`;
const whatsappSecret = "package-d-app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", whatsappSecret).update(body).digest("hex")}`;

function testApp() {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use("/api/webhooks/whatsapp", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    // Only this ephemeral app supplies test identities; production auth is untouched.
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  for (const router of [subscriptionsRouter, billingRouter, whatsappWebhookRouter]) app.use("/api", router);
  return app;
}

test("plans, subscriptions, renewals, automatic renewal requests and WhatsApp inbound", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId, primaryEmailAddressId: null,
    emailAddresses: userId === owner ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  delete process.env.SMTP_HOST;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.MOYASAR_SECRET_KEY;
  process.env.WHATSAPP_APP_SECRET = whatsappSecret;

  const server = testApp().listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const call = async (user: string | null, method: string, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method, headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
      return { status: response.status, data };
    };
    await db.insert(hbsOfficeStaff).values({ userId: owner });
    await db.insert(hbsRegistrationRequests).values(customers.map(userId => ({
      userId, email: `${userId}@example.invalid`, fullName: "شركة الاختبار", contactPhone: "0500000000", status: "approved",
    })));
    await db.insert(hbsCompanies).values({ userId: customer, name: "مؤسسة حلول الاختبار", updatedBy: customer });
    await db.insert(hbsCompanyMembers).values([
      { companyUserId: customer, memberUserId: viewer, email: `${viewer}@example.invalid`, role: "viewer", invitedBy: customer, acceptedAt: new Date() },
      { companyUserId: customer, memberUserId: finance, email: `${finance}@example.invalid`, role: "finance", invitedBy: customer, acceptedAt: new Date() },
    ]);
    const sent: { userId: string; mail: Mail | null }[] = [];
    const send = async (userId: string, build: (to: string | null) => Mail | null) => { sent.push({ userId, mail: build(`${userId}@example.invalid`) }); };

    await t.test("a month is added on the Riyadh calendar", () => {
      // 31 January 03:00 Riyadh (00:00 UTC) → 28 February; 31 March → 30 April.
      assert.equal(addRiyadhMonth(new Date("2026-01-31T00:00:00Z")).toISOString(), "2026-02-28T00:00:00.000Z");
      assert.equal(addRiyadhMonth(new Date("2026-03-31T12:34:56Z")).toISOString(), "2026-04-30T12:34:56.000Z");
      // 23:30 UTC on 15 December is already 16 December in Riyadh: the day is kept there.
      assert.equal(addRiyadhMonth(new Date("2026-12-15T23:30:00Z")).toISOString(), "2027-01-15T23:30:00.000Z");
      // The start's day of month is the anchor: clamped in February, back on the 31st in March.
      const startedOn31st = new Date("2026-01-31T00:00:00Z");
      const february = addRiyadhMonth(startedOn31st, startedOn31st);
      assert.equal(february.toISOString(), "2026-02-28T00:00:00.000Z");
      assert.equal(addRiyadhMonth(february, startedOn31st).toISOString(), "2026-03-31T00:00:00.000Z");
      assert.equal(addRiyadhMonth(february).toISOString(), "2026-03-28T00:00:00.000Z", "without an anchor the day drifts");
      assert.equal(addRiyadhMonth(new Date("2026-03-10T09:00:00Z"), startedOn31st).toISOString(), "2026-04-30T09:00:00.000Z", "a late payment renews on the anchored day");
      assert.match(riyadhMonthName(new Date("2026-10-11T00:00:00Z")), /أكتوبر 2026/);
    });

    let basicId = 0;
    let premiumId = 0;
    await t.test("the owner publishes plans; the public sees active ones by sort", async () => {
      const plan = { slug: `${slugPrefix}-basic`, name: "الباقة الأساسية", description: "حتى 10 موظفين", price: 20_000, employeeCap: 10, requestsPerMonth: 5, sort: 2 };
      assert.equal((await call(customer, "POST", "/office/plans", plan)).status, 403);
      assert.equal((await call(owner, "POST", "/office/plans", { ...plan, price: 50 })).status, 400, "under one riyal");
      assert.equal((await call(owner, "POST", "/office/plans", { ...plan, slug: "Bad Slug" })).status, 400);
      const created = await call(owner, "POST", "/office/plans", plan);
      assert.equal(created.status, 201);
      assert.equal(created.data.vat, vatFor(20_000));
      assert.equal(created.data.total, 20_000 + vatFor(20_000));
      assert.equal(created.data.autoRenewals, true);
      basicId = created.data.id;
      assert.equal((await call(owner, "POST", "/office/plans", plan)).status, 409, "duplicate slug");
      const premium = await call(owner, "POST", "/office/plans", { ...plan, slug: `${slugPrefix}-premium`, name: "الباقة المتقدمة", price: 50_000, employeeCap: null, requestsPerMonth: null, sort: 1 });
      assert.equal(premium.status, 201);
      premiumId = premium.data.id;
      const hidden = await call(owner, "POST", "/office/plans", { ...plan, slug: `${slugPrefix}-hidden`, active: false, sort: 0 });
      assert.equal(hidden.status, 201);
      const updated = await call(owner, "PUT", `/office/plans/${hidden.data.id}`, { ...plan, slug: `${slugPrefix}-hidden`, active: false, sort: 0, name: "باقة مخفية" });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.name, "باقة مخفية");
      assert.equal((await call(owner, "PUT", `/office/plans/${hidden.data.id}`, { ...plan, slug: `${slugPrefix}-premium` })).status, 409);
      const missing = await call(owner, "PUT", "/office/plans/2147483000", plan);
      assert.equal(missing.status, 404, JSON.stringify(missing.data));
      const publicPlans = (await call(null, "GET", "/plans")).data.filter((p: any) => p.slug.startsWith(slugPrefix));
      assert.deepEqual(publicPlans.map((p: any) => p.slug), [`${slugPrefix}-premium`, `${slugPrefix}-basic`]);
      const all = (await call(owner, "GET", "/office/plans")).data.filter((p: any) => p.slug.startsWith(slugPrefix));
      assert.equal(all.length, 3);
      assert.equal((await call(customer, "GET", "/office/plans")).status, 403);
      const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "plan"), eq(hbsAuditLog.targetId, String(hidden.data.id))));
      assert.deepEqual(audits.map(a => a.action).sort(), ["plan.create", "plan.update"]);
    });

    let subscriptionId = 0;
    let firstInvoiceId = 0;
    await t.test("the company owner subscribes and gets the first invoice", async () => {
      assert.deepEqual((await call(customer, "GET", "/company/subscription")).data, { subscription: null });
      assert.equal((await call(viewer, "GET", "/company/subscription")).status, 403, "viewers cannot see billing");
      assert.equal((await call(viewer, "POST", "/company/subscription", { planId: basicId })).status, 403);
      assert.equal((await call(customer, "POST", "/company/subscription", { planId: 2147483000 })).status, 404);
      const before = Date.now();
      const started = await call(customer, "POST", "/company/subscription", { planId: basicId });
      assert.equal(started.status, 201);
      subscriptionId = started.data.id;
      assert.equal(started.data.status, "active");
      assert.equal(started.data.plan.id, basicId);
      assert.equal(started.data.autoRenewRequests, true);
      const renewsAt = new Date(started.data.renewsAt).getTime();
      assert.ok(renewsAt > before + 27 * 86_400_000 && renewsAt < before + 32 * 86_400_000, "renews in about a month");
      const invoice = started.data.latestInvoice;
      assert.ok(invoice);
      firstInvoiceId = invoice.id;
      assert.equal(invoice.requestId, null);
      assert.equal(invoice.requestReference, null);
      assert.equal(invoice.subscriptionId, subscriptionId);
      assert.equal(invoice.quantity, 1);
      assert.equal(invoice.amount, 20_000);
      assert.equal(invoice.total, 20_000 + vatFor(20_000));
      assert.equal(invoice.status, "issued");
      assert.match(invoice.description, /^اشتراك الباقة الأساسية — /);
      const [row] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
      const [issuer] = await db.select().from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, row.issuedBy));
      assert.ok(issuer && issuer.email === null, "issued by the office owner");
      assert.equal((await call(customer, "POST", "/company/subscription", { planId: premiumId })).status, 409, "one open subscription");
      assert.equal((await call(finance, "POST", "/company/subscription", { planId: premiumId })).status, 409, "finance acts for the same company");
      const fetched = await call(finance, "GET", "/company/subscription");
      assert.equal(fetched.data.subscription.id, subscriptionId);
      assert.equal(fetched.data.subscription.latestInvoice.id, invoice.id);
      const invoices = await call(customer, "GET", "/company/invoices");
      assert.equal(invoices.status, 200);
      assert.deepEqual(invoices.data.map((i: any) => i.id), [invoice.id]);
      const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "subscription"), eq(hbsAuditLog.targetId, String(subscriptionId))));
      assert.deepEqual(audits.map(a => a.action).sort(), ["invoice.issue", "subscription.start"]);
    });

    await t.test("the office lists subscriptions with the company and customer names", async () => {
      assert.equal((await call(customer, "GET", "/office/subscriptions")).status, 403);
      assert.equal((await call(owner, "GET", "/office/subscriptions?page=0")).status, 400);
      const page = await call(owner, "GET", "/office/subscriptions?status=active&pageSize=100");
      assert.equal(page.status, 200);
      const mine = page.data.items.find((s: any) => s.id === subscriptionId);
      assert.ok(mine);
      assert.ok(page.data.total >= 1);
      assert.equal(mine.userId, customer);
      assert.equal(mine.companyName, "مؤسسة حلول الاختبار");
      assert.equal(mine.customerName, "شركة الاختبار");
      assert.equal(mine.latestInvoice.id, firstInvoiceId);
      const none = await call(owner, "GET", "/office/subscriptions?status=cancelled&pageSize=100");
      assert.ok(!none.data.items.some((s: any) => s.id === subscriptionId));
      const patched = await call(owner, "PATCH", `/office/subscriptions/${subscriptionId}`, { autoRenewRequests: false });
      assert.equal(patched.status, 200);
      assert.equal(patched.data.autoRenewRequests, false);
      assert.equal(patched.data.status, "active");
      assert.equal((await call(owner, "PATCH", `/office/subscriptions/${subscriptionId}`, {})).status, 400);
      assert.equal((await call(owner, "PATCH", "/office/subscriptions/2147483000", { status: "cancelled" })).status, 404);
      const back = await call(customer, "PATCH", "/company/subscription", { autoRenewRequests: true });
      assert.equal(back.status, 200);
      assert.equal(back.data.autoRenewRequests, true);
      assert.equal((await call(viewer, "PATCH", "/company/subscription", { autoRenewRequests: false })).status, 403);
    });

    await t.test("a subscription invoice is paid through the regular payment path", async () => {
      assert.equal((await call(customer, "POST", `/invoices/${firstInvoiceId}/pay`)).status, 503, "gateway off");
      const calls: string[] = [];
      let paid = false;
      const realFetch = globalThis.fetch;
      process.env.MOYASAR_SECRET_KEY = "sk_test_placeholder";
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith("https://api.moyasar.com/")) return realFetch(input, init);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const id = init?.method === "POST" ? `gw-${randomUUID()}` : url.split("/").at(-1)!;
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { amount: number; description: string; success_url: string; metadata: Record<string, string> };
          assert.equal(body.amount, 20_000 + vatFor(20_000));
          assert.match(body.description, /^INV-\d{4}-\d{5} · اشتراك/);
          assert.equal(body.metadata.subscription_id, String(subscriptionId));
        }
        return new Response(JSON.stringify({ id, status: paid ? "paid" : "initiated", amount: 20_000 + vatFor(20_000), currency: "SAR", url: `https://pay.example.invalid/${id}` }));
      }) as typeof fetch;
      try {
        assert.equal((await call(unsubscribed, "POST", `/invoices/${firstInvoiceId}/pay`)).status, 404, "another customer's invoice");
        const started = await call(customer, "POST", `/invoices/${firstInvoiceId}/pay`);
        assert.equal(started.status, 200);
        assert.match(started.data.url, /^https:\/\/pay\.example\.invalid\//);
        paid = true;
        const refreshed = await call(customer, "POST", `/invoices/${firstInvoiceId}/refresh`);
        assert.equal(refreshed.status, 200);
        assert.equal(refreshed.data.status, "paid");
        assert.equal(refreshed.data.paymentMethod, "online");
        assert.equal(refreshed.data.subscriptionId, subscriptionId);
        const current = await call(customer, "GET", "/company/subscription");
        assert.equal(current.data.subscription.latestInvoice.status, "paid");
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.MOYASAR_SECRET_KEY;
      }
    });

    await t.test("the daily sweep issues the next invoice, marks past due and reactivates on payment", async () => {
      const [before] = await db.select().from(hbsSubscriptions).where(eq(hbsSubscriptions.id, subscriptionId));
      const dueAt = new Date(Date.now() - 60_000);
      await db.update(hbsSubscriptions).set({ renewsAt: dueAt }).where(eq(hbsSubscriptions.id, subscriptionId));
      sent.length = 0;
      const first = await renewSubscriptions(send);
      assert.ok(first.issued >= 1);
      const [renewed] = await db.select().from(hbsSubscriptions).where(eq(hbsSubscriptions.id, subscriptionId));
      assert.equal(renewed.renewsAt.toISOString(), addRiyadhMonth(dueAt).toISOString());
      assert.equal(renewed.status, "active");
      const invoices = await db.select().from(hbsInvoices).where(eq(hbsInvoices.subscriptionId, subscriptionId));
      assert.equal(invoices.length, 2);
      const renewal = invoices.find(i => i.id !== firstInvoiceId)!;
      assert.equal(renewal.status, "issued");
      assert.equal(renewal.description, `اشتراك الباقة الأساسية — ${riyadhMonthName(dueAt)}`);
      const invoiceMail = sent.find(s => s.userId === customer)?.mail;
      assert.ok(invoiceMail);
      assert.match(invoiceMail.subject, /فاتورة اشتراكك الشهرية/);
      assert.equal(invoiceMail.action?.path, `/company?tab=subscription&invoice=${renewal.id}`);
      // Nothing is due any more: a second sweep issues nothing for this subscription.
      await renewSubscriptions(send);
      assert.equal((await db.select().from(hbsInvoices).where(eq(hbsInvoices.subscriptionId, subscriptionId))).length, 2);
      assert.ok(before.renewsAt.getTime() > dueAt.getTime());

      // Unpaid for 15 days: past due, told once.
      await db.update(hbsInvoices).set({ issuedAt: new Date(Date.now() - 45 * 86_400_000) }).where(eq(hbsInvoices.id, firstInvoiceId));
      await db.update(hbsInvoices).set({ issuedAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(hbsInvoices.id, renewal.id));
      sent.length = 0;
      const second = await renewSubscriptions(send);
      assert.ok(second.pastDue >= 1);
      assert.equal((await db.select().from(hbsSubscriptions).where(eq(hbsSubscriptions.id, subscriptionId)))[0].status, "past_due");
      const pastDueMail = sent.find(s => s.userId === customer)?.mail;
      assert.ok(pastDueMail);
      assert.match(pastDueMail.subject, /متأخر السداد/);
      sent.length = 0;
      await renewSubscriptions(send);
      assert.equal(sent.filter(s => s.userId === customer).length, 0, "no second past-due mail");
      const shown = await call(customer, "GET", "/company/subscription");
      assert.equal(shown.data.subscription.status, "past_due");
      const list = await call(owner, "GET", "/office/subscriptions?status=past_due&pageSize=100");
      assert.ok(list.data.items.some((s: any) => s.id === subscriptionId));

      // The overdue invoice reminder knows subscription invoices.
      await db.update(hbsInvoices).set({ reminderCount: 0, remindedAt: null }).where(eq(hbsInvoices.id, renewal.id));
      sent.length = 0;
      await remindOverdueInvoices(send);
      const reminder = sent.find(s => s.userId === customer)?.mail;
      assert.ok(reminder);
      assert.match(reminder.subject, /تذكير بسداد فاتورة الاشتراك/);
      assert.equal((await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, renewal.id)))[0].reminderCount, 2);

      // Paid at the office: the sweep (or the billing hook) brings it back,
      // and the next renewal is a month after the payment, not the missed one.
      const paidAt = new Date();
      await db.update(hbsInvoices).set({ status: "paid", paymentMethod: "manual", paidAt }).where(eq(hbsInvoices.id, renewal.id));
      const third = await renewSubscriptions(send);
      assert.ok(third.reactivated >= 1);
      const [reactivated] = await db.select().from(hbsSubscriptions).where(eq(hbsSubscriptions.id, subscriptionId));
      assert.equal(reactivated.status, "active");
      assert.equal(reactivated.renewsAt.toISOString(), addRiyadhMonth(paidAt, reactivated.startsAt).toISOString());
      assert.ok(reactivated.renewsAt.getTime() > Date.now() + 27 * 86_400_000, "the month ahead is bought");
      assert.equal(await onSubscriptionInvoicePaid({ id: renewal.id, subscriptionId }), null, "already active");
      assert.equal(await onSubscriptionInvoicePaid({ id: 1, subscriptionId: null }), null);
      assert.equal((await db.select().from(hbsInvoices).where(eq(hbsInvoices.subscriptionId, subscriptionId))).length, 2, "no invoice for the missed month");
    });

    await t.test("past due for two months with the invoice unpaid: the sweep cancels the subscription, once", async () => {
      const [plan] = await db.select().from(hbsPlans).where(eq(hbsPlans.id, basicId));
      const startsAt = new Date(Date.now() - 100 * 86_400_000);
      const [overdue] = await db.insert(hbsSubscriptions).values({
        userId: lapsed, planId: plan.id, status: "past_due", startsAt, renewsAt: new Date(Date.now() - 10 * 86_400_000),
      }).returning();
      const unpaid = async (daysAgo: number) => (await db.insert(hbsInvoices).values({
        subscriptionId: overdue.id, description: "اشتراك", amountHalalas: plan.priceHalalas, vatRateBasisPoints: 1_500,
        vatHalalas: vatFor(plan.priceHalalas), totalHalalas: plan.priceHalalas + vatFor(plan.priceHalalas), issuedBy: owner,
        issuedAt: new Date(Date.now() - daysAgo * 86_400_000),
      }).returning())[0];
      await unpaid(59);
      sent.length = 0;
      const early = await renewSubscriptions(send);
      assert.equal(early.cancelled, 0);
      assert.equal((await db.select().from(hbsSubscriptions).where(eq(hbsSubscriptions.id, overdue.id)))[0].status, "past_due", "59 days: still waiting");
      // The newest invoice decides: a fresh one keeps the subscription open.
      await db.update(hbsInvoices).set({ issuedAt: new Date(Date.now() - 61 * 86_400_000) }).where(eq(hbsInvoices.subscriptionId, overdue.id));
      const late = await renewSubscriptions(send);
      assert.equal(late.cancelled, 1);
      const [closed] = await db.select().from(hbsSubscriptions).where(eq(hbsSubscriptions.id, overdue.id));
      assert.equal(closed.status, "cancelled");
      assert.ok(closed.cancelledAt);
      const mail = sent.find(s => s.userId === lapsed)?.mail;
      assert.ok(mail);
      assert.match(mail.subject, /أُلغي اشتراكك لعدم السداد/);
      const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "subscription"), eq(hbsAuditLog.targetId, String(overdue.id))));
      assert.deepEqual(audits.map(a => a.action), ["subscription.update"]);
      assert.deepEqual(audits[0].details, { fromStatus: "past_due", toStatus: "cancelled", automatic: "invoice_unpaid", invoiceId: (await db.select().from(hbsInvoices).where(eq(hbsInvoices.subscriptionId, overdue.id)))[0].id, userId: lapsed });
      sent.length = 0;
      assert.equal((await renewSubscriptions(send)).cancelled, 0, "not twice");
      assert.equal(sent.length, 0);
      assert.equal((await call(lapsed, "GET", "/company/subscription")).data.subscription, null, "the company may subscribe again");
      await db.delete(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "subscription"), eq(hbsAuditLog.targetId, String(overdue.id))));
    });

    await t.test("an expiring employee document opens a renewal request for a subscribed company", async () => {
      const expiresOn = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      const [employee] = await db.insert(hbsCompanyEmployees).values({ userId: customer, fullName: "محمد العامل", iqamaExpiresOn: expiresOn, createdBy: customer }).returning();
      const [plainEmployee] = await db.insert(hbsCompanyEmployees).values({ userId: unsubscribed, fullName: "عامل بلا اشتراك", iqamaExpiresOn: expiresOn, createdBy: unsubscribed }).returning();
      const [reminder] = await db.insert(hbsDocumentReminders).values({ userId: customer, kind: "iqama", label: employee.fullName, expiresOn, createdBy: customer, employeeId: employee.id }).returning();
      await db.insert(hbsDocumentReminders).values({ userId: unsubscribed, kind: "iqama", label: plainEmployee.fullName, expiresOn, createdBy: unsubscribed, employeeId: plainEmployee.id });
      sent.length = 0;
      await sendDueReminders(send);
      const requests = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.clientRequestId, autoRenewalClientRequestId(reminder)));
      assert.equal(requests.length, 1);
      const [request] = requests;
      assert.equal(request.userId, customer);
      assert.equal(request.category, "passports");
      assert.equal(request.service, "تجديد الإقامة");
      assert.ok(request.description.startsWith(AUTO_RENEWAL_DESCRIPTION));
      assert.equal(request.employeeId, employee.id);
      assert.equal(request.contactPhone, "0500000000");
      const linked = await db.select().from(hbsRequestEmployees).where(eq(hbsRequestEmployees.requestId, request.id));
      assert.deepEqual(linked.map(l => l.employeeId), [employee.id]);
      const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "service_request"), eq(hbsAuditLog.targetId, String(request.id))));
      assert.ok(audits.some(a => a.action === "service_request.auto_renew"));
      const mail = sent.find(s => s.userId === customer)?.mail;
      assert.ok(mail);
      assert.ok(mail.lines.some(line => line.includes("تلقائيًا")), "the reminder mentions the request");
      assert.equal(mail.action?.path, `/requests/${request.id}`);
      const plainMail = sent.find(s => s.userId === unsubscribed)?.mail;
      assert.ok(plainMail);
      assert.equal(plainMail.action?.path, "/requests/new", "no subscription: the usual reminder");
      assert.equal((await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, unsubscribed))).length, 0);

      // The same reminder fired again for the same expiry never opens a second request.
      await db.update(hbsDocumentReminders).set({ lastReminderDays: null }).where(eq(hbsDocumentReminders.id, reminder.id));
      await sendDueReminders(send);
      assert.equal((await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer))).length, 1);

      // Switched off by the customer: nothing is opened for a new expiry.
      await call(customer, "PATCH", "/company/subscription", { autoRenewRequests: false });
      const later = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
      await db.update(hbsDocumentReminders).set({ expiresOn: later, lastReminderDays: null }).where(eq(hbsDocumentReminders.id, reminder.id));
      await sendDueReminders(send);
      assert.equal((await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer))).length, 1);
      await call(customer, "PATCH", "/company/subscription", { autoRenewRequests: true });
    });

    await t.test("WhatsApp messages from a registered number reach the open request or become an inquiry", async () => {
      await db.insert(hbsCustomerSettings).values({ userId: customer, whatsappOptIn: true, whatsappPhone: "0500000001" });
      const base = `http://127.0.0.1:${address.port}/api/webhooks/whatsapp`;
      const post = (id: string, from: string, body: string) => {
        const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: {
          messaging_product: "whatsapp", messages: [{ id, from, type: "text", timestamp: "1", text: { body } }],
        } }] }] });
        return fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(payload) }, body: payload });
      };
      const [request] = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer));
      await db.update(hbsServiceRequests).set({ status: "waiting_on_customer" }).where(eq(hbsServiceRequests.id, request.id));
      const first = `wamid.${randomUUID()}`;
      assert.equal((await post(first, "966500000001", "تم رفع المستند")).status, 200);
      const messages = await db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, request.id));
      assert.equal(messages.length, 1);
      assert.equal(messages[0].authorRole, "customer");
      assert.equal(messages[0].authorId, customer);
      assert.equal(messages[0].body, "تم رفع المستند");
      assert.equal((await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, request.id)))[0].status, "reviewing", "the reply resumes the request");
      const [inbound] = await db.select().from(hbsWhatsappInbound).where(eq(hbsWhatsappInbound.waMessageId, first));
      assert.equal(inbound.handled, "request_message");
      assert.equal(inbound.userId, customer);
      assert.equal(inbound.requestId, request.id);
      assert.equal(inbound.fromPhone, "966500000001");
      const [settings] = await db.select().from(hbsCustomerSettings).where(eq(hbsCustomerSettings.userId, customer));
      assert.ok(settings.lastInboundAt && Date.now() - settings.lastInboundAt.getTime() < 60_000);
      // Redelivered: nothing is added twice.
      assert.equal((await post(first, "966500000001", "تم رفع المستند")).status, 200);
      assert.equal((await db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, request.id))).length, 1);

      // A second open request: the message becomes an inquiry.
      await db.insert(hbsServiceRequests).values({ userId: customer, category: "other", service: "خدمة ثانية", description: "طلب آخر مفتوح.", contactPhone: "0500000000" });
      const second = `wamid.${randomUUID()}`;
      assert.equal((await post(second, "+966500000001", "استفسار عام")).status, 200);
      const inquiries = await db.select().from(hbsInquiries).where(eq(hbsInquiries.userId, customer));
      assert.equal(inquiries.length, 1);
      assert.equal(inquiries[0].subject, "رسالة واتساب");
      assert.equal(inquiries[0].message, "استفسار عام");
      assert.equal((await db.select().from(hbsWhatsappInbound).where(eq(hbsWhatsappInbound.waMessageId, second)))[0].handled, "inquiry");

      // An unknown number is kept for the office, its text cut to 200 characters.
      const third = `wamid.${randomUUID()}`;
      assert.equal((await post(third, "966500000099", "من أنا؟ " + "نص طويل ".repeat(60))).status, 200);
      const [unknown] = await db.select().from(hbsWhatsappInbound).where(eq(hbsWhatsappInbound.waMessageId, third));
      assert.equal(unknown.handled, "unmatched");
      assert.equal(unknown.userId, null);
      assert.equal(unknown.body.length, 200);
      assert.ok(unknown.body.startsWith("من أنا؟ "));
      assert.equal((await db.select().from(hbsInquiries).where(eq(hbsInquiries.userId, customer))).length, 1);
      assert.ok(messages[0].body.length < 200 && (await db.select().from(hbsWhatsappInbound).where(eq(hbsWhatsappInbound.waMessageId, first)))[0].body === "تم رفع المستند", "matched messages are kept whole");

      // Inbound records older than 90 days are purged daily.
      const old = `wamid.${randomUUID()}`;
      const recent = `wamid.${randomUUID()}`;
      const now = new Date("2026-10-01T00:00:00Z");
      await db.insert(hbsWhatsappInbound).values([
        { waMessageId: old, fromPhone: "966500000098", body: "قديم", handled: "unmatched", receivedAt: new Date(now.getTime() - 91 * 86_400_000) },
        { waMessageId: recent, fromPhone: "966500000098", body: "حديث", handled: "unmatched", receivedAt: new Date(now.getTime() - 89 * 86_400_000) },
      ]);
      assert.ok(await purgeOldWhatsappInbound(now) >= 1);
      const kept = await db.select({ id: hbsWhatsappInbound.waMessageId }).from(hbsWhatsappInbound).where(eq(hbsWhatsappInbound.fromPhone, "966500000098"));
      assert.deepEqual(kept.map(k => k.id), [recent]);
    });

    await t.test("cancelling ends the subscription", async () => {
      const cancelled = await call(customer, "PATCH", "/company/subscription", { cancel: true });
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.data.status, "cancelled");
      assert.ok(cancelled.data.cancelledAt);
      assert.deepEqual((await call(customer, "GET", "/company/subscription")).data, { subscription: null });
      assert.equal((await call(customer, "PATCH", "/company/subscription", { cancel: true })).status, 404);
      assert.equal((await call(owner, "PATCH", `/office/subscriptions/${subscriptionId}`, { status: "cancelled" })).status, 409);
      // The sweep leaves a cancelled subscription alone even when it was due.
      await db.update(hbsSubscriptions).set({ renewsAt: new Date(Date.now() - 60_000) }).where(eq(hbsSubscriptions.id, subscriptionId));
      await renewSubscriptions(send);
      assert.equal((await db.select().from(hbsInvoices).where(eq(hbsInvoices.subscriptionId, subscriptionId))).length, 2);
      const again = await call(customer, "POST", "/company/subscription", { planId: premiumId, autoRenewRequests: false });
      assert.equal(again.status, 201, `a new subscription after cancelling: ${JSON.stringify(again.data)}`);
      assert.equal(again.data.plan.id, premiumId);
      assert.equal(again.data.autoRenewRequests, false);
      const invoices = await call(customer, "GET", "/company/invoices");
      assert.equal(invoices.data.length, 3);
      assert.equal(invoices.data[0].subscriptionId, again.data.id, "newest first");
    });
  } finally {
    delete process.env.WHATSAPP_APP_SECRET;
    const subscriptions = await db.select({ id: hbsSubscriptions.id }).from(hbsSubscriptions).where(inArray(hbsSubscriptions.userId, customers));
    const ids = subscriptions.map(s => s.id);
    await db.delete(hbsInvoices).where(inArray(hbsInvoices.subscriptionId, ids.length ? ids : [0]));
    await db.delete(hbsSubscriptions).where(inArray(hbsSubscriptions.userId, customers));
    await db.delete(hbsPlans).where(like(hbsPlans.slug, `${slugPrefix}-%`));
    await db.delete(hbsWhatsappInbound).where(like(hbsWhatsappInbound.fromPhone, "9665000000%"));
    await db.delete(hbsInquiries).where(inArray(hbsInquiries.userId, customers));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, customers));
    await db.delete(hbsDocumentReminders).where(inArray(hbsDocumentReminders.userId, customers));
    await db.delete(hbsCompanyEmployees).where(inArray(hbsCompanyEmployees.userId, customers));
    await db.delete(hbsCustomerSettings).where(inArray(hbsCustomerSettings.userId, customers));
    await db.delete(hbsCompanyMembers).where(eq(hbsCompanyMembers.companyUserId, customer));
    await db.delete(hbsCompanies).where(inArray(hbsCompanies.userId, customers));
    await db.delete(hbsRegistrationRequests).where(inArray(hbsRegistrationRequests.userId, customers));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, owner));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
