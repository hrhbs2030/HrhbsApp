import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Per-customer notification choices. WhatsApp messages are sent only after
// the customer opts in and gives the number to use.
export const hbsCustomerSettings = pgTable("hbs_customer_settings", {
  userId: text("user_id").primaryKey(),
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
  whatsappPhone: text("whatsapp_phone"),
  // A number is never trusted merely because it was entered in the portal.
  whatsappVerified: boolean("whatsapp_verified").notNull().default(false),
  whatsappVerificationChallengeHash: text("whatsapp_verification_challenge_hash"),
  whatsappVerificationExpiresAt: timestamp("whatsapp_verification_expires_at", { withTimezone: true }),
  // When the customer last wrote to the office's WhatsApp number; a reply
  // within 24 hours can be free-form text instead of a template.
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  // The database arbitrates concurrent verification attempts and prevents a
  // verified number from ever routing to two customer accounts.
  uniqueIndex("hbs_customer_settings_verified_whatsapp_unique")
    .on(table.whatsappPhone)
    .where(sql`${table.whatsappVerified} = true and ${table.whatsappPhone} is not null`),
]);

export type HbsCustomerSettings = typeof hbsCustomerSettings.$inferSelect;
