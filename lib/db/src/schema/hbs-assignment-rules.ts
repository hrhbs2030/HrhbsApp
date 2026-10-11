import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// How new requests in a category are handled without anyone touching them:
// who they are assigned to and how many days the office gives itself.
export const hbsAssignmentRules = pgTable("hbs_assignment_rules", {
  category: text("category").primaryKey(),
  assignee: text("assignee"),
  dueDays: integer("due_days"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("hbs_assignment_rules_category_check", sql`${table.category} in ('passports', 'labor', 'business', 'other')`),
  check("hbs_assignment_rules_days_check", sql`${table.dueDays} is null or ${table.dueDays} between 1 and 90`),
]);

export type HbsAssignmentRule = typeof hbsAssignmentRules.$inferSelect;
