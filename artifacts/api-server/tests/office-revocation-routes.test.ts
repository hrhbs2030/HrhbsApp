import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import {
  db, hbsApprovedInformation, hbsApprovedInformationHistory, hbsAuditLog,
  hbsInquiries, hbsOfficeStaff, hbsRegistrationRequests, hbsServiceRequests, pool,
} from "@workspace/db";
import officeAdminRouter from "../src/routes/office-admin";
import portalRouter from "../src/routes/portal";
import approvedInformationRouter from "../src/routes/approved-information";

if (process.env.NODE_ENV === "production") throw new Error("Office revocation tests must not run in production");

test("removing staff immediately blocks registration, publication, and other office routes", async () => {
  const officeEmail = "revocation-test-owner@example.invalid";
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, "Use an isolated test office email");
  const ownerId = `revocation-owner-${randomUUID()}`;
  const staffId = `revocation-staff-${randomUUID()}`;
  const customerId = `revocation-customer-${randomUUID()}`;
  const staffEmail = `staff-${randomUUID()}@example.invalid`;
  const customerEmail = `customer-${randomUUID()}@example.invalid`;
  const users = new Map([
    [ownerId, { id: ownerId, emailAddresses: [{ emailAddress: officeEmail, verification: { status: "verified" } }] }],
    [staffId, { id: staffId, emailAddresses: [{ emailAddress: staffEmail, verification: { status: "verified" } }] }],
    [customerId, { id: customerId, emailAddresses: [{ emailAddress: customerEmail, verification: { status: "verified" } }] }],
  ]);
  mock.method(clerkClient.users, "getUser", async (id: string) => users.get(id) as never);
  mock.method(clerkClient.users, "getUserList", async (query: { emailAddress?: string[]; userId?: string[] }) => ({
    data: [...users.values()].filter(user =>
      query.userId?.includes(user.id) ||
      query.emailAddress?.some(email => user.emailAddresses.some(entry => entry.emailAddress === email)),
    ),
  }) as never);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", officeAdminRouter, portalRouter, approvedInformationRouter);
  const server = app.listen(0);
  const informationIds: number[] = [];
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api`;
    const call = async (user: string, path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: response.status === 204 ? null : await response.json() };
    };
    const staff = (path: string, method = "GET", body?: unknown) => call(staffId, path, method, body);

    await db.insert(hbsOfficeStaff).values({ userId: ownerId });
    const added = await call(ownerId, "/office/staff", "POST", { email: staffEmail });
    assert.equal(added.status, 201);
    assert.equal(added.data.userId, staffId);

    const [request] = await db.insert(hbsServiceRequests).values({
      userId: customerId, category: "business", service: "Test service",
      description: "Private test request", contactPhone: "0000000000",
    }).returning();
    const [inquiry] = await db.insert(hbsInquiries).values({
      userId: customerId, subject: "Test inquiry", message: "Private test question",
    }).returning();
    const [registration] = await db.insert(hbsRegistrationRequests).values({
      userId: customerId, email: customerEmail, fullName: "Test Customer", contactPhone: "0000000000",
    }).returning();

    assert.equal((await staff("/portal/me")).data.officeRole, "staff");
    const approved = await staff(`/office/registrations/${registration.id}`, "PATCH", { status: "approved" });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.reviewerId, staffId);
    const first = await staff("/office/approved-information", "POST", {
      title: "Published test title", content: "Published test content",
    });
    assert.equal(first.status, 201);
    informationIds.push(first.data.id);
    const reviewed = await staff(`/office/approved-information/${first.data.id}/review`, "POST", {
      expectedUpdatedAt: first.data.updatedAt,
    });
    assert.equal(reviewed.status, 200);
    const published = await staff(`/office/approved-information/${first.data.id}/publish`, "POST", {
      expectedUpdatedAt: reviewed.data.updatedAt,
    });
    assert.equal(published.status, 200);
    assert.equal(published.data.publishedTitle, "Published test title");

    const second = await staff("/office/approved-information", "POST", {
      title: "Unpublished test title", content: "Unpublished test content",
    });
    assert.equal(second.status, 201);
    informationIds.push(second.data.id);
    const ready = await staff(`/office/approved-information/${second.data.id}/review`, "POST", {
      expectedUpdatedAt: second.data.updatedAt,
    });
    assert.equal(ready.status, 200);

    for (const path of [
      "/office/registrations", "/office/summary", "/office/service-requests",
      "/office/inquiries", "/office/approved-information",
      `/office/approved-information/${first.data.id}/history`,
    ]) {
      assert.equal((await staff(path)).status, 200, `Staff should access ${path} before removal`);
    }
    // The old-app archive is the owner's alone.
    assert.equal((await staff("/office/legacy/imports")).status, 403);
    const updatedRequest = await staff(`/office/service-requests/${request.id}`, "PATCH", {
      status: "reviewing", officeNote: "Staff note before removal", expectedUpdatedAt: request.updatedAt.toISOString(),
    });
    assert.equal(updatedRequest.status, 200);
    const answered = await staff(`/office/inquiries/${inquiry.id}`, "PATCH", { answer: "Answer before removal" });
    assert.equal(answered.status, 200);

    // Leave a real pending registration for the after-removal approval attempt.
    await db.update(hbsRegistrationRequests).set({ status: "pending", reviewerId: null })
      .where(eq(hbsRegistrationRequests.id, registration.id));
    assert.equal((await call(ownerId, `/office/staff/${staffId}`, "DELETE")).status, 204);
    assert.equal((await staff("/portal/me")).data.officeRole, null);

    const blocked: { path: string; method?: string; body?: unknown }[] = [
      ...[
        "/office/registrations", "/office/summary", "/office/service-requests",
        "/office/inquiries", "/office/approved-information",
        `/office/approved-information/${first.data.id}/history`,
      ].map(path => ({ path })),
      { path: `/office/registrations/${registration.id}`, method: "PATCH", body: { status: "approved" } },
      { path: `/office/approved-information/${second.data.id}/publish`, method: "POST", body: { expectedUpdatedAt: ready.data.updatedAt } },
      { path: `/office/approved-information/${second.data.id}`, method: "PATCH", body: {
        title: "Forbidden title", content: "Forbidden content", expectedUpdatedAt: ready.data.updatedAt,
      } },
      { path: `/office/approved-information/${second.data.id}/review`, method: "POST", body: {
        expectedUpdatedAt: ready.data.updatedAt,
      } },
      { path: `/office/approved-information/${first.data.id}/unpublish`, method: "POST", body: {
        expectedUpdatedAt: published.data.updatedAt,
      } },
      { path: "/office/approved-information", method: "POST", body: { title: "Forbidden", content: "Forbidden" } },
      { path: `/office/service-requests/${request.id}`, method: "PATCH", body: {
        status: "completed", officeNote: "Forbidden note", expectedUpdatedAt: updatedRequest.data.updatedAt,
      } },
      { path: `/office/inquiries/${inquiry.id}`, method: "PATCH", body: { answer: "Forbidden answer" } },
    ];
    for (const { path, method, body } of blocked) {
      const response = await staff(path, method, body);
      assert.equal(response.status, 403, `${method ?? "GET"} ${path} must reject removed staff`);
      assert.deepEqual(response.data, { error: "Office access required" });
    }

    const [unchangedRegistration] = await db.select().from(hbsRegistrationRequests)
      .where(eq(hbsRegistrationRequests.id, registration.id));
    const [unchangedInformation] = await db.select().from(hbsApprovedInformation)
      .where(eq(hbsApprovedInformation.id, second.data.id));
    const [unchangedRequest] = await db.select().from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.id, request.id));
    const [unchangedInquiry] = await db.select().from(hbsInquiries)
      .where(eq(hbsInquiries.id, inquiry.id));
    assert.equal(unchangedRegistration.status, "pending");
    assert.equal(unchangedInformation.publishedAt, null);
    assert.equal(unchangedInformation.draftTitle, "Unpublished test title");
    assert.equal(unchangedRequest.status, "reviewing");
    assert.equal(unchangedRequest.officeNote, "Staff note before removal");
    assert.equal(unchangedInquiry.answer, "Answer before removal");
    assert.equal((await call(ownerId, "/office/registrations")).status, 200);
  } finally {
    if (informationIds.length) {
      await db.delete(hbsApprovedInformationHistory).where(inArray(hbsApprovedInformationHistory.informationId, informationIds));
      await db.delete(hbsApprovedInformation).where(inArray(hbsApprovedInformation.id, informationIds));
    }
    await db.delete(hbsInquiries).where(eq(hbsInquiries.userId, customerId));
    await db.delete(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customerId));
    await db.delete(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, customerId));
    await db.delete(hbsAuditLog).where(eq(hbsAuditLog.targetId, staffId));
    await db.delete(hbsOfficeStaff).where(inArray(hbsOfficeStaff.userId, [ownerId, staffId]));
    server.close();
    await once(server, "close");
    mock.restoreAll();
    await pool.end();
  }
});