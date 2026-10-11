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
  db, hbsAuditLog, hbsCustomerSettings, hbsDocumentReminders, hbsInvoices, hbsOfficeStaff,
  hbsServiceOffers, hbsServiceRequests, pool,
} from "@workspace/db";
import portalRouter from "../src/routes/portal";
import billingRouter, { settleFromGateway } from "../src/routes/billing";
import catalogRouter from "../src/routes/catalog";
import { createRemindersRouter } from "../src/routes/reminders";
import reportsRouter from "../src/routes/reports";
import officeAdminRouter from "../src/routes/office-admin";
import { sendDueReminders } from "../src/lib/document-reminders";

if (process.env.NODE_ENV === "production") {
  throw new Error("Office feature tests must not run in production");
}

const officeEmail = "office-features-owner@example.invalid";
const staffEmail = "office-features-staff@example.invalid";
const owner = `features-owner-${randomUUID()}`;
const staff = `features-staff-${randomUUID()}`;
const customerA = `features-a-${randomUUID()}`;
const customerB = `features-b-${randomUUID()}`;
const outsider = `features-outsider-${randomUUID()}`;
const customers = [customerA, customerB];
const slug = `features-test-${randomUUID().slice(0, 8)}`;

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
  const reader = async () => JSON.stringify({ kind: "iqama", label: "Test Holder", expiresOn: "2031-02-30", expiresOnText: "1452/10/01" });
  for (const router of [portalRouter, billingRouter, catalogRouter, createRemindersRouter(reader), reportsRouter, officeAdminRouter]) {
    app.use("/api", router);
  }
  return app;
}

