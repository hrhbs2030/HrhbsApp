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
  db, hbsInvoiceGatewayPages, hbsInvoices, hbsOfficeStaff, hbsRequestAttachments, hbsRequestMessages, hbsServiceOffers, hbsServiceRequests, pool,
} from "@workspace/db";
import portalRouter, { requireApprovedCustomer } from "../src/routes/portal";
import billingRouter from "../src/routes/billing";
import quotesRouter from "../src/routes/quotes";
import checklistRouter from "../src/routes/checklist";
import wathqRouter, { crLookupHandler } from "../src/routes/wathq";
import { remindOverdueInvoices } from "../src/lib/invoice-reminders";
import { vatFor } from "../src/lib/money";

if (process.env.NODE_ENV === "production") throw new Error("Package C tests must not run in production");

const officeEmail = "package-c-owner@example.invalid";
const owner = `package-c-owner-${randomUUID()}`;
const customer = `package-c-customer-${randomUUID()}`;
const otherCustomer = `package-c-other-${randomUUID()}`;
const offerSlug = `package-c-${randomUUID().slice(0, 8)}`;

test("quotes, document checklists, overdue reminders and CR lookups", async (t) => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId, primaryEmailAddressId: null,
    emailAddresses: userId === owner ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  delete process.env.SMTP_HOST;
  delete process.env.MOYASAR_SECRET_KEY;
  delete process.env.WATHQ_API_KEY;
  // Injected into a test-only route so no lookup ever leaves the process.
  let wathqReply: () => Response = () => new Response("{}", { status: 500 });
  const wathqCalls: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    wathqCalls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return wathqReply();
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    // Only this ephemeral app supplies test identities; production auth is untouched.
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  for (const router of [portalRouter, billingRouter, quotesRouter, checklistRouter, wathqRouter]) app.use("/api", router);
  app.get("/api/test/cr-lookup", requireApprovedCustomer, crLookupHandler(fakeFetch));
  const server = app.listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const call = async (user: string, method: string, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method, headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null };
    };
    const requestRow = async (id: number) => (await db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.id, id)))[0];
    await db.insert(hbsOfficeStaff).values({ userId: owner });
    // A request on file grants customer access (legacy customers).
    for (const user of [customer, otherCustomer]) {
      await db.insert(hbsServiceRequests).values({ userId: user, category: "other", service: "Fixture", description: "Grants access.", contactPhone: "0500000000" });
    }
    await db.insert(hbsServiceOffers).values({ slug: offerSlug, published: true, updatedBy: owner, requiredDocuments: ["صورة الإقامة", "صورة الجواز"] });

    let quoted = 0;
    await t.test("the office quotes, the customer sees it and the request waits on them", async () => {
      const created = await call(customer, "POST", "/service-requests", { category: "passports", service: "تجديد الإقامة", description: "Renew the iqama please.", contactPhone: "0500000000" });
      assert.equal(created.status, 201);
      quoted = created.data.id;
      assert.equal(created.data.quote, null);
      assert.equal((await call(owner, "POST", `/office/service-requests/${quoted}/quote`, { amount: 50 })).status, 400);
      const sent = await call(owner, "POST", `/office/service-requests/${quoted}/quote`, { amount: 20_000, note: "شامل رسوم المكتب" });
      assert.equal(sent.status, 200, JSON.stringify(sent.data));
      assert.equal(sent.data.status, "waiting_on_customer");
      assert.deepEqual({ amount: sent.data.quote.amount, vat: sent.data.quote.vat, total: sent.data.quote.total, note: sent.data.quote.note },
        { amount: 20_000, vat: vatFor(20_000), total: 23_000, note: "شامل رسوم المكتب" });
      assert.equal(sent.data.quote.acceptedAt, null);
      const seen = await call(customer, "GET", `/service-requests/${quoted}`);
      assert.equal(seen.data.quote.total, 23_000);
      assert.match(seen.data.customerMessage, /عرض سعر/);
      assert.equal((await call(otherCustomer, "GET", `/service-requests/${quoted}`)).status, 404);
      const history = await call(customer, "GET", `/service-requests/${quoted}/history`);
      assert.deepEqual(history.data.map((e: any) => e.status), ["received", "waiting_on_customer"]);
    });

    await t.test("accepting issues the invoice with VAT and moves the request on; once only", async () => {
      assert.equal((await call(otherCustomer, "POST", `/service-requests/${quoted}/quote/accept`)).status, 404);
      const accepted = await call(customer, "POST", `/service-requests/${quoted}/quote/accept`);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.ok(accepted.data.quote.acceptedAt);
      assert.equal(accepted.data.status, "awaiting_payment", "the accepted quote's invoice holds the request until it is paid");
      const history = await call(customer, "GET", `/service-requests/${quoted}/history`);
      assert.deepEqual(history.data.map((e: any) => e.status), ["received", "waiting_on_customer", "reviewing", "awaiting_payment"], "through the status machine");
      assert.equal((await call(customer, "GET", "/service-requests")).data.filter((r: any) => r.status === "awaiting_payment").length, 1, "the dashboard's unpaid filter finds it");
      const invoices = await call(customer, "GET", `/service-requests/${quoted}/invoices`);
      assert.equal(invoices.data.length, 1);
      assert.deepEqual({ amount: invoices.data[0].amount, vat: invoices.data[0].vat, total: invoices.data[0].total, status: invoices.data[0].status },
        { amount: 20_000, vat: 3_000, total: 23_000, status: "issued" });
      assert.match(invoices.data[0].description, /أتعاب الخدمة — تجديد الإقامة/);
      assert.equal((await db.select().from(hbsInvoices).where(eq(hbsInvoices.requestId, quoted)))[0].issuedBy, owner);
      assert.equal((await call(customer, "POST", `/service-requests/${quoted}/quote/accept`)).status, 409);
      assert.equal((await call(customer, "POST", `/service-requests/${quoted}/quote/decline`, {})).status, 409);
      // Paying the invoice sends the request back to the office's review.
      const paid = await call(owner, "PATCH", `/office/invoices/${invoices.data[0].id}`, { action: "mark_paid" });
      assert.equal(paid.status, 200, JSON.stringify(paid.data));
      assert.equal((await requestRow(quoted)).status, "reviewing");
      // A completed request takes no quote.
      await db.update(hbsServiceRequests).set({ status: "completed" }).where(eq(hbsServiceRequests.id, quoted));
      assert.equal((await call(owner, "POST", `/office/service-requests/${quoted}/quote`, { amount: 1_000 })).status, 409);
    });

    await t.test("declining records the reason as a message and resumes review; a revised quote can then be accepted", async () => {
      const created = await call(customer, "POST", "/service-requests", { category: "labor", service: "نقل خدمات", description: "Transfer a worker please.", contactPhone: "0500000000" });
      const id = created.data.id;
      assert.equal((await call(customer, "POST", `/service-requests/${id}/quote/decline`, { reason: "غالٍ" })).status, 409, "no quote yet");
      assert.equal((await call(owner, "POST", `/office/service-requests/${id}/quote`, { amount: 30_000, markWaiting: false })).data.status, "received");
      await db.update(hbsServiceRequests).set({ status: "waiting_on_customer", customerMessage: "راجع العرض" }).where(eq(hbsServiceRequests.id, id));
      const declined = await call(customer, "POST", `/service-requests/${id}/quote/decline`, { reason: "السعر أعلى من المتوقع" });
      assert.equal(declined.status, 200, JSON.stringify(declined.data));
      assert.ok(declined.data.quote.declinedAt);
      assert.equal(declined.data.status, "reviewing");
      const messages = await call(owner, "GET", `/office/service-requests/${id}/messages`);
      assert.equal(messages.data.length, 1);
      assert.equal(messages.data[0].authorRole, "customer");
      assert.match(messages.data[0].body, /السعر أعلى من المتوقع/);
      assert.equal((await call(customer, "POST", `/service-requests/${id}/quote/decline`, {})).status, 409, "declined once");
      assert.equal((await call(customer, "GET", `/service-requests/${id}/invoices`)).data.length, 0);
      // The office revises; the customer may still accept.
      const revised = await call(owner, "POST", `/office/service-requests/${id}/quote`, { amount: 25_000 });
      assert.equal(revised.data.quote.declinedAt, null);
      const accepted = await call(customer, "POST", `/service-requests/${id}/quote/accept`);
      assert.equal(accepted.status, 200);
      assert.equal((await call(customer, "GET", `/service-requests/${id}/invoices`)).data[0].amount, 25_000);
    });

    let listed = 0;
    const files: number[] = [];
    const file = async (userId: string, requestId: number, name: string) => {
      const [row] = await db.insert(hbsRequestAttachments).values({
        userId, requestId, objectPath: `/objects/test/${randomUUID()}`, name, contentType: "application/pdf", size: 10,
        expiresAt: new Date(Date.now() + 60_000),
      }).returning();
      files.push(row.id);
      return row.id;
    };
    await t.test("a request copies the published offer's documents as its checklist; files are linked one per item", async () => {
      const created = await call(customer, "POST", "/service-requests", { category: "passports", service: "تجديد الإقامة", description: "Renew the iqama please.", contactPhone: "0500000000", serviceSlug: offerSlug });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      listed = created.data.id;
      assert.deepEqual(created.data.checklist, [
        { key: "d1", label: "صورة الإقامة", attachmentId: null, attachmentName: null },
        { key: "d2", label: "صورة الجواز", attachmentId: null, attachmentName: null },
      ]);
      const plain = await call(customer, "POST", "/service-requests", { category: "passports", service: "تجديد الإقامة", description: "Renew the iqama please.", contactPhone: "0500000000", serviceSlug: "no-such-offer" });
      assert.deepEqual(plain.data.checklist, []);
      const iqama = await file(customer, listed, "iqama.pdf");
      const iqama2 = await file(customer, listed, "iqama-2.pdf");
      const officeFile = await file(owner, listed, "office.pdf");
      assert.equal((await call(customer, "PUT", `/service-requests/${listed}/attachments/${iqama}/checklist`, { key: "d9" })).status, 400);
      assert.equal((await call(customer, "PUT", `/service-requests/${listed}/attachments/${officeFile}/checklist`, { key: "d1" })).status, 404, "not the customer's file");
      assert.equal((await call(otherCustomer, "PUT", `/service-requests/${listed}/attachments/${iqama}/checklist`, { key: "d1" })).status, 404);
      const linked = await call(customer, "PUT", `/service-requests/${listed}/attachments/${iqama}/checklist`, { key: "d1" });
      assert.equal(linked.status, 200, JSON.stringify(linked.data));
      assert.deepEqual(linked.data.checklist[0], { key: "d1", label: "صورة الإقامة", attachmentId: iqama, attachmentName: "iqama.pdf" });
      // A second file on the same item replaces the first.
      const replaced = await call(customer, "PUT", `/service-requests/${listed}/attachments/${iqama2}/checklist`, { key: "d1" });
      assert.equal(replaced.data.checklist[0].attachmentId, iqama2);
      assert.equal((await db.select().from(hbsRequestAttachments).where(eq(hbsRequestAttachments.id, iqama)))[0].checklistKey, null);
      const unlinked = await call(customer, "PUT", `/service-requests/${listed}/attachments/${iqama2}/checklist`, { key: null });
      assert.equal(unlinked.data.checklist[0].attachmentId, null);
      // The office may link any file, including its own uploads.
      const byOffice = await call(owner, "PUT", `/office/service-requests/${listed}/attachments/${officeFile}/checklist`, { key: "d2" });
      assert.equal(byOffice.status, 200);
      assert.equal(byOffice.data.checklist[1].attachmentName, "office.pdf");
    });

    await t.test("completing the checklist resumes a waiting request; office edits keep links by key", async () => {
      const [iqama2] = files.slice(1, 2);
      await db.update(hbsServiceRequests).set({ status: "waiting_on_customer", customerMessage: "أرسل الإقامة" }).where(eq(hbsServiceRequests.id, listed));
      const done = await call(customer, "PUT", `/service-requests/${listed}/attachments/${iqama2}/checklist`, { key: "d1" });
      assert.equal(done.data.status, "reviewing", "every item answered");
      assert.equal(done.data.customerMessage, null);
      assert.equal((await call(owner, "PUT", `/office/service-requests/${listed}/checklist`, { items: [{ key: "bad key", label: "x" }] })).status, 400);
      const edited = await call(owner, "PUT", `/office/service-requests/${listed}/checklist`, {
        items: [{ key: "d1", label: "صورة الإقامة سارية" }, { label: "عقد العمل" }],
      });
      assert.equal(edited.status, 200, JSON.stringify(edited.data));
      assert.deepEqual(edited.data.checklist.map((i: any) => [i.key, i.label, i.attachmentId]),
        [["d1", "صورة الإقامة سارية", iqama2], ["d3", "عقد العمل", null]], "a new item never takes a removed item's key");
      assert.equal((await db.select().from(hbsRequestAttachments).where(eq(hbsRequestAttachments.id, files[2])))[0].checklistKey, null, "the removed item's link is dropped");
      // The search also matches the request without a checklist; find this one by id.
      const listedRow = (await call(owner, "GET", `/office/service-requests?q=${encodeURIComponent("تجديد الإقامة")}`)).data.items.find((i: any) => i.id === listed);
      assert.equal(listedRow.checklist.length, 2);
    });

    await t.test("overdue invoices are reminded once at 3 days and once at 7, and a failed send is retried", async () => {
      const [{ id: requestId }] = await db.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer)).limit(1);
      const days = (n: number) => new Date(Date.now() - n * 86_400_000 - 60_000);
      const insert = async (issuedAt: Date, status = "issued") => (await db.insert(hbsInvoices).values({
        requestId, description: "أتعاب", amountHalalas: 1_000, vatRateBasisPoints: 1_500, vatHalalas: 150, totalHalalas: 1_150, issuedBy: owner, issuedAt, status,
      }).returning())[0];
      const fresh = await insert(days(1));
      const overdue = await insert(days(4));
      const old = await insert(days(8));
      const paid = await insert(days(8), "paid");
      const sent: { userId: string; path: string | undefined }[] = [];
      const fakeSend = async (userId: string, build: (to: string | null) => { action?: { path: string } } | null) => {
        sent.push({ userId, path: build("x@example.invalid")?.action?.path });
      };
      const invoiceOf = async (id: number) => (await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, id)))[0];
      try {
        assert.equal(await remindOverdueInvoices(fakeSend), 2);
        assert.deepEqual(sent.map(s => s.userId), [customer, customer]);
        assert.equal(sent[0].path, `/requests/${requestId}?invoice=${old.id}`);
        assert.equal((await invoiceOf(fresh.id)).reminderCount, 0);
        assert.equal((await invoiceOf(paid.id)).reminderCount, 0);
        assert.equal((await invoiceOf(overdue.id)).reminderCount, 1);
        assert.ok((await invoiceOf(overdue.id)).remindedAt);
        assert.equal(await remindOverdueInvoices(fakeSend), 0, "nothing twice");
        // The first reminder went out; a week on, the second.
        await db.update(hbsInvoices).set({ issuedAt: days(8) }).where(eq(hbsInvoices.id, overdue.id));
        assert.equal(await remindOverdueInvoices(fakeSend), 1);
        assert.equal((await invoiceOf(overdue.id)).reminderCount, 2);
        assert.equal(await remindOverdueInvoices(fakeSend), 0, "two reminders at most");
        // Not sent: the claim is given back for the next sweep.
        await db.update(hbsInvoices).set({ issuedAt: days(4) }).where(eq(hbsInvoices.id, fresh.id));
        assert.equal(await remindOverdueInvoices(async () => { throw new Error("mail server down"); }), 0);
        assert.equal((await invoiceOf(fresh.id)).reminderCount, 0);
        assert.equal(await remindOverdueInvoices(fakeSend), 1);
      } finally {
        await db.delete(hbsInvoices).where(inArray(hbsInvoices.id, [fresh.id, overdue.id, old.id, paid.id]));
      }
    });

    await t.test("an invoice closed while its payment page was being created never keeps the page", async () => {
      const [{ id: requestId }] = await db.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer)).limit(1);
      const [invoice] = await db.insert(hbsInvoices).values({
        requestId, description: "أتعاب", amountHalalas: 1_000, vatRateBasisPoints: 1_500, vatHalalas: 150, totalHalalas: 1_150, issuedBy: owner,
      }).returning();
      const calls: string[] = [];
      const realFetch = globalThis.fetch;
      let createdId = "";
      let remoteStatus = "initiated";
      process.env.MOYASAR_SECRET_KEY = "sk_test_placeholder";
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith("https://api.moyasar.com/")) return realFetch(input, init);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const path = new URL(url).pathname.split("/");
        const isCancel = path.at(-1) === "cancel";
        const id = isCancel ? path.at(-2)! : path.at(-1)!;
        if (init?.method === "POST") {
          // The office cancels while the gateway is still creating the page.
          await db.update(hbsInvoices).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(hbsInvoices.id, invoice.id));
          createdId = `gw-${randomUUID()}`;
          remoteStatus = "initiated";
          return new Response(JSON.stringify({
            id: createdId, status: remoteStatus, amount: 1_150, currency: "SAR", url: `https://pay.example.invalid/${createdId}`,
          }));
        }
        if (isCancel) remoteStatus = "cancelled";
        return new Response(JSON.stringify({
          id, status: remoteStatus, amount: 1_150, currency: "SAR", url: `https://pay.example.invalid/${id}`,
        }));
      }) as typeof fetch;
      try {
        const result = await call(customer, "POST", `/invoices/${invoice.id}/pay`);
        assert.equal(result.status, 409, JSON.stringify(result.data));
        const [row] = await db.select().from(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
        assert.equal(row.gatewayInvoiceId, null);
        assert.equal(row.paymentUrl, null);
        assert.ok(calls.some(c => /^PUT .*\/cancel$/.test(c)), `the created page is closed: ${calls.join(", ")}`);
        assert.equal(remoteStatus, "cancelled", "the provider confirms the page cannot be paid");
        const [ledgerPage] = await db.select().from(hbsInvoiceGatewayPages)
          .where(eq(hbsInvoiceGatewayPages.gatewayInvoiceId, createdId));
        assert.equal(ledgerPage?.invoiceId, invoice.id, "retain the page-to-invoice attribution");
        assert.equal(ledgerPage?.paymentUrl, `https://pay.example.invalid/${createdId}`);
        assert.ok(ledgerPage?.closedAt, "retain that the orphaned page was closed");
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.MOYASAR_SECRET_KEY;
        await db.delete(hbsInvoiceGatewayPages).where(eq(hbsInvoiceGatewayPages.invoiceId, invoice.id));
        await db.delete(hbsInvoices).where(eq(hbsInvoices.id, invoice.id));
      }
    });

    await t.test("commercial register lookup: unconfigured, invalid, found, missing and failing", async () => {
      assert.equal((await call(customer, "GET", "/company/cr-lookup?number=1010101010")).status, 503);
      assert.equal((await call(customer, "GET", "/test/cr-lookup?number=1010101010")).status, 503);
      assert.equal((await call(customer, "GET", "/test/cr-lookup?number=12345")).status, 400, "format is checked first");
      process.env.WATHQ_API_KEY = "wathq_test_key";
      try {
        wathqReply = () => new Response(JSON.stringify({
          crName: "شركة المثال", crEntityNumber: "7001234567", status: { id: "active", name: "نشط" },
          activities: [{ id: 1, name: "تجارة التجزئة" }, { name: "خدمات" }], headquarterCityName: "الرياض", issueDate: "1440/01/01", expiryDate: "1450/01/01",
        }));
        const found = await call(customer, "GET", "/test/cr-lookup?number=١٠١٠١٠١٠١٠");
        assert.equal(found.status, 200, JSON.stringify(found.data));
        assert.deepEqual(found.data, { name: "شركة المثال", unifiedNumber: "7001234567", status: "نشط", activity: "تجارة التجزئة، خدمات", city: "الرياض", issuedOn: "1440/01/01", expiresOn: "1450/01/01" });
        assert.equal(wathqCalls.at(-1)?.url, "https://api.wathq.sa/v5/commercialregistration/info/1010101010");
        assert.equal(wathqCalls.at(-1)?.headers.apiKey, "wathq_test_key");
        wathqReply = () => new Response(JSON.stringify({ crName: "x" }));
        assert.deepEqual((await call(customer, "GET", "/test/cr-lookup?number=1010101010")).data, { name: "x", unifiedNumber: null, status: null, activity: null, city: null, issuedOn: null, expiresOn: null });
        wathqReply = () => new Response("{}", { status: 404 });
        assert.equal((await call(customer, "GET", "/test/cr-lookup?number=1010101010")).status, 404);
        wathqReply = () => new Response("down", { status: 500 });
        assert.equal((await call(customer, "GET", "/test/cr-lookup?number=1010101010")).status, 502);
        assert.equal((await call(owner, "GET", `/office/customers/nobody-${randomUUID()}/cr-lookup?number=1010101010`)).status, 404);
        assert.equal((await call(otherCustomer, "GET", "/office/customers/x/cr-lookup?number=1010101010")).status, 403);
      } finally {
        delete process.env.WATHQ_API_KEY;
      }
    });
  } finally {
    const ids = (await db.select({ id: hbsServiceRequests.id }).from(hbsServiceRequests)
      .where(inArray(hbsServiceRequests.userId, [customer, otherCustomer]))).map(r => r.id);
    if (ids.length) {
      await db.delete(hbsRequestMessages).where(inArray(hbsRequestMessages.requestId, ids));
      const invoices = await db.select({ id: hbsInvoices.id }).from(hbsInvoices)
        .where(inArray(hbsInvoices.requestId, ids));
      const invoiceIds = invoices.map(invoice => invoice.id);
      if (invoiceIds.length) {
        await db.delete(hbsInvoiceGatewayPages).where(inArray(hbsInvoiceGatewayPages.invoiceId, invoiceIds));
      }
      await db.delete(hbsInvoices).where(inArray(hbsInvoices.requestId, ids));
      await db.delete(hbsRequestAttachments).where(inArray(hbsRequestAttachments.requestId, ids));
    }
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, [customer, otherCustomer]));
    await db.delete(hbsServiceOffers).where(eq(hbsServiceOffers.slug, offerSlug));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, owner));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});
