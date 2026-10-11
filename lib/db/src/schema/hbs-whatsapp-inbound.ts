import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Messages customers send to the office's WhatsApp number, keyed by Meta's
// message ID so a redelivered webhook is ignored. A message from a known
// number becomes a request message or an inquiry; the rest are kept for
// the office to look at.
export const hbsWhatsappInbound = pgTable("hbs_whatsapp_inbound", {
  waMessageId: text("wa_message_id").primaryKey(),
  fromPhone: text("from_phone").notNull(),
  userId: text("user_id"),
  requestId: integer("request_id"),
  body: text("body").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  handled: text("handled").notNull(),
}, (table) => [
  index("hbs_whatsapp_inbound_user_idx").on(table.userId, table.receivedAt),
  check("hbs_whatsapp_inbound_handled_check", sql`${table.handled} in ('request_message', 'inquiry', 'unmatched', 'ignored')`),
]);

export type HbsWhatsappInbound = typeof hbsWhatsappInbound.$inferSelect;
