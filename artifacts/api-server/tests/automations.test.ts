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
  db, hbsAssignmentRules, hbsAuditLog, hbsInvoices, hbsOfficeStaff, hbsRequestMessages, hbsServiceRequests, pool,
} from "@workspace/db";
import portalRouter from "../src/routes/portal";
import billingRouter from "../src/routes/billing";
import officeAdminRouter from "../src/routes/office-admin";

if (process.env.NODE_ENV === "production") throw new Error("Automation tests must not run in production");

const officeEmail = "automation-owner@example.invalid";
const owner = `automation-owner-${randomUUID()}`;
const staff = `automation-staff-${randomUUID()}`;
const customer = `automation-customer-${randomUUID()}`;

test("rules assign new requests; replies and payments move requests on", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId, primaryEmailAddressId: null,
    emailAddresses: userId === owner ? [{ emailAddress: officeEmail, verification: { status: "verified" } }]
      : userId === staff ? [{ emailAddress: "automation-staff@example.invalid", verification: { status: "verified" } }] : [],
  }));
  delete process.env.SMTP_HOST;
  delete process.env.MOYASAR_SECRET_KEY;
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
  for (const router of [portalRouter, billingRouter, officeAdminRouter]) app.use("/api", router);
  // Read before listening: awaiting anything between listen() and once() would miss the event.
  const rulesBefore = await db.select().from(hbsAssignmentRules);
  const server = app.listen(0);
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
    await db.insert(hbsOfficeStaff).values([{ userId: owner }, { userId: staff, email: "automation-staff@example.invalid", addedBy: owner }]);
    await db.insert(hbsServiceRequests).values({ userId: customer, category: "other", service: "Fixture", description: "Grants access.", contactPhone: "0500000000" });

    let requestId = 0;
    await t.test("an assignment rule assigns and dates new requests", async () => {
      assert.equal((await call(staff, "GET", "/office/assignment-rules")).status, 403);
      assert.equal((await call(owner, "PUT", "/office/assignment-rules/labor", { assignee: "nobody", dueDays: 3 })).status, 400);
      const saved = await call(owner, "PUT", "/office/assignment-rules/labor", { assignee: staff, dueDays: 3 });
      assert.equal(saved.status, 200);
      const list = await call(owner, "GET", "/office/assignment-rules");
      assert.equal(list.data.length, 4);
      const created = await call(customer, "POST", "/service-requests", { category: "labor", service: "نقل خدمات", description: "Transfer a worker please.", contactPhone: "0500000000" });
      assert.equal(created.status, 201);
      requestId = created.data.id;
      const [row] = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, requestId));
      assert.equal(row.assignedTo, staff);
      const days = (row.dueAt!.getTime() - row.createdAt.getTime()) / 86_400_000;
      assert.equal(Math.round(days), 3);
      const history = await call(customer, "GET", `/service-requests/${requestId}/history`);
      assert.deepEqual(history.data.map((e: any) => e.status), ["received"], "assignment is not a status change");
    });

    await t.test("a customer's message or file moves a waiting request back to review", async () => {
      await db.update(hbsServiceRequests).set({ status: "waiting_on_customer", customerMessage: "أرسل صورة الإقامة" }).where(eq(hbsServiceRequests.id, requestId));
      assert.equal((await call(customer, "POST", `/service-requests/${requestId}/messages`, { body: "أرسلتها الآن" })).status, 201);
      const [row] = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, requestId));
      assert.equal(row.status, "reviewing");
      assert.equal(row.customerMessage, null);
      const history = await call(customer, "GET", `/service-requests/${requestId}/history`);
      assert.deepEqual(history.data.map((e: any) => e.status), ["received", "reviewing"]);
      // A reply while already under review changes nothing.
      await call(customer, "POST", `/service-requests/${requestId}/messages`, { body: "شكرًا" });
      assert.equal((await db.select().from(hbsAuditLog).where(eq(hbsAuditLog.targetId, String(requestId)))).filter(a => a.actorId === "automation" && (a.details as any).toStatus === "reviewing").length, 1);
    });

    await t.test("settling the last open invoice resumes a request awaiting payment", async () => {
      const first = await call(staff, "POST", `/office/service-requests/${requestId}/invoices`, { description: "أتعاب", amount: 10_000, markAwaitingPayment: true });
      const second = await call(staff, "POST", `/office/service-requests/${requestId}/invoices`, { description: "رسوم", amount: 5_000 });
      await call(staff, "PATCH", `/office/invoices/${first.data.id}`, { action: "mark_paid", paymentReference: "R1" });
      assert.equal((await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, requestId)))[0].status, "awaiting_payment", "one invoice still open");
      await call(staff, "PATCH", `/office/invoices/${second.data.id}`, { action: "cancel" });
      assert.equal((await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, requestId)))[0].status, "reviewing");
    });

    await t.test("completed requests take no more customer messages; huge IDs are 404 not 500", async () => {
      await db.update(hbsServiceRequests).set({ status: "completed" }).where(eq(hbsServiceRequests.id, requestId));
      assert.equal((await call(customer, "POST", `/service-requests/${requestId}/messages`, { body: "سؤال" })).status, 409);
      assert.equal((await call(staff, "POST", `/office/service-requests/${requestId}/messages`, { body: "تم" })).status, 201);
      assert.equal((await call(customer, "POST", "/invoices/99999999999/refresh")).status, 404);
      assert.equal((await call(customer, "GET", "/service-requests/99999999999/messages")).status, 404);
    });
  } finally {
    const ids = (await db.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer))).map(r => r.id);
    if (ids.length) {
      await db.delete(hbsRequestMessages).where(inArray(hbsRequestMessages.requestId, ids));
      await db.delete(hbsInvoices).where(inArray(hbsInvoices.requestId, ids));
    }
    await db.delete(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer));
    await db.delete(hbsAssignmentRules);
    if (rulesBefore.length) await db.insert(hbsAssignmentRules).values(rulesBefore);
    await db.delete(hbsOfficeStaff).where(inArray(hbsOfficeStaff.userId, [owner, staff]));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
