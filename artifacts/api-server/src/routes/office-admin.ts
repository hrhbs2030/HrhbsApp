import { clerkClient, getAuth } from "@clerk/express";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsAuditLog, hbsOfficeStaff, type HbsOfficeStaffMember } from "@workspace/db";
import {
  AddOfficeStaffBody,
  AddOfficeStaffResponse,
  ListOfficeAuditLogResponse,
  ListOfficeStaffResponse,
  RemoveOfficeStaffParams,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import {
  approvedOfficeEmail,
  clerkUsersById,
  forgetOfficeAccess,
  requireOfficeOwner,
  verifiedEmailOf,
} from "../lib/office-access";

const router: IRouter = Router();
const AUDIT_LOG_LIMIT = 200;

// Rows without an email were created for the owner of HBS_OFFICE_EMAIL.
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

router.post("/office/staff", requireOfficeOwner, async (req, res): Promise<void> => {
  const parsed = AddOfficeStaffBody.safeParse(req.body);
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
  if (!parsed.success || !email) {
    res.status(400).json({ error: "أدخل بريدًا إلكترونيًا صالحًا." });
    return;
  }
  if (email === approvedOfficeEmail()) {
    res.status(409).json({ error: "هذا بريد مالك المكتب، ولديه الصلاحية مسبقًا." });
    return;
  }

  const { data } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  const user = data.find((candidate) => verifiedEmailOf(candidate, email));
  if (!user) {
    res.status(404).json({ error: "لا يوجد حساب بهذا البريد بعد التحقق منه. اطلب من الموظف إنشاء حساب وتأكيد بريده أولًا." });
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
    res.status(409).json({ error: "هذا الحساب أو البريد لديه صلاحية المكتب مسبقًا." });
    return;
  }
  forgetOfficeAccess(record.userId);
  res.status(201).json(AddOfficeStaffResponse.parse(staffMember(record, null)));
});

router.delete("/office/staff/:userId", requireOfficeOwner, async (req, res): Promise<void> => {
  const params = RemoveOfficeStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح." });
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
    res.status(404).json({ error: "الموظف غير موجود." });
    return;
  }
  if (outcome === "owner") {
    res.status(400).json({ error: "لا يمكن إزالة حساب مالك المكتب من هنا." });
    return;
  }
  forgetOfficeAccess(params.data.userId);
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
