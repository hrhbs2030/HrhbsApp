import { clerkClient, getAuth } from "@clerk/express";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Request, RequestHandler, Response } from "express";
import { db, hbsCompanies, hbsCompanyMembers, hbsInquiries, hbsRegistrationRequests, hbsServiceRequests } from "@workspace/db";

// Who may work in a company's portal (the /company routes) and as what.
//
// A company is identified by its owner's user ID (hbs_companies.user_id).
// The owner is implicit; everyone else is a row in hbs_company_members with
// a role, pending until the invited person signs in with that email.
//
// Shown to a member whose role does not allow the action.
export const COMPANY_ACCESS_DENIED = "ليست لديك صلاحية لهذا الإجراء.";

export type CompanyRole = "owner" | "hr" | "finance" | "viewer";
export type CompanyAccess = { companyUserId: string; role: CompanyRole };

export const COMPANY_ROLES: CompanyRole[] = ["owner", "hr", "finance", "viewer"];
export const MEMBER_ROLES = ["hr", "finance", "viewer"] as const;

// What each role may do. viewer reads everything under /company; hr also
// maintains employees, licenses, imports and reminders; finance also acts on
// invoices and the subscription; the owner does everything, members included.
export const companyPermissions = {
  read: COMPANY_ROLES,
  company: ["owner"],
  people: ["owner", "hr"],
  reveal: ["owner", "hr"],
  billing: ["owner", "finance"],
  members: ["owner"],
} as const satisfies Record<string, readonly CompanyRole[]>;

// ---- customer approval ---------------------------------------------------------

export async function hasLegacyCustomerData(userId: string): Promise<boolean> {
  const [request] = await db.select({ id: hbsServiceRequests.id })
    .from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, userId)).limit(1);
  if (request) return true;
  const [inquiry] = await db.select({ id: hbsInquiries.id })
    .from(hbsInquiries).where(eq(hbsInquiries.userId, userId)).limit(1);
  return !!inquiry;
}

// Approved registrations, plus anyone with requests or inquiries from before
// registration existed.
export async function hasCustomerApproval(userId: string): Promise<boolean> {
  const [registration] = await db.select({ status: hbsRegistrationRequests.status })
    .from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, userId))
    .limit(1);
  return registration?.status === "approved" || hasLegacyCustomerData(userId);
}

// ---- verified emails -------------------------------------------------------------

// A signed-in user's verified addresses are remembered briefly, so a page
// that polls does not spend a Clerk Backend API call on every request.
const EMAILS_TTL_MS = 60_000;
const EMAILS_MAX = 5_000;
const verifiedEmailsCache = new Map<string, { emails: string[]; until: number }>();

export async function verifiedEmailsOf(userId: string): Promise<string[]> {
  const cached = verifiedEmailsCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.emails;
  const user = await clerkClient.users.getUser(userId);
  const emails = user.emailAddresses
    .filter(entry => entry.verification?.status === "verified")
    .map(entry => entry.emailAddress.trim().toLowerCase());
  if (verifiedEmailsCache.size >= EMAILS_MAX) {
    const now = Date.now();
    for (const [id, entry] of verifiedEmailsCache) if (entry.until <= now) verifiedEmailsCache.delete(id);
    if (verifiedEmailsCache.size >= EMAILS_MAX) verifiedEmailsCache.delete(verifiedEmailsCache.keys().next().value!);
  }
  verifiedEmailsCache.set(userId, { emails, until: Date.now() + EMAILS_TTL_MS });
  return emails;
}

// Tests and the invitation flow forget a user's cached addresses.
export function forgetVerifiedEmails(userId?: string) {
  if (userId) verifiedEmailsCache.delete(userId); else verifiedEmailsCache.clear();
}

// Invitations are stored in this spelling and matched against it.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// ---- resolution ------------------------------------------------------------------

const memberRole = (role: string): CompanyRole => (MEMBER_ROLES as readonly string[]).includes(role) ? role as CompanyRole : "viewer";

// The company the signed-in user works in, and their role there:
//   1. their own company (a company row, or an approved customer who has not
//      filled the company file yet) → owner;
//   2. a membership they accepted → its role;
//   3. a pending invitation addressed to one of their verified Clerk emails →
//      accepted now (member_user_id, accepted_at) and returned.
// The acceptance in 3 is the only write. Null when none applies.
export async function resolveCompanyAccess(req: Request): Promise<CompanyAccess | null> {
  const userId = getAuth(req).userId;
  if (!userId) return null;
  return resolveCompanyAccessFor(userId);
}

export async function resolveCompanyAccessFor(userId: string): Promise<CompanyAccess | null> {
  const [own] = await db.select({ userId: hbsCompanies.userId }).from(hbsCompanies).where(eq(hbsCompanies.userId, userId)).limit(1);
  if (own) return { companyUserId: userId, role: "owner" };

  const [accepted] = await db.select({ companyUserId: hbsCompanyMembers.companyUserId, role: hbsCompanyMembers.role })
    .from(hbsCompanyMembers).where(eq(hbsCompanyMembers.memberUserId, userId))
    .orderBy(asc(hbsCompanyMembers.acceptedAt), asc(hbsCompanyMembers.id)).limit(1);
  if (accepted) return { companyUserId: accepted.companyUserId, role: memberRole(accepted.role) };

  // A customer's own (not yet filled) company comes before invitations
  // elsewhere, so a customer is never turned into another company's member.
  if (await hasCustomerApproval(userId)) return { companyUserId: userId, role: "owner" };

  const emails = await verifiedEmailsOf(userId);
  if (!emails.length) return null;
  const [pending] = await db.select({ id: hbsCompanyMembers.id })
    .from(hbsCompanyMembers)
    .where(and(isNull(hbsCompanyMembers.memberUserId), inArray(hbsCompanyMembers.email, emails)))
    .orderBy(asc(hbsCompanyMembers.invitedAt), asc(hbsCompanyMembers.id)).limit(1);
  if (!pending) return null;
  const [joined] = await db.update(hbsCompanyMembers).set({ memberUserId: userId, acceptedAt: new Date() })
    .where(and(eq(hbsCompanyMembers.id, pending.id), isNull(hbsCompanyMembers.memberUserId))).returning();
  // Withdrawn between the two statements: nothing to join.
  if (!joined) return null;
  return { companyUserId: joined.companyUserId, role: memberRole(joined.role) };
}

// ---- middleware ------------------------------------------------------------------

// Set by requireCompanyRole for the handler.
export function companyAccessOf(res: Response): CompanyAccess {
  const access = res.locals.companyAccess as CompanyAccess | undefined;
  if (!access) throw new Error("requireCompanyRole must run before this handler");
  return access;
}

// Signed in, working in a company, and holding one of the allowed roles.
// Someone with no company at all gets `missing` (403 like the customer
// approval check, or 404 where the contract says so); a member whose role
// does not allow the action gets 403 with the Arabic message.
export function requireCompanyRole(allowed: readonly CompanyRole[], missing: 403 | 404 = 403): RequestHandler {
  return async (req, res, next) => {
    if (!getAuth(req).userId) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    const access = await resolveCompanyAccess(req);
    if (!access) {
      res.status(missing).json({ error: missing === 404 ? "Not a company owner or member" : "Customer registration approval required" });
      return;
    }
    if (!allowed.includes(access.role)) {
      res.status(403).json({ error: COMPANY_ACCESS_DENIED });
      return;
    }
    res.locals.companyAccess = access;
    next();
  };
}
