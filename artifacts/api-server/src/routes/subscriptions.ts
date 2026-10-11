import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsCompanies, hbsPlans, hbsRegistrationRequests, hbsSubscriptions, type HbsPlan } from "@workspace/db";
import {
  CreateOfficePlanBody, CreateOfficePlanResponse,
  GetCompanySubscriptionResponse,
  ListCompanyInvoicesResponse,
  ListOfficePlansResponse, ListOfficeSubscriptionsQueryParams, ListOfficeSubscriptionsResponse, ListPlansResponse,
  StartCompanySubscriptionBody, StartCompanySubscriptionResponse,
  UpdateCompanySubscriptionBody, UpdateCompanySubscriptionResponse,
  UpdateOfficePlanBody, UpdateOfficePlanParams, UpdateOfficePlanResponse,
  UpdateOfficeSubscriptionBody, UpdateOfficeSubscriptionParams, UpdateOfficeSubscriptionResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { companyAccessOf, companyPermissions, requireCompanyRole } from "../lib/company-access";
import { notifyCustomer } from "../lib/customer-contact";
import { requireOfficeOwner } from "../lib/office-access";
import {
  OPEN_SUBSCRIPTION_STATUSES, SUBSCRIPTION_AUDIT, addRiyadhMonth, customerInvoices, invoiceInfo, issueSubscriptionInvoice,
  latestInvoicesOf, openSubscriptionOf, planView, riyadhDateText, subscriptionView,
} from "../lib/subscriptions";
import { subscriptionStartedMail } from "../lib/notify";

// Plans and subscriptions (package D). Contract in lib/api-spec/openapi.yaml
// under the `subscriptions` tag; the office owner publishes plans, a company
// owner (or finance member) subscribes, and lib/subscriptions.ts invoices
// and renews. Subscription invoices are paid through billing.ts.
const router: IRouter = Router();

// The smallest monthly price: an invoice must carry at least one riyal
// (hbs_invoices_amount_check), like request invoices.
export const MIN_PLAN_PRICE_HALALAS = 100;
const DEFAULT_PAGE_SIZE = 20;

// Drizzle wraps the driver's error; the Postgres code and constraint are on the cause.
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error; typeof current === "object" && current !== null; current = (current as { cause?: unknown }).cause) {
    const pg = current as { code?: string; constraint?: string };
    if (pg.code === "23505") return pg.constraint === constraint;
  }
  return false;
}

function planValues(input: typeof CreateOfficePlanBody._output) {
  return {
    slug: input.slug, name: input.name.trim(), description: input.description.trim(), priceHalalas: input.price,
    employeeCap: input.employeeCap ?? null, requestsPerMonth: input.requestsPerMonth ?? null,
    autoRenewals: input.autoRenewals, active: input.active, sort: input.sort,
  };
}

function planInputError(input: typeof CreateOfficePlanBody._output): string | null {
  if (input.name.trim().length < 2) return "اكتب اسم الباقة.";
  if (input.price < MIN_PLAN_PRICE_HALALAS) return "سعر الباقة الشهري لا يقل عن ريال واحد.";
  return null;
}

// ---- plans ----------------------------------------------------------------------

router.get("/plans", async (_req, res): Promise<void> => {
  const rows = await db.select().from(hbsPlans).where(eq(hbsPlans.active, true)).orderBy(asc(hbsPlans.sort), asc(hbsPlans.id));
  res.json(ListPlansResponse.parse(rows.map(planView)));
});

router.get("/office/plans", requireOfficeOwner, async (_req, res): Promise<void> => {
  const rows = await db.select().from(hbsPlans).orderBy(asc(hbsPlans.sort), asc(hbsPlans.id));
  res.json(ListOfficePlansResponse.parse(rows.map(planView)));
});

router.post("/office/plans", requireOfficeOwner, async (req, res): Promise<void> => {
  const body = CreateOfficePlanBody.safeParse(req.body);
  const error = body.success ? planInputError(body.data) : "بيانات الباقة غير صالحة.";
  if (!body.success || error) { res.status(400).json({ error }); return; }
  const actorId = getAuth(req).userId!;
  let plan: HbsPlan;
  try {
    plan = await db.transaction(async tx => {
      const [created] = await tx.insert(hbsPlans).values(planValues(body.data)).returning();
      await recordAudit(tx, {
        actorId, action: SUBSCRIPTION_AUDIT.planCreate, targetType: "plan", targetId: created.id,
        details: { slug: created.slug, price: created.priceHalalas, active: created.active },
      });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err, "hbs_plans_slug_unique")) { res.status(409).json({ error: "المعرّف مستخدم لباقة أخرى." }); return; }
    throw err;
  }
  res.status(201).json(CreateOfficePlanResponse.parse(planView(plan)));
});

