import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// What the office publishes about a service in the website catalogue, keyed
// by the service slug (artifacts/hbs-solutions/src/content/services.ts).
// Prices, processing times and required documents come only from here, so
// nothing is shown until the office owner enters and publishes it.
export const hbsServiceOffers = pgTable("hbs_service_offers", {
  slug: text("slug").primaryKey(),
  // Office fee in halalas, before VAT. Null: priced after review.
  priceHalalas: integer("price_halalas"),
  // Government fees vary per case, so they are described rather than priced.
  governmentFeesNote: text("government_fees_note"),
  processingDays: integer("processing_days"),
  requiredDocuments: jsonb("required_documents").$type<string[]>().notNull().default([]),
  published: boolean("published").notNull().default(false),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("hbs_service_offers_price_check", sql`${table.priceHalalas} is null or ${table.priceHalalas} >= 0`),
  check("hbs_service_offers_days_check", sql`${table.processingDays} is null or ${table.processingDays} between 1 and 365`),
]);

export type HbsServiceOffer = typeof hbsServiceOffers.$inferSelect;
