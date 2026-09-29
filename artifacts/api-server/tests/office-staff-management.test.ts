import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import { db, hbsAuditLog, hbsOfficeStaff, pool } from "@workspace/db";
import { requireOfficeStaff } from "../src/lib/office-access";
import officeAdminRouter from "../src/routes/office-admin";

if (process.env.NODE_ENV === "production") throw new Error("Office staff tests must not run in production");

test("owner-only staff management audits changes and revokes removed staff immediately", async () => {
  const officeEmail = "office-staff-test-owner@example.invalid";
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, "Use an isolated test office email");

  const ownerId = `office-owner-${randomUUID()}`;
  const staffId = `office-staff-${randomUUID()}`;
  const customerId = `office-customer-${randomUUID()}`;
  const staffEmail = `staff-${randomUUID()}@example.invalid`;
  const users = new Map([
    [ownerId, { id: ownerId, emailAddresses: [{ emailAddress: officeEmail, verification: { status: "verified" } }] }],
    [staffId, { id: staffId, emailAddresses: [{ emailAddress: staffEmail, verification: { status: "verified" } }] }],
    [customerId, { id: customerId, emailAddresses: [{ emailAddress: `customer-${randomUUID()}@example.invalid`, verification: { status: "verified" } }] }],
  ]);

  mock.method(clerkClient.users, "getUser", async (id: string) => users.get(id) as never);
  mock.method(clerkClient.users, "getUserList", async (query: { emailAddress?: string[]; userId?: string[] }) => {
    const candidates = [...users.values()].filter((user) =>
      query.userId?.includes(user.id) ||
      query.emailAddress?.some((email) => user.emailAddresses.some(
        (entry) => entry.emailAddress.toLowerCase() === email.toLowerCase(),
      )),
    );
    return { data: candidates } as never;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", officeAdminRouter);
  app.get("/api/office-test/staff", requireOfficeStaff, (_req, res) => res.json({ allowed: true }));

  const server = app.listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api`;
    const call = async (user: string | null, path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(user ? { "x-test-user": user } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: response.status === 204 ? null : await response.json() };
    };

    await db.insert(hbsOfficeStaff).values({ userId: ownerId });

    assert.equal((await call(null, "/office/staff")).status, 401);
    assert.equal((await call(customerId, "/office/staff")).status, 403);
    assert.equal((await call(ownerId, "/office/staff")).status, 200);

    const added = await call(ownerId, "/office/staff", "POST", { email: staffEmail });
    assert.equal(added.status, 201);
    assert.equal(added.data.userId, staffId);
    assert.equal((await call(staffId, "/office-test/staff")).status, 200);

    users.set(staffId, {
      id: staffId,
      emailAddresses: [{ emailAddress: staffEmail, verification: { status: "unverified" } }],
    });
    assert.equal((await call(staffId, "/office-test/staff")).status, 403);
    users.set(staffId, {
      id: staffId,
      emailAddresses: [{ emailAddress: staffEmail, verification: { status: "verified" } }],
    });

    assert.equal((await call(ownerId, `/office/staff/${ownerId}`, "DELETE")).status, 400);
    assert.equal((await call(ownerId, `/office/staff/${staffId}`, "DELETE")).status, 204);
    assert.equal((await call(staffId, "/office-test/staff")).status, 403);

    const audit = await call(ownerId, "/office/audit-log");
    assert.equal(audit.status, 200);
    assert.deepEqual(
      audit.data.filter((entry: { targetId: string }) => entry.targetId === staffId)
        .map((entry: { action: string }) => entry.action).sort(),
      ["staff.add", "staff.remove"],
    );
  } finally {
    await db.delete(hbsAuditLog).where(eq(hbsAuditLog.targetId, staffId));
    await db.delete(hbsOfficeStaff).where(inArray(hbsOfficeStaff.userId, [ownerId, staffId]));
    server.close();
    await once(server, "close");
    mock.restoreAll();
    await pool.end();
  }
});