import { index, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hbsServiceRequests = pgTable("hbs_service_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  service: text("service").notNull(),
  description: text("description").notNull(),
  contactPhone: text("contact_phone").notNull(),
  status: text("status").notNull().default("received"),
  officeNote: text("office_note"),
  customerMessage: text("customer_message"),
  clientRequestId: text("client_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hbs_service_requests_user_idx").on(table.userId),
  uniqueIndex("hbs_service_requests_user_client_request_idx").on(table.userId, table.clientRequestId),
]);

export const insertHbsServiceRequestSchema = createInsertSchema(hbsServiceRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type HbsServiceRequest = typeof hbsServiceRequests.$inferSelect;
export type InsertHbsServiceRequest = z.infer<typeof insertHbsServiceRequestSchema>;