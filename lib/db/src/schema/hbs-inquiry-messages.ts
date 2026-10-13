import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { hbsInquiries } from "./hbs-inquiries";

// Follow-up messages on an inquiry, turning it into a conversation. The
// inquiry's own `message` stays the first customer message (the API
// composes it in), and `answer`/`answered_at` keep mirroring the first
// office reply for older screens.
export const hbsInquiryMessages = pgTable("hbs_inquiry_messages", {
  id: serial("id").primaryKey(),
  inquiryId: integer("inquiry_id").notNull().references(() => hbsInquiries.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  channel: text("channel").notNull().default("portal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_inquiry_messages_inquiry_idx").on(table.inquiryId, table.createdAt),
  check("hbs_inquiry_messages_role_check", sql`${table.authorRole} in ('customer', 'office')`),
  check("hbs_inquiry_messages_channel_check", sql`${table.channel} in ('portal', 'whatsapp')`),
]);

export type HbsInquiryMessage = typeof hbsInquiryMessages.$inferSelect;
