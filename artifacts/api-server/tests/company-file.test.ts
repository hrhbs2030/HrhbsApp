import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  db, hbsAuditLog, hbsCompanies, hbsCompanyEmployees, hbsCompanyLicenses, hbsDocumentReminders, hbsOfficeStaff,
  hbsRequestMessages, hbsServiceRequests, pool,
} from "@workspace/db";
import portalRouter from "../src/routes/portal";
import companyRouter from "../src/routes/company";
import { createRemindersRouter } from "../src/routes/reminders";

if (process.env.NODE_ENV === "production") throw new Error("Company file tests must not run in production");

const officeEmail = "company-file-owner@example.invalid";
const owner = `company-owner-${randomUUID()}`;
const customerA = `company-a-${randomUUID()}`;
const customerB = `company-b-${randomUUID()}`;
const stranger = `company-stranger-${randomUUID()}`;
const customers = [customerA, customerB];

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
  for (const router of [portalRouter, companyRouter, createRemindersRouter(async () => "{}")]) app.use("/api", router);
  return app;
}

test("company file, masked numbers, reminder sync, linked requests and conversations", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId, primaryEmailAddressId: null,
    emailAddresses: userId === owner ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  delete process.env.SMTP_HOST;
  const server = testApp().listen(0);
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
    await db.insert(hbsOfficeStaff).values({ userId: owner });
    const [reqA] = await db.insert(hbsServiceRequests).values(customers.map(userId => ({
      userId, category: "other" as const, service: "Fixture", description: "Grants customer access.", contactPhone: "0500000000",
    }))).returning();
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    let employeeId = 0;
    await t.test("customer manages their company and employees; numbers are masked", async () => {
      assert.equal((await call(customerA, "PUT", "/company", { name: "X" })).status, 400);
      assert.equal((await call(customerA, "PUT", "/company", { name: "مؤسسة الأفق", crNumber: "70A" })).status, 400);
      const saved = await call(customerA, "PUT", "/company", { name: " مؤسسة   الأفق ", crNumber: "1010123456", city: "الرياض" });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.name, "مؤسسة الأفق");

      assert.equal((await call(customerA, "POST", "/company/employees", { fullName: "Ali", idNumber: "3123456789" })).status, 400);
      const created = await call(customerA, "POST", "/company/employees", {
        fullName: "أحمد محمد", nationality: "مصر", idNumber: "2123456789", passportNumber: "a1234567",
        iqamaExpiresOn: soon(20), passportExpiresOn: soon(400), workPermitExpiresOn: null, status: "active",
      });
      assert.equal(created.status, 201);
      employeeId = created.data.id;
      assert.equal(created.data.idNumberMasked, "•••• 6789");
      assert.equal(created.data.passportNumberMasked, "•••• 4567");
      assert.ok(!JSON.stringify(created.data).includes("2123456789"));
      assert.equal(created.data.iqamaExpiresOn, soon(20));

      const numbers = await call(customerA, "GET", `/company/employees/${employeeId}/numbers`);
      assert.deepEqual(numbers.data, { idNumber: "2123456789", passportNumber: "A1234567" });
      assert.equal((await call(customerB, "GET", `/company/employees/${employeeId}/numbers`)).status, 404);
      assert.equal((await call(customerB, "PUT", `/company/employees/${employeeId}`, { fullName: "Hijack" })).status, 404);
      assert.equal((await call(customerB, "GET", "/company")).data.employees.length, 0);

      // Omitting numbers keeps them; null clears.
      await call(customerA, "PUT", `/company/employees/${employeeId}`, { fullName: "أحمد محمد علي", iqamaExpiresOn: soon(20), passportExpiresOn: soon(400), passportNumber: null });
      const [row] = await db.select().from(hbsCompanyEmployees).where(eq(hbsCompanyEmployees.id, employeeId));
      assert.equal(row.idNumber, "2123456789");
      assert.equal(row.passportNumber, null);
    });

    await t.test("employee and license dates become reminders that follow the file", async () => {
      const reminders = await call(customerA, "GET", "/reminders");
      const linked = reminders.data.filter((r: any) => r.source === "employee");
      assert.deepEqual(linked.map((r: any) => r.kind).sort(), ["iqama", "passport"]);
      assert.ok(linked.every((r: any) => r.label === "أحمد محمد علي"));
      const iqama = linked.find((r: any) => r.kind === "iqama");
      assert.equal((await call(customerA, "PUT", `/reminders/${iqama.id}`, { kind: "iqama", label: "Changed", expiresOn: soon(5) })).status, 404);
      assert.equal((await call(customerA, "DELETE", `/reminders/${iqama.id}`)).status, 404);

      await db.update(hbsDocumentReminders).set({ lastReminderDays: 30 }).where(eq(hbsDocumentReminders.id, iqama.id));
      await call(customerA, "PUT", `/company/employees/${employeeId}`, { fullName: "أحمد محمد علي", iqamaExpiresOn: soon(20), passportExpiresOn: soon(400), workPermitExpiresOn: soon(90) });
      const [kept] = await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.id, iqama.id));
      assert.equal(kept.lastReminderDays, 30, "same date keeps the reminder schedule");
      assert.equal((await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.employeeId, employeeId))).length, 3);

      await call(customerA, "PUT", `/company/employees/${employeeId}`, { fullName: "أحمد محمد علي", iqamaExpiresOn: soon(20), status: "left" });
      assert.equal((await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.employeeId, employeeId))).length, 0,
        "employees who left get no reminders");
      await call(customerA, "PUT", `/company/employees/${employeeId}`, { fullName: "أحمد محمد علي", iqamaExpiresOn: soon(20), status: "active" });

      assert.equal((await call(customerA, "POST", "/company/licenses", { kind: "municipal", title: "رخصة", issuedOn: soon(10), expiresOn: soon(5) })).status, 400);
      const lic = await call(customerA, "POST", "/company/licenses", { kind: "municipal", title: "رخصة المحل", number: "4300-1", expiresOn: soon(25) });
      assert.equal(lic.status, 201);
      const [licReminder] = await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.licenseId, lic.data.id));
      assert.equal(licReminder.label, "رخصة البلدية: رخصة المحل");
      await call(customerA, "DELETE", `/company/licenses/${lic.data.id}`);
      assert.equal((await db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.licenseId, lic.data.id))).length, 0);
    });

    await t.test("office works on a customer's file, audited, and sees the directory", async () => {
      assert.equal((await call(customerA, "GET", `/office/customers/${customerA}`)).status, 403);
      assert.equal((await call(owner, "GET", `/office/customers/${stranger}`)).status, 404);
      assert.equal((await call(owner, "POST", `/office/customers/${stranger}/employees`, { fullName: "x y" })).status, 404);
      const added = await call(owner, "POST", `/office/customers/${customerB}/employees`, { fullName: "سارة", idNumber: "1098765432" });
      assert.equal(added.status, 201);
      assert.equal(added.data.addedBy, "office");
      assert.equal((await call(owner, "GET", `/office/customers/${customerA}/employees/${added.data.id}/numbers`)).status, 404,
        "an employee is reachable only through its own customer");
      const reveal = await call(owner, "GET", `/office/customers/${customerB}/employees/${added.data.id}/numbers`);
      assert.equal(reveal.data.idNumber, "1098765432");
      const audits = await db.select().from(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "customer"), eq(hbsAuditLog.targetId, customerB)));
      assert.deepEqual(audits.map(a => a.action).sort(), ["employee.create", "employee.reveal"]);
      assert.ok(!JSON.stringify(audits).includes("1098765432"), "numbers never enter the audit log");
      // Customers' own changes are not office actions.
      assert.equal((await db.select().from(hbsAuditLog).where(eq(hbsAuditLog.targetId, customerA))).length, 0);

      const list = await call(owner, "GET", "/office/customers?q=" + encodeURIComponent("الأفق"));
      assert.equal(list.status, 200);
      const row = list.data.find((c: any) => c.userId === customerA);
      assert.ok(row && row.companyName === "مؤسسة الأفق" && row.employees === 1 && row.expiringSoon >= 1);
      const file = await call(owner, "GET", `/office/customers/${customerA}`);
      assert.equal(file.data.company.name, "مؤسسة الأفق");
      assert.equal(file.data.employees[0].idNumberMasked, "•••• 6789");
      assert.ok(file.data.reminders.some((r: any) => r.source === "employee"));
    });

    await t.test("requests link to the customer's own employee and carry a conversation", async () => {
      const base = { category: "passports", service: "تجديد الإقامة", description: "Renew the iqama please.", contactPhone: "0500000000" };
      const [other] = await db.select().from(hbsCompanyEmployees).where(eq(hbsCompanyEmployees.userId, customerB));
      assert.equal((await call(customerA, "POST", "/service-requests", { ...base, employeeId: other.id })).status, 400);
      const created = await call(customerA, "POST", "/service-requests", { ...base, employeeId });
      assert.equal(created.status, 201);
      assert.deepEqual(created.data.subject, { type: "employee", id: employeeId, label: "أحمد محمد علي" });

      const id = created.data.id;
      assert.equal((await call(customerB, "POST", `/service-requests/${id}/messages`, { body: "hi" })).status, 404);
      assert.equal((await call(customerA, "POST", `/service-requests/${id}/messages`, { body: "   " })).status, 400);
      assert.equal((await call(customerA, "POST", `/service-requests/${id}/messages`, { body: "متى ينتهي التجديد؟" })).status, 201);
      const officeSummary = await call(owner, "GET", "/office/summary");
      assert.ok(officeSummary.data.awaitingReply >= 1, JSON.stringify(officeSummary));
      assert.equal((await call(owner, "POST", `/office/service-requests/${id}/messages`, { body: "خلال يومين" })).status, 201);
      const thread = await call(customerA, "GET", `/service-requests/${id}/messages`);
      assert.deepEqual(thread.data.map((m: any) => m.authorRole), ["customer", "office"]);
      const detail = await call(customerA, "GET", `/service-requests/${id}`);
      assert.equal(detail.data.lastMessage.by, "office");

      const summary = await call(customerA, "GET", "/portal/summary");
      assert.equal(summary.data.hasCompany, true);
      assert.equal(summary.data.employeesCount, 1);
      assert.ok(summary.data.expiringSoon.some((r: any) => r.source === "employee" && /^\d{4}-\d{2}-\d{2}$/.test(r.expiresOn)));

      // Deleting the employee keeps the request, without the link.
      await call(customerA, "DELETE", `/company/employees/${employeeId}`);
      assert.equal((await call(customerA, "GET", `/service-requests/${id}`)).data.subject, null);
    });
    void reqA;
  } finally {
    const ids = (await db.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, customers))).map(r => r.id);
    if (ids.length) await db.delete(hbsRequestMessages).where(inArray(hbsRequestMessages.requestId, ids));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, customers));
    await db.delete(hbsDocumentReminders).where(inArray(hbsDocumentReminders.userId, customers));
    await db.delete(hbsCompanyEmployees).where(inArray(hbsCompanyEmployees.userId, customers));
    await db.delete(hbsCompanyLicenses).where(inArray(hbsCompanyLicenses.userId, customers));
    await db.delete(hbsCompanies).where(inArray(hbsCompanies.userId, customers));
    await db.delete(hbsAuditLog).where(inArray(hbsAuditLog.targetId, customers));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, owner));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
