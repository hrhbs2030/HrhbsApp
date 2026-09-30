import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import express from "express";

// Runs the real office routes against a migrated PostgreSQL database, with
// Clerk replaced by fixed test accounts. Set TEST_DATABASE_URL to run it
// (CI does); the database's office tables are emptied first.
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : "set TEST_DATABASE_URL to a migrated test database";

process.env.NODE_ENV = "production";
process.env.DATABASE_URL = databaseUrl ?? "postgres://unused@127.0.0.1:1/unused";
process.env.HBS_OFFICE_EMAIL = "office@example.test";
process.env.CLERK_SECRET_KEY ??= "sk_test_placeholder";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:1";

const { clerkClient } = await import("@clerk/express");
const { db, pool, hbsInquiries, hbsRegistrationRequests, hbsServiceRequests } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const { default: apiRouter } = await import("../src/routes");

type Account = { id: string; emailAddresses: { emailAddress: string; verification: { status: string } | null }[] };
const account = (id: string, email: string): Account => ({
  id,
  emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
});
const accounts = new Map<string, Account>([
  ["user_owner", account("user_owner", "office@example.test")],
  ["user_staff", account("user_staff", "staff@example.test")],
  ["user_customer", account("user_customer", "customer@example.test")],
  ["user_other", account("user_other", "other@example.test")],
]);

const users = clerkClient.users as unknown as Record<string, unknown>;
users.getUser = async (id: string) => {
  const found = accounts.get(id);
  if (!found) throw new Error(`No test account ${id}`);
  return found;
};
users.getUserList = async ({ emailAddress, userId }: { emailAddress?: string[]; userId?: string[] }) => ({
  data: [...accounts.values()].filter((candidate) =>
    (!userId || userId.includes(candidate.id)) &&
    (!emailAddress || candidate.emailAddresses.some((entry) =>
      emailAddress.some((email) => email.toLowerCase() === entry.emailAddress.toLowerCase())))),
});

// Same brand clerkMiddleware puts on req.auth, so getAuth() accepts it.
const clerkAuthBrand = Symbol.for("@clerk/express.auth");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const userId = req.get("x-test-user") ?? null;
  const auth = () => ({ tokenType: "session_token", userId, isAuthenticated: !!userId });
  (req as unknown as { auth: unknown }).auth = Object.assign(auth, { [clerkAuthBrand]: true });
  next();
});
app.use("/api", apiRouter);

let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;

before(async () => {
  if (skip) return;
  await db.execute(sql`truncate hbs_audit_log, hbs_office_staff, hbs_inquiries, hbs_service_requests, hbs_registration_requests restart identity cascade`);
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  await pool.end();
});

