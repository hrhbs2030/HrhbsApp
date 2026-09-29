import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Office access is assigned explicitly to an existing Clerk user ID.
// Rows without an email represent the verified HBS_OFFICE_EMAIL owner.
export const hbsOfficeStaff = pgTable("hbs_office_staff", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("hbs_office_staff_email_unique").on(table.email)]);

export const insertHbsOfficeStaffSchema = createInsertSchema(hbsOfficeStaff).omit({
  createdAt: true,
});
export type HbsOfficeStaffMember = typeof hbsOfficeStaff.$inferSelect;
export type InsertHbsOfficeStaffMember = z.infer<typeof insertHbsOfficeStaffSchema>;