import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { and, asc, eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  db, hbsAuditLog, hbsCompanies, hbsCompanyEmployees, hbsCompanyLicenses, hbsCompanyMembers, hbsDocumentReminders,
  hbsInvoiceGatewayPages, hbsInvoices, hbsOfficeStaff, hbsPlans, hbsRequestEmployees, hbsServiceRequests, hbsSubscriptions, pool,
} from "@workspace/db";
import portalRouter from "../src/routes/portal";
import companyRouter from "../src/routes/company";
import companyMembersRouter from "../src/routes/company-members";
import billingRouter from "../src/routes/billing";
import subscriptionsRouter from "../src/routes/subscriptions";
import { forgetVerifiedEmails, verifiedEmailsOf } from "../src/lib/company-access";
import { vatFor } from "../src/lib/money";

if (process.env.NODE_ENV === "production") throw new Error("Package D member tests must not run in production");

const officeEmail = "package-d-members-office@example.invalid";
const office = `pkg-d-office-${randomUUID()}`;
const owner = `pkg-d-owner-${randomUUID()}`;
const other = `pkg-d-other-${randomUUID()}`;
const hr = `pkg-d-hr-${randomUUID()}`;
const finance = `pkg-d-finance-${randomUUID()}`;
const viewer = `pkg-d-viewer-${randomUUID()}`;
const multi = `pkg-d-multi-${randomUUID()}`;
const stranger = `pkg-d-stranger-${randomUUID()}`;
// An approved customer who never saved the company file.
const bare = `pkg-d-bare-${randomUUID()}`;
const customers = [owner, other, bare];
const emailOf = (id: string) => `${id}@example.invalid`;
const people = new Map([office, owner, other, hr, finance, viewer, multi, stranger, bare].map(id => [id, {
  id, primaryEmailAddressId: "primary",
  emailAddresses: [{ id: "primary", emailAddress: id === office ? officeEmail : emailOf(id), verification: { status: "verified" } }],
}]));
// Who already has an account when invited: hr and finance; the viewer signs up later.
const accounts = new Set([office, owner, other, hr, finance, stranger, multi, bare]);

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
  for (const router of [portalRouter, companyRouter, companyMembersRouter, billingRouter, subscriptionsRouter]) app.use("/api", router);
  return app;
}

