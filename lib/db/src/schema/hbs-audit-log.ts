import { index, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Append-only audit of office staff access changes.
export const hbsAuditLog = pgTable("hbs_audit_log", {
  id: serial("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_audit_log_created_idx").on(table.createdAt),
  // A request's status history is read by target, newest first.
  index("hbs_audit_log_target_idx").on(table.targetType, table.targetId, table.createdAt.desc()),
]);

export type HbsAuditLogEntry = typeof hbsAuditLog.$inferSelect;