async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "x-test-user": user, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test("owner manages staff, staff are limited, and actions are audited", { skip }, async () => {
  // The approved email's owner is provisioned on first /portal/me.
  const ownerMe = await call("user_owner", "GET", "/portal/me");
  assert.equal(ownerMe.status, 200);
  assert.equal(ownerMe.body.role, "staff");
  assert.equal(ownerMe.body.officeRole, "owner");

  const customerMe = await call("user_customer", "GET", "/portal/me");
  assert.equal(customerMe.body.role, "customer");
  assert.equal(customerMe.body.officeRole, null);

  // Not staff yet.
  assert.equal((await call("user_staff", "GET", "/office/summary")).status, 403);

  // Adding staff.
  assert.equal((await call("user_owner", "POST", "/office/staff", { email: "nobody@example.test" })).status, 404);
  assert.equal((await call("user_owner", "POST", "/office/staff", { email: "office@example.test" })).status, 409);
  assert.equal((await call("user_owner", "POST", "/office/staff", { email: "not-an-email" })).status, 400);
  assert.equal((await call("user_customer", "POST", "/office/staff", { email: "staff@example.test" })).status, 403);
  const added = await call("user_owner", "POST", "/office/staff", { email: "Staff@Example.test" });
  assert.equal(added.status, 201);
  assert.deepEqual(
    { userId: added.body.userId, email: added.body.email, role: added.body.role, addedBy: added.body.addedBy },
    { userId: "user_staff", email: "staff@example.test", role: "staff", addedBy: "user_owner" },
  );
  assert.equal((await call("user_owner", "POST", "/office/staff", { email: "staff@example.test" })).status, 409);

  // Staff can work requests but not owner pages.
  const staffMe = await call("user_staff", "GET", "/portal/me");
  assert.equal(staffMe.body.officeRole, "staff");
  assert.equal((await call("user_staff", "GET", "/office/summary")).status, 200);
  for (const path of ["/office/staff", "/office/audit-log", "/office/legacy/imports"]) {
    assert.equal((await call("user_staff", "GET", path)).status, 403, path);
  }

  const [request] = await db.insert(hbsServiceRequests).values({
    userId: "user_customer", category: "labor", service: "تجديد", description: "وصف الطلب", contactPhone: "0500000000",
  }).returning();
  const updated = await call("user_staff", "PATCH", `/office/service-requests/${request.id}`, {
    status: "reviewing", officeNote: "بانتظار المستندات", expectedUpdatedAt: request.updatedAt.toISOString(),
  });
  assert.equal(updated.status, 200);
  assert.equal((await call("user_staff", "PATCH", "/office/service-requests/999999", { status: "reviewing", expectedUpdatedAt: new Date().toISOString() })).status, 404);

  const staffList = await call("user_owner", "GET", "/office/staff");
  assert.deepEqual(
    staffList.body.map((member: { userId: string; email: string; role: string }) => [member.userId, member.email, member.role]),
    [["user_owner", "office@example.test", "owner"], ["user_staff", "staff@example.test", "staff"]],
  );

  // Removing staff: the owner row is protected, removal takes effect at once.
  assert.equal((await call("user_owner", "DELETE", "/office/staff/user_owner")).status, 400);
  assert.equal((await call("user_owner", "DELETE", "/office/staff/user_missing")).status, 404);
  assert.equal((await call("user_owner", "DELETE", "/office/staff/user_staff")).status, 204);
  assert.equal((await call("user_staff", "GET", "/office/summary")).status, 403);

  const log = await call("user_owner", "GET", "/office/audit-log");
  assert.equal(log.status, 200);
  const entries = log.body.map((entry: { action: string; actorEmail: string | null; targetId: string; details: unknown }) =>
    [entry.action, entry.actorEmail, entry.targetId, entry.details]);
  assert.deepEqual(entries, [
    ["staff.remove", "office@example.test", "user_staff", { email: "staff@example.test" }],
    // The removed staff member's row is gone, so their entries keep only the ID.
    ["service_request.update", null, String(request.id), { fromStatus: "received", toStatus: "reviewing", noteChanged: true }],
    ["staff.add", "office@example.test", "user_staff", { email: "staff@example.test" }],
  ]);
});

