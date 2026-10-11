import { clerkClient, getAuth } from "@clerk/express";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, hbsCompanies, hbsCompanyMembers, hbsRegistrationRequests, type HbsCompanyMember } from "@workspace/db";
import {
  GetCompanyMembershipResponse, InviteCompanyMemberBody, InviteCompanyMemberResponse, ListCompanyMembersResponse,
  ListOfficeCustomerMembersParams, ListOfficeCustomerMembersResponse, RemoveCompanyMemberParams,
  UpdateCompanyMemberBody, UpdateCompanyMemberParams, UpdateCompanyMemberResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import {
  COMPANY_ROLES, companyAccessOf, companyPermissions, forgetVerifiedEmails, hasCustomerApproval, normalizeEmail,
  requireCompanyRole, resolveCompanyAccess, type CompanyRole,
} from "../lib/company-access";
import { customerEmail } from "../lib/customer-contact";
import { requireOfficeStaff } from "../lib/office-access";
import { verifiedEmailOf } from "../lib/office-access-rules";
import { companyInviteMail, notify } from "../lib/notify";

// Company members (multi-user company). The owner is implicit: ownership is
// hbs_companies.user_id itself, reported first as role 'owner' with id 0.
// Invitations are rows in hbs_company_members, pending until the invited
// person signs in with that email (lib/company-access accepts them).
const router: IRouter = Router();

export const MAX_COMPANY_MEMBERS = 10;

function member(row: HbsCompanyMember) {
  return {
    id: row.id, email: row.email, role: row.role as CompanyRole, memberUserId: row.memberUserId,
    invitedAt: row.invitedAt, acceptedAt: row.acceptedAt,
  };
}

// The owner's row first, then invitations by date. The owner's address is
// the one they registered with (or their verified sign-in email).
async function membersOf(companyUserId: string) {
  const [[company], [registration], email, rows] = await Promise.all([
    db.select({ updatedAt: hbsCompanies.updatedAt }).from(hbsCompanies).where(eq(hbsCompanies.userId, companyUserId)).limit(1),
    db.select({ createdAt: hbsRegistrationRequests.createdAt }).from(hbsRegistrationRequests)
      .where(eq(hbsRegistrationRequests.userId, companyUserId)).limit(1),
    customerEmail(companyUserId),
    db.select().from(hbsCompanyMembers).where(eq(hbsCompanyMembers.companyUserId, companyUserId))
      .orderBy(asc(hbsCompanyMembers.invitedAt), asc(hbsCompanyMembers.id)),
  ]);
  const since = registration?.createdAt ?? company?.updatedAt ?? new Date();
  return [
    { id: 0, email: email ?? "", role: "owner" as const, memberUserId: companyUserId, invitedAt: since, acceptedAt: since },
    ...rows.map(member),
  ];
}

const owner = (req: Request) => getAuth(req).userId!;

async function memberCount(companyUserId: string) {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(hbsCompanyMembers)
    .where(eq(hbsCompanyMembers.companyUserId, companyUserId));
  return count;
}

// The invited person's Clerk account, when one already holds that address
// verified: the invitation is then accepted at once.
async function clerkUserWithVerifiedEmail(email: string): Promise<string | null> {
  const { data } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  return data.find(candidate => verifiedEmailOf(candidate, email))?.id ?? null;
}

function memberId(req: Request, res: Response): number | null {
  const params = UpdateCompanyMemberParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Member not found" }); return null; }
  return params.data.id;
}

// ---- owner and members --------------------------------------------------------------

const anyMember = requireCompanyRole(companyPermissions.read, 404);
const ownerOnly = requireCompanyRole(companyPermissions.members);

router.get("/company/members", anyMember, async (_req, res): Promise<void> => {
  res.json(ListCompanyMembersResponse.parse(await membersOf(companyAccessOf(res).companyUserId)));
});

router.post("/company/members", ownerOnly, async (req, res): Promise<void> => {
  // Addresses are compared in one spelling: trimmed and lower-cased.
  const raw = req.body as { email?: unknown } | null;
  const body = InviteCompanyMemberBody.safeParse(
    raw && typeof raw.email === "string" ? { ...raw, email: normalizeEmail(raw.email) } : raw);
  if (!body.success) { res.status(400).json({ error: "اكتب بريدًا صحيحًا واختر صلاحية." }); return; }
  const companyUserId = companyAccessOf(res).companyUserId;
  const email = body.data.email;
  const ownEmail = await customerEmail(companyUserId);
  if (ownEmail && normalizeEmail(ownEmail) === email) { res.status(400).json({ error: "هذا بريدك أنت؛ أنت مالك المنشأة." }); return; }
  const [duplicate] = await db.select({ id: hbsCompanyMembers.id }).from(hbsCompanyMembers)
    .where(and(eq(hbsCompanyMembers.companyUserId, companyUserId), eq(hbsCompanyMembers.email, email))).limit(1);
  if (duplicate) { res.status(409).json({ error: "هذا البريد مدعو من قبل." }); return; }
  if (await memberCount(companyUserId) >= MAX_COMPANY_MEMBERS) {
    res.status(409).json({ error: `يمكن إضافة ${MAX_COMPANY_MEMBERS} أعضاء على الأكثر.` }); return;
  }
  const existingUserId = await clerkUserWithVerifiedEmail(email);
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(hbsCompanyMembers).values({
      companyUserId, email, role: body.data.role, invitedBy: owner(req),
      ...(existingUserId ? { memberUserId: existingUserId, acceptedAt: new Date() } : {}),
    }).onConflictDoNothing().returning();
    if (!created) return null;
    await recordAudit(tx, {
      actorId: owner(req), action: "company.member_invite", targetType: "customer", targetId: companyUserId,
      details: { memberId: created.id, email, role: created.role, accepted: Boolean(existingUserId) },
    });
    return created;
  });
  // Lost the race with an identical invitation.
  if (!row) { res.status(409).json({ error: "هذا البريد مدعو من قبل." }); return; }
  if (existingUserId) forgetVerifiedEmails(existingUserId);
  res.status(201).json(InviteCompanyMemberResponse.parse(member(row)));
  const [[company], [registration]] = await Promise.all([
    db.select({ name: hbsCompanies.name }).from(hbsCompanies).where(eq(hbsCompanies.userId, companyUserId)).limit(1),
    db.select({ fullName: hbsRegistrationRequests.fullName }).from(hbsRegistrationRequests)
      .where(eq(hbsRegistrationRequests.userId, companyUserId)).limit(1),
  ]);
  notify(companyInviteMail(email, company?.name ?? null, row.role, registration?.fullName ?? null));
});

