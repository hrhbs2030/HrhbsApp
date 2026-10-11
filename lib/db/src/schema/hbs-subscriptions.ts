import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Monthly plans the office sells. Prices are in halalas before VAT; limits
// are null for unlimited.
export const hbsPlans = pgTable("hbs_plans", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceHalalas: integer("price_halalas").notNull(),
  employeeCap: integer("employee_cap"),
  requestsPerMonth: integer("requests_per_month"),
  // Whether the plan covers the automatic renewal requests raised from
  // document expiry reminders.
  autoRenewals: boolean("auto_renewals").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("hbs_plans_slug_unique").on(table.slug),
  check("hbs_plans_price_check", sql`${table.priceHalalas} >= 0`),
]);

// A company owner's subscription to a plan. At most one is active (or past
// due) per customer; a monthly invoice is issued at renews_at.
export const hbsSubscriptions = pgTable("hbs_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  planId: integer("plan_id").notNull().references(() => hbsPlans.id),
  status: text("status").notNull().default("active"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  renewsAt: timestamp("renews_at", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  // Whether expiring documents open renewal requests automatically.
  autoRenewRequests: boolean("auto_renew_requests").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("hbs_subscriptions_user_open_unique").on(table.userId).where(sql`${table.status} in ('active', 'past_due')`),
  index("hbs_subscriptions_user_idx").on(table.userId),
  // The renewal sweep: active subscriptions due for their next invoice.
  index("hbs_subscriptions_renews_idx").on(table.renewsAt).where(sql`${table.status} = 'active'`),
  check("hbs_subscriptions_status_check", sql`${table.status} in ('active', 'past_due', 'cancelled')`),
]);

export type HbsPlan = typeof hbsPlans.$inferSelect;
export type HbsSubscription = typeof hbsSubscriptions.$inferSelect;
