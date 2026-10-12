import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { hbsServiceRequests } from "./hbs-service-requests";
import { hbsSubscriptions } from "./hbs-subscriptions";

// Office invoices on a service request or on a subscription (exactly one of
// the two). Amounts are in halalas. VAT is computed when the invoice is
// issued and never recalculated.
export const hbsInvoices = pgTable("hbs_invoices", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").references(() => hbsServiceRequests.id),
  subscriptionId: integer("subscription_id").references(() => hbsSubscriptions.id),
  description: text("description").notNull(),
  // amount = unit_amount × quantity when a unit amount is given (bulk
  // requests); otherwise amount is entered directly and quantity is 1.
  quantity: integer("quantity").notNull().default(1),
  unitAmountHalalas: integer("unit_amount_halalas"),
  amountHalalas: integer("amount_halalas").notNull(),
  vatRateBasisPoints: integer("vat_rate_basis_points").notNull(),
  vatHalalas: integer("vat_halalas").notNull(),
  totalHalalas: integer("total_halalas").notNull(),
  status: text("status").notNull().default("issued"),
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
  // The hosted payment page created at the payment gateway, if any.
  gatewayInvoiceId: text("gateway_invoice_id"),
  paymentUrl: text("payment_url"),
  // Office issue requests may safely retry with the same key. Null preserves
  // compatibility with callers that predate idempotent issuance.
  idempotencyKey: text("idempotency_key"),
  // Set while one request is creating the hosted page, so a second click
  // waits instead of opening a second page. Cleared once the page is stored.
  gatewayClaimedAt: timestamp("gateway_claimed_at", { withTimezone: true }),
  issuedBy: text("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  // Overdue reminders sent by the daily sweep: once after 3 days, once after 7.
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
}, (table) => [
  index("hbs_invoices_request_idx").on(table.requestId),
  index("hbs_invoices_subscription_idx").on(table.subscriptionId),
  // Open invoices by date: reports, reconciliation and the customer's summary.
  index("hbs_invoices_status_issued_idx").on(table.status, table.issuedAt),
  uniqueIndex("hbs_invoices_gateway_unique").on(table.gatewayInvoiceId),
  uniqueIndex("hbs_invoices_request_idempotency_unique").on(table.requestId, table.idempotencyKey),
  check("hbs_invoices_status_check", sql`${table.status} in ('issued', 'paid', 'cancelled')`),
  check("hbs_invoices_method_check", sql`${table.paymentMethod} is null or ${table.paymentMethod} in ('manual', 'online')`),
  check("hbs_invoices_amount_check", sql`${table.amountHalalas} > 0 and ${table.vatHalalas} >= 0 and ${table.totalHalalas} = ${table.amountHalalas} + ${table.vatHalalas}`),
  check("hbs_invoices_quantity_check", sql`${table.quantity} between 1 and 500 and (${table.unitAmountHalalas} is null or ${table.unitAmountHalalas} > 0)`),
  check("hbs_invoices_subject_check", sql`${table.requestId} is not null or ${table.subscriptionId} is not null`),
]);

export type HbsInvoice = typeof hbsInvoices.$inferSelect;
