import { clerkClient, getAuth } from "@clerk/express";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsAssignmentRules, hbsAuditLog, hbsOfficeStaff, type HbsOfficeStaffMember } from "@workspace/db";
import {
  AddOfficeStaffBody,
  AddOfficeStaffResponse,
  ListOfficeAssigneesResponse,
  ListAssignmentRulesResponse,
  SaveAssignmentRuleBody,
  SaveAssignmentRuleParams,
  SaveAssignmentRuleResponse,
  ListOfficeAuditLogResponse,
  ListOfficeStaffResponse,
  RemoveOfficeStaffParams,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import {
  approvedOfficeEmail,
  clerkUsersById,
  requireOfficeOwner,
  requireOfficeStaff,
  verifiedEmailOf,
} from "../lib/office-access";

const router: IRouter = Router();
const AUDIT_LOG_LIMIT = 200;

function staffMember(record: HbsOfficeStaffMember, ownerEmail: string | null) {
  return {
    userId: record.userId,
    email: record.email ?? ownerEmail,
    role: record.email ? "staff" as const : "owner" as const,
    addedBy: record.addedBy,
    createdAt: record.createdAt,
  };
}

router.get("/office/staff", requireOfficeOwner, async (_req, res): Promise<void> => {
  const records = await db.select().from(hbsOfficeStaff).orderBy(hbsOfficeStaff.createdAt);
  const approvedEmail = approvedOfficeEmail();
  const ownerIds = records.filter((record) => !record.email).map((record) => record.userId);
  const owners = approvedEmail ? await clerkUsersById(ownerIds) : new Map();
  res.json(ListOfficeStaffResponse.parse(records.map((record) => staffMember(
    record,
    approvedEmail ? verifiedEmailOf(owners.get(record.userId), approvedEmail) : null,
  ))));
});

// Who a request can be assigned to. Visible to all staff, unlike the team page.
router.get("/office/assignees", requireOfficeStaff, async (_req, res): Promise<void> => {
  const records = await db.select().from(hbsOfficeStaff).orderBy(hbsOfficeStaff.createdAt);
  const ownerEmail = approvedOfficeEmail();
  res.json(ListOfficeAssigneesResponse.parse(records.map((record) => ({
    userId: record.userId,
    email: record.email ?? ownerEmail,
    role: record.email ? "staff" as const : "owner" as const,
  }))));
});

const categories = ["passports", "labor", "business", "other"] as const;

router.get("/office/assignment-rules", requireOfficeOwner, async (_req, res): Promise<void> => {
  const rows = new Map((await db.select().from(hbsAssignmentRules)).map(r => [r.category, r]));
  res.json(ListAssignmentRulesResponse.parse(categories.map(category => {
    const row = rows.get(category);
    return { category, assignee: row?.assignee ?? null, dueDays: row?.dueDays ?? null, updatedAt: row?.updatedAt ?? null };
  })));
});

router.put("/office/assignment-rules/:category", requireOfficeOwner, async (req, res): Promise<void> => {
  const params = SaveAssignmentRuleParams.safeParse(req.params);
  const body = SaveAssignmentRuleBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid rule" }); return; }
  const assignee = body.data.assignee || null;
  if (assignee) {
    const [member] = await db.select({ userId: hbsOfficeStaff.userId }).from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, assignee)).limit(1);
    if (!member) { res.status(400).json({ error: "Choose an office member." }); return; }
  }
  const actorId = getAuth(req).userId!;
  const values = { assignee, dueDays: body.data.dueDays, updatedBy: actorId, updatedAt: new Date() };
  const row = await db.transaction(async tx => {
    const [saved] = await tx.insert(hbsAssignmentRules).values({ category: params.data.category, ...values })
      .onConflictDoUpdate({ target: hbsAssignmentRules.category, set: values }).returning();
    await recordAudit(tx, {
      actorId, action: "automation.update", targetType: "assignment_rule", targetId: saved.category,
      details: { assignee: saved.assignee, dueDays: saved.dueDays },
    });
    return saved;
  });
  res.json(SaveAssignmentRuleResponse.parse({ category: row.category, assignee: row.assignee, dueDays: row.dueDays, updatedAt: row.updatedAt }));
});

router.post("/office/staff", requireOfficeOwner, async (req, res): Promise<void> => {
  const parsed = AddOfficeStaffBody.safeParse(req.body);
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
  if (!parsed.success || !email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (email === approvedOfficeEmail()) {
    res.status(409).json({ error: "The office owner already has access." });
    return;
  }

  const { data } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  const user = data.find((candidate) => verifiedEmailOf(candidate, email));
  if (!user) {
    res.status(404).json({ error: "No existing account has this verified email address." });
    return;
  }

  const actorId = getAuth(req).userId!;
  const record = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(hbsOfficeStaff)
      .values({ userId: user.id, email, addedBy: actorId })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await recordAudit(tx, {
        actorId, action: "staff.add", targetType: "staff", targetId: inserted.userId, details: { email },
      });
    }
    return inserted;
  });
  if (!record) {
    res.status(409).json({ error: "This account already has office access." });
    return;
  }
  res.status(201).json(AddOfficeStaffResponse.parse(staffMember(record, null)));
});

router.delete("/office/staff/:userId", requireOfficeOwner, async (req, res): Promise<void> => {
  const params = RemoveOfficeStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid user ID." });
    return;
  }
  const actorId = getAuth(req).userId!;
  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(hbsOfficeStaff)
      .where(eq(hbsOfficeStaff.userId, params.data.userId)).for("update");
    if (!existing) return "missing" as const;
    if (!existing.email) return "owner" as const;
    await tx.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, existing.userId));
    await recordAudit(tx, {
      actorId, action: "staff.remove", targetType: "staff", targetId: existing.userId,
      details: { email: existing.email },
    });
    return "removed" as const;
  });
  if (outcome === "missing") {
    res.status(404).json({ error: "Staff account not found." });
    return;
  }
  if (outcome === "owner") {
    res.status(400).json({ error: "The office owner cannot be removed." });
    return;
  }
  res.status(204).end();
});

router.get("/office/audit-log", requireOfficeOwner, async (_req, res): Promise<void> => {
  const rows = await db.select({ entry: hbsAuditLog, staff: hbsOfficeStaff })
    .from(hbsAuditLog)
    .leftJoin(hbsOfficeStaff, eq(hbsAuditLog.actorId, hbsOfficeStaff.userId))
    .orderBy(desc(hbsAuditLog.createdAt), desc(hbsAuditLog.id))
    .limit(AUDIT_LOG_LIMIT);
  const ownerEmail = approvedOfficeEmail();
  res.json(ListOfficeAuditLogResponse.parse(rows.map(({ entry, staff }) => ({
    id: entry.id,
    actorId: entry.actorId,
    actorEmail: staff ? staff.email ?? ownerEmail : null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details,
    createdAt: entry.createdAt,
  }))));
});

export default router;