import { db, hbsAuditLog } from "@workspace/db";
import type { AuditLogEntryAction } from "@workspace/api-zod";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AuditEntry = {
  actorId: string;
  action: AuditLogEntryAction;
  targetType: string;
  targetId: string | number;
  details?: Record<string, unknown>;
};

// Audit rows are written in the same transaction as the office access change.
export async function recordAudit(tx: Transaction, entry: AuditEntry): Promise<void> {
  await tx.insert(hbsAuditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: String(entry.targetId),
    details: entry.details ?? {},
  });
}