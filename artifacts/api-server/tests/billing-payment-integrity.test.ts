import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  db, hbsInvoiceGatewayPages, hbsInvoices, hbsOfficeStaff, hbsServiceRequests, pool,
} from "@workspace/db";
import billingRouter from "../src/routes/billing";

if (process.env.NODE_ENV === "production") throw new Error("Billing integrity tests must not run in production");

test("billing gateway reconciliation, safe manual closure and idempotent issue retries", async (t) => {
  const officeEmail = "billing-integrity-office@example.invalid";
  const owner = `billing-integrity-owner-${randomUUID()}`;
  const customers = [`billing-integrity-customer-${randomUUID()}`, `billing-integrity-customer-${randomUUID()}`];
  const requestIds: number[] = [];
  const invoiceIds: number[] = [];
  const gatewayStates = new Map<string, { id: string; status: string; amount: number; currency: string; url: string }>();
  let cancelMode: "fail" | "paid" | "cancel" = "cancel";
  const oldFetch = globalThis.fetch;
  process.env.HBS_OFFICE_EMAIL = officeEmail;
  process.env.MOYASAR_SECRET_KEY = "test-only-no-network";
  process.env.MOYASAR_WEBHOOK_SECRET = "test-webhook-secret";
  delete process.env.SMTP_HOST;
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId, primaryEmailAddressId: null,
    emailAddresses: userId === owner ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.moyasar.com/v1/invoices/")) return oldFetch(input, init);
    const path = url.slice("https://api.moyasar.com/v1/invoices/".length);
    const isCancel = path.endsWith("/cancel");
    const id = isCancel ? path.slice(0, -"/cancel".length) : path;
    const state = gatewayStates.get(id);
    if (!state) return Response.json({ error: "missing" }, { status: 404 });
    if (isCancel) {
      if (cancelMode === "fail") return new Response("gateway unavailable", { status: 503 });
      state.status = cancelMode === "paid" ? "paid" : "cancelled";
    }
    return Response.json(state);
  }) as typeof fetch;

  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", billingRouter);
  const server = app.listen(0);

  async function call(user: string, method: string, path: string, body?: unknown) {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await oldFetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method, headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }

  async function makeRequest(userId: string) {
    const [request] = await db.insert(hbsServiceRequests).values({
      userId, category: "other", service: "Payment integrity test", description: "Test invoice handling", contactPhone: "0500000000",
    }).returning();
    requestIds.push(request.id);
    return request;
  }

  async function makeInvoice(requestId: number, suffix: string) {
    const [invoice] = await db.insert(hbsInvoices).values({
      requestId, description: "Test service", quantity: 1, amountHalalas: 5_000,
      vatRateBasisPoints: 1_500, vatHalalas: 750, totalHalalas: 5_750, issuedBy: owner,
    }).returning();
    invoiceIds.push(invoice.id);
    const pageId = `integrity-${suffix}-${randomUUID().slice(0, 8)}`;
    const page = { id: pageId, status: "initiated", amount: invoice.totalHalalas, currency: "SAR", url: `https://pay.invalid/${pageId}` };
    gatewayStates.set(pageId, page);
    await db.insert(hbsInvoiceGatewayPages).values({ gatewayInvoiceId: pageId, invoiceId: invoice.id, paymentUrl: page.url });
    await db.update(hbsInvoices).set({ gatewayInvoiceId: pageId, paymentUrl: page.url }).where(eq(hbsInvoices.id, invoice.id));
    return { invoice, page };
  }

  try {
    await once(server, "listening");
    await db.insert(hbsOfficeStaff).values({ userId: owner });

    await t.test("cancellation failure blocks manual closure and leaves the invoice issued", async () => {
      cancelMode = "fail";
      const request = await makeRequest(customers[0]!);
      const { invoice, page } = await makeInvoice(request.id, "cancel-fail");
      const result = await call(owner, "PATCH", `/office/invoices/${invoice.id}`, { action: "cancel" });
      assert.equal(result.status, 502);
      const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
      assert.equal(fresh?.status, "issued");
      assert.equal(gatewayStates.get(page.id)?.status, "initiated");
    });

    await t.test("a delayed payment from an older page settles its original invoice", async () => {
      const request = await makeRequest(customers[0]!);
      const { invoice, page: currentPage } = await makeInvoice(request.id, "old-page");
      const oldId = `integrity-old-${randomUUID().slice(0, 8)}`;
      const oldPage = { id: oldId, status: "paid", amount: invoice.totalHalalas, currency: "SAR", url: `https://pay.invalid/${oldId}` };
      gatewayStates.set(oldId, oldPage);
      await db.insert(hbsInvoiceGatewayPages).values({ gatewayInvoiceId: oldId, invoiceId: invoice.id, paymentUrl: oldPage.url });
      // Current pointer intentionally names a different page.
      assert.notEqual(currentPage.id, oldId);
      const result = await call(customers[0]!, "POST", "/payments/moyasar/webhook", {
        secret_token: "test-webhook-secret", data: { invoice_id: oldId },
      });
      assert.equal(result.status, 200);
      const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
      assert.equal(fresh?.status, "paid");
      assert.equal(fresh?.paymentMethod, "online");
      assert.equal(fresh?.paymentReference, oldId);
    });

    await t.test("a payment racing office closure wins as an online payment", async () => {
      cancelMode = "paid";
      const request = await makeRequest(customers[0]!);
      const { invoice, page } = await makeInvoice(request.id, "closure-race");
      const result = await call(owner, "PATCH", `/office/invoices/${invoice.id}`, { action: "mark_paid", paymentReference: "manual-ref" });
      assert.equal(result.status, 409);
      const [fresh] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
      assert.equal(fresh?.status, "paid");
      assert.equal(fresh?.paymentMethod, "online");
      assert.equal(fresh?.paymentReference, page.id);
    });

    await t.test("concurrent issue retries with a key produce one invoice and reject changed payload", async () => {
      const request = await makeRequest(customers[1]!);
      const payload = { description: "Duplicate-resistant invoice", amount: 1_000, idempotencyKey: `issue-${randomUUID()}` };
      const [first, second] = await Promise.all([
        call(owner, "POST", `/office/service-requests/${request.id}/invoices`, payload),
        call(owner, "POST", `/office/service-requests/${request.id}/invoices`, payload),
      ]);
      assert.ok(first.status === 201 || first.status === 200, JSON.stringify(first));
      assert.ok(second.status === 201 || second.status === 200, JSON.stringify(second));
      assert.equal(first.data.id, second.data.id);
      const rows = await db.select().from(hbsInvoices).where(eq(hbsInvoices.requestId, request.id));
      assert.equal(rows.length, 1);
      const conflict = await call(owner, "POST", `/office/service-requests/${request.id}/invoices`, {
        ...payload, amount: 2_000,
      });
      assert.equal(conflict.status, 409);
      assert.equal((await db.select().from(hbsInvoices).where(eq(hbsInvoices.requestId, request.id))).length, 1);
    });
  } finally {
    globalThis.fetch = oldFetch;
    const allInvoiceIds = new Set(invoiceIds);
    if (requestIds.length) {
      const issued = await db.select({ id: hbsInvoices.id }).from(hbsInvoices)
        .where(inArray(hbsInvoices.requestId, requestIds));
      for (const row of issued) allInvoiceIds.add(row.id);
    }
    if (allInvoiceIds.size) {
      const ids = [...allInvoiceIds];
      await db.delete(hbsInvoiceGatewayPages).where(inArray(hbsInvoiceGatewayPages.invoiceId, ids));
      await db.delete(hbsInvoices).where(inArray(hbsInvoices.id, ids));
    }
    if (requestIds.length) await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.id, requestIds));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, owner));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    delete process.env.MOYASAR_SECRET_KEY;
    delete process.env.MOYASAR_WEBHOOK_SECRET;
    delete process.env.HBS_OFFICE_EMAIL;
    await pool.end();
  }
});
