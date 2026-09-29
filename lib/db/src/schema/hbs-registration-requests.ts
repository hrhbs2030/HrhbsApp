import { sql } from "drizzle-orm";
import { check, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hbsRegistrationRequests = pgTable("hbs_registration_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  reviewerId: text("reviewer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("hbs_registration_requests_user_id_unique").on(table.userId),
  check("hbs_registration_requests_status_check", sql`${table.status} in ('pending', 'approved', 'rejected')`),
]);

export const insertHbsRegistrationRequestSchema = createInsertSchema(hbsRegistrationRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type HbsRegistrationRequest = typeof hbsRegistrationRequests.$inferSelect;
export type InsertHbsRegistrationRequest = z.infer<typeof insertHbsRegistrationRequestSchema>;