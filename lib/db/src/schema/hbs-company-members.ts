import { sql } from "drizzle-orm";
import { check, index, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { hbsCompanies } from "./hbs-company";

// People the company owner invited to work in the company's portal. The
// owner is not a row here: ownership is the hbs_companies.user_id itself and
// is reported as role 'owner' in responses. A row is pending until the
// invited person signs in with the same email (member_user_id, accepted_at).
export const hbsCompanyMembers = pgTable("hbs_company_members", {
  id: serial("id").primaryKey(),
  // The owner's user ID, which identifies the company.
  companyUserId: text("company_user_id").notNull().references(() => hbsCompanies.userId, { onDelete: "cascade" }),
  memberUserId: text("member_user_id"),
  email: text("email").notNull(),
  role: text("role").notNull(),
  invitedBy: text("invited_by").notNull(),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("hbs_company_members_company_email_unique").on(table.companyUserId, table.email),
  index("hbs_company_members_member_idx").on(table.memberUserId),
  check("hbs_company_members_role_check", sql`${table.role} in ('hr', 'finance', 'viewer')`),
]);

export type HbsCompanyMember = typeof hbsCompanyMembers.$inferSelect;
