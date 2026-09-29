import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import express from "express";
import { db, hbsApprovedInformation, hbsApprovedInformationHistory, hbsOfficeStaff, pool } from "@workspace/db";
import approvedInformationRouter from "../src/routes/approved-information";

if (process.env.NODE_ENV === "production") throw new Error("History tests must not run in production");

test("office publication history preserves snapshots through republish and withdrawal", async () => {
  const officeEmail = "history-test-office@example.invalid";
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, "Use an isolated test office email");
  const staff = `history-staff-${randomUUID()}`;
  const customer = `history-customer-${randomUUID()}`;
  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id, emailAddresses: id === staff
      ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", approvedInformationRouter);
  const server = app.listen(0);
  let id: number | undefined;
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api/office/approved-information`;
    const call = async (user: string, path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method, headers: { "x-test-user": user, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    };
    await db.insert(hbsOfficeStaff).values({ userId: staff });
    // Simulate information that was already live when the history feature was installed.
    const legacyPublishedAt = new Date("2026-01-03T12:00:00.000Z");
    const [legacy] = await db.insert(hbsApprovedInformation).values({
      draftTitle: "المسودة الجديدة", draftContent: "تفاصيل المسودة الجديدة قبل الاعتماد",
      publishedTitle: "النسخة القديمة", publishedContent: "تفاصيل النسخة القديمة المعتمدة",
      publishedReviewedAt: new Date("2026-01-02T12:00:00.000Z"),
      publishedAt: legacyPublishedAt,
    }).returning();
    id = legacy.id;
    assert.equal((await call(customer, `/${id}/history`)).status, 403);
    const initial = await call(staff, `/${id}/history`);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.data.map((entry: { title: string }) => entry.title), ["النسخة القديمة"]);
    let current = legacy;
    const review = await call(staff, `/${id}/review`, "POST", { expectedUpdatedAt: current.updatedAt.toISOString() });
    assert.equal(review.status, 200);
    current = review.data;
    const publish = await call(staff, `/${id}/publish`, "POST", { expectedUpdatedAt: current.updatedAt });
    assert.equal(publish.status, 200);
    current = publish.data;
    assert.equal((await call(staff, `/${id}/publish`, "POST", { expectedUpdatedAt: review.data.updatedAt })).status, 409);
    const withdrawn = await call(staff, `/${id}/unpublish`, "POST", { expectedUpdatedAt: current.updatedAt });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.data.publishedContent, null);
    const history = await call(staff, `/${id}/history`);
    assert.equal(history.status, 200);
    assert.deepEqual(history.data.map((entry: { action: string; title: string }) => [entry.action, entry.title]), [
      ["withdrawn", "المسودة الجديدة"], ["published", "المسودة الجديدة"], ["published", "النسخة القديمة"],
    ]);
    assert.equal(history.data[0].content, "تفاصيل المسودة الجديدة قبل الاعتماد");
    assert.equal(history.data[2].content, "تفاصيل النسخة القديمة المعتمدة");
    assert.equal(history.data[0].publishedAt, history.data[1].publishedAt);
    assert.equal((await call(customer, `/${id}/history`)).status, 403);
  } finally {
    if (id) {
      await db.delete(hbsApprovedInformationHistory).where(eq(hbsApprovedInformationHistory.informationId, id));
      await db.delete(hbsApprovedInformation).where(eq(hbsApprovedInformation.id, id));
    }
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, staff));
    server.close();
    await once(server, "close");
    mock.restoreAll();
    await pool.end();
  }
});