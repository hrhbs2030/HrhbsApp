import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { hbsServiceRequests } from "./hbs-service-requests";

export const hbsInquiries = pgTable("hbs_inquiries", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  linkedServiceRequestId: integer("linked_service_request_id").references(() => hbsServiceRequests.id, { onDelete: "set null" }),
  status: text("status").notNull().default("open"),
  answer: text("answer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (table) => [
  index("hbs_inquiries_user_idx").on(table.userId),
  check("hbs_inquiries_status_check", sql`${table.status} in ('open', 'answered')`),
]);

export const insertHbsInquirySchema = createInsertSchema(hbsInquiries).omit({
  id: true,
  createdAt: true,
  answeredAt: true,
});
export type HbsInquiry = typeof hbsInquiries.$inferSelect;
export type InsertHbsInquiry = z.infer<typeof insertHbsInquirySchema>;