test("company members, roles, bulk requests and invoice quantities", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  let concurrentInviteGate: {
    calls: number; ready: Promise<void>; release: () => void;
  } | null = null;
  const clerkFailures = new Set<string>();
  mock.method(clerkClient.users, "getUser", async (userId: string) => {
    if (clerkFailures.has(userId)) throw new Error("Clerk unavailable");
    return (people.get(userId) ?? { id: userId, primaryEmailAddressId: null, emailAddresses: [] }) as never;
  });
  mock.method(clerkClient.users, "getUserList", async (query: { emailAddress?: string[]; userId?: string[] }) => {
    if (concurrentInviteGate && query.emailAddress?.some(email => email.startsWith("race-"))) {
      concurrentInviteGate.calls++;
      if (concurrentInviteGate.calls === 2) concurrentInviteGate.release();
      await concurrentInviteGate.ready;
    }
    return {
      data: [...people.values()].filter(user => accounts.has(user.id) && (
        query.userId?.includes(user.id) ||
        query.emailAddress?.some(email => user.emailAddresses.some(entry => entry.emailAddress.toLowerCase() === email.toLowerCase())))),
    } as never;
  });
  delete process.env.SMTP_HOST;
  delete process.env.MOYASAR_SECRET_KEY;
  forgetVerifiedEmails();
  const server = testApp().listen(0);
  const requestIds: number[] = [];
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
    const auditsFor = async (targetId: string | number) =>
      db.select().from(hbsAuditLog).where(eq(hbsAuditLog.targetId, String(targetId)))
        .orderBy(asc(hbsAuditLog.createdAt), asc(hbsAuditLog.id));

    await db.insert(hbsOfficeStaff).values({ userId: office });
    // A request grants customer access, like the legacy customers.
    const fixtures = await db.insert(hbsServiceRequests).values(customers.map(userId => ({
      userId, category: "other" as const, service: "Fixture", description: "Grants customer access.", contactPhone: "0500000000",
    }))).returning();
    requestIds.push(...fixtures.map(r => r.id));
    assert.equal((await call(owner, "PUT", "/company", { name: "شركة الاختبار", city: "الرياض" })).status, 200);
    assert.equal((await call(other, "PUT", "/company", { name: "منشأة أخرى" })).status, 200);

    let viewerMemberId = 0;
    let financeMemberId = 0;
    await t.test("the owner invites by email; accounts join at once, others when they sign in with that email", async () => {
      assert.equal((await call(viewer, "GET", "/company")).status, 403, "not a customer, not a member");
      assert.equal((await call(viewer, "GET", "/company/membership")).status, 404);
      assert.equal((await call(viewer, "GET", "/portal/me")).data.registrationStatus, null, "no registration of their own");
      const noFile = await call(bare, "POST", "/company/members", { email: emailOf(viewer), role: "viewer" });
      assert.equal(noFile.status, 409, JSON.stringify(noFile.data));
      assert.equal(noFile.data.error, "احفظ ملف المنشأة أولًا ثم ادعُ الأعضاء.");
      assert.equal((await call(owner, "POST", "/company/members", { email: "nope", role: "viewer" })).status, 400);
      assert.equal((await call(owner, "POST", "/company/members", { email: emailOf(viewer), role: "owner" })).status, 400);
      assert.equal((await call(owner, "POST", "/company/members", { email: emailOf(owner), role: "hr" })).status, 400, "the owner is not a member");

      const invited = await call(owner, "POST", "/company/members", { email: ` ${emailOf(viewer).toUpperCase()} `, role: "viewer" });
      assert.equal(invited.status, 201, JSON.stringify(invited.data));
      assert.deepEqual({ email: invited.data.email, role: invited.data.role, memberUserId: invited.data.memberUserId, acceptedAt: invited.data.acceptedAt },
        { email: emailOf(viewer), role: "viewer", memberUserId: null, acceptedAt: null });
      viewerMemberId = invited.data.id;
      assert.equal((await call(owner, "POST", "/company/members", { email: emailOf(viewer), role: "hr" })).status, 409, "duplicate email");

      assert.deepEqual(await verifiedEmailsOf(viewer), [emailOf(viewer)]);
      people.set(viewer, {
        id: viewer, primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "primary", emailAddress: emailOf(viewer), verification: { status: "unverified" } }],
      });
      assert.equal((await call(viewer, "GET", "/company")).status, 403, "pending invite cannot use a cached verified email");
      const [stillPending] = await db.select().from(hbsCompanyMembers).where(eq(hbsCompanyMembers.id, viewerMemberId));
      assert.equal(stillPending.memberUserId, null, "an unverified pending address is not accepted");
      people.set(viewer, {
        id: viewer, primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "primary", emailAddress: emailOf(viewer), verification: { status: "verified" } }],
      });

      const joined = await call(owner, "POST", "/company/members", { email: emailOf(hr), role: "hr" });
      assert.equal(joined.status, 201);
      assert.equal(joined.data.memberUserId, hr, "an existing verified account joins at once");
      assert.ok(joined.data.acceptedAt);
      // Another company's owner, like any approved customer, is never made a member.
      const customer = await call(owner, "POST", "/company/members", { email: emailOf(other), role: "viewer" });
      assert.equal(customer.status, 409, JSON.stringify(customer.data));
      assert.match(customer.data.error, /عميل مسجّل/);
      assert.equal((await db.select().from(hbsCompanyMembers).where(eq(hbsCompanyMembers.email, emailOf(other)))).length, 0, "nothing stays pending");
      financeMemberId = (await call(owner, "POST", "/company/members", { email: emailOf(finance), role: "finance" })).data.id;

      // Signing in with the invited address accepts the invitation.
      const membership = await call(viewer, "GET", "/company/membership");
      assert.equal(membership.status, 200, JSON.stringify(membership.data));
      assert.deepEqual(membership.data, { role: "viewer", companyUserId: owner, companyName: "شركة الاختبار" });
      const [row] = await db.select().from(hbsCompanyMembers).where(eq(hbsCompanyMembers.id, viewerMemberId));
      assert.equal(row.memberUserId, viewer);
      assert.ok(row.acceptedAt);
      assert.deepEqual((await call(hr, "GET", "/company/membership")).data.role, "hr");
      // The shell lets a member in without a registration: /portal/me reports them approved.
      const me = await call(viewer, "GET", "/portal/me");
      assert.equal(me.status, 200, JSON.stringify(me.data));
      assert.deepEqual(me.data, { role: "customer", officeRole: null, registrationStatus: "approved" });
      assert.equal((await call(viewer, "GET", "/company")).status, 200, "the file opens for a viewer");
      assert.equal((await call(viewer, "PUT", "/company", { name: "x" })).status, 403, "read only");
      assert.deepEqual((await call(owner, "GET", "/company/membership")).data, { role: "owner", companyUserId: owner, companyName: "شركة الاختبار" });
      assert.equal((await call(stranger, "GET", "/company/membership")).status, 404);

      const list = await call(viewer, "GET", "/company/members");
      assert.equal(list.status, 200, JSON.stringify(list.data));
      assert.deepEqual(list.data.map((m: any) => m.role), ["owner", "viewer", "hr", "finance"]);
      assert.deepEqual({ id: list.data[0].id, email: list.data[0].email, memberUserId: list.data[0].memberUserId },
        { id: 0, email: emailOf(owner), memberUserId: owner });
      assert.equal((await call(stranger, "GET", "/company/members")).status, 404);
    });

    await t.test("a member may leave; the owner and outsiders cannot", async () => {
      assert.equal((await call(stranger, "DELETE", "/company/membership")).status, 404);
      const refused = await call(owner, "DELETE", "/company/membership");
      assert.equal(refused.status, 403);
      assert.equal(refused.data.error, "مالك المنشأة لا يمكنه مغادرتها.");
      const [extraRow] = await db.insert(hbsCompanyMembers).values({ companyUserId: owner, email: emailOf(stranger), role: "viewer", invitedBy: owner }).returning();
      assert.equal((await call(stranger, "GET", "/company/membership")).status, 200, "the stranger is now a member");
      assert.equal((await call(stranger, "DELETE", "/company/membership")).status, 204);
      assert.equal((await call(stranger, "GET", "/company/membership")).status, 404);
      assert.equal((await call(stranger, "DELETE", "/company/membership")).status, 404, "nothing to leave twice");
      assert.equal((await db.select().from(hbsCompanyMembers).where(eq(hbsCompanyMembers.id, extraRow.id))).length, 0);
      const [left] = (await auditsFor(owner)).filter(a => a.action === "company.member_leave");
      assert.ok(left, "audited under the company");
      assert.equal(left.actorId, stranger);
      assert.deepEqual(left.details, { memberId: extraRow.id, role: "viewer" });
    });

    await t.test("only the owner manages members, up to ten", async () => {
      const denied = await call(hr, "POST", "/company/members", { email: "x@example.invalid", role: "viewer" });
      assert.equal(denied.status, 403);
      assert.equal(denied.data.error, "ليست لديك صلاحية لهذا الإجراء.");
      assert.equal((await call(viewer, "PATCH", `/company/members/${financeMemberId}`, { role: "viewer" })).status, 403);
      assert.equal((await call(viewer, "DELETE", `/company/members/${financeMemberId}`)).status, 403);

      const extras: number[] = [];
      for (let i = 0; i < 7; i++) {
        const added = await call(owner, "POST", "/company/members", { email: `extra-${i}-${randomUUID()}@example.invalid`, role: "viewer" });
        assert.equal(added.status, 201);
        extras.push(added.data.id);
      }
      const eleventh = await call(owner, "POST", "/company/members", { email: `extra-11-${randomUUID()}@example.invalid`, role: "viewer" });
      assert.equal(eleventh.status, 409);

      assert.equal((await call(owner, "PATCH", "/company/members/0", { role: "hr" })).status, 404, "the owner cannot be changed");
      assert.equal((await call(owner, "PATCH", `/company/members/${extras[0]}`, { role: "owner" })).status, 400);
      const changed = await call(owner, "PATCH", `/company/members/${extras[0]}`, { role: "finance" });
      assert.equal(changed.status, 200);
      assert.equal(changed.data.role, "finance");
      assert.equal((await call(other, "PATCH", `/company/members/${extras[0]}`, { role: "hr" })).status, 404, "another owner's member");
      assert.equal((await call(owner, "DELETE", `/company/members/${extras[1]}`)).status, 204);
      assert.equal((await call(owner, "DELETE", `/company/members/${extras[1]}`)).status, 404);
      let releaseLookups!: () => void;
      const ready = new Promise<void>(resolve => { releaseLookups = resolve; });
      concurrentInviteGate = { calls: 0, ready, release: releaseLookups };
      const concurrent = await Promise.all([
        call(owner, "POST", "/company/members", { email: `race-${randomUUID()}@example.invalid`, role: "viewer" }),
        call(owner, "POST", "/company/members", { email: `race-${randomUUID()}@example.invalid`, role: "viewer" }),
      ]);
      assert.equal(concurrentInviteGate.calls, 2);
      concurrentInviteGate = null;
      assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409], "only one concurrent invitation may claim the final slot");

      const actions = (await auditsFor(owner)).map(a => a.action);
      assert.equal(actions.filter(a => a === "company.member_invite").length, 11);
      assert.equal(actions.filter(a => a === "company.member_update").length, 1);
      assert.equal(actions.filter(a => a === "company.member_remove").length, 1);

      const office_list = await call(office, "GET", `/office/customers/${owner}/members`);
      assert.equal(office_list.status, 200);
      assert.equal(office_list.data[0].role, "owner");
      assert.equal(office_list.data.length, 11);
      assert.equal((await call(office, "GET", `/office/customers/${stranger}/members`)).status, 404);
      assert.equal((await call(owner, "GET", `/office/customers/${owner}/members`)).status, 403);
    });

    const employeeIds: number[] = [];
    await t.test("viewer reads, hr maintains people, finance cannot, and the owner edits the company", async () => {
      assert.equal((await call(viewer, "GET", "/company")).data.company.name, "شركة الاختبار");
      const viewerWrite = await call(viewer, "POST", "/company/employees", { fullName: "موظف" });
      assert.equal(viewerWrite.status, 403);
      assert.equal(viewerWrite.data.error, "ليست لديك صلاحية لهذا الإجراء.");
      assert.equal((await call(finance, "POST", "/company/employees", { fullName: "موظف" })).status, 403);
      assert.equal((await call(hr, "PUT", "/company", { name: "اسم آخر" })).status, 403);
      assert.equal((await call(owner, "PUT", "/company", { name: "شركة الاختبار", city: "جدة" })).status, 200);

      for (const [name, idNumber] of [["أحمد", "2000000011"], ["سالم", "2000000012"], ["خالد", "2000000013"]]) {
        const created = await call(hr, "POST", "/company/employees", { fullName: name, idNumber, iqamaExpiresOn: "2030-01-01" });
        assert.equal(created.status, 201, JSON.stringify(created.data));
        employeeIds.push(created.data.id);
      }
      const file = await call(owner, "GET", "/company");
      assert.equal(file.data.employees.length, 3, "hr's employees are in the owner's file");
      assert.equal((await call(viewer, "GET", "/company")).data.employees.length, 3);
      assert.equal((await call(finance, "GET", `/company/employees/${employeeIds[0]}/numbers`)).status, 403);
      assert.equal((await call(viewer, "GET", `/company/employees/${employeeIds[0]}/numbers`)).status, 403);
      assert.equal((await call(hr, "GET", `/company/employees/${employeeIds[0]}/numbers`)).data.idNumber, "2000000011");
      assert.equal((await call(owner, "GET", `/company/employees/${employeeIds[0]}/numbers`)).data.idNumber, "2000000011");
      assert.equal((await call(hr, "PUT", `/company/employees/${employeeIds[2]}`, { fullName: "خالد علي", idNumber: "2000000013" })).status, 200);
      assert.equal((await call(hr, "POST", "/company/licenses", { kind: "municipal", title: "رخصة البلدية" })).status, 201);

      const byMembers = (await auditsFor(owner)).filter(a => a.actorId === hr);
      assert.deepEqual(byMembers.map(a => a.action).sort(), ["employee.create", "employee.create", "employee.create", "employee.reveal", "employee.update", "license.create"]);
      assert.ok(!JSON.stringify(byMembers).includes("2000000011"), "numbers never enter the audit log");
      assert.equal((await auditsFor(owner)).filter(a => a.actorId === owner && a.action.startsWith("employee")).length, 0, "the owner's own reveals are not audited");
    });

    let bulkId = 0;
    await t.test("a request can cover several of the company's employees, each tracked by the office", async () => {
      const base = { category: "labor", service: "تجديد رخص العمل", description: "Renew the work permits please.", contactPhone: "0500000000" };
      const [foreign] = await db.insert(hbsCompanyEmployees).values({ userId: other, createdBy: other, fullName: "غريب" }).returning();
      assert.equal((await call(owner, "POST", "/service-requests", { ...base, employeeIds: [employeeIds[0], foreign.id] })).status, 400);
      assert.equal((await call(owner, "POST", "/service-requests", { ...base, employeeIds: [employeeIds[0]], licenseId: 1 })).status, 400);
      assert.equal((await call(owner, "POST", "/service-requests", { ...base, employeeIds: Array.from({ length: 51 }, (_, i) => i + 1) })).status, 400);

      const created = await call(owner, "POST", "/service-requests", { ...base, employeeId: employeeIds[2], employeeIds: [employeeIds[0], employeeIds[1], employeeIds[2], employeeIds[0]] });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bulkId = created.data.id;
      requestIds.push(bulkId);
      assert.deepEqual(created.data.employees.map((e: any) => [e.employeeId, e.fullName, e.itemStatus, e.note]),
        [[employeeIds[0], "أحمد", "pending", null], [employeeIds[2], "خالد علي", "pending", null], [employeeIds[1], "سالم", "pending", null]]);
      assert.deepEqual(created.data.subject, { type: "employee", id: employeeIds[0], label: "أحمد" }, "employeeIds wins; the first is the subject");

      const single = await call(owner, "POST", "/service-requests", { ...base, employeeId: employeeIds[1] });
      requestIds.push(single.data.id);
      assert.deepEqual(single.data.employees, []);
      assert.equal((await call(owner, "GET", `/service-requests/${bulkId}`)).data.employees.length, 3);
      assert.equal((await call(owner, "GET", "/service-requests")).data.find((r: any) => r.id === bulkId).employees.length, 3);
      const page = await call(office, "GET", "/office/service-requests?q=" + encodeURIComponent("تجديد رخص"));
      assert.equal(page.status, 200, JSON.stringify(page.data));
      assert.equal(page.data.items.find((r: any) => r.id === bulkId).employees.length, 3);

      assert.equal((await call(office, "PATCH", `/office/service-requests/${bulkId}/employees/${foreign.id}`, { itemStatus: "done" })).status, 404);
      assert.equal((await call(office, "PATCH", `/office/service-requests/${bulkId}/employees/${employeeIds[1]}`, { itemStatus: "finished" })).status, 400);
      assert.equal((await call(owner, "PATCH", `/office/service-requests/${bulkId}/employees/${employeeIds[1]}`, { itemStatus: "done" })).status, 403);
      const updated = await call(office, "PATCH", `/office/service-requests/${bulkId}/employees/${employeeIds[1]}`, { itemStatus: "done", note: " صدرت الرخصة " });
      assert.equal(updated.status, 200, JSON.stringify(updated.data));
      const item = updated.data.employees.find((e: any) => e.employeeId === employeeIds[1]);
      assert.deepEqual([item.itemStatus, item.note], ["done", "صدرت الرخصة"]);
      assert.equal(updated.data.status, "received", "items do not move the request");
      const kept = await call(office, "PATCH", `/office/service-requests/${bulkId}/employees/${employeeIds[1]}`, { itemStatus: "blocked" });
      assert.equal(kept.data.employees.find((e: any) => e.employeeId === employeeIds[1]).note, "صدرت الرخصة", "omitted note is kept");
      const cleared = await call(office, "PATCH", `/office/service-requests/${bulkId}/employees/${employeeIds[1]}`, { itemStatus: "in_progress", note: null });
      assert.equal(cleared.data.employees.find((e: any) => e.employeeId === employeeIds[1]).note, null);
      const audits = (await auditsFor(bulkId)).filter(a => a.action === "service_request.employee_item");
      assert.equal(audits.length, 3);
      assert.deepEqual(audits[0].details, { employeeId: employeeIds[1], itemStatus: "done", noteChanged: true });
      assert.equal((await call(owner, "GET", `/service-requests/${bulkId}`)).data.employees.find((e: any) => e.employeeId === employeeIds[1]).itemStatus, "in_progress");

      // An employee removed from the file leaves the request.
      assert.equal((await call(hr, "DELETE", `/company/employees/${employeeIds[2]}`)).status, 204);
      assert.equal((await call(owner, "GET", `/service-requests/${bulkId}`)).data.employees.length, 2);
    });

    await t.test("accepted membership requires a currently verified invitation email", async () => {
      const acceptedAt = Date.now();
      await db.insert(hbsCompanyMembers).values([
        {
          companyUserId: owner, memberUserId: multi, email: `former-${emailOf(multi)}`, role: "viewer",
          invitedBy: owner, acceptedAt: new Date(acceptedAt),
        },
        {
          companyUserId: other, memberUserId: multi, email: emailOf(multi), role: "hr",
          invitedBy: other, acceptedAt: new Date(acceptedAt + 1_000),
        },
      ]);
      const selectedCompany = await call(multi, "GET", "/company");
      assert.equal(selectedCompany.status, 200);
      assert.equal(selectedCompany.data.company.name, "منشأة أخرى", "skip older accepted rows whose invite email is no longer verified");

      // Warm the old short-lived cache before Clerk reports verification loss.
      assert.deepEqual(await verifiedEmailsOf(finance), [emailOf(finance)]);
      assert.equal((await call(finance, "GET", "/company")).status, 200, "verified member can read the company file");
      assert.equal((await call(finance, "GET", "/company/invoices")).status, 200, "verified finance member can read company invoices");
      assert.equal((await call(finance, "GET", "/company/subscription")).status, 200, "verified finance member can read subscription access");
      const [companyBefore] = await db.select({ userId: hbsCompanies.userId }).from(hbsCompanies)
        .where(eq(hbsCompanies.userId, owner));
      assert.ok(companyBefore, "the employer company exists before membership revocation");
      const employeeIdsBefore = (await db.select({ id: hbsCompanyEmployees.id }).from(hbsCompanyEmployees)
        .where(eq(hbsCompanyEmployees.userId, owner))).map(employee => employee.id).sort((a, b) => a - b);
      const previousFinance = people.get(finance)!;
      try {
        people.set(finance, {
          id: finance, primaryEmailAddressId: "primary",
          emailAddresses: [{ id: "primary", emailAddress: emailOf(finance), verification: { status: "unverified" } }],
        });
        assert.equal((await call(finance, "GET", "/company")).status, 403, "stale cached email cannot preserve company access");
        assert.equal((await call(finance, "GET", "/company/invoices")).status, 403, "billing access is revoked immediately");
        assert.equal((await call(finance, "GET", "/company/subscription")).status, 403, "billing membership access is revoked immediately");
      } finally {
        people.set(finance, previousFinance);
      }

      // Clerk errors also fail closed for members, rather than trusting the
      // accepted memberUserId or stale cached addresses.
      clerkFailures.add(hr);
      try {
        assert.equal((await call(hr, "GET", "/company")).status, 403, "Clerk lookup failure denies member access");
      } finally {
        clerkFailures.delete(hr);
      }

      // Approved personal customer data keeps precedence over the invitation:
      // it remains readable from the user's own account, not the employer's.
      clerkFailures.add(multi);
      try {
        const [personalRequest] = await db.insert(hbsServiceRequests).values({
          userId: multi, category: "other", service: "Personal legacy request",
          description: "Preserves the customer's own approved access.", contactPhone: "0500000000",
        }).returning();
        requestIds.push(personalRequest.id);
        const ownFile = await call(multi, "GET", "/company");
        assert.equal(ownFile.status, 200, JSON.stringify(ownFile.data));
        assert.equal(ownFile.data.company, null);
        assert.deepEqual(ownFile.data.employees, []);
        const ownerFile = await call(owner, "GET", "/company");
        assert.equal(ownerFile.status, 200);
        const [companyAfter] = await db.select({ userId: hbsCompanies.userId }).from(hbsCompanies)
          .where(eq(hbsCompanies.userId, owner));
        const employeeIdsAfter = (await db.select({ id: hbsCompanyEmployees.id }).from(hbsCompanyEmployees)
          .where(eq(hbsCompanyEmployees.userId, owner))).map(employee => employee.id).sort((a, b) => a - b);
        assert.equal(companyAfter?.userId, companyBefore.userId, "the employer's company record remains intact");
        assert.deepEqual(employeeIdsAfter, employeeIdsBefore, "the employer's employee records remain intact");
        assert.deepEqual(ownerFile.data.employees.map((employee: any) => employee.id).sort((a: number, b: number) => a - b),
          employeeIdsBefore, "the company endpoint still exposes the same employees");
      } finally {
        clerkFailures.delete(multi);
      }
    });

    await t.test("an invoice priced per unit multiplies by the quantity", async () => {
      const tooMuch = await call(office, "POST", `/office/service-requests/${bulkId}/invoices`, { description: "رسوم", amount: 100, quantity: 2, unitAmount: 100_000_000 });
      assert.equal(tooMuch.status, 400);
      assert.equal((await call(office, "POST", `/office/service-requests/${bulkId}/invoices`, { description: "رسوم", amount: 100, quantity: 501, unitAmount: 100 })).status, 400);
      const issued = await call(office, "POST", `/office/service-requests/${bulkId}/invoices`, { description: "تجديد رخصة عمل", amount: 100, quantity: 3, unitAmount: 15_000 });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      assert.deepEqual({
        quantity: issued.data.quantity, unitAmount: issued.data.unitAmount, amount: issued.data.amount, vat: issued.data.vat, total: issued.data.total,
        requestId: issued.data.requestId, subscriptionId: issued.data.subscriptionId,
      }, { quantity: 3, unitAmount: 15_000, amount: 45_000, vat: vatFor(45_000), total: 45_000 + vatFor(45_000), requestId: bulkId, subscriptionId: null });
      assert.match(issued.data.requestReference, /^HBS-\d{4}-\d{5}$/);
      const [row] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, issued.data.id));
      assert.deepEqual([row.quantity, row.unitAmountHalalas, row.amountHalalas], [3, 15_000, 45_000]);

      const plain = await call(office, "POST", `/office/service-requests/${bulkId}/invoices`, { description: "أتعاب", amount: 20_000 });
      assert.deepEqual([plain.data.quantity, plain.data.unitAmount, plain.data.amount], [1, null, 20_000]);
      const listed = await call(owner, "GET", `/service-requests/${bulkId}/invoices`);
      assert.deepEqual(listed.data.map((i: any) => [i.quantity, i.unitAmount, i.amount]), [[3, 15_000, 45_000], [1, null, 20_000]]);
      const refreshed = await call(owner, "POST", `/invoices/${issued.data.id}/refresh`);
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.data.quantity, 3);
      assert.equal((await call(other, "POST", `/invoices/${issued.data.id}/refresh`)).status, 404);
      const summary = await call(owner, "GET", "/portal/summary");
      assert.equal(summary.data.unpaidInvoices, 2);
      const paid = await call(office, "PATCH", `/office/invoices/${issued.data.id}`, { action: "mark_paid" });
      assert.equal(paid.status, 200, JSON.stringify(paid.data));
      assert.equal(paid.data.unitAmount, 15_000);
    });

    await t.test("a subscription invoice belongs to the subscriber and pays back to the company page", async () => {
      const [plan] = await db.insert(hbsPlans).values({
        slug: `pkg-d-plan-${randomUUID().slice(0, 8)}`, name: "الأساسية", description: "خطة الاختبار", priceHalalas: 30_000,
      }).returning();
      const [subscription] = await db.insert(hbsSubscriptions).values({
        userId: owner, planId: plan.id, renewsAt: new Date(Date.now() + 30 * 86_400_000),
      }).returning();
      const [invoice] = await db.insert(hbsInvoices).values({
        subscriptionId: subscription.id, description: "اشتراك شهري", amountHalalas: 30_000, vatRateBasisPoints: 1_500,
        vatHalalas: 4_500, totalHalalas: 34_500, issuedBy: office,
      }).returning();
      const gateway: { url: string; body: Record<string, unknown> }[] = [];
      const realFetch = globalThis.fetch;
      let gatewayId = "";
      let gatewayStatus = "initiated";
      process.env.MOYASAR_SECRET_KEY = "sk_test_placeholder";
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith("https://api.moyasar.com/")) return realFetch(input, init);
        gateway.push({ url: `${init?.method ?? "GET"} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : {} });
        const path = new URL(url).pathname.split("/");
        const cancel = path.at(-1) === "cancel";
        const id = cancel ? path.at(-2)! : path.at(-1)!;
        if (init?.method === "POST") {
          gatewayId = `gw-${randomUUID()}`;
          gatewayStatus = "initiated";
          return new Response(JSON.stringify({
            id: gatewayId, status: gatewayStatus, amount: 34_500, currency: "SAR", url: `https://pay.example.invalid/${gatewayId}`,
          }));
        }
        if (cancel) gatewayStatus = "cancelled";
        return new Response(JSON.stringify({ id, status: gatewayStatus, amount: 34_500, currency: "SAR", url: `https://pay.example.invalid/${id}` }));
      }) as typeof fetch;
      try {
        const refreshed = await call(owner, "POST", `/invoices/${invoice.id}/refresh`);
        assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
        assert.deepEqual({ requestId: refreshed.data.requestId, requestReference: refreshed.data.requestReference, subscriptionId: refreshed.data.subscriptionId, quantity: refreshed.data.quantity },
          { requestId: null, requestReference: null, subscriptionId: subscription.id, quantity: 1 });
        assert.equal((await call(other, "POST", `/invoices/${invoice.id}/refresh`)).status, 404, "another customer");
        assert.equal((await call(hr, "POST", `/invoices/${invoice.id}/pay`)).status, 403, "hr does not cover billing");
        assert.equal((await call(viewer, "POST", `/invoices/${invoice.id}/pay`)).status, 403);
        assert.equal((await call(viewer, "POST", `/invoices/${invoice.id}/refresh`)).status, 403);
        assert.equal((await call(other, "POST", `/invoices/${invoice.id}/pay`)).status, 404);
        const started = await call(owner, "POST", `/invoices/${invoice.id}/pay`);
        assert.equal(started.status, 200, JSON.stringify(started.data));
        assert.match(started.data.url, /^https:\/\/pay\.example\.invalid\//);
        // A finance member acts on the company's subscription invoices as the owner would.
        const byFinance = await call(finance, "POST", `/invoices/${invoice.id}/refresh`);
        assert.equal(byFinance.status, 200, JSON.stringify(byFinance.data));
        assert.equal(byFinance.data.subscriptionId, subscription.id);
        const financePays = await call(finance, "POST", `/invoices/${invoice.id}/pay`);
        assert.equal(financePays.status, 200, JSON.stringify(financePays.data));
        assert.equal(financePays.data.url, started.data.url, "the same payment page");
        const created = gateway.find(c => c.url.startsWith("POST "));
        assert.ok(created, gateway.map(c => c.url).join(", "));
        const site = (process.env.PUBLIC_SITE_URL ?? "https://hrhbs.com").replace(/\/$/, "");
        assert.equal(created.body.success_url, `${site}/company?invoice=${invoice.id}`);
        assert.equal(created.body.back_url, `${site}/company`);
        assert.deepEqual(created.body.metadata, { invoice_id: String(invoice.id), subscription_id: String(subscription.id) });
        const summary = await call(owner, "GET", "/portal/summary");
        assert.equal(summary.data.unpaidInvoices, 2, "the subscription invoice counts with the open request invoice");
        const paid = await call(office, "PATCH", `/office/invoices/${invoice.id}`, { action: "mark_paid" });
        assert.equal(paid.status, 200, JSON.stringify(paid.data));
        assert.equal(paid.data.subscriptionId, subscription.id);
        assert.equal(gatewayStatus, "cancelled", "the provider confirms the page is no longer payable");
        const [page] = await db.select().from(hbsInvoiceGatewayPages)
          .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId));
        assert.equal(page?.invoiceId, invoice.id, "retain page-to-invoice attribution after manual payment");
        assert.ok(page?.closedAt);
        const [audit] = (await auditsFor(subscription.id)).filter(a => a.action === "invoice.mark_paid" && a.targetType === "subscription");
        assert.ok(audit, "filed under the subscription");
        assert.ok(gateway.some(c => /^PUT .*\/cancel$/.test(c.url)), "the open payment page is closed once paid");
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.MOYASAR_SECRET_KEY;
        await db.delete(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "subscription"), eq(hbsAuditLog.targetId, String(subscription.id))));
        await db.delete(hbsInvoiceGatewayPages).where(eq(hbsInvoiceGatewayPages.invoiceId, invoice.id));
        await db.delete(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
        await db.delete(hbsSubscriptions).where(eq(hbsSubscriptions.id, subscription.id));
        await db.delete(hbsPlans).where(eq(hbsPlans.id, plan.id));
      }
    });
  } finally {
    const ids = [...new Set(requestIds)];
    if (ids.length) {
      await db.delete(hbsAuditLog).where(inArray(hbsAuditLog.targetId, ids.map(String)));
      const invoices = await db.select({ id: hbsInvoices.id }).from(hbsInvoices)
        .where(inArray(hbsInvoices.requestId, ids));
      const invoiceIds = invoices.map(invoice => invoice.id);
      if (invoiceIds.length) {
        await db.delete(hbsInvoiceGatewayPages).where(inArray(hbsInvoiceGatewayPages.invoiceId, invoiceIds));
      }
      await db.delete(hbsInvoices).where(inArray(hbsInvoices.requestId, ids));
      await db.delete(hbsRequestEmployees).where(inArray(hbsRequestEmployees.requestId, ids));
      await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.id, ids));
    }
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, customers));
    await db.delete(hbsDocumentReminders).where(inArray(hbsDocumentReminders.userId, customers));
    await db.delete(hbsCompanyEmployees).where(inArray(hbsCompanyEmployees.userId, customers));
    await db.delete(hbsCompanyLicenses).where(inArray(hbsCompanyLicenses.userId, customers));
    await db.delete(hbsCompanyMembers).where(inArray(hbsCompanyMembers.companyUserId, customers));
    await db.delete(hbsCompanies).where(inArray(hbsCompanies.userId, customers));
    await db.delete(hbsAuditLog).where(and(eq(hbsAuditLog.targetType, "customer"), inArray(hbsAuditLog.targetId, customers)));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, office));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
