import { getAuth } from "@clerk/express";
import { timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler, type Response } from "express";
import { db, hbsInvoices, hbsServiceRequests, hbsSubscriptions, type HbsInvoice, type HbsServiceRequest } from "@workspace/db";
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

// Marks an invoice paid only when the gateway itself reports it paid in full,
// in riyals. Safe to call repeatedly and from several places at once.
export async function settleFromGateway(row: HbsInvoice, request: HbsServiceRequest | null, gateway?: GatewayInvoice): Promise<HbsInvoice> {
  if (!row.gatewayInvoiceId) return row;
  if (row.status !== "issued") {
    // Paid on the gateway after the office closed the invoice: the money must
    // not go unnoticed. Logged and emailed so the office can refund or match it.
    if (gateway && gateway.id === row.gatewayInvoiceId && gateway.status === "paid") {
      logger.error({ invoiceId: row.id, gatewayInvoiceId: gateway.id, status: row.status }, "Online payment received for a closed invoice");
      void notifyOffice(() => closedInvoicePaidMail(subjectInfo(row, request), invoiceReference(row.id, row.issuedAt), riyals(gateway.amount)),
        { kind: "office.invoice_paid", targetType: "invoice", targetId: row.id, signals: { amountHalalas: gateway.amount, repeated: true } });
    }
    return row;
  }
  const remote = gateway ?? await fetchGatewayInvoice(row.gatewayInvoiceId);
  if (remote.id !== row.gatewayInvoiceId || remote.status !== "paid" || remote.amount !== row.totalHalalas || remote.currency !== "SAR") return row;
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
  if (!updated) return (await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, row.id)))[0] ?? row;
  // A paid request invoice resumes the request; a paid subscription invoice
  // reactivates a past-due subscription without waiting for the daily sweep.
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
      const existing = await fetchGatewayInvoice(row.gatewayInvoiceId);
      if (existing.status === "paid") { await settleFromGateway(row, request, existing); closed(); return; }
      if (existing.status === "initiated" && row.paymentUrl) { res.json(StartInvoicePaymentResponse.parse({ url: row.paymentUrl })); return; }
      // The page at the gateway expired or was closed: a new one replaces it,
      // and the old one is closed so it cannot take a payment nothing tracks.
      cancelGatewayInvoice(row.gatewayInvoiceId).catch((error: unknown) =>
        req.log.warn({ err: error, invoiceId: row.id }, "Could not close the replaced payment page"));
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
    const [stored] = await db.update(hbsInvoices).set({ gatewayInvoiceId: created.id, paymentUrl: created.url, gatewayClaimedAt: null })
      .where(and(eq(hbsInvoices.id, claimed.id), eq(hbsInvoices.status, "issued"), eq(hbsInvoices.gatewayClaimedAt, claimedAt))).returning();
    if (!stored) {
      // The claim was taken over after 60 s or the invoice was closed: the
      // page just created must not stay open with nothing tracking it.
      req.log.warn({ invoiceId: claimed.id, gatewayInvoiceId: created.id }, "Payment page created after the claim was lost; closing it");
      cancelGatewayInvoice(created.id).catch((error: unknown) =>
        req.log.warn({ err: error, invoiceId: claimed.id }, "Could not close the payment page"));
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
  const [row] = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .where(eq(hbsInvoices.gatewayInvoiceId, gatewayId)).limit(1);
  if (row) {
    try { await settleFromGateway(row.invoice, row.request, await fetchGatewayInvoice(gatewayId)); }
    catch (error) { req.log.error({ err: error }, "Webhook payment check failed"); res.status(502).end(); return; }
  }
  res.status(200).end();
});

