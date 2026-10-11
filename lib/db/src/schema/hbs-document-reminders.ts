import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { hbsCompanyEmployees, hbsCompanyLicenses } from "./hbs-company";

// A customer's document expiry date (iqama, passport, commercial register,
// work permit...). The reminder job emails the customer before it expires.
// No document number is stored: the label names whose document it is.
export const hbsDocumentReminders = pgTable("hbs_document_reminders", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  expiresOn: date("expires_on", { mode: "string" }).notNull(),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  // The last reminder sent, in days before expiry (30, 7 or 1). Reset when
  // the expiry date changes.
  lastReminderDays: integer("last_reminder_days"),
  // Set when the date comes from the company file; it is then edited there.
  employeeId: integer("employee_id").references(() => hbsCompanyEmployees.id, { onDelete: "cascade" }),
  licenseId: integer("license_id").references(() => hbsCompanyLicenses.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_document_reminders_user_idx").on(table.userId),
  index("hbs_document_reminders_expires_idx").on(table.expiresOn),
  uniqueIndex("hbs_document_reminders_employee_kind_unique").on(table.employeeId, table.kind),
  uniqueIndex("hbs_document_reminders_license_unique").on(table.licenseId),
  check("hbs_document_reminders_kind_check", sql`${table.kind} in ('iqama', 'passport', 'commercial_register', 'work_permit', 'other')`),
]);

export type HbsDocumentReminder = typeof hbsDocumentReminders.$inferSelect;
