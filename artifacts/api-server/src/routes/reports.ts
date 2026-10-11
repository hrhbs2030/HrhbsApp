import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsAuditLog, hbsInvoices, hbsOfficeStaff, hbsServiceRequests } from "@workspace/db";
import { GetOfficeReportQueryParams, GetOfficeReportResponse } from "@workspace/api-zod";
import { approvedOfficeEmail, requireOfficeOwner } from "../lib/office-access";

const router: IRouter = Router();

// When each request was first completed, from the audit log (the same source
// as the customer's status history).
const firstCompleted = () => db.select({
  targetId: hbsAuditLog.targetId,
  completedAt: sql<Date>`min(${hbsAuditLog.createdAt})`.as("completed_at"),
}).from(hbsAuditLog).where(and(
  eq(hbsAuditLog.action, "service_request.update"),
  eq(hbsAuditLog.targetType, "service_request"),
  sql`${hbsAuditLog.details}->>'toStatus' = 'completed'`,
)).groupBy(hbsAuditLog.targetId).as("first_completed");

router.get("/office/reports", requireOfficeOwner, async (req, res): Promise<void> => {
  // Query values arrive as strings; the generated schema expects numbers.
  const raw = req.query.days;
  const query = GetOfficeReportQueryParams.safeParse({ days: typeof raw === "string" && /^\d{1,3}$/.test(raw) ? Number(raw) : raw });
  if (!query.success) { res.status(400).json({ error: "Invalid period" }); return; }
  const days = query.data.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const completedRows = firstCompleted();

  const [
    [created], [completion], byStatus, byCategory, topServices, staffRows, members, [ratings], distribution, [paid], [outstanding],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(hbsServiceRequests).where(gte(hbsServiceRequests.createdAt, since)),
    db.select({
      count: sql<number>`count(*)::int`,
      averageDays: sql<number | null>`round((avg(extract(epoch from (${completedRows.completedAt} - ${hbsServiceRequests.createdAt}))) / 86400)::numeric, 1)::float`,
    }).from(completedRows)
      .innerJoin(hbsServiceRequests, sql`${hbsServiceRequests.id}::text = ${completedRows.targetId}`)
      .where(gte(completedRows.completedAt, since)),
    db.select({ key: hbsServiceRequests.status, count: sql<number>`count(*)::int` }).from(hbsServiceRequests)
      .groupBy(hbsServiceRequests.status),
    db.select({ key: hbsServiceRequests.category, count: sql<number>`count(*)::int` }).from(hbsServiceRequests)
      .where(gte(hbsServiceRequests.createdAt, since)).groupBy(hbsServiceRequests.category),
    db.select({
      service: hbsServiceRequests.service,
      created: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${hbsServiceRequests.status} = 'completed')::int`,
    }).from(hbsServiceRequests).where(gte(hbsServiceRequests.createdAt, since))
      .groupBy(hbsServiceRequests.service).orderBy(desc(sql`count(*)`)).limit(10),
    db.select({
      userId: hbsServiceRequests.assignedTo,
      active: sql<number>`count(*) filter (where ${hbsServiceRequests.status} <> 'completed')::int`,
      completed: sql<number>`count(*) filter (where ${hbsServiceRequests.status} = 'completed' and ${completedRows.completedAt} >= ${since})::int`,
      overdue: sql<number>`count(*) filter (where ${hbsServiceRequests.status} <> 'completed' and ${hbsServiceRequests.dueAt} < now())::int`,
    }).from(hbsServiceRequests)
      .leftJoin(completedRows, sql`${hbsServiceRequests.id}::text = ${completedRows.targetId}`)
      .groupBy(hbsServiceRequests.assignedTo),
    db.select({ userId: hbsOfficeStaff.userId, email: hbsOfficeStaff.email }).from(hbsOfficeStaff),
    db.select({
      count: sql<number>`count(*)::int`,
      average: sql<number | null>`round(avg(${hbsServiceRequests.rating})::numeric, 2)::float`,
    }).from(hbsServiceRequests).where(and(isNotNull(hbsServiceRequests.rating), gte(hbsServiceRequests.ratedAt, since))),
    db.select({ key: sql<string>`${hbsServiceRequests.rating}::text`, count: sql<number>`count(*)::int` }).from(hbsServiceRequests)
      .where(and(isNotNull(hbsServiceRequests.rating), gte(hbsServiceRequests.ratedAt, since))).groupBy(hbsServiceRequests.rating),
    db.select({
      total: sql<number>`coalesce(sum(${hbsInvoices.totalHalalas}), 0)::bigint`.mapWith(Number),
      vat: sql<number>`coalesce(sum(${hbsInvoices.vatHalalas}), 0)::bigint`.mapWith(Number),
      count: sql<number>`count(*)::int`,
    }).from(hbsInvoices).where(and(eq(hbsInvoices.status, "paid"), gte(hbsInvoices.paidAt, since))),
    db.select({
      total: sql<number>`coalesce(sum(${hbsInvoices.totalHalalas}), 0)::bigint`.mapWith(Number),
      count: sql<number>`count(*)::int`,
    }).from(hbsInvoices).where(eq(hbsInvoices.status, "issued")),
  ]);

  const emails = new Map(members.map(m => [m.userId, m.email ?? approvedOfficeEmail()]));
  const counts = new Map(distribution.map(d => [d.key, d.count]));
  res.json(GetOfficeReportResponse.parse({
    days,
    created: created.count,
    completed: completion.count,
    averageCompletionDays: completion.averageDays,
    byStatus,
    byCategory,
    topServices,
    staff: staffRows
      .filter(row => row.active || row.completed || row.overdue)
      .map(row => ({ ...row, email: row.userId ? emails.get(row.userId) ?? null : null }))
      .sort((a, b) => (a.userId === null ? 1 : 0) - (b.userId === null ? 1 : 0) || b.active - a.active),
    ratings: {
      count: ratings.count,
      average: ratings.average,
      distribution: ["5", "4", "3", "2", "1"].map(key => ({ key, count: counts.get(key) ?? 0 })),
    },
    revenue: {
      paidTotal: paid.total, paidVat: paid.vat, paidCount: paid.count,
      outstandingTotal: outstanding.total, outstandingCount: outstanding.count,
    },
  }));
});

export default router;
