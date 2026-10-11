import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, hbsInvoices, hbsServiceRequests } from "@workspace/db";
import { notifyCustomerNow } from "./customer-contact";
import { logger } from "./logger";
import { invoiceReference, requestReference, riyals } from "./money";
import { invoiceOverdueMail } from "./notify";

// Unpaid invoices get two reminders: 3 days after issue and again after 7.
// Each invoice remembers how many went out, claimed with a conditional update
// before sending, so a restart or a second server never sends one twice.
export const REMINDER_AFTER_DAYS = [3, 7] as const;
const SWEEP_INTERVAL_MS = 24 * 60 * 60_000;
const BATCH_SIZE = 200;

export async function remindOverdueInvoices(send: typeof notifyCustomerNow = notifyCustomerNow): Promise<number> {
  const rows = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .innerJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .where(and(eq(hbsInvoices.status, "issued"), or(
      and(eq(hbsInvoices.reminderCount, 0), sql`${hbsInvoices.issuedAt} < now() - make_interval(days => ${REMINDER_AFTER_DAYS[0]})`),
      and(eq(hbsInvoices.reminderCount, 1), sql`${hbsInvoices.issuedAt} < now() - make_interval(days => ${REMINDER_AFTER_DAYS[1]})`))))
    .orderBy(asc(hbsInvoices.issuedAt), asc(hbsInvoices.id)).limit(BATCH_SIZE);
  let sent = 0;
  for (const { invoice, request } of rows) {
    // An invoice first seen past both thresholds gets one reminder, counted
    // as the last, rather than two in a row.
    const passed = REMINDER_AFTER_DAYS.filter(days => invoice.issuedAt.getTime() < Date.now() - days * 86_400_000).length;
    const [claimed] = await db.update(hbsInvoices).set({ reminderCount: Math.max(passed, invoice.reminderCount + 1), remindedAt: new Date() })
      .where(and(eq(hbsInvoices.id, invoice.id), eq(hbsInvoices.status, "issued"), eq(hbsInvoices.reminderCount, invoice.reminderCount)))
      .returning();
    if (!claimed) continue;
    const days = Math.floor((Date.now() - invoice.issuedAt.getTime()) / 86_400_000);
    try {
      await send(request.userId, to => invoiceOverdueMail(to,
        { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service },
        { id: invoice.id, reference: invoiceReference(invoice.id, invoice.issuedAt), total: riyals(invoice.totalHalalas), days }));
    } catch (err) {
      // Not sent: give the claim back so the next sweep tries again, unless
      // the invoice moved on since.
      await db.update(hbsInvoices).set({ reminderCount: invoice.reminderCount, remindedAt: invoice.remindedAt })
        .where(and(eq(hbsInvoices.id, invoice.id), eq(hbsInvoices.reminderCount, claimed.reminderCount)));
      logger.warn({ err, invoiceId: invoice.id }, "Invoice reminder was not sent; it will be retried");
      continue;
    }
    sent++;
  }
  return sent;
}

export function startInvoiceReminders() {
  const schedule = (delay: number) => {
    setTimeout(async () => {
      try {
        const sent = await remindOverdueInvoices();
        if (sent) logger.info({ sent }, "Sent overdue invoice reminders");
      } catch (err) {
        logger.error({ err }, "Invoice reminder sweep failed");
      } finally {
        schedule(SWEEP_INTERVAL_MS);
      }
    }, delay).unref();
  };
  schedule(3 * 60_000);
}
