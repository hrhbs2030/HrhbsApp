import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { hbsCompanyEmployees } from "./hbs-company";
import { hbsServiceRequests } from "./hbs-service-requests";

// A bulk request covers several employees from the company file; each one
// is tracked separately by the office (hbs_service_requests.employee_id
// still holds the single-employee case).
export const hbsRequestEmployees = pgTable("hbs_request_employees", {
  requestId: integer("request_id").notNull().references(() => hbsServiceRequests.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => hbsCompanyEmployees.id, { onDelete: "cascade" }),
  itemStatus: text("item_status").notNull().default("pending"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: "hbs_request_employees_pk", columns: [table.requestId, table.employeeId] }),
  index("hbs_request_employees_employee_idx").on(table.employeeId),
  check("hbs_request_employees_status_check", sql`${table.itemStatus} in ('pending', 'in_progress', 'done', 'blocked')`),
]);

export type HbsRequestEmployee = typeof hbsRequestEmployees.$inferSelect;
