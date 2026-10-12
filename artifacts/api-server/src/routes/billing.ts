import { getAuth } from "@clerk/express";
import { timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler, type Response } from "express";
import {
  db, hbsInvoiceGatewayPages, hbsInvoices, hbsServiceRequests, hbsSubscriptions, type HbsInvoice, type HbsServiceRequest,
} from "@workspace/db";
import {
  IssueOfficeInvoiceBody, IssueOfficeInvoiceParams, IssueOfficeInvoiceResponse,
  ListOfficeServiceRequestInvoicesParams, ListOfficeServiceRequestInvoicesResponse,
  ListServiceRequestInvoicesParams, ListServiceRequestInvoicesResponse,
  RefreshInvoicePaymentParams, RefreshInvoicePaymentResponse,
  StartInvoicePaymentParams, StartInvoicePaymentResponse,
  UpdateOfficeInvoiceBody, UpdateOfficeInvoiceParams, UpdateOfficeInvoiceResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { COMPANY_ACCESS_DENIED, companyPermissions, hasCustomerApproval, resolveCompanyAccess } from "../lib/company-access";
import { notifyCustomer, notifyOffice } from "../lib/customer-contact";
import { invoiceReference, requestReference, riyals, vatFor, VAT_RATE_BASIS_POINTS } from "../lib/money";
import {
  cancelGatewayInvoice, createGatewayInvoice, fetchGatewayInvoice, moyasarConfigured, type GatewayInvoice,
} from "../lib/moyasar";
import { closedInvoicePaidMail, invoiceIssuedMail, invoicePaidOfficeMail } from "../lib/notify";
import { logger } from "../lib/logger";
import { requireOfficeStaff } from "../lib/office-access";
import { resumeAfterPayment } from "../lib/automations";
import { onSubscriptionInvoicePaid } from "../lib/subscriptions";
import { requireApprovedCustomer } from "./portal";

const router: IRouter = Router();
const GATEWAY_ACTOR = "payment-gateway";
const siteUrl = () => (process.env.PUBLIC_SITE_URL ?? "https://hrhbs.com").replace(/\/$/, "");

function seller() {
  return { name: process.env.HBS_LEGAL_NAME?.trim() || "HBS حلول الغد", vatNumber: process.env.HBS_VAT_NUMBER?.trim() || null };
}

// A subscription invoice has no request: requestId/requestReference are null.
export function invoice(row: HbsInvoice, request: Pick<HbsServiceRequest, "id" | "createdAt"> | null) {
  return {
    id: row.id,
    reference: invoiceReference(row.id, row.issuedAt),
    requestId: request?.id ?? null,
    requestReference: request ? requestReference(request.id, request.createdAt) : null,
    subscriptionId: row.subscriptionId,
    description: row.description,
    quantity: row.quantity,
    unitAmount: row.unitAmountHalalas,
    amount: row.amountHalalas,
    vatRateBasisPoints: row.vatRateBasisPoints,
    vat: row.vatHalalas,
    total: row.totalHalalas,
    status: row.status,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    canPayOnline: row.status === "issued" && moyasarConfigured(),
    seller: seller(),
  };
}

async function invoicesOf(request: HbsServiceRequest) {
  const rows = await db.select().from(hbsInvoices).where(eq(hbsInvoices.requestId, request.id))
    .orderBy(asc(hbsInvoices.issuedAt), asc(hbsInvoices.id));
  return rows.map(row => invoice(row, request));
}

// Who may pay or refresh an invoice: an approved customer (their own
// requests and subscription), or a company member whose role covers billing
// (lib/company-access) for the company's subscription invoices only. The
// company whose subscription invoices the member may act on is left in
// res.locals.billingCompanyUserId; request invoices stay the customer's own.
const requireInvoiceAccess: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to continue" }); return; }
  if (await hasCustomerApproval(userId)) { res.locals.billingCompanyUserId = null; next(); return; }
  const access = await resolveCompanyAccess(req);
  if (!access) { res.status(403).json({ error: "Customer registration approval required" }); return; }
  if (!(companyPermissions.billing as readonly string[]).includes(access.role)) { res.status(403).json({ error: COMPANY_ACCESS_DENIED }); return; }
  res.locals.billingCompanyUserId = access.companyUserId;
  next();
};

const billingCompanyOf = (res: Response) => (res.locals.billingCompanyUserId ?? null) as string | null;

// The customer's invoice with its request (null for a subscription invoice),
// or nothing for another customer's. The customer owns it through the
// request, or through the subscription (hbs_subscriptions.user_id); a
// billing member owns the company's subscription invoices.
async function customerInvoice(id: number, userId: string, billingCompanyUserId: string | null) {
  const owners = [eq(hbsServiceRequests.userId, userId), eq(hbsSubscriptions.userId, userId)];
  if (billingCompanyUserId) owners.push(eq(hbsSubscriptions.userId, billingCompanyUserId));
  const [row] = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .leftJoin(hbsSubscriptions, eq(hbsInvoices.subscriptionId, hbsSubscriptions.id))
    .where(and(eq(hbsInvoices.id, id), or(...owners))).limit(1);
  return row ?? null;
}

