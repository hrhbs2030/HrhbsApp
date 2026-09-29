import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, hbsInquiries, hbsServiceRequests, pool } from "@workspace/db";
import portalRouter from "../src/routes/portal";

// This suite uses the development database, but never existing customer IDs.
// Do not run it against a production database.
if (process.env.NODE_ENV === "production") {
  throw new Error("Portal isolation tests must not run in production");
}

const customerA = `inquiry-test-a-${randomUUID()}`;
const customerB = `inquiry-test-b-${randomUUID()}`;
const users = [customerA, customerB];

function testApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    // Clerk's getAuth requires the branded request auth handler. This test
    // middleware only exists on this ephemeral Express app, never in the API.
    const auth = () => ({
      tokenType: "session_token" as const,
      userId,
      sessionClaims: { sub: userId, sid: "test-session" },
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", portalRouter);
  return app;
}

async function request(base: string, user: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

test("customer inquiry links and dashboard remain isolated across two accounts", async () => {
  const server = testApp().listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const [ownRequest] = await db.insert(hbsServiceRequests).values({
      userId: customerA, category: "business", service: "A service",
      description: "Only customer A can see this", contactPhone: "0000000000",
      officeNote: "SECRET OFFICE NOTE A",
    }).returning();
    const [otherRequest] = await db.insert(hbsServiceRequests).values({
      userId: customerB, category: "labor", service: "B private service",
      description: "B private request description", contactPhone: "1111111111",
      officeNote: "SECRET OFFICE NOTE B",
    }).returning();
    await db.insert(hbsInquiries).values([
      { userId: customerA, subject: "Old unlinked inquiry", message: "This predates request linking" },
      { userId: customerB, subject: "B private inquiry", message: "B private inquiry message", linkedServiceRequestId: otherRequest.id },
      // Simulate a preexisting inconsistent reference. Reads must not resolve
      // another customer's request even if such a row already exists.
      { userId: customerA, subject: "Legacy mismatched link", message: "Do not expose B", linkedServiceRequestId: otherRequest.id },
    ]);

    const body = { subject: "Question about a request", message: "Please check the request status" };
    const own = await request(base, customerA, "/inquiries", { ...body, linkedServiceRequestId: ownRequest.id });
    assert.equal(own.status, 201);
    assert.match(own.data.linkedServiceRequestReference, new RegExp(`${ownRequest.id.toString().padStart(5, "0")}$`));
    assert.equal(own.data.message, body.message);

    const other = await request(base, customerA, "/inquiries", { ...body, linkedServiceRequestId: otherRequest.id });
    const missing = await request(base, customerA, "/inquiries", { ...body, linkedServiceRequestId: Math.max(ownRequest.id, otherRequest.id) + 1_000_000 });
    assert.equal(other.status, 400);
    assert.deepEqual(missing, other);

    const unlinked = await request(base, customerA, "/inquiries", body);
    assert.equal(unlinked.status, 201);
    assert.equal(unlinked.data.linkedServiceRequestReference, null);

    for (const user of users) {
      const list = await request(base, user, "/inquiries");
      const summary = await request(base, user, "/portal/summary");
      assert.equal(list.status, 200);
      assert.equal(summary.status, 200);
      assert.equal(summary.data.totalRequests, 1);
      assert.equal(summary.data.openInquiries, user === customerA ? 4 : 1);
      const forbidden = user === customerA
        ? ["B private inquiry", "B private service", "B private request description", "SECRET OFFICE NOTE B"]
        : ["Old unlinked inquiry", "Legacy mismatched link", "A service", "SECRET OFFICE NOTE A"];
      for (const payload of [list.data, summary.data]) {
        const json = JSON.stringify(payload);
        for (const value of forbidden) assert.ok(!json.includes(value), `Leaked ${value}`);
        assert.ok(!json.includes("SECRET OFFICE NOTE"), "Office notes must remain private");
      }
      assert.deepEqual(summary.data.recentInquiries.map((row: { id: number }) => row.id).sort(),
        list.data.map((row: { id: number }) => row.id).sort());
      if (user === customerA) {
        for (const collection of [list.data, summary.data.recentInquiries]) {
          assert.equal(collection.find((row: { subject: string }) => row.subject === "Old unlinked inquiry")?.linkedServiceRequestReference, null);
          assert.equal(collection.find((row: { subject: string }) => row.subject === "Legacy mismatched link")?.linkedServiceRequestReference, null);
        }
        assert.equal(summary.data.recentRequests[0].id, ownRequest.id);
      } else {
        assert.equal(summary.data.recentRequests[0].id, otherRequest.id);
      }
    }
  } finally {
    await db.delete(hbsInquiries).where(inArray(hbsInquiries.userId, users));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, users));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});