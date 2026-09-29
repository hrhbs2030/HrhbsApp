import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import express from "express";

// The document routes against a migrated PostgreSQL database, with files kept
// in memory. Set TEST_DATABASE_URL to run it (CI does).
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : "set TEST_DATABASE_URL to a migrated test database";

process.env.NODE_ENV = "production";
process.env.HBS_FILE_STORE = "memory";
process.env.DATABASE_URL = databaseUrl ?? "postgres://unused@127.0.0.1:1/unused";
process.env.HBS_OFFICE_EMAIL = "office@example.test";
process.env.CLERK_SECRET_KEY ??= "sk_test_placeholder";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:1";

const { clerkClient } = await import("@clerk/express");
const { db, pool, hbsAuditLog, hbsRegistrationRequests, hbsServiceRequests } = await import("@workspace/db");
const { eq, sql } = await import("drizzle-orm");
const { default: apiRouter } = await import("../src/routes");
const { purgeExpiredFiles } = await import("../src/routes/files");

const account = (id: string, email: string) => ({ id, emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }] });
const accounts = new Map([
  ["user_owner", account("user_owner", "office@example.test")],
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
  await db.execute(sql`truncate hbs_request_files, hbs_audit_log, hbs_office_staff, hbs_inquiries, hbs_service_requests, hbs_registration_requests restart identity cascade`);
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

async function call(user: string, method: string, path: string, body?: Buffer, name?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-test-user": user,
      ...(body ? { "Content-Type": "application/octet-stream" } : {}),
      ...(name !== undefined ? { "X-File-Name": encodeURIComponent(name) } : {}),
    },
    body,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, headers: response.headers, bytes, body: type.includes("json") && bytes.length ? JSON.parse(bytes.toString()) : null };
}

test("customers and the office exchange documents on a request, with access checks and audit", { skip }, async () => {
  assert.equal((await call("user_owner", "GET", "/portal/me")).status, 200);
  await db.insert(hbsRegistrationRequests).values([
    { userId: "user_customer", email: "customer@example.test", fullName: "سارة", contactPhone: "0501112233", status: "approved" },
    { userId: "user_other", email: "other@example.test", fullName: "خالد", contactPhone: "0504445566", status: "approved" },
  ]);
  const [request] = await db.insert(hbsServiceRequests).values({
    userId: "user_customer", category: "passports", service: "تجديد إقامة", description: "تجديد إقامة عامل", contactPhone: "0501112233",
  }).returning();
  const base = `/service-requests/${request.id}/files`;

  // Upload checks.
  assert.equal((await call("user_customer", "POST", base, EXE, "tool.exe")).status, 415);
  assert.equal((await call("user_customer", "POST", base, PDF)).status, 400);
  assert.equal((await call("user_other", "POST", base, PDF, "x.pdf")).status, 404);
  assert.equal((await call("user_owner", "POST", "/service-requests/999999/files", PDF, "x.pdf")).status, 403);

  const uploaded = await call("user_customer", "POST", base, PDF, "صورة الإقامة.pdf");
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.fileName, "صورة الإقامة.pdf");
  assert.equal(uploaded.body.contentType, "application/pdf");
  assert.equal(uploaded.body.uploaderRole, "customer");
  assert.equal("storageKey" in uploaded.body, false);

  // Only the owner and the office see and download it.
  assert.equal((await call("user_other", "GET", base)).status, 404);
  assert.equal((await call("user_other", "GET", `${base}/${uploaded.body.id}/content`)).status, 404);
  const mine = await call("user_customer", "GET", `${base}/${uploaded.body.id}/content`);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.bytes, PDF);
  assert.match(mine.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(mine.headers.get("x-content-type-options"), "nosniff");

  const officeBase = `/office/service-requests/${request.id}/files`;
  assert.equal((await call("user_customer", "GET", officeBase)).status, 403);
  const officeCopy = await call("user_owner", "GET", `${officeBase}/${uploaded.body.id}/content`);
  assert.equal(officeCopy.status, 200);
  const officeFile = await call("user_owner", "POST", officeBase, PNG, "الشهادة");
  assert.equal(officeFile.status, 201);
  assert.equal(officeFile.body.fileName, "الشهادة.png");
  assert.equal(officeFile.body.uploaderRole, "office");

  const listed = await call("user_customer", "GET", base);
  assert.deepEqual(listed.body.map((f: { id: number }) => f.id), [officeFile.body.id, uploaded.body.id]);

  // Customers remove their own uploads only.
  assert.equal((await call("user_customer", "DELETE", `${base}/${officeFile.body.id}`)).status, 409);
  assert.equal((await call("user_other", "DELETE", `${base}/${uploaded.body.id}`)).status, 404);
  assert.equal((await call("user_customer", "DELETE", `${base}/${uploaded.body.id}`)).status, 204);
  assert.equal((await call("user_customer", "GET", `${base}/${uploaded.body.id}/content`)).status, 404);
  const afterDelete = await call("user_customer", "GET", base);
  const removed = afterDelete.body.find((f: { id: number }) => f.id === uploaded.body.id);
  assert.equal(removed.deletedReason, "uploader");
  assert.ok(removed.deletedAt);

  // Ten active files at most.
  for (let i = 0; i < 9; i++) assert.equal((await call("user_customer", "POST", base, JPG, `صورة ${i}.jpg`)).status, 201);
  assert.equal((await call("user_customer", "POST", base, JPG, "زائد.jpg")).status, 409);

  // Office actions are audited; customer actions are not office actions.
  const audit = await db.select().from(hbsAuditLog).where(eq(hbsAuditLog.targetId, String(request.id)));
  assert.deepEqual(audit.map((entry) => entry.action).sort(), ["request_file.download", "request_file.upload"]);

  // Completed requests: customers can no longer add files, and after 90 days all files are purged.
  await db.update(hbsServiceRequests).set({ status: "completed", updatedAt: new Date(Date.now() - 91 * 86_400_000) })
    .where(eq(hbsServiceRequests.id, request.id));
  assert.equal((await call("user_customer", "POST", base, PDF, "late.pdf")).status, 409);
  assert.equal(await purgeExpiredFiles(), 10);
  assert.equal(await purgeExpiredFiles(), 0);
  const purged = await call("user_customer", "GET", base);
  assert.ok(purged.body.every((f: { deletedAt: string | null }) => f.deletedAt));
  assert.equal((await call("user_owner", "GET", `${officeBase}/${officeFile.body.id}/content`)).status, 404);
  const purgeAudit = await db.select().from(hbsAuditLog).where(eq(hbsAuditLog.action, "request_file.purge"));
  assert.equal(purgeAudit.length, 10);
  assert.ok(purgeAudit.every((entry) => entry.actorId === "system"));
});
