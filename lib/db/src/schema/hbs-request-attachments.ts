import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { hbsServiceRequests } from "./hbs-service-requests";

export const hbsRequestAttachments = pgTable("hbs_request_attachments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  requestId: integer("request_id").references(() => hbsServiceRequests.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_request_attachments_request_idx").on(table.requestId),
  index("hbs_request_attachments_user_idx").on(table.userId),
  uniqueIndex("hbs_request_attachments_path_unique").on(table.objectPath),
]);

export const insertHbsRequestAttachmentSchema = createInsertSchema(hbsRequestAttachments).omit({
  id: true, createdAt: true,
});
export type HbsRequestAttachment = typeof hbsRequestAttachments.$inferSelect;
export type InsertHbsRequestAttachment = z.infer<typeof insertHbsRequestAttachmentSchema>;