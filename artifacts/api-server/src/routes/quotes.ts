import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, hbsRequestMessages, hbsServiceRequests, type HbsServiceRequest } from "@workspace/db";
import {
  AcceptQuoteParams, AcceptQuoteResponse, DeclineQuoteBody, DeclineQuoteParams, DeclineQuoteResponse,
  SendOfficeQuoteBody, SendOfficeQuoteParams, SendOfficeQuoteResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { AUTOMATION_ACTOR, resumeAfterCustomerReply } from "../lib/automations";
import { customerContextOf } from "../lib/company-access";
import { notifyCustomer, notifyOffice } from "../lib/customer-contact";
import { invoiceReference, requestReference, riyals, vatFor } from "../lib/money";
import { quoteAcceptedMail, quoteDeclinedMail, quoteSentMail } from "../lib/notify";
import { requireOfficeStaff } from "../lib/office-access";
import { canTransition } from "../lib/request-status";
import { issueInvoice } from "./billing";
import { customerOf, detailsFor, officeRequest, publicRequest, requireApprovedCustomer, staffEmail } from "./portal";

// A price quote before work starts. The office sends it (and may revise it),
// the customer accepts or declines from the request page. Accepting issues
// the invoice for the quoted amount; declining keeps the quote on record so
// the office can answer and send a new one.

const router: IRouter = Router();

const info = (record: HbsServiceRequest) => ({ id: record.id, reference: requestReference(record.id, record.createdAt), service: record.service });

router.post("/office/service-requests/:id/quote", requireOfficeStaff, async (req, res): Promise<void> => {
  const params = SendOfficeQuoteParams.safeParse(req.params);
  const body = SendOfficeQuoteBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Enter an amount of at least 1 riyal." }); return; }
  const actorId = getAuth(req).userId!;
  const note = body.data.note?.trim() || null;
  const markWaiting = body.data.markWaiting ?? true;
  const total = riyals(body.data.amount + vatFor(body.data.amount));
  const outcome = await db.transaction(async tx => {
    const [request] = await tx.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, params.data.id)).for("update");
    if (!request) return "missing" as const;
    if (request.status === "completed") return "completed" as const;
    // The customer answers the quote from the request page, so the request
    // waits on them with a message saying what to do.
    const waits = markWaiting && canTransition(request.status, "waiting_on_customer");
    const [updated] = await tx.update(hbsServiceRequests).set({
      quoteHalalas: body.data.amount, quoteNote: note, quotedAt: new Date(), quoteAcceptedAt: null, quoteDeclinedAt: null, quotedBy: actorId,
      ...(waits ? { status: "waiting_on_customer", customerMessage: `أرسل المكتب عرض سعر: ${total}. راجعه ووافق عليه من صفحة الطلب.` } : {}),
      updatedAt: new Date(),
    }).where(eq(hbsServiceRequests.id, request.id)).returning();
    await recordAudit(tx, {
      actorId, action: "service_request.quote", targetType: "service_request", targetId: request.id,
      details: { amount: body.data.amount, total: body.data.amount + vatFor(body.data.amount), revised: request.quotedAt !== null },
    });
    if (waits && request.status !== updated.status) {
      await recordAudit(tx, {
        actorId, action: "service_request.update", targetType: "service_request", targetId: request.id,
        details: { fromStatus: request.status, toStatus: updated.status, noteChanged: false },
      });
    }
    return updated;
  });
  if (outcome === "missing") { res.status(404).json({ error: "Request not found" }); return; }
  if (outcome === "completed") { res.status(409).json({ error: "The request is completed" }); return; }
  const details = (await detailsFor([outcome])).get(outcome.id);
  res.json(SendOfficeQuoteResponse.parse(officeRequest(outcome, details, await customerOf(outcome.userId))));
  void notifyCustomer(outcome.userId, to => quoteSentMail(to, info(outcome), total, note),
    { kind: "quote.sent", targetType: "service_request", targetId: outcome.id, signals: { amountHalalas: outcome.quoteHalalas ?? undefined } });
});

// The customer's own request with a quote still open to a decision, locked.
async function quotedRequest(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: number, userId: string) {
  const [request] = await tx.select().from(hbsServiceRequests)
    .where(and(eq(hbsServiceRequests.id, id), eq(hbsServiceRequests.userId, userId))).for("update");
  if (!request) return "missing" as const;
  if (request.quoteHalalas === null || request.quotedAt === null || request.quoteAcceptedAt !== null || request.status === "completed") return "closed" as const;
  return request;
}

// The accepted quote's invoice is open, so the request waits for payment
// like one the office invoices by hand (billing marks awaiting_payment by
// default); paying it resumes review. Recorded as the automation, through the
// status machine: a request that cannot move stays where it is.
async function awaitPayment(requestId: number): Promise<HbsServiceRequest | null> {
  return db.transaction(async tx => {
    const [request] = await tx.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, requestId)).for("update");
    if (!request || request.status === "awaiting_payment" || !canTransition(request.status, "awaiting_payment")) return request ?? null;
    const [updated] = await tx.update(hbsServiceRequests).set({ status: "awaiting_payment", customerMessage: null, updatedAt: new Date() })
      .where(eq(hbsServiceRequests.id, requestId)).returning();
    await recordAudit(tx, {
      actorId: AUTOMATION_ACTOR, action: "service_request.update", targetType: "service_request", targetId: requestId,
      details: { fromStatus: request.status, toStatus: "awaiting_payment", noteChanged: false, automatic: "quote_accepted" },
    });
    return updated;
  });
}

