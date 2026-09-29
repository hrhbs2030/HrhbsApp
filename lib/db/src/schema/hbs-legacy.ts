import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hbsLegacyImports = pgTable("hbs_legacy_imports", {
  id: serial("id").primaryKey(),
  digest: text("digest").notNull().unique(),
  exportedAt: text("exported_at").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  importedBy: text("imported_by").notNull(),
}, (table) => [index("hbs_legacy_imports_date_idx").on(table.importedAt)]);

export const hbsLegacyRecords = pgTable("hbs_legacy_records", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => hbsLegacyImports.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  legacyId: text("legacy_id").notNull(),
  // Office-only original record. Never join this table to portal customer accounts.
  data: jsonb("data").notNull(),
}, (table) => [uniqueIndex("hbs_legacy_records_source_idx").on(table.importId, table.kind, table.legacyId)]);

export const insertHbsLegacyImportSchema = createInsertSchema(hbsLegacyImports).omit({ id: true, importedAt: true });
export const insertHbsLegacyRecordSchema = createInsertSchema(hbsLegacyRecords).omit({ id: true });
export type HbsLegacyImport = typeof hbsLegacyImports.$inferSelect;
export type InsertHbsLegacyImport = z.infer<typeof insertHbsLegacyImportSchema>;