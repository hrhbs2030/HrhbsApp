import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { hbsServiceRequests } from "./hbs-service-requests";

// Office invoices on a service request. Amounts are in halalas. VAT is
// computed when the invoice is issued and never recalculated.
export const hbsInvoices = pgTable("hbs_invoices", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => hbsServiceRequests.id),
  description: text("description").notNull(),
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
  issuedBy: text("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (table) => [
  index("hbs_invoices_request_idx").on(table.requestId),
  uniqueIndex("hbs_invoices_gateway_unique").on(table.gatewayInvoiceId),
  check("hbs_invoices_status_check", sql`${table.status} in ('issued', 'paid', 'cancelled')`),
  check("hbs_invoices_method_check", sql`${table.paymentMethod} is null or ${table.paymentMethod} in ('manual', 'online')`),
  check("hbs_invoices_amount_check", sql`${table.amountHalalas} > 0 and ${table.vatHalalas} >= 0 and ${table.totalHalalas} = ${table.amountHalalas} + ${table.vatHalalas}`),
]);

export type HbsInvoice = typeof hbsInvoices.$inferSelect;
