import { and, desc, eq, sql } from "drizzle-orm";
import { db, hbsApprovedInformation, hbsApprovedInformationHistory, type ApprovedInformation } from "@workspace/db";
import {
  CreateApprovedInformationBody, CreateApprovedInformationResponse,
  ListApprovedInformationResponse, UpdateApprovedInformationBody,
  UpdateApprovedInformationResponse, ReviewApprovedInformationResponse,
  PublishApprovedInformationResponse, UnpublishApprovedInformationResponse,
  ReviewApprovedInformationBody, PublishApprovedInformationBody,
  UnpublishApprovedInformationBody,
  ListApprovedInformationHistoryResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireOfficeStaff } from "../lib/office-access";

const router: IRouter = Router();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Rows published before the history table existed also need a durable snapshot.
async function preserveCurrentPublication(tx: Transaction, row: ApprovedInformation) {
  if (!row.publishedAt || !row.publishedTitle || !row.publishedContent || !row.publishedReviewedAt) return;
  const [existing] = await tx.select({ id: hbsApprovedInformationHistory.id })
    .from(hbsApprovedInformationHistory)
    .where(and(eq(hbsApprovedInformationHistory.informationId, row.id),
      eq(hbsApprovedInformationHistory.action, "published"),
      eq(hbsApprovedInformationHistory.publishedAt, row.publishedAt))).limit(1);
  if (existing) return;
  await tx.insert(hbsApprovedInformationHistory).values({
    informationId: row.id, action: "published", title: row.publishedTitle,
    content: row.publishedContent, reviewedAt: row.publishedReviewedAt,
    publishedAt: row.publishedAt, changedAt: row.publishedAt,
  });
}

async function lockedInformation(tx: Transaction, id: number) {
  const [row] = await tx.select().from(hbsApprovedInformation)
    .where(eq(hbsApprovedInformation.id, id)).for("update");
  return row;
}

function matchesVersion(row: ApprovedInformation, expected: Date) {
  return Math.floor(row.updatedAt.getTime()) === expected.getTime();
}

function present(row: ApprovedInformation) {
  return {
    id: row.id, title: row.draftTitle, content: row.draftContent,
    publishedTitle: row.publishedTitle, publishedContent: row.publishedContent,
    reviewedAt: row.reviewedAt, publishedReviewedAt: row.publishedReviewedAt,
    publishedAt: row.publishedAt, updatedAt: row.updatedAt,
  };
}

router.get("/office/approved-information", requireOfficeStaff, async (_req, res): Promise<void> => {
  const rows = await db.select().from(hbsApprovedInformation).orderBy(hbsApprovedInformation.id);
  res.json(ListApprovedInformationResponse.parse(rows.map(present)));
});

router.get("/office/approved-information/:id/history", requireOfficeStaff, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid information" }); return; }
  const history = await db.transaction(async tx => {
    const row = await lockedInformation(tx, id);
    if (!row) return null;
    await preserveCurrentPublication(tx, row);
    return tx.select().from(hbsApprovedInformationHistory)
      .where(eq(hbsApprovedInformationHistory.informationId, id))
      .orderBy(desc(hbsApprovedInformationHistory.changedAt), desc(hbsApprovedInformationHistory.id));
  });
  if (!history) { res.status(404).json({ error: "Not found" }); return; }
  res.json(ListApprovedInformationHistoryResponse.parse(history));
});

router.post("/office/approved-information", requireOfficeStaff, async (req, res): Promise<void> => {
  const parsed = CreateApprovedInformationBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.title.trim() || !parsed.data.content.trim()) {
    res.status(400).json({ error: "Invalid information" }); return;
  }
  const [row] = await db.insert(hbsApprovedInformation).values({
    draftTitle: parsed.data.title.trim(), draftContent: parsed.data.content.trim(),
  }).returning();
  res.status(201).json(CreateApprovedInformationResponse.parse(present(row)));
});

router.patch("/office/approved-information/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UpdateApprovedInformationBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success ||
      !parsed.data.title.trim() || !parsed.data.content.trim()) {
    res.status(400).json({ error: "Invalid information" }); return;
  }
  const updatedAt = new Date(Math.max(Date.now(), parsed.data.expectedUpdatedAt.getTime() + 1));
  const [row] = await db.update(hbsApprovedInformation).set({
    draftTitle: parsed.data.title.trim(), draftContent: parsed.data.content.trim(),
    reviewedAt: null, updatedAt,
  }).where(and(
    eq(hbsApprovedInformation.id, id),
    sql`date_trunc('milliseconds', ${hbsApprovedInformation.updatedAt}) = ${parsed.data.expectedUpdatedAt}`,
  )).returning();
  if (!row) {
    const [existing] = await db.select({ id: hbsApprovedInformation.id })
      .from(hbsApprovedInformation).where(eq(hbsApprovedInformation.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    res.status(409).json({ error: "This information changed since you opened it. Refresh and review the latest version." });
    return;
  }
  res.json(UpdateApprovedInformationResponse.parse(present(row)));
});