// What the mails name for an invoice: its request, or the subscription.
function subjectInfo(row: HbsInvoice, request: HbsServiceRequest | null) {
  return request
    ? { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service }
    : { id: 0, reference: `اشتراك #${row.subscriptionId}`, service: "الاشتراك الشهري" };
}

const terminalGatewayStatuses = new Set(["paid", "expired", "failed", "cancelled", "canceled"]);

function gatewayStatusIsTerminal(status: string) {
  return terminalGatewayStatuses.has(status.toLowerCase());
}

async function rememberGatewayPage(invoiceId: number, page: Pick<GatewayInvoice, "id" | "url">) {
  await db.insert(hbsInvoiceGatewayPages).values({
    gatewayInvoiceId: page.id, invoiceId, paymentUrl: page.url,
  }).onConflictDoNothing();
  const [stored] = await db.select({ invoiceId: hbsInvoiceGatewayPages.invoiceId })
    .from(hbsInvoiceGatewayPages).where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, page.id)).limit(1);
  if (!stored || stored.invoiceId !== invoiceId) {
    throw new Error(`Gateway page ${page.id} is already associated with another invoice`);
  }
}

async function invoiceForGatewayPage(gatewayId: string) {
  let [page] = await db.select().from(hbsInvoiceGatewayPages)
    .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId)).limit(1);
  if (!page) {
    // Backfill legacy current-page pointers lazily; existing invoices need no
    // migration data rewrite before webhooks and reconciliation can find them.
    const [legacy] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.gatewayInvoiceId, gatewayId)).limit(1);
    if (!legacy) return null;
    await rememberGatewayPage(legacy.id, { id: gatewayId, url: legacy.paymentUrl ?? "" });
    [page] = await db.select().from(hbsInvoiceGatewayPages)
      .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId)).limit(1);
  }
  if (!page) return null;
  const [joined] = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests })
    .from(hbsInvoices).leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .where(eq(hbsInvoices.id, page.invoiceId)).limit(1);
  return joined ? { ...joined, page } : null;
}

async function noteGatewayPageChecked(gatewayId: string) {
  await db.update(hbsInvoiceGatewayPages).set({ lastCheckedAt: new Date() })
    .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId));
}

// Marks an invoice paid only when the gateway itself reports it paid in full,
// in riyals. The page-to-invoice relation, not the current URL pointer, owns
// attribution so old pages remain reconcilable after replacement.
export async function settleFromGateway(
  row: HbsInvoice, request: HbsServiceRequest | null, gateway?: GatewayInvoice,
): Promise<HbsInvoice> {
  const gatewayId = gateway?.id ?? row.gatewayInvoiceId;
  if (!gatewayId) return row;
  const associated = await invoiceForGatewayPage(gatewayId);
  if (!associated) return row;
  row = associated.invoice;
  request = associated.request;
  const remote = gateway ?? await fetchGatewayInvoice(gatewayId);
  await noteGatewayPageChecked(gatewayId);
  if (remote.id !== gatewayId || remote.status !== "paid") return row;
  if (remote.amount !== row.totalHalalas || remote.currency !== "SAR") {
    const [alerted] = await db.update(hbsInvoiceGatewayPages)
      .set({ closedPaidAlertedAt: new Date() })
      .where(and(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId), isNull(hbsInvoiceGatewayPages.closedPaidAlertedAt)))
      .returning();
    if (alerted) {
      logger.error({
        invoiceId: row.id, gatewayInvoiceId: gatewayId, expectedAmount: row.totalHalalas,
        actualAmount: remote.amount, currency: remote.currency, status: row.status,
      }, "Payment reported for invoice has an amount or currency mismatch");
      if (row.status !== "issued") void notifyOffice(() => closedInvoicePaidMail(
        subjectInfo(row, request), invoiceReference(row.id, row.issuedAt), riyals(remote.amount),
      ), { kind: "office.invoice_paid", targetType: "invoice", targetId: row.id,
        signals: { amountHalalas: remote.amount, repeated: true }, dedupeKey: `closed-page-paid:${gatewayId}` });
    }
    return row;
  }
  // This exact online payment was already recorded. Do not misclassify every
  // later reconciliation of the same page as money received after closure.
  if (row.status === "paid" && row.paymentMethod === "online" && row.paymentReference === gatewayId) return row;
  if (row.status !== "issued") {
    const [alerted] = await db.update(hbsInvoiceGatewayPages).set({ closedPaidAlertedAt: new Date() })
      .where(and(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId), isNull(hbsInvoiceGatewayPages.closedPaidAlertedAt))).returning();
    if (alerted) {
      logger.error({ invoiceId: row.id, gatewayInvoiceId: gatewayId, status: row.status }, "Online payment received for a closed invoice");
      void notifyOffice(() => closedInvoicePaidMail(subjectInfo(row, request), invoiceReference(row.id, row.issuedAt), riyals(remote.amount)), { kind: "office.invoice_paid", targetType: "invoice", targetId: row.id, signals: { amountHalalas: remote.amount, repeated: true }, dedupeKey: "closed-page-paid:" + gatewayId });
    }
    return row;
  }
  const updated = await db.transaction(async tx => {
    const [paid] = await tx.update(hbsInvoices).set({
      status: "paid", paymentMethod: "online", paymentReference: remote.id, paidAt: new Date(),
    }).where(and(eq(hbsInvoices.id, row.id), eq(hbsInvoices.status, "issued"))).returning();
    if (paid) {
      await recordAudit(tx, {
        actorId: GATEWAY_ACTOR, action: "invoice.paid_online", ...auditTarget(row, request),
        details: { invoiceId: paid.id, total: paid.totalHalalas, gatewayInvoiceId: remote.id },
      });
    }
    return paid;
  });
  if (!updated) {
    const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, row.id));
    if (fresh?.status === "paid" && fresh.paymentMethod === "online" && fresh.paymentReference === gatewayId) {
      return fresh;
    }
    if (fresh && fresh.status !== "issued") {
      const [alerted] = await db.update(hbsInvoiceGatewayPages).set({ closedPaidAlertedAt: new Date() })
        .where(and(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, gatewayId), isNull(hbsInvoiceGatewayPages.closedPaidAlertedAt))).returning();
      if (alerted) {
        logger.error({ invoiceId: fresh.id, gatewayInvoiceId: gatewayId, status: fresh.status }, "Online payment received as invoice closure raced");
        void notifyOffice(() => closedInvoicePaidMail(subjectInfo(fresh, request), invoiceReference(fresh.id, fresh.issuedAt), riyals(remote.amount)),
          { kind: "office.invoice_paid", targetType: "invoice", targetId: fresh.id,
            signals: { amountHalalas: remote.amount, repeated: true }, dedupeKey: `closed-page-paid:${gatewayId}` });
      }
    }
    return fresh ?? row;
  }
  if (request) await resumeAfterPayment(request.id);
  else await onSubscriptionInvoicePaid(updated);
  void notifyOffice(() => invoicePaidOfficeMail(subjectInfo(row, request), invoiceReference(updated.id, updated.issuedAt), riyals(updated.totalHalalas)),
    { kind: "office.invoice_paid", targetType: "invoice", targetId: updated.id, signals: { amountHalalas: updated.totalHalalas } });
  return updated;
}

