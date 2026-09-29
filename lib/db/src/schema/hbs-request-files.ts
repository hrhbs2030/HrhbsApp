import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { hbsServiceRequests } from "./hbs-service-requests";

// Documents attached to a service request, by the customer or the office.
// The bytes live in private object storage under `storageKey`; this row is
// the only way to reach them. When a file is removed (by its uploader, the
// office, or the retention purge) the object is deleted and `deletedAt` set,
// so the request keeps a record that the file existed.
export const hbsRequestFiles = pgTable("hbs_request_files", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => hbsServiceRequests.id, { onDelete: "cascade" }),
  uploadedBy: text("uploaded_by").notNull(),
  uploaderRole: text("uploader_role").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedReason: text("deleted_reason"),
}, (table) => [
  index("hbs_request_files_request_idx").on(table.requestId),
  uniqueIndex("hbs_request_files_storage_key_unique").on(table.storageKey),
  check("hbs_request_files_role_check", sql`${table.uploaderRole} in ('customer', 'office')`),
  check("hbs_request_files_type_check", sql`${table.contentType} in ('application/pdf', 'image/jpeg', 'image/png')`),
  check("hbs_request_files_size_check", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 10485760`),
  check("hbs_request_files_deleted_reason_check", sql`${table.deletedReason} is null or ${table.deletedReason} in ('uploader', 'office', 'retention')`),
]);

export type HbsRequestFile = typeof hbsRequestFiles.$inferSelect;