router.put("/office/plans/:id", requireOfficeOwner, async (req, res): Promise<void> => {
  const params = UpdateOfficePlanParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Plan not found" }); return; }
  const body = UpdateOfficePlanBody.safeParse(req.body);
  const error = body.success ? planInputError(body.data) : "بيانات الباقة غير صالحة.";
  if (!body.success || error) { res.status(400).json({ error }); return; }
  const actorId = getAuth(req).userId!;
  let plan: HbsPlan | null;
  try {
    plan = await db.transaction(async tx => {
      const [previous] = await tx.select().from(hbsPlans).where(eq(hbsPlans.id, params.data.id)).for("update");
      if (!previous) return null;
      const values = planValues(body.data);
      const [updated] = await tx.update(hbsPlans).set({ ...values, updatedAt: new Date() }).where(eq(hbsPlans.id, previous.id)).returning();
      const changed = (Object.keys(values) as (keyof typeof values)[]).filter(key => values[key] !== previous[key]);
      await recordAudit(tx, {
        actorId, action: SUBSCRIPTION_AUDIT.planUpdate, targetType: "plan", targetId: updated.id,
        details: { slug: updated.slug, price: updated.priceHalalas, active: updated.active, changed },
      });
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err, "hbs_plans_slug_unique")) { res.status(409).json({ error: "المعرّف مستخدم لباقة أخرى." }); return; }
    throw err;
  }
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(UpdateOfficePlanResponse.parse(planView(plan)));
});

// ---- office: subscriptions ------------------------------------------------------

async function officeSubscriptionRows(filter: ReturnType<typeof and>, page: number, pageSize: number) {
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(hbsSubscriptions).where(filter),
    db.select({
      subscription: hbsSubscriptions, plan: hbsPlans,
      companyName: hbsCompanies.name, customerName: hbsRegistrationRequests.fullName,
    }).from(hbsSubscriptions)
      .innerJoin(hbsPlans, eq(hbsSubscriptions.planId, hbsPlans.id))
      .leftJoin(hbsCompanies, eq(hbsSubscriptions.userId, hbsCompanies.userId))
      .leftJoin(hbsRegistrationRequests, eq(hbsSubscriptions.userId, hbsRegistrationRequests.userId))
      .where(filter)
      .orderBy(desc(hbsSubscriptions.createdAt), desc(hbsSubscriptions.id))
      .limit(pageSize).offset((page - 1) * pageSize),
  ]);
  const invoices = await latestInvoicesOf(rows.map(row => row.subscription.id));
  return {
    total,
    items: rows.map(row => ({
      ...subscriptionView(row.subscription, row.plan, invoices.get(row.subscription.id) ?? null),
      userId: row.subscription.userId, companyName: row.companyName ?? null, customerName: row.customerName ?? null,
    })),
  };
}

router.get("/office/subscriptions", requireOfficeOwner, async (req, res): Promise<void> => {
  const query = ListOfficeSubscriptionsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid pagination or filter" }); return; }
  const page = query.data.page ?? 1;
  const pageSize = query.data.pageSize ?? DEFAULT_PAGE_SIZE;
  const filter = query.data.status ? eq(hbsSubscriptions.status, query.data.status) : undefined;
  res.json(ListOfficeSubscriptionsResponse.parse(await officeSubscriptionRows(filter, page, pageSize)));
});

router.patch("/office/subscriptions/:id", requireOfficeOwner, async (req, res): Promise<void> => {
  const params = UpdateOfficeSubscriptionParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Subscription not found" }); return; }
  const body = UpdateOfficeSubscriptionBody.safeParse(req.body);
  if (!body.success || (body.data.status === undefined && body.data.autoRenewRequests === undefined)) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const outcome = await changeSubscription(eq(hbsSubscriptions.id, params.data.id), getAuth(req).userId!,
    { cancel: body.data.status === "cancelled", autoRenewRequests: body.data.autoRenewRequests });
  if (outcome === "missing") { res.status(404).json({ error: "Subscription not found" }); return; }
  if (outcome === "closed") { res.status(409).json({ error: "الاشتراك ملغى بالفعل." }); return; }
  const { items } = await officeSubscriptionRows(eq(hbsSubscriptions.id, outcome.id), 1, 1);
  res.json(UpdateOfficeSubscriptionResponse.parse(items[0]));
});