// Invoice audits are filed under the request, or the subscription.
function auditTarget(row: HbsInvoice, request: Pick<HbsServiceRequest, "id"> | null) {
  return request
    ? { targetType: "service_request", targetId: request.id }
    : { targetType: "subscription", targetId: row.subscriptionId ?? 0 };
}

// Where the customer lands after the payment page: the request's page, or
// the company page for a subscription invoice (it refreshes the invoice
// named by ?invoice= there).
export function paymentReturnPath(request: Pick<HbsServiceRequest, "id"> | null) {
  return request ? `/requests/${request.id}` : "/company";
}

router.get("/service-requests/:id/invoices", requireApprovedCustomer, async (req, res): Promise<void> => {
  const params = ListServiceRequestInvoicesParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Request not found" }); return; }
  const [request] = await db.select().from(hbsServiceRequests).where(and(
    eq(hbsServiceRequests.id, params.data.id), eq(hbsServiceRequests.userId, getAuth(req).userId!))).limit(1);
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  res.json(ListServiceRequestInvoicesResponse.parse(await invoicesOf(request)));
});

// How long one request may hold the invoice while it creates the hosted
// page. The gateway calls time out at 15 s, so a claim older than this was
// left by a crashed request and may be taken over.
const GATEWAY_CLAIM_MS = 60_000;

// A cancellation response may be lost after the gateway committed it. Verify
// the resulting remote state before treating the page as safe to replace or
// close. Unknown states remain payable/uncertain and therefore block action.
async function closeGatewayPageSafely(gatewayId: string): Promise<GatewayInvoice> {
  let remote = await fetchGatewayInvoice(gatewayId);
  if (remote.status === "paid" || gatewayStatusIsTerminal(remote.status)) return remote;
  try {
    remote = await cancelGatewayInvoice(gatewayId);
  } catch (cancelError) {
    try { remote = await fetchGatewayInvoice(gatewayId); }
    catch (verifyError) {
      throw new Error(`Gateway cancellation outcome is uncertain for ${gatewayId}`, { cause: verifyError });
    }
    if (remote.status !== "paid" && !gatewayStatusIsTerminal(remote.status)) {
      throw new Error(`Gateway page ${gatewayId} remains payable after cancellation failure`, { cause: cancelError });
    }
    return remote;
  }
  if (remote.status === "paid" || gatewayStatusIsTerminal(remote.status)) return remote;
  remote = await fetchGatewayInvoice(gatewayId);
  if (remote.status !== "paid" && !gatewayStatusIsTerminal(remote.status)) {
    throw new Error(`Gateway page ${gatewayId} remains payable after cancellation`);
  }
  return remote;
}

