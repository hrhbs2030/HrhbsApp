import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { hbsServiceRequests } from "./hbs-service-requests";

// A customer's company file: the company itself, its employees and its
// licenses. The customer and office staff both maintain it; office changes
// are audited. Expiry dates here feed the document reminders
// (hbs_document_reminders rows linked by employee_id / license_id).
export const hbsCompanies = pgTable("hbs_companies", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  crNumber: text("cr_number"),
  unifiedNumber: text("unified_number"),
  vatNumber: text("vat_number"),
  city: text("city"),
  address: text("address"),
  activity: text("activity"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Identity and passport numbers are stored in full but shown masked; seeing
// a full number is a separate request, audited when office staff make it.
export const hbsCompanyEmployees = pgTable("hbs_company_employees", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  fullName: text("full_name").notNull(),
  nationality: text("nationality"),
  occupation: text("occupation"),
  idNumber: text("id_number"),
  passportNumber: text("passport_number"),
  iqamaExpiresOn: date("iqama_expires_on", { mode: "string" }),
  passportExpiresOn: date("passport_expires_on", { mode: "string" }),
  workPermitExpiresOn: date("work_permit_expires_on", { mode: "string" }),
  phone: text("phone"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_company_employees_user_idx").on(table.userId),
  check("hbs_company_employees_status_check", sql`${table.status} in ('active', 'left')`),
]);

export const hbsCompanyLicenses = pgTable("hbs_company_licenses", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  number: text("number"),
  issuedOn: date("issued_on", { mode: "string" }),
  expiresOn: date("expires_on", { mode: "string" }),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_company_licenses_user_idx").on(table.userId),
  check("hbs_company_licenses_kind_check", sql`${table.kind} in ('commercial_register', 'municipal', 'civil_defense', 'chamber', 'gosi', 'zakat_vat', 'other')`),
]);

// Messages between the customer and the office on one request. `channel`
// records where the message came from or also went (portal / WhatsApp) so
// the conversation shows it; WhatsApp replies are routed in by reference.
export const hbsRequestMessages = pgTable("hbs_request_messages", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => hbsServiceRequests.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  channel: text("channel").notNull().default("portal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_request_messages_request_idx").on(table.requestId, table.createdAt),
  check("hbs_request_messages_role_check", sql`${table.authorRole} in ('customer', 'office')`),
  check("hbs_request_messages_channel_check", sql`${table.channel} in ('portal', 'whatsapp')`),
]);

export type HbsCompany = typeof hbsCompanies.$inferSelect;
export type HbsCompanyEmployee = typeof hbsCompanyEmployees.$inferSelect;
export type HbsCompanyLicense = typeof hbsCompanyLicenses.$inferSelect;
export type HbsRequestMessage = typeof hbsRequestMessages.$inferSelect;
