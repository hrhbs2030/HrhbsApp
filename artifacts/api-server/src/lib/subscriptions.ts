import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
  db, hbsInvoices, hbsOfficeStaff, hbsPlans, hbsServiceRequests, hbsSubscriptions,
  type HbsInvoice, type HbsPlan, type HbsServiceRequest, type HbsSubscription,
} from "@workspace/db";
import type { AuditLogEntryAction } from "@workspace/api-zod";
import { recordAudit } from "./audit";
import { AUTOMATION_ACTOR } from "./automations";
import { notifyCustomerNow } from "./customer-contact";
import { logger } from "./logger";
import { invoiceReference, requestReference, riyals, vatFor, VAT_RATE_BASIS_POINTS } from "./money";
import { moyasarConfigured } from "./moyasar";
import { subscriptionInvoiceMail, subscriptionPastDueMail } from "./notify";

// Monthly plans and subscriptions (package D). A subscription is invoiced
// once when it starts and again at each renews_at by the daily sweep; an
// invoice unpaid for 14 days puts the subscription past due until it is
// paid. Subscription invoices are hbs_invoices rows with subscription_id set
// and request_id null; they are paid through the same /invoices/:id/pay
// path as request invoices.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Audit actions of this package. TODO(contract): AuditLogEntry.action in
// lib/api-spec/openapi.yaml does not list them yet; they are written as
// given here and must be added to the enum before /office/audit-log can
// parse rows that carry them.
export const SUBSCRIPTION_AUDIT = {
  planCreate: "plan.create" as AuditLogEntryAction,
  planUpdate: "plan.update" as AuditLogEntryAction,
  start: "subscription.start" as AuditLogEntryAction,
  update: "subscription.update" as AuditLogEntryAction,
  autoRenew: "service_request.auto_renew" as AuditLogEntryAction,
};

export const PAST_DUE_AFTER_DAYS = 14;
const SWEEP_INTERVAL_MS = 24 * 60 * 60_000;
const BATCH_SIZE = 200;
export const OPEN_SUBSCRIPTION_STATUSES = ["active", "past_due"] as const;

// ---- calendar ------------------------------------------------------------------

// Riyadh keeps UTC+3 all year, so a month is added on the office's calendar
// by shifting into that offset, stepping the month (clamped to the last day
// of a shorter month) and shifting back.
const RIYADH_OFFSET_MS = 3 * 60 * 60_000;

export function addRiyadhMonth(date: Date): Date {
  const local = new Date(date.getTime() + RIYADH_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const lastDayOfNext = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const next = Date.UTC(year, month + 1, Math.min(local.getUTCDate(), lastDayOfNext),
    local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return new Date(next - RIYADH_OFFSET_MS);
}

export function riyadhMonthName(date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(date);
}

export function riyadhDateText(date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "long", timeZone: "Asia/Riyadh" }).format(date);
}

// ---- views ---------------------------------------------------------------------

export function planView(plan: HbsPlan) {
  const vat = vatFor(plan.priceHalalas);
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    price: plan.priceHalalas,
    vat,
    total: plan.priceHalalas + vat,
    employeeCap: plan.employeeCap,
    requestsPerMonth: plan.requestsPerMonth,
    autoRenewals: plan.autoRenewals,
    active: plan.active,
    sort: plan.sort,
  };
}

function seller() {
  return { name: process.env.HBS_LEGAL_NAME?.trim() || "HBS حلول الغد", vatNumber: process.env.HBS_VAT_NUMBER?.trim() || null };
}