router.post("/invoices/:id/pay", requireInvoiceAccess, async (req, res): Promise<void> => {
  const params = StartInvoicePaymentParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!moyasarConfigured()) { res.status(503).json({ error: "Online payment is not available. Contact the office to pay." }); return; }
  const found = await customerInvoice(params.data.id, getAuth(req).userId!, billingCompanyOf(res));
  if (!found) { res.status(404).json({ error: "Invoice not found" }); return; }
  const { request } = found;
  const closed = () => { res.status(409).json({ error: "This invoice is already paid or cancelled." }); };
  const busy = () => { res.status(409).json({ error: "The payment page is being prepared. Try again in a moment." }); };
  try {
    // One hosted page per invoice. No row lock is held while the gateway is
    // called: the row is claimed with a timestamp, the page is created, and
    // the result is stored only where the claim is still this request's.
    let row = found.invoice;
    if (row.status !== "issued") { closed(); return; }
    if (row.gatewayInvoiceId) {
      await rememberGatewayPage(row.id, { id: row.gatewayInvoiceId, url: row.paymentUrl ?? "" });
      const existing = await fetchGatewayInvoice(row.gatewayInvoiceId);
      await noteGatewayPageChecked(existing.id);
      if (existing.status === "paid") { await settleFromGateway(row, request, existing); closed(); return; }
      if (existing.status === "initiated" && row.paymentUrl) { res.json(StartInvoicePaymentResponse.parse({ url: row.paymentUrl })); return; }
      // A known terminal state is safe to replace. An unrecognized state is
      // not: without proof it can no longer accept funds, retain this page.
      if (!gatewayStatusIsTerminal(existing.status)) { busy(); return; }
    }
    const claimedAt = new Date();
    const [claimed] = await db.update(hbsInvoices).set({ gatewayClaimedAt: claimedAt }).where(and(
      eq(hbsInvoices.id, row.id), eq(hbsInvoices.status, "issued"),
      sql`${hbsInvoices.gatewayInvoiceId} is not distinct from ${row.gatewayInvoiceId}`,
      or(isNull(hbsInvoices.gatewayClaimedAt), lt(hbsInvoices.gatewayClaimedAt, new Date(claimedAt.getTime() - GATEWAY_CLAIM_MS))),
    )).returning();
    if (!claimed) {
      // Someone else got there first: closed, a page just stored, or still being created.
      [row] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, row.id));
      if (row.status !== "issued") { closed(); return; }
      if (row.gatewayInvoiceId !== found.invoice.gatewayInvoiceId && row.paymentUrl) {
        res.json(StartInvoicePaymentResponse.parse({ url: row.paymentUrl })); return;
      }
      busy(); return;
    }
    let created: GatewayInvoice;
    try {
      created = await createGatewayInvoice({
        amount: claimed.totalHalalas,
        description: `${invoiceReference(claimed.id, claimed.issuedAt)} · ${claimed.description}`.slice(0, 250),
        successUrl: `${siteUrl()}${paymentReturnPath(request)}?invoice=${claimed.id}`,
        backUrl: `${siteUrl()}${paymentReturnPath(request)}`,
        metadata: { invoice_id: String(claimed.id), ...(request ? { request_id: String(request.id) } : { subscription_id: String(claimed.subscriptionId) }) },
      });
    } catch (error) {
      await db.update(hbsInvoices).set({ gatewayClaimedAt: null })
        .where(and(eq(hbsInvoices.id, claimed.id), eq(hbsInvoices.gatewayClaimedAt, claimedAt)));
      throw error;
    }
    // Stored only while the invoice is still open: one cancelled or marked
    // paid while the page was being created must not get a live page.
    let stored: HbsInvoice | undefined;
    try {
      stored = await db.transaction(async tx => {
        // Record every created page even if the claim was lost or invoice
        // closed meanwhile, so a delayed payment is still attributed.
        await tx.insert(hbsInvoiceGatewayPages).values({
          gatewayInvoiceId: created.id, invoiceId: claimed.id, paymentUrl: created.url,
        }).onConflictDoNothing();
        const [pageMapping] = await tx.select({ invoiceId: hbsInvoiceGatewayPages.invoiceId })
          .from(hbsInvoiceGatewayPages).where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, created.id)).limit(1);
        if (!pageMapping || pageMapping.invoiceId !== claimed.id) {
          throw new Error(`Gateway page ${created.id} is already associated with another invoice`);
        }
        const [invoiceRow] = await tx.update(hbsInvoices).set({
          gatewayInvoiceId: created.id, paymentUrl: created.url, gatewayClaimedAt: null,
        }).where(and(
          eq(hbsInvoices.id, claimed.id), eq(hbsInvoices.status, "issued"), eq(hbsInvoices.gatewayClaimedAt, claimedAt),
        )).returning();
        return invoiceRow;
      });
    } catch (storeError) {
      // The remote page exists, but the local commit may have failed or been
      // uncertain. Try to preserve the mapping and only cancel with proof.
      try {
        await rememberGatewayPage(claimed.id, created);
        const result = await closeGatewayPageSafely(created.id);
        if (result.status === "paid") {
          const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, claimed.id));
          if (fresh) await settleFromGateway(fresh, request, result);
        }
      } catch (recoveryError) {
        req.log.error({ err: recoveryError, storeError, invoiceId: claimed.id, gatewayInvoiceId: created.id },
          "Could not safely resolve a payment page after storing it failed");
      }
      throw storeError;
    }
    if (!stored) {
      // Do not leave an orphaned payable page. Its mapping was committed
      // above, and cancellation is awaited and remotely verified.
      const closedPage = await closeGatewayPageSafely(created.id);
      if (closedPage.status === "paid") {
        const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, claimed.id));
        if (fresh) await settleFromGateway(fresh, request, closedPage);
      }
      await db.update(hbsInvoiceGatewayPages).set({ closedAt: new Date() })
        .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, created.id));
      [row] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, claimed.id));
      if (row.status === "issued" && row.gatewayInvoiceId && row.paymentUrl) {
        res.json(StartInvoicePaymentResponse.parse({ url: row.paymentUrl })); return;
      }
      if (row.status !== "issued") { closed(); return; }
      busy(); return;
    }
    res.json(StartInvoicePaymentResponse.parse({ url: created.url }));
  } catch (error) {
    req.log.error({ err: error }, "Could not start online payment");
    res.status(502).json({ error: "Could not open the payment page. Try again shortly." });
  }
});

