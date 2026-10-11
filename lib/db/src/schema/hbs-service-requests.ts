import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { hbsCompanyEmployees, hbsCompanyLicenses } from "./hbs-company";
import { z } from "zod/v4";

export const hbsServiceRequests = pgTable("hbs_service_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  service: text("service").notNull(),
  description: text("description").notNull(),
  contactPhone: text("contact_phone").notNull(),
  status: text("status").notNull().default("received"),
  officeNote: text("office_note"),
  customerMessage: text("customer_message"),
  clientRequestId: text("client_request_id"),
  // Office staff member responsible for the request, and the date it should be done by.
  assignedTo: text("assigned_to"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  // The customer's rating (1-5) once the request is completed; given once.
  rating: integer("rating"),
  ratingComment: text("rating_comment"),
  ratedAt: timestamp("rated_at", { withTimezone: true }),
  // The employee or license the request is about, from the company file.
  employeeId: integer("employee_id").references(() => hbsCompanyEmployees.id, { onDelete: "set null" }),
  licenseId: integer("license_id").references(() => hbsCompanyLicenses.id, { onDelete: "set null" }),
  // Office quote before work starts (halalas before VAT). Accepting issues the
  // invoice; declining keeps the quote so the office can revise it.
  quoteHalalas: integer("quote_halalas"),
  quoteNote: text("quote_note"),
  quotedAt: timestamp("quoted_at", { withTimezone: true }),
  quoteAcceptedAt: timestamp("quote_accepted_at", { withTimezone: true }),
  quoteDeclinedAt: timestamp("quote_declined_at", { withTimezone: true }),
  quotedBy: text("quoted_by"),
  // Documents the customer must provide, copied from the service offer at
  // creation; attachments link to an item through checklist_key.
  documentChecklist: jsonb("document_checklist").$type<{ key: string; label: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_service_requests_user_idx").on(table.userId),
  index("hbs_service_requests_assigned_idx").on(table.assignedTo),
  uniqueIndex("hbs_service_requests_user_client_request_idx").on(table.userId, table.clientRequestId),
  // The office list: filtered by status, sorted by newest or by oldest update; overdue work by due date.
  index("hbs_service_requests_status_updated_idx").on(table.status, table.updatedAt.desc()),
  index("hbs_service_requests_created_idx").on(table.createdAt.desc(), table.id.desc()),
  index("hbs_service_requests_open_due_idx").on(table.dueAt).where(sql`${table.status} <> 'completed'`),
  check("hbs_service_requests_category_check", sql`${table.category} in ('passports', 'labor', 'business', 'other')`),
  check("hbs_service_requests_status_check", sql`${table.status} in ('received', 'reviewing', 'waiting_on_customer', 'submitted_to_authority', 'awaiting_payment', 'completed')`),
  check("hbs_service_requests_rating_check", sql`${table.rating} is null or ${table.rating} between 1 and 5`),
  check("hbs_service_requests_quote_check", sql`${table.quoteHalalas} is null or ${table.quoteHalalas} > 0`),
]);

export const insertHbsServiceRequestSchema = createInsertSchema(hbsServiceRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type HbsServiceRequest = typeof hbsServiceRequests.$inferSelect;
export type InsertHbsServiceRequest = z.infer<typeof insertHbsServiceRequestSchema>;