import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Web Push subscriptions (one per browser/device) keyed by the push
// service endpoint. A subscription the push service rejects (404/410) is
// deleted; other failures are stamped in failed_at.
export const hbsPushSubscriptions = pgTable("hbs_push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  userId: text("user_id").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
}, (table) => [
  index("hbs_push_subscriptions_user_idx").on(table.userId),
]);

export type HbsPushSubscription = typeof hbsPushSubscriptions.$inferSelect;