router.post("/invoices/:id/refresh", requireInvoiceAccess, async (req, res): Promise<void> => {
  const params = RefreshInvoicePaymentParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Invoice not found" }); return; }
  const found = await customerInvoice(params.data.id, getAuth(req).userId!, billingCompanyOf(res));
  if (!found) { res.status(404).json({ error: "Invoice not found" }); return; }
  let row = found.invoice;
  try {
    if (moyasarConfigured()) row = await settleFromGateway(row, found.request);
  } catch (error) {
    req.log.warn({ err: error }, "Could not check payment status");
  }
  res.json(RefreshInvoicePaymentResponse.parse(invoice(row, found.request)));
});

// Moyasar webhook. The payload is only a hint: the invoice is fetched from
// Moyasar before anything is marked paid.
router.post("/payments/moyasar/webhook", async (req, res): Promise<void> => {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  if (!secret || !moyasarConfigured()) { res.status(404).end(); return; }
  const body = (req.body ?? {}) as { secret_token?: unknown; data?: { invoice_id?: unknown } };
  const token = typeof body.secret_token === "string" ? Buffer.from(body.secret_token) : Buffer.alloc(0);
  const expected = Buffer.from(secret);
  if (token.length !== expected.length || !timingSafeEqual(token, expected)) { res.status(401).end(); return; }
  const gatewayId = typeof body.data?.invoice_id === "string" ? body.data.invoice_id : null;
  if (!gatewayId) { res.status(200).end(); return; }
  const associated = await invoiceForGatewayPage(gatewayId);
  if (associated) {
    try { await settleFromGateway(associated.invoice, associated.request, await fetchGatewayInvoice(gatewayId)); }
    catch (error) { req.log.error({ err: error }, "Webhook payment check failed"); res.status(502).end(); return; }
  }
  res.status(200).end();
});

// Customers who pay and close the tab before returning, without a webhook,
// would leave the invoice unpaid here: check every known payment page.
export async function reconcileOnlinePayments(): Promise<number> {
  if (!moyasarConfigured()) return 0;
  // Backfill the former single-pointer representation so deployments with
  // existing invoices gain durable page mappings without losing history.
  const legacy = await db.select({
    id: hbsInvoices.id, gatewayInvoiceId: hbsInvoices.gatewayInvoiceId, paymentUrl: hbsInvoices.paymentUrl,
  }).from(hbsInvoices).where(isNotNull(hbsInvoices.gatewayInvoiceId));
  for (const item of legacy) {
    if (item.gatewayInvoiceId) await rememberGatewayPage(item.id, { id: item.gatewayInvoiceId, url: item.paymentUrl ?? "" });
  }
  // Reconcile all known pages, including pages for manually closed invoices.
  // Oldest/never-checked first prevents an old delayed payment being starved.
  const pages = await db.select().from(hbsInvoiceGatewayPages)
    .orderBy(sql`${hbsInvoiceGatewayPages.lastCheckedAt} asc nulls first`, asc(hbsInvoiceGatewayPages.createdAt)).limit(200);
  let settled = 0;
  for (const page of pages) {
    try {
      const associated = await invoiceForGatewayPage(page.gatewayInvoiceId);
      if (!associated) continue;
      const wasIssued = associated.invoice.status === "issued";
      if (wasIssued && (await settleFromGateway(associated.invoice, associated.request,
        await fetchGatewayInvoice(page.gatewayInvoiceId))).status === "paid") settled++;
    } catch (err) {
      logger.warn({ err, invoiceId: page.invoiceId, gatewayInvoiceId: page.gatewayInvoiceId }, "Payment reconciliation failed for a gateway page");
      try { await noteGatewayPageChecked(page.gatewayInvoiceId); } catch { /* retain the original gateway failure */ }
    }
  }
  return settled;
}

