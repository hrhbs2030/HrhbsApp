import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// When a user last opened a conversation (request or inquiry). Unread
// counts are messages by the other side newer than this; no row means
// nothing was read yet.
export const hbsThreadReads = pgTable("hbs_thread_reads", {
  userId: text("user_id").notNull(),
  threadType: text("thread_type").notNull(),
  threadId: integer("thread_id").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.threadType, table.threadId] }),
  check("hbs_thread_reads_type_check", sql`${table.threadType} in ('request', 'inquiry')`),
]);

export type HbsThreadRead = typeof hbsThreadReads.$inferSelect;