test("office lists filter, search, page and show the customer", { skip }, async () => {
  await db.execute(sql`truncate hbs_inquiries, hbs_service_requests, hbs_registration_requests restart identity cascade`);
  await db.insert(hbsRegistrationRequests).values({
    userId: "user_customer", email: "customer@example.test", fullName: "سارة العتيبي",
    contactPhone: "0501112233", status: "approved",
  });
  const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const rows = Array.from({ length: 30 }, (_, index) => ({
    userId: index < 28 ? "user_customer" : "user_legacy",
    category: index % 2 ? "labor" : "passports",
    service: index === 3 ? "تجديد إقامة 50%" : `خدمة ${index + 1}`,
    description: "وصف الطلب",
    contactPhone: "0500000000",
    status: index === 0 ? "completed" : "received",
    ...(index < 2 ? { createdAt: old, updatedAt: old } : {}),
  }));
  const inserted = await db.insert(hbsServiceRequests).values(rows).returning({ id: hbsServiceRequests.id });
  await db.insert(hbsInquiries).values([
    { userId: "user_customer", subject: "موعد التسليم", message: "متى يجهز الطلب؟" },
    { userId: "user_legacy", subject: "سؤال آخر", message: "رسالة", status: "answered", answer: "رد" },
  ]);

  const first = await call("user_owner", "GET", "/office/service-requests");
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 30);
  assert.equal(first.body.pageSize, 20);
  assert.equal(first.body.items.length, 20);
  assert.equal(first.body.items[0].id, inserted[29].id, "newest first");
  assert.equal(first.body.items[0].customer, null, "customer without a registration");
  assert.deepEqual(first.body.items[2].customer, { fullName: "سارة العتيبي", email: "customer@example.test" });
  assert.equal((await call("user_owner", "GET", "/office/service-requests?page=2")).body.items.length, 10);

  const labor = await call("user_owner", "GET", "/office/service-requests?category=labor&status=received");
  assert.equal(labor.body.total, 15);
  assert.ok(labor.body.items.every((item: { category: string; status: string }) => item.category === "labor" && item.status === "received"));

  // Search by customer name, by reference, and with wildcard characters taken literally.
  assert.equal((await call("user_owner", "GET", `/office/service-requests?q=${encodeURIComponent("سارة")}`)).body.total, 28);
  const byReference = await call("user_owner", "GET", `/office/service-requests?q=${encodeURIComponent(`HBS-2026-${String(inserted[5].id).padStart(5, "0")}`)}`);
  assert.deepEqual(byReference.body.items.map((item: { id: number }) => item.id), [inserted[5].id]);
  assert.equal((await call("user_owner", "GET", `/office/service-requests?q=${encodeURIComponent("50%")}`)).body.total, 1);
  assert.equal((await call("user_owner", "GET", "/office/service-requests?q=%25")).body.total, 1);

  const oldest = await call("user_owner", "GET", "/office/service-requests?sort=oldest_update&status=received");
  assert.equal(oldest.body.items[0].id, inserted[1].id, "stalled request first");

  assert.equal((await call("user_owner", "GET", "/office/service-requests?status=unknown")).status, 400);
  assert.equal((await call("user_owner", "GET", "/office/service-requests?page=0")).status, 400);

  const summary = await call("user_owner", "GET", "/office/summary");
  assert.equal(summary.body.staleRequests, 1, "completed requests are never stalled");

  const inquiries = await call("user_owner", "GET", "/office/inquiries?status=open");
  assert.equal(inquiries.body.total, 1);
  assert.deepEqual(inquiries.body.items[0].customer, { fullName: "سارة العتيبي", email: "customer@example.test" });
  assert.equal((await call("user_owner", "GET", `/office/inquiries?q=${encodeURIComponent("التسليم")}`)).body.total, 1);
  assert.equal((await call("user_owner", "GET", "/office/inquiries")).body.total, 2);
});

test("a customer sees their own request's status history, not other customers'", { skip }, async () => {
  await db.execute(sql`truncate hbs_audit_log, hbs_inquiries, hbs_service_requests, hbs_registration_requests restart identity cascade`);
  assert.equal((await call("user_owner", "GET", "/portal/me")).status, 200);
  await db.insert(hbsRegistrationRequests).values([
    { userId: "user_customer", email: "customer@example.test", fullName: "سارة", contactPhone: "0501112233", status: "approved" },
    { userId: "user_other", email: "other@example.test", fullName: "خالد", contactPhone: "0504445566", status: "approved" },
  ]);
  const [request] = await db.insert(hbsServiceRequests).values({
    userId: "user_customer", category: "passports", service: "تجديد إقامة", description: "تجديد إقامة عامل", contactPhone: "0501112233",
  }).returning();

  let expectedUpdatedAt = request.updatedAt.toISOString();
  for (const body of [{ status: "reviewing" }, { status: "reviewing", officeNote: "ملاحظة داخلية" }, { status: "completed" }]) {
    const changed = await call("user_owner", "PATCH", `/office/service-requests/${request.id}`, { ...body, expectedUpdatedAt });
    assert.equal(changed.status, 200);
    expectedUpdatedAt = changed.body.updatedAt;
  }

  const history = await call("user_customer", "GET", `/service-requests/${request.id}/history`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.map((event: { status: string }) => event.status), ["received", "reviewing", "completed"]);
  const times = history.body.map((event: { at: string }) => Date.parse(event.at));
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  // Only status and time: no actor, no note.
  assert.deepEqual(Object.keys(history.body[1]).sort(), ["at", "status"]);

  assert.equal((await call("user_other", "GET", `/service-requests/${request.id}/history`)).status, 404);
  assert.equal((await call("user_customer", "GET", "/service-requests/999999/history")).status, 404);
});