// An invoice as the Invoice schema describes it, on a request or on a
// subscription (then request and requestReference are null).
export function invoiceView(row: HbsInvoice, request: Pick<HbsServiceRequest, "id" | "createdAt"> | null) {
  return {
    id: row.id,
    reference: invoiceReference(row.id, row.issuedAt),
    requestId: request?.id ?? null,
    requestReference: request ? requestReference(request.id, request.createdAt) : null,
    subscriptionId: row.subscriptionId,
    description: row.description,
    quantity: row.quantity,
    unitAmount: row.unitAmountHalalas,
    amount: row.amountHalalas,
    vatRateBasisPoints: row.vatRateBasisPoints,
    vat: row.vatHalalas,
    total: row.totalHalalas,
    status: row.status,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    canPayOnline: row.status === "issued" && moyasarConfigured(),
    seller: seller(),
  };
}

export function subscriptionView(subscription: HbsSubscription, plan: HbsPlan, latestInvoice: HbsInvoice | null) {
  return {
    id: subscription.id,
    plan: planView(plan),
    status: subscription.status,
    startsAt: subscription.startsAt,
    renewsAt: subscription.renewsAt,
    cancelledAt: subscription.cancelledAt,
    autoRenewRequests: subscription.autoRenewRequests,
    latestInvoice: latestInvoice ? invoiceView(latestInvoice, null) : null,
  };
}

export function invoiceInfo(row: HbsInvoice) {
  return { id: row.id, reference: invoiceReference(row.id, row.issuedAt), total: riyals(row.totalHalalas) };
}

// ---- queries -------------------------------------------------------------------

// The newest invoice of each subscription given.
export async function latestInvoicesOf(subscriptionIds: number[], tx: Tx | typeof db = db): Promise<Map<number, HbsInvoice>> {
  if (!subscriptionIds.length) return new Map();
  const rows = await tx.selectDistinctOn([hbsInvoices.subscriptionId]).from(hbsInvoices)
    .where(inArray(hbsInvoices.subscriptionId, subscriptionIds))
    .orderBy(hbsInvoices.subscriptionId, desc(hbsInvoices.issuedAt), desc(hbsInvoices.id));
  return new Map(rows.map(row => [row.subscriptionId!, row]));
}

// The customer's active or past-due subscription with its plan, if any.
export async function openSubscriptionOf(userId: string, tx: Tx | typeof db = db) {
  const [row] = await tx.select({ subscription: hbsSubscriptions, plan: hbsPlans }).from(hbsSubscriptions)
    .innerJoin(hbsPlans, eq(hbsSubscriptions.planId, hbsPlans.id))
    .where(and(eq(hbsSubscriptions.userId, userId), inArray(hbsSubscriptions.status, [...OPEN_SUBSCRIPTION_STATUSES])))
    .limit(1);
  return row ?? null;
}

// Whether the customer's expiring documents open renewal requests by
// themselves: an active subscription on a plan that covers renewals, with
// the customer's own switch on.
export async function autoRenewalCovered(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: hbsSubscriptions.id }).from(hbsSubscriptions)
    .innerJoin(hbsPlans, eq(hbsSubscriptions.planId, hbsPlans.id))
    .where(and(eq(hbsSubscriptions.userId, userId), eq(hbsSubscriptions.status, "active"),
      eq(hbsSubscriptions.autoRenewRequests, true), eq(hbsPlans.autoRenewals, true)))
    .limit(1);
  return Boolean(row);
}

// Every invoice of the customer, on their requests and on their
// subscriptions, newest first.
export async function customerInvoices(userId: string) {
  const rows = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .leftJoin(hbsSubscriptions, eq(hbsInvoices.subscriptionId, hbsSubscriptions.id))
    .where(or(eq(hbsServiceRequests.userId, userId), eq(hbsSubscriptions.userId, userId)))
    .orderBy(desc(hbsInvoices.issuedAt), desc(hbsInvoices.id)).limit(500);
  return rows.map(({ invoice, request }) => invoiceView(invoice, request));
}

// ---- invoicing -----------------------------------------------------------------

// Subscription invoices are issued by the office owner (the staff row
// without an email) when there is one, else by the automation actor.
async function officeIssuer(tx: Tx): Promise<string> {
  const [owner] = await tx.select({ userId: hbsOfficeStaff.userId }).from(hbsOfficeStaff)
    .orderBy(sql`${hbsOfficeStaff.email} is not null`, asc(hbsOfficeStaff.createdAt)).limit(1);
  return owner?.userId ?? AUTOMATION_ACTOR;
}