// Cancels and/or switches automatic renewal requests on one subscription;
// cancelling an already cancelled subscription is refused.
async function changeSubscription(where: ReturnType<typeof eq>, actorId: string, change: { cancel: boolean; autoRenewRequests?: boolean }) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(hbsSubscriptions).where(where).for("update");
    if (!current) return "missing" as const;
    if (current.status === "cancelled") return "closed" as const;
    const now = new Date();
    const [updated] = await tx.update(hbsSubscriptions).set({
      ...(change.cancel ? { status: "cancelled", cancelledAt: now } : {}),
      ...(change.autoRenewRequests !== undefined ? { autoRenewRequests: change.autoRenewRequests } : {}),
      updatedAt: now,
    }).where(eq(hbsSubscriptions.id, current.id)).returning();
    await recordAudit(tx, {
      actorId, action: SUBSCRIPTION_AUDIT.update, targetType: "subscription", targetId: updated.id,
      details: {
        userId: updated.userId, fromStatus: current.status, toStatus: updated.status,
        ...(change.autoRenewRequests !== undefined ? { autoRenewRequests: change.autoRenewRequests } : {}),
      },
    });
    return updated;
  });
}

// ---- company: subscription ------------------------------------------------------

const requireBilling = requireCompanyRole(companyPermissions.billing);

async function companySubscription(userId: string) {
  const open = await openSubscriptionOf(userId);
  if (!open) return null;
  const invoices = await latestInvoicesOf([open.subscription.id]);
  return subscriptionView(open.subscription, open.plan, invoices.get(open.subscription.id) ?? null);
}

router.get("/company/subscription", requireBilling, async (_req, res): Promise<void> => {
  const { companyUserId } = companyAccessOf(res);
  res.json(GetCompanySubscriptionResponse.parse({ subscription: await companySubscription(companyUserId) }));
});

router.post("/company/subscription", requireBilling, async (req, res): Promise<void> => {
  const body = StartCompanySubscriptionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid plan" }); return; }
  const { companyUserId } = companyAccessOf(res);
  const actorId = getAuth(req).userId!;
  const [plan] = await db.select().from(hbsPlans).where(and(eq(hbsPlans.id, body.data.planId), eq(hbsPlans.active, true))).limit(1);
  if (!plan) { res.status(404).json({ error: "الباقة غير متاحة." }); return; }
  if (plan.priceHalalas < MIN_PLAN_PRICE_HALALAS) { res.status(400).json({ error: "الباقة غير متاحة للاشتراك." }); return; }
  const taken = () => { res.status(409).json({ error: "لديك اشتراك قائم بالفعل." }); };
  if (await openSubscriptionOf(companyUserId)) { taken(); return; }
  let result;
  try {
    result = await db.transaction(async tx => {
      const now = new Date();
      const [subscription] = await tx.insert(hbsSubscriptions).values({
        userId: companyUserId, planId: plan.id, status: "active", startsAt: now, renewsAt: addRiyadhMonth(now),
        autoRenewRequests: body.data.autoRenewRequests,
      }).returning();
      const invoice = await issueSubscriptionInvoice(tx, subscription, plan, { actorId, periodStart: now });
      await recordAudit(tx, {
        actorId, action: SUBSCRIPTION_AUDIT.start, targetType: "subscription", targetId: subscription.id,
        details: { userId: companyUserId, planId: plan.id, slug: plan.slug, invoiceId: invoice.id, renewsAt: subscription.renewsAt },
      });
      return { subscription, invoice };
    });
  } catch (err) {
    // Two clicks at once: the partial unique index keeps one open subscription per customer.
    if (isUniqueViolation(err, "hbs_subscriptions_user_open_unique")) { taken(); return; }
    throw err;
  }
  res.status(201).json(StartCompanySubscriptionResponse.parse(subscriptionView(result.subscription, plan, result.invoice)));
  void notifyCustomer(companyUserId, to => subscriptionStartedMail(to, plan.name, invoiceInfo(result.invoice), riyadhDateText(result.subscription.renewsAt)));
});

router.patch("/company/subscription", requireBilling, async (req, res): Promise<void> => {
  const body = UpdateCompanySubscriptionBody.safeParse(req.body);
  if (!body.success || (body.data.cancel === undefined && body.data.autoRenewRequests === undefined)) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const { companyUserId } = companyAccessOf(res);
  const outcome = await changeSubscription(
    and(eq(hbsSubscriptions.userId, companyUserId), inArray(hbsSubscriptions.status, [...OPEN_SUBSCRIPTION_STATUSES]))!,
    getAuth(req).userId!, { cancel: body.data.cancel === true, autoRenewRequests: body.data.autoRenewRequests });
  if (outcome === "missing" || outcome === "closed") { res.status(404).json({ error: "لا يوجد اشتراك قائم." }); return; }
  const invoices = await latestInvoicesOf([outcome.id]);
  const [plan] = await db.select().from(hbsPlans).where(eq(hbsPlans.id, outcome.planId)).limit(1);
  res.json(UpdateCompanySubscriptionResponse.parse(subscriptionView(outcome, plan, invoices.get(outcome.id) ?? null)));
});

router.get("/company/invoices", requireCompanyRole(companyPermissions.read), async (_req, res): Promise<void> => {
  const { companyUserId } = companyAccessOf(res);
  res.json(ListCompanyInvoicesResponse.parse(await customerInvoices(companyUserId)));
});

export default router;
