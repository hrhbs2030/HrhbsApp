import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, hbsRequestAttachments, hbsServiceRequests, pool } from "@workspace/db";
import { cleanupExpiredRequestAttachments } from "../src/lib/expired-request-attachments";

if (process.env.NODE_ENV === "production") {
  throw new Error("Attachment cleanup tests must not run in production");
}

test("cleans only expired unsubmitted upload keys and retries storage failures", async () => {
  const userId = `attachment-cleanup-test-${randomUUID()}`;
  const now = new Date("2026-09-29T12:00:00Z");
  const path = () => `/objects/uploads/${randomUUID()}`;
  const expired = new Date(now.getTime() - 2 * 60 * 60_000);
  const recent = new Date(now.getTime() - 30 * 60_000);
  const values = (objectPath: string, expiresAt: Date, requestId: number | null = null) => ({
    userId, objectPath, expiresAt, requestId,
    name: "document.pdf", contentType: "application/pdf", size: 10,
  });

  try {
    const [request] = await db.insert(hbsServiceRequests).values({
      userId, category: "other", service: "Test",
      description: "Submitted request", contactPhone: "0000000000",
    }).returning();
    const expiredPath = path();
    const failedPath = path();
    const missingPath = path();
    const recentPath = path();
    const submittedPath = `/objects/submitted/${randomUUID()}`;
    const suspiciousPath = `/objects/submitted/${randomUUID()}`;
    await db.insert(hbsRequestAttachments).values([
      values(expiredPath, expired),
      values(failedPath, expired),
      values(missingPath, expired),
      values(recentPath, recent),
      values(submittedPath, expired, request.id),
      values(suspiciousPath, expired),
    ]);

    const attempted: string[] = [];
    const deleteObject = async (objectPath: string) => {
      attempted.push(objectPath);
      if (objectPath === failedPath) throw new Error("Storage unavailable");
      // A never-uploaded object is already absent; deleting its row is safe.
    };
    assert.equal(await cleanupExpiredRequestAttachments(deleteObject, now, userId), 2);
    assert.deepEqual(attempted.sort(), [expiredPath, failedPath, missingPath].sort());

    let rows = await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.userId, userId));
    assert.deepEqual(rows.map(row => row.objectPath).sort(),
      [failedPath, recentPath, submittedPath, suspiciousPath].sort());

    assert.equal(await cleanupExpiredRequestAttachments(async objectPath => {
      assert.equal(objectPath, failedPath);
    }, now, userId), 1);
    rows = await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.userId, userId));
    assert.equal(rows.length, 3);
    assert.ok(rows.some(row => row.objectPath === submittedPath && row.requestId === request.id));
    assert.ok(rows.some(row => row.objectPath === recentPath));
    assert.ok(rows.some(row => row.objectPath === suspiciousPath && row.requestId === null));
  } finally {
    await db.delete(hbsRequestAttachments).where(eq(hbsRequestAttachments.userId, userId));
    await db.delete(hbsServiceRequests).where(eq(hbsServiceRequests.userId, userId));
    await pool.end();
  }
});