// One month of the plan, VAT computed now like request invoices. periodStart
// names the month on the invoice; the caller holds the subscription row.
export async function issueSubscriptionInvoice(
  tx: Tx, subscription: HbsSubscription, plan: HbsPlan,
  options: { actorId?: string; periodStart?: Date } = {},
): Promise<HbsInvoice> {
  const amount = plan.priceHalalas;
  const vat = vatFor(amount);
  const [row] = await tx.insert(hbsInvoices).values({
    subscriptionId: subscription.id, requestId: null,
    description: `اشتراك ${plan.name} — ${riyadhMonthName(options.periodStart ?? new Date())}`,
    quantity: 1, amountHalalas: amount, vatRateBasisPoints: VAT_RATE_BASIS_POINTS, vatHalalas: vat, totalHalalas: amount + vat,
    issuedBy: await officeIssuer(tx),
  }).returning();
  await recordAudit(tx, {
    actorId: options.actorId ?? AUTOMATION_ACTOR, action: "invoice.issue", targetType: "subscription", targetId: subscription.id,
    details: { invoiceId: row.id, total: row.totalHalalas, planId: plan.id, userId: subscription.userId },
  });
  return row;
}

// A paid subscription invoice brings a past-due subscription back. Safe to
// call for any invoice: request invoices and active subscriptions are left
// alone. The billing path may call it after marking an invoice paid; the
// daily sweep also applies it to whatever it finds.
export async function onSubscriptionInvoicePaid(invoice: Pick<HbsInvoice, "id" | "subscriptionId">, actorId = AUTOMATION_ACTOR): Promise<HbsSubscription | null> {
  if (!invoice.subscriptionId) return null;
  return db.transaction(async tx => {
    const [updated] = await tx.update(hbsSubscriptions).set({ status: "active", updatedAt: new Date() })
      .where(and(eq(hbsSubscriptions.id, invoice.subscriptionId!), eq(hbsSubscriptions.status, "past_due"))).returning();
    if (updated) {
      await recordAudit(tx, {
        actorId, action: SUBSCRIPTION_AUDIT.update, targetType: "subscription", targetId: updated.id,
        details: { fromStatus: "past_due", toStatus: "active", automatic: "invoice_paid", invoiceId: invoice.id, userId: updated.userId },
      });
    }
    return updated ?? null;
  });
}

// ---- the daily sweep -----------------------------------------------------------

// The newest invoice of the subscription in the outer query.
const latestInvoiceId = () => sql`(select i.id from ${hbsInvoices} i where i.subscription_id = ${hbsSubscriptions.id} order by i.issued_at desc, i.id desc limit 1)`;

export type RenewalOutcome = { issued: number; pastDue: number; reactivated: number };