export function startPaymentReconciliation() {
  const schedule = (delay: number) => {
    setTimeout(async () => {
      try {
        const settled = await reconcileOnlinePayments();
        if (settled) logger.info({ settled }, "Reconciled online payments");
      } catch (err) {
        logger.error({ err }, "Payment reconciliation failed");
      } finally { schedule(30 * 60_000); }
    }, delay).unref();
  };
  schedule(2 * 60_000);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Largest amount before VAT an invoice may carry (halalas), as in the contract.
export const MAX_INVOICE_AMOUNT = 100_000_000;

// Inserts an invoice with VAT computed now and records who issued it. The
// caller holds the request locked; the audit actor may differ from issuedBy
// when an accepted quote issues the invoice on the office's behalf. With a
// unit amount the amount is unitAmount × quantity (bulk requests).
export async function issueInvoice(
  tx: Tx, request: Pick<HbsServiceRequest, "id">,
  input: {
    description: string; amount: number; quantity?: number; unitAmount?: number | null; issuedBy: string;
    idempotencyKey?: string | null;
  }, actorId: string,
): Promise<HbsInvoice> {
  const quantity = input.quantity ?? 1;
  const unitAmount = input.unitAmount ?? null;
  const amount = unitAmount === null ? input.amount : unitAmount * quantity;
  const vat = vatFor(amount);
  const values = {
    requestId: request.id, description: input.description, quantity, unitAmountHalalas: unitAmount, amountHalalas: amount,
    vatRateBasisPoints: VAT_RATE_BASIS_POINTS, vatHalalas: vat, totalHalalas: amount + vat,
    issuedBy: input.issuedBy, idempotencyKey: input.idempotencyKey ?? null,
  };
  const inserted = await tx.insert(hbsInvoices).values(values)
    .onConflictDoNothing({ target: [hbsInvoices.requestId, hbsInvoices.idempotencyKey] }).returning();
  let row = inserted[0];
  if (!row && input.idempotencyKey) {
    const [existing] = await tx.select().from(hbsInvoices).where(and(
      eq(hbsInvoices.requestId, request.id), eq(hbsInvoices.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (!existing) throw new Error("Invoice idempotency conflict could not be resolved");
    const samePayload = existing.description === input.description && existing.quantity === quantity &&
      existing.unitAmountHalalas === unitAmount && existing.amountHalalas === amount;
    if (!samePayload) {
      const error = new Error("This idempotency key was already used with different invoice details");
      error.name = "InvoiceIdempotencyConflictError";
      throw error;
    }
    return existing;
  }
  if (!row) throw new Error("Invoice creation failed");
  await recordAudit(tx, {
    actorId, action: "invoice.issue", targetType: "service_request", targetId: request.id,
    details: { invoiceId: row.id, total: row.totalHalalas },
  });
  return row;
}

router.get("/office/service-requests/:id/invoices", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = ListOfficeServiceRequestInvoicesParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Request not found" }); return; }
  const [request] = await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, params.data.id)).limit(1);
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  res.json(ListOfficeServiceRequestInvoicesResponse.parse(await invoicesOf(request)));
});

router.post("/office/service-requests/:id/invoices", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = IssueOfficeInvoiceParams.safeParse(req.params);
  const body = IssueOfficeInvoiceBody.safeParse(req.body);
  const description = body.success ? body.data.description.trim() : "";
  const rawKey = body.success ? body.data.idempotencyKey : undefined;
  if (rawKey !== undefined && rawKey !== null &&
      (typeof rawKey !== "string" || rawKey.trim().length < 1 || rawKey.trim().length > 200)) {
    res.status(400).json({ error: "Invalid invoice idempotency key." });
    return;
  }
  const idempotencyKey = typeof rawKey === "string" ? rawKey.trim() : null;
  if (!params.success || !body.success || description.length < 2) {
    res.status(400).json({ error: "Enter a description and an amount of at least 1 riyal." });
    return;
  }
  const actorId = getAuth(req).userId!;
  // A unit amount prices each of `quantity` units (employees on a bulk
  // request); the total before VAT must stay within the contract's bound.
  const { quantity, unitAmount = null } = body.data;
  if (unitAmount !== null && unitAmount * quantity > MAX_INVOICE_AMOUNT) {
    res.status(400).json({ error: "المبلغ الإجمالي يتجاوز الحد المسموح (مليون ريال)." });
    return;
  }
  let result: { row: HbsInvoice; request: HbsServiceRequest; replay: boolean } | null = null;
  try {
    result = await db.transaction(async tx => {
      const [request] = await tx.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, params.data.id)).for("update");
      if (!request) return null;
      const [prior] = idempotencyKey ? await tx.select().from(hbsInvoices).where(and(
        eq(hbsInvoices.requestId, request.id), eq(hbsInvoices.idempotencyKey, idempotencyKey),
      )).limit(1) : [];
      const row = await issueInvoice(tx, request, {
        description, amount: body.data.amount, quantity, unitAmount, issuedBy: actorId, idempotencyKey,
      }, actorId);
      let current = request;
      if (body.data.markAwaitingPayment && request.status !== "completed" && request.status !== "awaiting_payment") {
        [current] = await tx.update(hbsServiceRequests).set({ status: "awaiting_payment", customerMessage: null, updatedAt: new Date() })
          .where(eq(hbsServiceRequests.id, request.id)).returning();
        await recordAudit(tx, {
          actorId, action: "service_request.update", targetType: "service_request", targetId: request.id,
          details: { fromStatus: request.status, toStatus: "awaiting_payment", noteChanged: false },
        });
      }
      return { row, request: current, replay: Boolean(prior) };
    });
  } catch (error) {
    if (error instanceof Error && error.name === "InvoiceIdempotencyConflictError") {
      res.status(409).json({ error: error.message });
      return;
    }
    if (idempotencyKey) {
      // A lost database commit acknowledgement can leave the client unsure
      // whether issuance succeeded. Resolve a committed write by its unique
      // key; if the database itself cannot answer, tell the caller to retry
      // the exact key rather than issue an unkeyed duplicate.
      try {
        const [existing] = await db.select().from(hbsInvoices).where(and(
          eq(hbsInvoices.requestId, params.data.id), eq(hbsInvoices.idempotencyKey, idempotencyKey),
        )).limit(1);
        if (existing) {
          const quantity = body.data.quantity ?? 1;
          const unitAmount = body.data.unitAmount ?? null;
          const amount = unitAmount === null ? body.data.amount : unitAmount * quantity;
          if (existing.description !== description || existing.quantity !== quantity ||
              existing.unitAmountHalalas !== unitAmount || existing.amountHalalas !== amount) {
            res.status(409).json({ error: "This idempotency key was already used with different invoice details" });
            return;
          }
          const [request] = await db.select().from(hbsServiceRequests)
            .where(eq(hbsServiceRequests.id, existing.requestId!)).limit(1);
          if (request) {
            result = { row: existing, request, replay: true };
          }
        }
      } catch (lookupError) {
        req.log.error({ err: lookupError, requestId: params.data.id }, "Could not resolve invoice issue commit outcome");
      }
      if (!result) {
        req.log.error({ err: error, requestId: params.data.id }, "Invoice issue commit outcome is uncertain");
        res.status(503).json({ error: "Invoice issuance could not be confirmed. Retry with the same idempotency key." });
        return;
      }
    } else {
      throw error;
    }
  }
  if (!result) { res.status(404).json({ error: "Request not found" }); return; }
  const { row, request, replay } = result;
  res.status(replay ? 200 : 201).json(IssueOfficeInvoiceResponse.parse(invoice(row, request)));
  if (!replay) {
    void notifyCustomer(request.userId, to => invoiceIssuedMail(to,
      { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service },
      invoiceReference(row.id, row.issuedAt), riyals(row.totalHalalas)), { kind: "invoice.issued", targetType: "invoice", targetId: row.id, signals: { amountHalalas: row.totalHalalas }, dedupeKey: "invoice-issued:" + row.id });
  }
});