// Customers who pay and close the tab before returning, without a webhook,
// would leave the invoice unpaid here: check recent open payment pages.
export async function reconcileOnlinePayments(): Promise<number> {
  if (!moyasarConfigured()) return 0;
  const rows = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .where(and(eq(hbsInvoices.status, "issued"), isNotNull(hbsInvoices.gatewayInvoiceId),
      sql`${hbsInvoices.issuedAt} > now() - interval '30 days'`))
    // Newest first: a backlog of stale pages must not keep the latest payments unchecked.
    .orderBy(desc(hbsInvoices.issuedAt), desc(hbsInvoices.id)).limit(200);
  let settled = 0;
  for (const { invoice: row, request } of rows) {
    try { if ((await settleFromGateway(row, request)).status === "paid") settled++; }
    catch (err) { logger.warn({ err, invoiceId: row.id }, "Payment reconciliation failed for an invoice"); }
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
  input: { description: string; amount: number; quantity?: number; unitAmount?: number | null; issuedBy: string }, actorId: string,
): Promise<HbsInvoice> {
  const quantity = input.quantity ?? 1;
  const unitAmount = input.unitAmount ?? null;
  const amount = unitAmount === null ? input.amount : unitAmount * quantity;
  const vat = vatFor(amount);
  const [row] = await tx.insert(hbsInvoices).values({
    requestId: request.id, description: input.description, quantity, unitAmountHalalas: unitAmount, amountHalalas: amount,
    vatRateBasisPoints: VAT_RATE_BASIS_POINTS, vatHalalas: vat, totalHalalas: amount + vat, issuedBy: input.issuedBy,
  }).returning();
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
  const result = await db.transaction(async tx => {
    const [request] = await tx.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, params.data.id)).for("update");
    if (!request) return null;
    const row = await issueInvoice(tx, request, { description, amount: body.data.amount, quantity, unitAmount, issuedBy: actorId }, actorId);
    let current = request;
    if (body.data.markAwaitingPayment && request.status !== "completed" && request.status !== "awaiting_payment") {
      [current] = await tx.update(hbsServiceRequests).set({ status: "awaiting_payment", customerMessage: null, updatedAt: new Date() })
        .where(eq(hbsServiceRequests.id, request.id)).returning();
      await recordAudit(tx, {
        actorId, action: "service_request.update", targetType: "service_request", targetId: request.id,
        details: { fromStatus: request.status, toStatus: "awaiting_payment", noteChanged: false },
      });
    }
    return { row, request: current };
  });
  if (!result) { res.status(404).json({ error: "Request not found" }); return; }
  const { row, request } = result;
  res.status(201).json(IssueOfficeInvoiceResponse.parse(invoice(row, request)));
  void notifyCustomer(request.userId, to => invoiceIssuedMail(to,
    { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service },
    invoiceReference(row.id, row.issuedAt), riyals(row.totalHalalas)),
  { kind: "invoice.issued", targetType: "invoice", targetId: row.id, signals: { amountHalalas: row.totalHalalas } });
});

router.patch("/office/invoices/:id", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = UpdateOfficeInvoiceParams.safeParse(req.params);
  const body = UpdateOfficeInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid invoice action" }); return; }
  const actorId = getAuth(req).userId!;
  // An invoice with a payment page may already be paid online: settle it
  // from the gateway instead of recording a second, manual payment.
  const [current] = await db.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
    .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
    .where(eq(hbsInvoices.id, params.data.id)).limit(1);
  if (current?.invoice.status === "issued" && current.invoice.gatewayInvoiceId && moyasarConfigured()) {
    try {
      const settled = await settleFromGateway(current.invoice, current.request);
      if (settled.status === "paid") {
        res.status(409).json({ error: "This invoice was already paid online." });
        return;
      }
    } catch (error) {
      req.log.warn({ err: error }, "Could not check the payment gateway");
      res.status(502).json({ error: "Could not confirm with the payment gateway that this invoice is unpaid. Try again shortly." });
      return;
    }
  }
  const outcome = await db.transaction(async tx => {
    const [found] = await tx.select({ invoice: hbsInvoices, request: hbsServiceRequests }).from(hbsInvoices)
      .leftJoin(hbsServiceRequests, eq(hbsInvoices.requestId, hbsServiceRequests.id))
      .where(eq(hbsInvoices.id, params.data.id)).for("update", { of: hbsInvoices });
    if (!found) return "missing" as const;
    if (found.invoice.status !== "issued") return "closed" as const;
    const paid = body.data.action === "mark_paid";
    const [row] = await tx.update(hbsInvoices).set(paid
      ? { status: "paid", paymentMethod: "manual", paymentReference: body.data.paymentReference?.trim() || null, paidAt: new Date() }
      : { status: "cancelled", cancelledAt: new Date(), paymentUrl: null }).where(eq(hbsInvoices.id, found.invoice.id)).returning();
    await recordAudit(tx, {
      actorId, action: paid ? "invoice.mark_paid" : "invoice.cancel", ...auditTarget(row, found.request),
      details: { invoiceId: row.id, total: row.totalHalalas, ...(row.paymentReference ? { paymentReference: row.paymentReference } : {}) },
    });
    return { row, request: found.request };
  });
  if (outcome === "missing") { res.status(404).json({ error: "Invoice not found" }); return; }
  if (outcome === "closed") { res.status(409).json({ error: "This invoice is already paid or cancelled." }); return; }
  // Paid or cancelled, the request no longer waits on this invoice.
  if (outcome.request) await resumeAfterPayment(outcome.request.id);
  else if (outcome.row.status === "paid") await onSubscriptionInvoicePaid(outcome.row);
  res.json(UpdateOfficeInvoiceResponse.parse(invoice(outcome.row, outcome.request)));
  // An open payment page would still take the customer's money: close it.
  // A payment that slips in first is still caught by the webhook.
  const gatewayId = outcome.row.gatewayInvoiceId;
  if (gatewayId && moyasarConfigured()) {
    cancelGatewayInvoice(gatewayId).catch((error: unknown) =>
      req.log.warn({ err: error, invoiceId: outcome.row.id }, "Could not close the payment page"));
  }
});

export default router;
