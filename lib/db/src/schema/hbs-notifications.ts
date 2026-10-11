import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const NOTIFICATION_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
export type DeliveryOutcome = "sent" | "skipped" | "failed" | "held";

// One in-app notification per recipient. Office notifications fan out one
// row per staff member so each person has their own read state. Rows held
// for quiet hours or the daily digest carry deliver_after; the sweep sends
// them later and stamps digested_at.
export const hbsNotifications = pgTable("hbs_notifications", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  audience: text("audience").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  path: text("path"),
  priority: text("priority").notNull(),
  // Repeated events on the same target collapse into one row with a count.
  groupKey: text("group_key"),
  count: integer("count").notNull().default(1),
  targetType: text("target_type"),
  targetId: text("target_id"),
  dedupeKey: text("dedupe_key"),
  deliverAfter: timestamp("deliver_after", { withTimezone: true }),
  delivered: jsonb("delivered").$type<Record<string, DeliveryOutcome>>().notNull().default({}),
  digestedAt: timestamp("digested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [
  index("hbs_notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
  index("hbs_notifications_user_unread_idx").on(table.userId).where(sql`${table.readAt} is null`),
  uniqueIndex("hbs_notifications_dedupe_unique").on(table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  // The digest sweep: held rows not yet sent.
  index("hbs_notifications_deliver_after_idx").on(table.deliverAfter).where(sql`${table.deliverAfter} is not null and ${table.digestedAt} is null`),
  check("hbs_notifications_audience_check", sql`${table.audience} in ('customer', 'office')`),
  check("hbs_notifications_priority_check", sql`${table.priority} in ('urgent', 'high', 'normal', 'low')`),
]);

// Per-user delivery choices. Quiet hours are whole hours in Asia/Riyadh and
// may wrap past midnight (e.g. 22 → 7); both null means no quiet hours.
export const hbsNotificationPreferences = pgTable("hbs_notification_preferences", {
  userId: text("user_id").primaryKey(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  quietStart: smallint("quiet_start"),
  quietEnd: smallint("quiet_end"),
  digest: text("digest").notNull().default("instant"),
  mutedKinds: jsonb("muted_kinds").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("hbs_notification_preferences_quiet_start_check", sql`${table.quietStart} is null or (${table.quietStart} between 0 and 23)`),
  check("hbs_notification_preferences_quiet_end_check", sql`${table.quietEnd} is null or (${table.quietEnd} between 0 and 23)`),
  check("hbs_notification_preferences_digest_check", sql`${table.digest} in ('instant', 'daily')`),
]);

export type HbsNotification = typeof hbsNotifications.$inferSelect;
export type HbsNotificationPreferences = typeof hbsNotificationPreferences.$inferSelect;