router.patch("/office/invoices/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = UpdateOfficeInvoiceParams.safeParse(req.params);
  const body = UpdateOfficeInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid invoice action" }); return; }
  const actorId = getAuth(req).userId!;
  const [current] = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .where(eq(hbsInvoices.id, params.data.id)).limit(1);
  if (!current) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (current.invoice.status !== "issued") { res.status(409).json({ error: "This invoice is already paid or cancelled." }); return; }

  // Reserve the gateway claim while checking and closing every issued page.
  // This prevents a concurrent pay request from creating a fresh payable page
  // between the final gateway check and the office transaction.
  const closeClaimAt = new Date();
  const [closeClaim] = await db.update(hbsInvoices).set({ gatewayClaimedAt: closeClaimAt }).where(and(
    eq(hbsInvoices.id, current.invoice.id), eq(hbsInvoices.status, "issued"),
    or(isNull(hbsInvoices.gatewayClaimedAt), lt(hbsInvoices.gatewayClaimedAt, new Date(closeClaimAt.getTime() - GATEWAY_CLAIM_MS))),
  )).returning();
  if (!closeClaim) {
    res.status(409).json({ error: "The payment page is being prepared. Try again in a moment." });
    return;
  }

  try {
    if (current.invoice.gatewayInvoiceId) {
      await rememberGatewayPage(current.invoice.id, {
        id: current.invoice.gatewayInvoiceId, url: current.invoice.paymentUrl ?? "",
      });
    }
    const pages = await db.select().from(hbsInvoiceGatewayPages)
      .where(eq(hbsInvoiceGatewayPages.invoiceId, current.invoice.id));
    if (pages.length && !moyasarConfigured()) {
      throw new Error("Cannot safely close an invoice while its online payment pages cannot be checked");
    }
    for (const page of pages) {
      const remote = await closeGatewayPageSafely(page.gatewayInvoiceId);
      await noteGatewayPageChecked(page.gatewayInvoiceId);
      if (remote.status === "paid") {
        await settleFromGateway(current.invoice, current.request, remote);
        await db.update(hbsInvoices).set({ gatewayClaimedAt: null })
          .where(and(eq(hbsInvoices.id, current.invoice.id), eq(hbsInvoices.gatewayClaimedAt, closeClaimAt)));
        res.status(409).json({ error: "This invoice was already paid online." });
        return;
      }
      await db.update(hbsInvoiceGatewayPages).set({ closedAt: new Date() })
        .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, page.gatewayInvoiceId));
    }
  } catch (error) {
    req.log.warn({ err: error, invoiceId: current.invoice.id }, "Could not safely close every payment page");
    await db.update(hbsInvoices).set({ gatewayClaimedAt: null })
      .where(and(eq(hbsInvoices.id, current.invoice.id), eq(hbsInvoices.gatewayClaimedAt, closeClaimAt)));
    res.status(502).json({ error: "Could not confirm that all online payment pages are closed. Try again shortly." });
    return;
  }
  let outcome:
    | "missing" | "closed" | "busy"
    | { row: HbsInvoice; request: HbsServiceRequest | null };
  try {
    outcome = await db.transaction(async tx => {
      const [found] = await tx.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
        .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
        .where(eq(hbsInvoices.id, params.data.id)).for("update", { of: hbsInvoices });
      if (!found) return "missing" as const;
      if (found.invoice.status !== "issued") return "closed" as const;
      if (!found.invoice.gatewayClaimedAt || found.invoice.gatewayClaimedAt.getTime() !== closeClaimAt.getTime()) {
        return "busy" as const;
      }
      const paid = body.data.action === "mark_paid";
      const [row] = await tx.update(hbsInvoices).set(paid
        ? { status: "paid", paymentMethod: "manual", paymentReference: body.data.paymentReference?.trim() || null, paidAt: new Date(), gatewayClaimedAt: null }
        : { status: "cancelled", cancelledAt: new Date(), paymentUrl: null, gatewayClaimedAt: null }).where(eq(hbsInvoices.id, found.invoice.id)).returning();
      await recordAudit(tx, {
        actorId, action: paid ? "invoice.mark_paid" : "invoice.cancel", ...auditTarget(row, found.request),
        details: { invoiceId: row.id, total: row.totalHalalas, ...(row.paymentReference ? { paymentReference: row.paymentReference } : {}) },
      });
      return { row, request: found.request };
    });
  } catch (error) {
    // The gateway pages are confirmed closed, but the DB commit may have
    // succeeded even if its acknowledgement was lost. Resolve by rereading
    // before reporting failure; never pretend a failed commit is a success.
    req.log.error({ err: error, invoiceId: current.invoice.id }, "Office invoice closure commit outcome is uncertain");
    try {
      const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, current.invoice.id));
      const expected = body.data.action === "mark_paid" ? "paid" : "cancelled";
      if (fresh?.status === expected) {
        const [request] = fresh.requestId
          ? await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, fresh.requestId)).limit(1)
          : [];
        outcome = { row: fresh, request: request ?? null };
      } else {
        await db.update(hbsInvoices).set({ gatewayClaimedAt: null }).where(and(
          eq(hbsInvoices.id, current.invoice.id), eq(hbsInvoices.status, "issued"),
          eq(hbsInvoices.gatewayClaimedAt, closeClaimAt),
        ));
        res.status(502).json({ error: "Invoice closure could not be confirmed. Check the invoice status and try again." });
        return;
      }
    } catch (readError) {
      req.log.error({ err: readError, invoiceId: current.invoice.id }, "Could not resolve the invoice closure commit outcome");
      res.status(502).json({ error: "Invoice closure outcome is uncertain. Check the invoice status before retrying." });
      return;
    }
  }
  if (outcome === "missing") { res.status(404).json({ error: "Invoice not found" }); return; }
  if (outcome === "closed") {
    await db.update(hbsInvoices).set({ gatewayClaimedAt: null }).where(and(
      eq(hbsInvoices.id, current.invoice.id), eq(hbsInvoices.gatewayClaimedAt, closeClaimAt),
    ));
    res.status(409).json({ error: "This invoice is already paid or cancelled." });
    return;
  }
  if (outcome === "busy") { res.status(409).json({ error: "The payment page is being prepared. Try again in a moment." }); return; }
  // Paid or cancelled, the request no longer waits on this invoice.
  if (outcome.request) await resumeAfterPayment(outcome.request.id);
  else if (outcome.row.status === "paid") await onSubscriptionInvoicePaid(outcome.row);
  res.json(UpdateOfficeInvoiceResponse.parse(invoice(outcome.row, outcome.request)));
});

export default router;