router.post("/office/approved-information/:id/review", requireOfficeStaff, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ReviewApprovedInformationBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) { res.status(400).json({ error: "Invalid review" }); return; }
  const updatedAt = new Date(Math.max(Date.now(), parsed.data.expectedUpdatedAt.getTime() + 1));
  const [row] = await db.update(hbsApprovedInformation).set({ reviewedAt: updatedAt, updatedAt })
    .where(and(
      eq(hbsApprovedInformation.id, id),
      sql`date_trunc('milliseconds', ${hbsApprovedInformation.updatedAt}) = ${parsed.data.expectedUpdatedAt}`,
    )).returning();
  if (!row) {
    const [existing] = await db.select({ id: hbsApprovedInformation.id })
      .from(hbsApprovedInformation).where(eq(hbsApprovedInformation.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    res.status(409).json({ error: "This information changed since you opened it. Refresh and review the latest version." });
    return;
  }
  res.json(ReviewApprovedInformationResponse.parse(present(row)));
});

router.post("/office/approved-information/:id/publish", requireOfficeStaff, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = PublishApprovedInformationBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) { res.status(400).json({ error: "Invalid publish request" }); return; }
  const result = await db.transaction(async tx => {
    const before = await lockedInformation(tx, id);
    if (!before) return { status: 404 as const };
    if (!matchesVersion(before, parsed.data.expectedUpdatedAt)) return { status: 409 as const };
    if (!before.reviewedAt) return { status: 412 as const };
    await preserveCurrentPublication(tx, before);
    const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
    const [row] = await tx.update(hbsApprovedInformation).set({
      publishedTitle: before.draftTitle, publishedContent: before.draftContent,
      publishedReviewedAt: before.reviewedAt, publishedAt: updatedAt, updatedAt,
    }).where(eq(hbsApprovedInformation.id, id)).returning();
    await tx.insert(hbsApprovedInformationHistory).values({
      informationId: id, action: "published", title: before.draftTitle,
      content: before.draftContent, reviewedAt: before.reviewedAt,
      publishedAt: updatedAt, changedAt: updatedAt,
    });
    return { status: 200 as const, row };
  });
  if (result.status !== 200) {
    res.status(result.status === 404 ? 404 : 409).json({ error: result.status === 412
      ? "Review the current draft before publishing"
      : result.status === 404 ? "Not found" : "This information changed since you opened it. Refresh and review the latest version." });
    return;
  }
  const { row } = result;
  res.json(PublishApprovedInformationResponse.parse(present(row)));
});

router.post("/office/approved-information/:id/unpublish", requireOfficeStaff, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UnpublishApprovedInformationBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) { res.status(400).json({ error: "Invalid unpublish request" }); return; }
  const result = await db.transaction(async tx => {
    const before = await lockedInformation(tx, id);
    if (!before) return { status: 404 as const };
    if (!matchesVersion(before, parsed.data.expectedUpdatedAt)) return { status: 409 as const };
    await preserveCurrentPublication(tx, before);
    const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
    const [row] = await tx.update(hbsApprovedInformation).set({
      publishedTitle: null, publishedContent: null, publishedAt: null, publishedReviewedAt: null,
      updatedAt,
    }).where(eq(hbsApprovedInformation.id, id)).returning();
    if (before.publishedAt && before.publishedTitle && before.publishedContent && before.publishedReviewedAt) {
      await tx.insert(hbsApprovedInformationHistory).values({
        informationId: id, action: "withdrawn", title: before.publishedTitle,
        content: before.publishedContent, reviewedAt: before.publishedReviewedAt,
        publishedAt: before.publishedAt, changedAt: updatedAt,
      });
    }
    return { status: 200 as const, row };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.status === 404 ? "Not found" : "This information changed since you opened it. Refresh and review the latest version." });
    return;
  }
  const { row } = result;
  res.json(UnpublishApprovedInformationResponse.parse(present(row)));
});

export default router;