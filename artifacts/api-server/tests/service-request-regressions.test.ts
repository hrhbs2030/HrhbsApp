import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, hbsServiceRequests, pool } from "@workspace/db";
import portalRouter from "../src/routes/portal";

// This suite uses the development database, but never existing customer IDs.
// Do not run it against a production database.
if (process.env.NODE_ENV === "production") {
  throw new Error("Service request regression tests must not run in production");
}

const customerA = `service-request-test-a-${randomUUID()}`;
const customerB = `service-request-test-b-${randomUUID()}`;
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

test("service request retries are idempotent per customer and waiting messages stay public-only", async () => {
  const server = testApp().listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const clientRequestId = randomUUID();
    const body = {
      category: "business",
      service: "Business registration",
      description: "Please help with a business registration.",
      contactPhone: "0000000000",
      clientRequestId,
    };
    const [waitingRequest] = await db.insert(hbsServiceRequests).values({
      userId: customerA,
      category: "labor",
      service: "Employment document review",
      description: "Review my employment documents.",
      contactPhone: "0000000000",
      status: "waiting_on_customer",
      customerMessage: "Please provide a clearer copy of the document.",
      officeNote: "PRIVATE internal follow-up note",
    }).returning();
    await db.insert(hbsServiceRequests).values({
      userId: customerB,
      category: "other",
      service: "Existing customer request",
      description: "Existing request used to grant test customer access.",
      contactPhone: "1111111111",
    });

    const first = await request(base, customerA, "/service-requests", body);
    const retry = await request(base, customerA, "/service-requests", body);
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.id, first.data.id);
    assert.equal(retry.data.clientRequestId, clientRequestId);
    assert.deepEqual(retry.data, first.data);

    const conflicting = await request(base, customerA, "/service-requests", {
      ...body,
      description: "Please help with a different business registration.",
    });
    assert.equal(conflicting.status, 409);

    // The same client key belongs to a customer, not globally: another account
    // creates and retries its own request instead of receiving customer A's.
    const otherCustomerFirst = await request(base, customerB, "/service-requests", body);
    const otherCustomerRetry = await request(base, customerB, "/service-requests", body);
    assert.equal(otherCustomerFirst.status, 201);
    assert.equal(otherCustomerRetry.status, 200);
    assert.notEqual(otherCustomerFirst.data.id, first.data.id);
    assert.equal(otherCustomerFirst.data.service, body.service);
    assert.equal(otherCustomerRetry.data.id, otherCustomerFirst.data.id);

    for (const result of [
      await request(base, customerA, "/service-requests"),
      await request(base, customerA, `/service-requests/${waitingRequest.id}`),
    ]) {
      assert.equal(result.status, 200);
      const record = Array.isArray(result.data)
        ? result.data.find((row: { id: number }) => row.id === waitingRequest.id)
        : result.data;
      assert.equal(record.id, waitingRequest.id);
      assert.equal(record.status, "waiting_on_customer");
      assert.equal(record.customerMessage, "Please provide a clearer copy of the document.");
      assert.ok(!JSON.stringify(record).includes("PRIVATE internal follow-up note"));
      assert.ok(!("officeNote" in record));
    }

    const customerBRequests = await request(base, customerB, "/service-requests");
    assert.equal(customerBRequests.status, 200);
    assert.ok(!customerBRequests.data.some((row: { id: number }) => row.id === waitingRequest.id));
  } finally {
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, users));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});