router.patch("/company/members/:id", ownerOnly, async (req, res): Promise<void> => {
  const id = memberId(req, res);
  if (!id) return;
  const body = UpdateCompanyMemberBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "اختر صلاحية صحيحة." }); return; }
  const companyUserId = companyAccessOf(res).companyUserId;
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(hbsCompanyMembers).set({ role: body.data.role })
      .where(and(eq(hbsCompanyMembers.id, id), eq(hbsCompanyMembers.companyUserId, companyUserId))).returning();
    if (!updated) return null;
    await recordAudit(tx, {
      actorId: owner(req), action: "company.member_update", targetType: "customer", targetId: companyUserId,
      details: { memberId: updated.id, role: updated.role },
    });
    return updated;
  });
  if (!row) { res.status(404).json({ error: "Member not found" }); return; }
  res.json(UpdateCompanyMemberResponse.parse(member(row)));
});

router.delete("/company/members/:id", ownerOnly, async (req, res): Promise<void> => {
  const params = RemoveCompanyMemberParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Member not found" }); return; }
  const companyUserId = companyAccessOf(res).companyUserId;
  const row = await db.transaction(async tx => {
    const [removed] = await tx.delete(hbsCompanyMembers)
      .where(and(eq(hbsCompanyMembers.id, params.data.id), eq(hbsCompanyMembers.companyUserId, companyUserId))).returning();
    if (!removed) return null;
    await recordAudit(tx, {
      actorId: owner(req), action: "company.member_remove", targetType: "customer", targetId: companyUserId,
      details: { memberId: removed.id, role: removed.role, accepted: removed.acceptedAt !== null },
    });
    return removed;
  });
  if (!row) { res.status(404).json({ error: "Member not found" }); return; }
  res.status(204).end();
});

router.get("/company/membership", async (req, res): Promise<void> => {
  if (!getAuth(req).userId) { res.status(401).json({ error: "Sign in to continue" }); return; }
  const access = await resolveCompanyAccess(req);
  if (!access || !COMPANY_ROLES.includes(access.role)) { res.status(404).json({ error: "Not a company owner or member" }); return; }
  const [company] = await db.select({ name: hbsCompanies.name }).from(hbsCompanies).where(eq(hbsCompanies.userId, access.companyUserId)).limit(1);
  res.json(GetCompanyMembershipResponse.parse({ role: access.role, companyUserId: access.companyUserId, companyName: company?.name ?? null }));
});

// ---- office ------------------------------------------------------------------------------

router.get("/office/customers/:userId/members", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = ListOfficeCustomerMembersParams.safeParse(req.params);
  if (!params.success || !(await hasCustomerApproval(params.data.userId))) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(ListOfficeCustomerMembersResponse.parse(await membersOf(params.data.userId)));
});

export default router;