router.post("/service-requests/:id/quote/accept", requireApprovedCustomer, async (req, res): Promise<void> => {
  const params = AcceptQuoteParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Request not found" }); return; }
  // The company's request; the decision is audited to the person who made it.
  const { customerId, userId } = customerContextOf(req);
  const outcome = await db.transaction(async tx => {
    const request = await quotedRequest(tx, params.data.id, customerId);
    if (typeof request === "string") return request;
    const [updated] = await tx.update(hbsServiceRequests).set({ quoteAcceptedAt: new Date(), quoteDeclinedAt: null, updatedAt: new Date() })
      .where(eq(hbsServiceRequests.id, request.id)).returning();
    await recordAudit(tx, {
      actorId: userId, action: "service_request.quote_accept", targetType: "service_request", targetId: request.id,
      details: { amount: request.quoteHalalas },
    });
    // The invoice carries the service and the office's note, issued in the
    // name of whoever quoted (or the automation when that member is gone).
    const invoice = await issueInvoice(tx, request, {
      description: [`أتعاب الخدمة — ${request.service}`, ...(request.quoteNote ? [request.quoteNote] : [])].join(" · ").slice(0, 300),
      amount: request.quoteHalalas!, issuedBy: request.quotedBy ?? AUTOMATION_ACTOR,
    }, userId);
    return { request: updated, invoice };
  });
  if (outcome === "missing") { res.status(404).json({ error: "Request not found" }); return; }
  if (outcome === "closed") { res.status(409).json({ error: "There is no quote waiting for your decision." }); return; }
  // Accepting answers the office, like a message would; the invoice it
  // issued then holds the request at awaiting_payment until it is paid.
  await resumeAfterCustomerReply(outcome.request.id, "quote_accepted");
  const current = (await awaitPayment(outcome.request.id)) ?? outcome.request;
  res.json(AcceptQuoteResponse.parse(publicRequest(current, (await detailsFor([current])).get(current.id))));
  const acceptedEmail = current.assignedTo ? await staffEmail(current.assignedTo) : null;
  void notifyOffice(() => quoteAcceptedMail(acceptedEmail, info(current),
    `${riyals(outcome.invoice.totalHalalas)} (${invoiceReference(outcome.invoice.id, outcome.invoice.issuedAt)})`),
  { kind: "office.quote_answered", targetType: "service_request", targetId: current.id, signals: { amountHalalas: outcome.invoice.totalHalalas } });
});

router.post("/service-requests/:id/quote/decline", requireApprovedCustomer, async (req, res): Promise<void> => {
  const params = DeclineQuoteParams.safeParse(req.params);
  const body = DeclineQuoteBody.safeParse(req.body ?? {});
  if (!params.success) { res.status(404).json({ error: "Request not found" }); return; }
  if (!body.success) { res.status(400).json({ error: "The reason is too long." }); return; }
  const { customerId, userId } = customerContextOf(req);
  const reason = body.data.reason?.trim() || null;
  const outcome = await db.transaction(async tx => {
    const request = await quotedRequest(tx, params.data.id, customerId);
    if (typeof request === "string") return request;
    if (request.quoteDeclinedAt !== null) return "closed" as const;
    const [updated] = await tx.update(hbsServiceRequests).set({ quoteDeclinedAt: new Date(), updatedAt: new Date() })
      .where(eq(hbsServiceRequests.id, request.id)).returning();
    await recordAudit(tx, {
      actorId: userId, action: "service_request.quote_decline", targetType: "service_request", targetId: request.id,
      details: { amount: request.quoteHalalas, withReason: reason !== null },
    });
    // The reason goes into the conversation so the office can answer it there.
    await tx.insert(hbsRequestMessages).values({
      requestId: request.id, authorId: userId, authorRole: "customer",
      body: reason ? `لم أوافق على عرض السعر: ${reason}` : "لم أوافق على عرض السعر.",
    });
    return updated;
  });
  if (outcome === "missing") { res.status(404).json({ error: "Request not found" }); return; }
  if (outcome === "closed") { res.status(409).json({ error: "There is no quote waiting for your decision." }); return; }
  const current = (await resumeAfterCustomerReply(outcome.id, "quote_declined")) ?? outcome;
  res.json(DeclineQuoteResponse.parse(publicRequest(current, (await detailsFor([current])).get(current.id))));
  const declinedEmail = current.assignedTo ? await staffEmail(current.assignedTo) : null;
  void notifyOffice(() => quoteDeclinedMail(declinedEmail, info(current)), { kind: "office.quote_answered", targetType: "service_request", targetId: current.id });
});

export default router;
