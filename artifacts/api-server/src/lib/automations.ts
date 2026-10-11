import { and, eq, sql } from "drizzle-orm";
import { db, hbsAssignmentRules, hbsInvoices, hbsOfficeStaff, hbsServiceRequests, type HbsServiceRequest } from "@workspace/db";
import { recordAudit } from "./audit";
import { logger } from "./logger";

// Status moves the office would otherwise make by hand. Each one is a
// conditional update (it happens once, even with two servers) recorded in
// the audit log as the "automation" actor, so it shows in the request's
// status history like any office update.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const AUTOMATION_ACTOR = "automation";

async function move(requestId: number, from: string, to: string, reason: string): Promise<HbsServiceRequest | null> {
  return db.transaction(async tx => {
    const [updated] = await tx.update(hbsServiceRequests).set({ status: to, customerMessage: null, updatedAt: new Date() })
      .where(and(eq(hbsServiceRequests.id, requestId), eq(hbsServiceRequests.status, from),
        ...(to === "reviewing" && from === "awaiting_payment"
          ? [sql`not exists (select 1 from ${hbsInvoices} i where i.request_id = ${requestId} and i.status = 'issued')`] : [])))
      .returning();
    if (updated) {
      await recordAudit(tx, {
        actorId: AUTOMATION_ACTOR, action: "service_request.update", targetType: "service_request", targetId: requestId,
        details: { fromStatus: from, toStatus: to, noteChanged: false, automatic: reason },
      });
    }
    return updated ?? null;
  });
}

// The customer answered (a message, a document, the last checklist item or
// a decision on the quote): the request goes back to the office's review queue.
export async function resumeAfterCustomerReply(requestId: number, reason: "customer_message" | "customer_file" | "checklist_complete" | "quote_accepted" | "quote_declined") {
  try { return await move(requestId, "waiting_on_customer", "reviewing", reason); }
  catch (err) { logger.warn({ err, requestId }, "Automatic status change failed"); return null; }
}

// Every invoice on the request is settled: back to the office to continue.
export async function resumeAfterPayment(requestId: number) {
  try { return await move(requestId, "awaiting_payment", "reviewing", "invoice_paid"); }
  catch (err) { logger.warn({ err, requestId }, "Automatic status change failed"); return null; }
}

// Applies the category's rule to a request just created, inside its
// transaction. An assignee who is no longer on the team is skipped.
export async function applyAssignmentRule(tx: Tx, request: HbsServiceRequest): Promise<HbsServiceRequest> {
  const [rule] = await tx.select().from(hbsAssignmentRules).where(eq(hbsAssignmentRules.category, request.category)).limit(1);
  if (!rule || (!rule.assignee && !rule.dueDays)) return request;
  const [member] = rule.assignee
    ? await tx.select({ userId: hbsOfficeStaff.userId }).from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, rule.assignee)).limit(1)
    : [];
  const dueAt = rule.dueDays ? new Date(request.createdAt.getTime() + rule.dueDays * 86_400_000) : null;
  if (!member && !dueAt) return request;
  const [updated] = await tx.update(hbsServiceRequests).set({
    ...(member ? { assignedTo: member.userId } : {}), ...(dueAt ? { dueAt } : {}),
  }).where(eq(hbsServiceRequests.id, request.id)).returning();
  await recordAudit(tx, {
    actorId: AUTOMATION_ACTOR, action: "service_request.update", targetType: "service_request", targetId: request.id,
    details: { fromStatus: request.status, toStatus: request.status, noteChanged: false, automatic: "assignment_rule",
      ...(member ? { toAssignee: member.userId } : {}), ...(dueAt ? { dueAt } : {}) },
  });
  return updated;
}
