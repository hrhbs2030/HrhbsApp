import { getAuth } from "@clerk/express";
import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsServiceOffers, type HbsServiceOffer } from "@workspace/db";
import {
  ListOfficeServiceOffersResponse, ListServiceOffersResponse,
  SaveOfficeServiceOfferBody, SaveOfficeServiceOfferParams, SaveOfficeServiceOfferResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { requireOfficeOwner } from "../lib/office-access";

const router: IRouter = Router();

function offer(row: HbsServiceOffer) {
  return {
    slug: row.slug, price: row.priceHalalas, governmentFeesNote: row.governmentFeesNote,
    processingDays: row.processingDays, requiredDocuments: row.requiredDocuments,
    published: row.published, updatedAt: row.updatedAt,
  };
}

// Public: the website shows only what the office owner published.
router.get("/service-offers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(hbsServiceOffers).where(eq(hbsServiceOffers.published, true)).orderBy(asc(hbsServiceOffers.slug));
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(ListServiceOffersResponse.parse(rows.map(offer)));
});

router.get("/office/service-offers", requireOfficeOwner, async (_req, res): Promise<void> => {
  const rows = await db.select().from(hbsServiceOffers).orderBy(asc(hbsServiceOffers.slug));
  res.json(ListOfficeServiceOffersResponse.parse(rows.map(offer)));
});

router.put("/office/service-offers/:slug", requireOfficeOwner, async (req, res): Promise<void> => {
  const params = SaveOfficeServiceOfferParams.safeParse(req.params);
  const body = SaveOfficeServiceOfferBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid offer" }); return; }
  const documents = [...new Set(body.data.requiredDocuments.map(d => d.trim()).filter(d => d.length >= 2))];
  const actorId = getAuth(req).userId!;
  const values = {
    priceHalalas: body.data.price,
    governmentFeesNote: body.data.governmentFeesNote?.trim() || null,
    processingDays: body.data.processingDays,
    requiredDocuments: documents,
    published: body.data.published,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  const row = await db.transaction(async tx => {
    const [saved] = await tx.insert(hbsServiceOffers).values({ slug: params.data.slug, ...values })
      .onConflictDoUpdate({ target: hbsServiceOffers.slug, set: values }).returning();
    await recordAudit(tx, {
      actorId, action: "offer.update", targetType: "service_offer", targetId: saved.slug,
      details: { price: saved.priceHalalas, processingDays: saved.processingDays, published: saved.published },
    });
    return saved;
  });
  res.json(SaveOfficeServiceOfferResponse.parse(offer(row)));
});

export default router;
