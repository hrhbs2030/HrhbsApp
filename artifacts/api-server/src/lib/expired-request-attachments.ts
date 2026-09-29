import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { db, hbsRequestAttachments } from "@workspace/db";
import { logger } from "./logger";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

// Upload URLs last 15 minutes. Leave an additional hour before removing an
// unsubmitted object, so no still-valid signed PUT can recreate it after deletion.
const RETENTION_AFTER_EXPIRY_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 15 * 60_000;
const BATCH_SIZE = 20;
const MAX_BATCHES = 5;
const temporaryPath = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storage = new ObjectStorageService();

async function deleteTemporaryObject(path: string) {
  try {
    const file = await storage.getObjectEntityFile(path);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    // A never-completed upload has no object to remove. The expired reservation
    // can still be cleared; other storage failures must be retried later.
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
}

export async function cleanupExpiredRequestAttachments(
  deleteObject: (path: string) => Promise<void> = deleteTemporaryObject,
  now = new Date(),
  userId?: string,
) {
  const cutoff = new Date(now.getTime() - RETENTION_AFTER_EXPIRY_MS);
  let cursor = 0;
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    // Lock the same rows that submission locks before attaching them. SKIP
    // LOCKED lets concurrent server instances clean disjoint batches safely.
    const { count, lastId, size } = await db.transaction(async tx => {
      const rows = await tx.select().from(hbsRequestAttachments).where(and(
        isNull(hbsRequestAttachments.requestId),
        lt(hbsRequestAttachments.expiresAt, cutoff),
        gt(hbsRequestAttachments.id, cursor),
        userId ? eq(hbsRequestAttachments.userId, userId) : undefined,
      )).orderBy(asc(hbsRequestAttachments.id)).limit(BATCH_SIZE)
        .for("update", { skipLocked: true });

      let count = 0;
      for (const row of rows) {
        // Never let a malformed reservation target a submitted/private key.
        if (!temporaryPath.test(row.objectPath)) {
          logger.warn({ attachmentId: row.id }, "Skipping unexpected temporary attachment path");
          continue;
        }
        try {
          await deleteObject(row.objectPath);
        } catch (err) {
          logger.warn({ err, attachmentId: row.id }, "Could not remove expired temporary attachment");
          continue;
        }
        await tx.delete(hbsRequestAttachments).where(and(
          eq(hbsRequestAttachments.id, row.id),
          isNull(hbsRequestAttachments.requestId),
        ));
        count++;
      }
      return { count, lastId: rows.at(-1)?.id ?? cursor, size: rows.length };
    });
    removed += count;
    cursor = lastId;
    if (size < BATCH_SIZE) break;
  }
  return removed;
}

export function startExpiredRequestAttachmentCleanup() {
  // Schedule only after the server starts; one run at a time and no timer
  // holding the process open on shutdown.
  const schedule = (delay: number) => {
    setTimeout(async () => {
      try {
        const removed = await cleanupExpiredRequestAttachments();
        if (removed) logger.info({ removed }, "Removed expired temporary attachments");
      } catch (err) {
        logger.error({ err }, "Expired attachment cleanup failed");
      } finally {
        schedule(SWEEP_INTERVAL_MS);
      }
    }, delay).unref();
  };
  schedule(30_000);
}