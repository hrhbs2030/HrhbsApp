import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hbsApprovedInformation = pgTable("hbs_approved_information", {
  id: serial("id").primaryKey(),
  draftTitle: text("draft_title").notNull(),
  draftContent: text("draft_content").notNull(),
  publishedTitle: text("published_title"),
  publishedContent: text("published_content"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  publishedReviewedAt: timestamp("published_reviewed_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApprovedInformationSchema = createInsertSchema(hbsApprovedInformation).pick({
  draftTitle: true, draftContent: true,
});
export type InsertApprovedInformation = z.infer<typeof insertApprovedInformationSchema>;
export type ApprovedInformation = typeof hbsApprovedInformation.$inferSelect;

// Historical snapshots are never read by the customer assistant.
export const hbsApprovedInformationHistory = pgTable("hbs_approved_information_history", {
  id: serial("id").primaryKey(),
  informationId: integer("information_id").notNull().references(() => hbsApprovedInformation.id),
  action: text("action").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
});

export type ApprovedInformationHistory = typeof hbsApprovedInformationHistory.$inferSelect;