type Call = (user: string | null, method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

function client(base: string): Call {
  return async (user, method, path, body) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
}

test("assignment, statuses, ratings, invoices, reminders, catalogue and reports", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId,
    primaryEmailAddressId: null,
    emailAddresses: userId === staff ? [{ emailAddress: staffEmail, verification: { status: "verified" } }]
      : userId === owner ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  // No email or WhatsApp settings in tests, so notifications are skipped.
  delete process.env.SMTP_HOST;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.MOYASAR_SECRET_KEY;

  const server = testApp().listen(0);
  const requestIds: number[] = [];
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const call = client(`http://127.0.0.1:${address.port}`);
    await db.insert(hbsOfficeStaff).values([{ userId: owner }, { userId: staff, email: staffEmail, addedBy: owner }]);
    const [reqA, reqB] = await db.insert(hbsServiceRequests).values(customers.map(userId => ({
      userId, category: "passports" as const, service: "تجديد الإقامة",
      description: "Renew a residence permit for the test.", contactPhone: "0500000000",
    }))).returning();
    requestIds.push(reqA.id, reqB.id);

    await t.test("assignees and assignment", async () => {
      const assignees = await call(staff, "GET", "/office/assignees");
      assert.equal(assignees.status, 200);
      assert.ok(assignees.data.some((a: any) => a.userId === owner && a.role === "owner" && a.email === officeEmail));
      assert.equal((await call(customerA, "GET", "/office/assignees")).status, 403);

      const rejected = await call(owner, "PATCH", `/office/service-requests/${reqA.id}`, {
        status: "reviewing", expectedUpdatedAt: reqA.updatedAt.toISOString(), assignedTo: outsider,
      });
      assert.equal(rejected.status, 400);

      const past = new Date(Date.now() - 86_400_000).toISOString();
      const assigned = await call(owner, "PATCH", `/office/service-requests/${reqA.id}`, {
        status: "submitted_to_authority", expectedUpdatedAt: reqA.updatedAt.toISOString(), assignedTo: staff, dueAt: past,
      });
      assert.equal(assigned.status, 200);
      assert.equal(assigned.data.assignedTo, staff);
      assert.equal(assigned.data.status, "submitted_to_authority");

      const mine = await call(staff, "GET", "/office/service-requests?assignee=me&pageSize=100");
      assert.deepEqual(mine.data.items.map((r: any) => r.id), [reqA.id]);
      const overdue = await call(staff, "GET", "/office/service-requests?overdue=true&pageSize=100");
      assert.ok(overdue.data.items.some((r: any) => r.id === reqA.id));
      assert.ok(!overdue.data.items.some((r: any) => r.id === reqB.id));
      const notFiltered = await call(staff, "GET", "/office/service-requests?overdue=false&pageSize=100");
      assert.ok(notFiltered.data.items.some((r: any) => r.id === reqB.id));
      const unassigned = await call(staff, "GET", "/office/service-requests?assignee=unassigned&pageSize=100");
      assert.ok(unassigned.data.items.some((r: any) => r.id === reqB.id) && !unassigned.data.items.some((r: any) => r.id === reqA.id));

      const summary = await call(staff, "GET", "/office/summary");
      assert.equal(summary.data.myRequests, 1);
      assert.ok(summary.data.overdueRequests >= 1);

      // Keeping fields out of the body leaves the assignment alone.
      const kept = await call(staff, "PATCH", `/office/service-requests/${reqA.id}`, {
        status: "submitted_to_authority", expectedUpdatedAt: assigned.data.updatedAt,
      });
      assert.equal(kept.data.assignedTo, staff);
      const [audit] = await db.select().from(hbsAuditLog).where(eq(hbsAuditLog.targetId, String(reqA.id)))
        .orderBy(hbsAuditLog.id).limit(1);
      assert.equal((audit.details as any).toAssignee, staff);

      const history = await call(customerA, "GET", `/service-requests/${reqA.id}/history`);
      assert.deepEqual(history.data.map((e: any) => e.status), ["received", "submitted_to_authority"]);
      // Customers never see who handles their request.
      const own = await call(customerA, "GET", `/service-requests/${reqA.id}`);
      assert.ok(!("assignedTo" in own.data));
    });

    await t.test("ratings: completed requests only, once, own requests only", async () => {
      assert.equal((await call(customerA, "POST", `/service-requests/${reqA.id}/rating`, { rating: 5 })).status, 409);
      await db.update(hbsServiceRequests).set({ status: "completed" }).where(eq(hbsServiceRequests.id, reqA.id));
      await db.insert(hbsAuditLog).values({
        actorId: owner, action: "service_request.update", targetType: "service_request", targetId: String(reqA.id),
        details: { fromStatus: "submitted_to_authority", toStatus: "completed" },
      });
      assert.equal((await call(customerB, "POST", `/service-requests/${reqA.id}/rating`, { rating: 5 })).status, 404);
      assert.equal((await call(customerA, "POST", `/service-requests/${reqA.id}/rating`, { rating: 6 })).status, 400);
      const rated = await call(customerA, "POST", `/service-requests/${reqA.id}/rating`, { rating: 4, comment: " Quick " });
      assert.equal(rated.status, 200);
      assert.equal(rated.data.rating, 4);
      assert.equal(rated.data.ratingComment, "Quick");
      assert.equal((await call(customerA, "POST", `/service-requests/${reqA.id}/rating`, { rating: 1 })).status, 409);
    });

    await t.test("notification settings validate Saudi mobiles", async () => {
      assert.equal((await call(customerA, "PUT", "/portal/settings", { whatsappOptIn: true, whatsappPhone: null })).status, 400);
      assert.equal((await call(customerA, "PUT", "/portal/settings", { whatsappOptIn: true, whatsappPhone: "12345" })).status, 400);
      const saved = await call(customerA, "PUT", "/portal/settings", { whatsappOptIn: true, whatsappPhone: "055 123 4567" });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.whatsappAvailable, false);
      assert.equal((await call(customerA, "GET", "/portal/settings")).data.whatsappOptIn, true);
      assert.equal((await call(customerB, "GET", "/portal/settings")).data.whatsappOptIn, false);
    });

    await t.test("invoices: VAT, status change, isolation and manual payment", async () => {
      assert.equal((await call(customerA, "POST", `/office/service-requests/${reqB.id}/invoices`, { description: "x", amount: 100 })).status, 403);
      const issued = await call(staff, "POST", `/office/service-requests/${reqB.id}/invoices`, {
        description: "أتعاب تجديد الإقامة", amount: 20_000, markAwaitingPayment: true,
      });
      assert.equal(issued.status, 201);
      assert.equal(issued.data.vat, 3_000);
      assert.equal(issued.data.total, 23_000);
      assert.equal(issued.data.canPayOnline, false);
      assert.match(issued.data.reference, /^INV-\d{4}-\d{5}$/);
      const [after] = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, reqB.id));
      assert.equal(after.status, "awaiting_payment");

      assert.equal((await call(customerA, "GET", `/service-requests/${reqB.id}/invoices`)).status, 404);
      const own = await call(customerB, "GET", `/service-requests/${reqB.id}/invoices`);
      assert.equal(own.data.length, 1);
      assert.equal((await call(customerA, "POST", `/invoices/${issued.data.id}/refresh`)).status, 404);
      assert.equal((await call(customerB, "POST", `/invoices/${issued.data.id}/pay`)).status, 503);

      const paid = await call(staff, "PATCH", `/office/invoices/${issued.data.id}`, { action: "mark_paid", paymentReference: "TRX-1" });
      assert.equal(paid.data.status, "paid");
      assert.equal(paid.data.paymentMethod, "manual");
      assert.equal((await call(staff, "PATCH", `/office/invoices/${issued.data.id}`, { action: "cancel" })).status, 409);
    });

    await t.test("online payments are trusted only when the gateway confirms the full amount", async () => {
      const [request] = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, reqB.id));
      const [row] = await db.insert(hbsInvoices).values({
        requestId: reqB.id, description: "Gateway test", amountHalalas: 1_000, vatRateBasisPoints: 1500,
        vatHalalas: 150, totalHalalas: 1_150, issuedBy: staff, gatewayInvoiceId: `gw-${randomUUID()}`,
      }).returning();
      const gateway = { id: row.gatewayInvoiceId!, status: "paid", currency: "SAR", url: "https://example.invalid" };
      assert.equal((await settleFromGateway(row, request, { ...gateway, amount: 100 })).status, "issued");
      assert.equal((await settleFromGateway(row, request, { ...gateway, amount: 1_150, currency: "USD" })).status, "issued");
      assert.equal((await settleFromGateway(row, request, { ...gateway, amount: 1_150, status: "initiated" })).status, "issued");
      const settled = await settleFromGateway(row, request, { ...gateway, amount: 1_150 });
      assert.equal(settled.status, "paid");
      assert.equal(settled.paymentMethod, "online");
      // A second confirmation changes nothing.
      assert.equal((await settleFromGateway(row, request, { ...gateway, amount: 1_150 })).paidAt?.getTime(), settled.paidAt?.getTime());
      const webhook = await call(null, "POST", "/payments/moyasar/webhook", { secret_token: "x" });
      assert.equal(webhook.status, 404);
    });

    await t.test("cancelling an invoice closes its open payment page", async () => {
      const gatewayId = `gw-${randomUUID()}`;
      const [row] = await db.insert(hbsInvoices).values({
        requestId: reqB.id, description: "Page to close", amountHalalas: 1_000, vatRateBasisPoints: 1500,
        vatHalalas: 150, totalHalalas: 1_150, issuedBy: staff, gatewayInvoiceId: gatewayId,
      }).returning();
      const calls: string[] = [];
      const realFetch = globalThis.fetch;
      const previousKey = process.env.MOYASAR_SECRET_KEY;
      process.env.MOYASAR_SECRET_KEY = "sk_test_placeholder";
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith("https://api.moyasar.com/")) return realFetch(input, init);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const status = url.endsWith("/cancel") ? "canceled" : "initiated";
        return new Response(JSON.stringify({ id: gatewayId, status, amount: 1_150, currency: "SAR", url: "https://example.invalid" }));
      }) as typeof fetch;
      try {
        const cancelled = await call(staff, "PATCH", `/office/invoices/${row.id}`, { action: "cancel" });
        assert.equal(cancelled.data.status, "cancelled");
        for (let i = 0; i < 50 && calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.deepEqual(calls, [
          `GET https://api.moyasar.com/v1/invoices/${gatewayId}`,
          `PUT https://api.moyasar.com/v1/invoices/${gatewayId}/cancel`,
        ]);
      } finally {
        globalThis.fetch = realFetch;
        if (previousKey === undefined) delete process.env.MOYASAR_SECRET_KEY;
        else process.env.MOYASAR_SECRET_KEY = previousKey;
      }
    });

    await t.test("reminders: customers own theirs; office adds with audit; due reminders are sent once", async () => {
      const bad = await call(customerA, "POST", "/reminders", { kind: "iqama", label: "Me", expiresOn: "2030-02-30" });
      assert.equal(bad.status, 400);
      const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      const created = await call(customerA, "POST", "/reminders", { kind: "iqama", label: "Ahmad", expiresOn: soon });
      assert.equal(created.status, 201);
      assert.equal(created.data.expiresOn, soon);
      assert.equal(created.data.addedBy, "customer");
      assert.equal((await call(customerB, "GET", "/reminders")).data.length, 0);
      assert.equal((await call(customerB, "DELETE", `/reminders/${created.data.id}`)).status, 404);

      const sent: string[] = [];
      const fakeSend = async (userId: string) => { sent.push(userId); };
      await sendDueReminders(fakeSend);
      await sendDueReminders(fakeSend);
      assert.equal(sent.filter(u => u === customerA).length, 1);
      const [claimed] = await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.id, created.data.id));
      assert.equal(claimed.lastReminderDays, 7);

      // A new expiry date starts the reminders again; the same date does not.
      const later = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
      await call(customerA, "PUT", `/reminders/${created.data.id}`, { kind: "iqama", label: "Ahmad", expiresOn: soon, note: "same" });
      assert.equal((await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.id, created.data.id)))[0].lastReminderDays, 7);
      await call(customerA, "PUT", `/reminders/${created.data.id}`, { kind: "iqama", label: "Ahmad", expiresOn: later, note: null });
      assert.equal((await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.id, created.data.id)))[0].lastReminderDays, null);

      const office = await call(staff, "POST", `/office/service-requests/${reqB.id}/reminders`, { kind: "passport", label: "Sara", expiresOn: soon });
      assert.equal(office.status, 201);
      assert.equal(office.data.addedBy, "office");
      assert.ok((await call(customerB, "GET", "/reminders")).data.some((r: any) => r.id === office.data.id));
      const list = await call(staff, "GET", "/office/reminders?withinDays=30");
      assert.ok(list.data.some((r: any) => r.id === office.data.id));
      assert.ok(!list.data.some((r: any) => r.id === created.data.id));
      assert.equal((await call(customerA, "GET", "/office/reminders")).status, 403);
      assert.ok((await call(staff, "GET", "/office/summary")).data.expiringDocuments >= 1);
    });

    await t.test("catalogue: owner edits, public sees published only", async () => {
      const body = { price: 15_000, governmentFeesNote: null, processingDays: 3, requiredDocuments: ["صورة الإقامة", "صورة الإقامة", " "], published: false };
      assert.equal((await call(staff, "PUT", `/office/service-offers/${slug}`, body)).status, 403);
      const saved = await call(owner, "PUT", `/office/service-offers/${slug}`, body);
      assert.equal(saved.status, 400); // a blank document name is invalid
      const ok = await call(owner, "PUT", `/office/service-offers/${slug}`, { ...body, requiredDocuments: ["صورة الإقامة", "صورة الإقامة"] });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.data.requiredDocuments, ["صورة الإقامة"]);
      assert.ok(!(await call(null, "GET", "/service-offers")).data.some((o: any) => o.slug === slug));
      await call(owner, "PUT", `/office/service-offers/${slug}`, { ...body, requiredDocuments: [], published: true });
      assert.ok((await call(null, "GET", "/service-offers")).data.some((o: any) => o.slug === slug && o.price === 15_000));
    });

    await t.test("reports are owner-only and count the period", async () => {
      assert.equal((await call(staff, "GET", "/office/reports")).status, 403);
      const report = await call(owner, "GET", "/office/reports?days=30");
      assert.equal(report.status, 200);
      assert.ok(report.data.created >= 2);
      assert.ok(report.data.completed >= 1);
      assert.ok(report.data.ratings.count >= 1);
      assert.ok(report.data.revenue.paidTotal >= 23_000 + 1_150);
      assert.ok(report.data.staff.some((s: any) => s.userId === staff && s.email === staffEmail));
      assert.equal((await call(owner, "GET", "/office/reports?days=12")).status, 400);
    });
  } finally {
    await db.delete(hbsInvoices).where(inArray(hbsInvoices.requestId, requestIds.length ? requestIds : [0]));
    await db.delete(hbsDocumentReminders).where(inArray(hbsDocumentReminders.userId, customers));
    await db.delete(hbsCustomerSettings).where(inArray(hbsCustomerSettings.userId, customers));
    await db.delete(hbsServiceOffers).where(eq(hbsServiceOffers.slug, slug));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, customers));
    await db.delete(hbsOfficeStaff).where(inArray(hbsOfficeStaff.userId, [owner, staff]));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
