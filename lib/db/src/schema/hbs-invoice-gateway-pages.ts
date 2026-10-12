import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hbsInvoices } from "./hbs-invoices";

// Every hosted page ever issued for an invoice remains addressable here. The
// current URL on hbs_invoices is only a convenience for the active page.
export const hbsInvoiceGatewayPages = pgTable("hbs_invoice_gateway_pages", {
  gatewayInvoiceId: text("gateway_invoice_id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => hbsInvoices.id),
  paymentUrl: text("payment_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedPaidAlertedAt: timestamp("closed_paid_alerted_at", { withTimezone: true }),
}, (table) => [
  index("hbs_invoice_gateway_pages_invoice_idx").on(table.invoiceId),
  index("hbs_invoice_gateway_pages_reconcile_idx").on(table.lastCheckedAt, table.createdAt),
]);
