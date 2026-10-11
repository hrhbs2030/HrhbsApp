import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Per-customer notification choices. WhatsApp messages are sent only after
// the customer opts in and gives the number to use.
export const hbsCustomerSettings = pgTable("hbs_customer_settings", {
  userId: text("user_id").primaryKey(),
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
  whatsappPhone: text("whatsapp_phone"),
  // When the customer last wrote to the office's WhatsApp number; a reply
  // within 24 hours can be free-form text instead of a template.
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HbsCustomerSettings = typeof hbsCustomerSettings.$inferSelect;
