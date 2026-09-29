import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Office access is assigned explicitly to an existing Clerk user ID.
// Registration alone never grants staff access.
export const hbsOfficeStaff = pgTable("hbs_office_staff", {
  userId: text("user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHbsOfficeStaffSchema = createInsertSchema(hbsOfficeStaff).omit({
  createdAt: true,
});
export type HbsOfficeStaffMember = typeof hbsOfficeStaff.$inferSelect;
export type InsertHbsOfficeStaffMember = z.infer<typeof insertHbsOfficeStaffSchema>;