// Three passes, each a conditional update so two servers never do a step
// twice: invoices for renewals that are due, past due for invoices unpaid
// 14 days after issue, and back to active once that invoice is paid.
export async function renewSubscriptions(send: typeof notifyCustomerNow = notifyCustomerNow, now = new Date()): Promise<RenewalOutcome> {
  const outcome: RenewalOutcome = { issued: 0, pastDue: 0, reactivated: 0 };

  const due = await db.select({ subscription: hbsSubscriptions, plan: hbsPlans }).from(hbsSubscriptions)
    .innerJoin(hbsPlans, eq(hbsSubscriptions.planId, hbsPlans.id))
    .where(and(eq(hbsSubscriptions.status, "active"), lte(hbsSubscriptions.renewsAt, now)))
    .orderBy(asc(hbsSubscriptions.renewsAt), asc(hbsSubscriptions.id)).limit(BATCH_SIZE);
  for (const { subscription, plan } of due) {
    const result = await db.transaction(async tx => {
      // Moving renews_at is the claim; the invoice goes in the same transaction.
      const [claimed] = await tx.update(hbsSubscriptions)
        .set({ renewsAt: addRiyadhMonth(subscription.renewsAt), updatedAt: now })
        .where(and(eq(hbsSubscriptions.id, subscription.id), eq(hbsSubscriptions.status, "active"), eq(hbsSubscriptions.renewsAt, subscription.renewsAt)))
        .returning();
      if (!claimed) return null;
      return issueSubscriptionInvoice(tx, claimed, plan, { periodStart: subscription.renewsAt });
    });
    if (!result) continue;
    outcome.issued++;
    try {
      await send(subscription.userId, to => subscriptionInvoiceMail(to, plan.name, invoiceInfo(result), null));
    } catch (err) {
      // The invoice stands; the overdue sweep reminds the customer again.
      logger.warn({ err, subscriptionId: subscription.id, invoiceId: result.id }, "Subscription invoice email was not sent");
    }
  }

  const overdue = await db.select({ subscription: hbsSubscriptions, plan: hbsPlans, invoice: hbsInvoices }).from(hbsSubscriptions)
    .innerJoin(hbsPlans, eq(hbsSubscriptions.planId, hbsPlans.id))
    .innerJoin(hbsInvoices, eq(hbsInvoices.id, latestInvoiceId()))
    .where(and(eq(hbsSubscriptions.status, "active"), eq(hbsInvoices.status, "issued"),
      sql`${hbsInvoices.issuedAt} < ${now}::timestamptz - make_interval(days => ${PAST_DUE_AFTER_DAYS})`))
    .orderBy(asc(hbsInvoices.issuedAt), asc(hbsSubscriptions.id)).limit(BATCH_SIZE);
  for (const { subscription, plan, invoice } of overdue) {
    const moved = await db.transaction(async tx => {
      const [updated] = await tx.update(hbsSubscriptions).set({ status: "past_due", updatedAt: now })
        .where(and(eq(hbsSubscriptions.id, subscription.id), eq(hbsSubscriptions.status, "active"))).returning();
      if (updated) {
        await recordAudit(tx, {
          actorId: AUTOMATION_ACTOR, action: SUBSCRIPTION_AUDIT.update, targetType: "subscription", targetId: updated.id,
          details: { fromStatus: "active", toStatus: "past_due", automatic: "invoice_overdue", invoiceId: invoice.id, userId: updated.userId },
        });
      }
      return updated ?? null;
    });
    if (!moved) continue;
    outcome.pastDue++;
    try {
      await send(subscription.userId, to => subscriptionPastDueMail(to, plan.name, invoiceInfo(invoice)));
    } catch (err) {
      logger.warn({ err, subscriptionId: subscription.id }, "Subscription past-due email was not sent");
    }
  }

  // Paid at the office or online without the billing path telling us.
  const settled = await db.select({ subscription: hbsSubscriptions, invoice: hbsInvoices }).from(hbsSubscriptions)
    .innerJoin(hbsInvoices, eq(hbsInvoices.id, latestInvoiceId()))
    .where(and(eq(hbsSubscriptions.status, "past_due"), eq(hbsInvoices.status, "paid")))
    .orderBy(asc(hbsSubscriptions.id)).limit(BATCH_SIZE);
  for (const { invoice } of settled) {
    if (await onSubscriptionInvoicePaid(invoice)) outcome.reactivated++;
  }

  return outcome;
}

export function startSubscriptionRenewals() {
  const schedule = (delay: number) => {
    setTimeout(async () => {
      try {
        const outcome = await renewSubscriptions();
        if (outcome.issued || outcome.pastDue || outcome.reactivated) logger.info(outcome, "Subscription renewal sweep done");
      } catch (err) {
        logger.error({ err }, "Subscription renewal sweep failed");
      } finally {
        schedule(SWEEP_INTERVAL_MS);
      }
    }, delay).unref();
  };
  schedule(5 * 60_000);
}
