import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Readable } from "node:stream";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { db, hbsAuditLog, hbsOfficeStaff, hbsRequestAttachments, hbsServiceRequests, pool } from "@workspace/db";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { purgeCompletedRequestAttachments } from "../src/lib/expired-request-attachments";
import portalRouter from "../src/routes/portal";

// Adding files to an existing request, office uploads, removal, the 10-file
// limit, and the 90-day purge after completion. Storage is an in-memory fake.
if (process.env.NODE_ENV === "production") throw new Error("Attachment tests must not run in production");

const customerA = `attachment-life-a-${randomUUID()}`;
const customerB = `attachment-life-b-${randomUUID()}`;
const ownerId = `attachment-life-owner-${randomUUID()}`;
const officeEmail = "attachment-lifecycle-office@example.invalid";
const pdf = Buffer.from("%PDF-1.4\nlifecycle-test\n");
const files = new Map<string, Buffer>();
const privateDir = "/test-bucket/attachment-lifecycle";

function fakeFile(path: string) {
  return {
    bucket: { file: (name: string) => fakeFile(`/objects/submitted/${name.split("/").at(-1)}`) },
    async getMetadata() {
      const bytes = files.get(path);
      if (!bytes) throw new Error("Missing test object");
      return [{ size: String(bytes.length) }];
    },
    async download() {
      const bytes = files.get(path);
      if (!bytes) throw new Error("Missing test object");
      return [bytes.subarray(0, 8)];
    },
    async copy(destination: ReturnType<typeof fakeFile>) {
      const bytes = files.get(path);
      if (!bytes) throw new Error("Missing test object");
      files.set(destination.path, Buffer.from(bytes));
    },
    async delete() { files.delete(path); },
    createReadStream() { return Readable.from([files.get(path)!]); },
    path,
  };
}

function testApp() {
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", portalRouter);
  return app;
}

test("files can be added to a request by its customer and the office, removed, limited and purged", async () => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail, `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId,
    emailAddresses: userId === ownerId ? [{ emailAddress: officeEmail, verification: { status: "verified" } }] : [],
  }));
  mock.method(ObjectStorageService.prototype, "getPrivateObjectDir", () => privateDir);
  mock.method(ObjectStorageService.prototype, "getObjectEntityUploadURL",
    async () => `https://storage.googleapis.com${privateDir}/uploads/${randomUUID()}?signature=test`);
  mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async (path: string) => {
    if (!files.has(path)) throw new Error("Missing test object");
    return fakeFile(path) as never;
  });

  const server = testApp().listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api`;
    const call = (user: string, method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
      method,
      headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const reserve = async (user: string, office = false) => {
      const response = await call(user, "POST", `${office ? "/office" : ""}/service-requests/attachments/upload-url`,
        { name: office ? "الشهادة.pdf" : "صورة الإقامة.pdf", size: pdf.length, contentType: "application/pdf" });
      assert.equal(response.status, 200);
      const { attachmentId } = await response.json() as { attachmentId: number };
      const [row] = await db.select().from(hbsRequestAttachments).where(eq(hbsRequestAttachments.id, attachmentId));
      files.set(row.objectPath, pdf);
      return attachmentId;
    };

    const [request] = await db.insert(hbsServiceRequests).values({
      userId: customerA, category: "passports", service: "تجديد إقامة",
      description: "Existing activity grants customer access.", contactPhone: "0500000000",
    }).returning();
    await db.insert(hbsServiceRequests).values({
      userId: customerB, category: "other", service: "fixture", description: "Existing activity grants access.", contactPhone: "0500000001",
    });
    await db.insert(hbsOfficeStaff).values({ userId: ownerId });
    const attach = (user: string, ids: number[], office = false) =>
      call(user, "POST", `${office ? "/office" : ""}/service-requests/${request.id}/attachments`, { attachmentIds: ids });

    // The customer adds a file to the open request.
    const mine = await reserve(customerA);
    assert.equal((await attach(customerB, [mine])).status, 404);
    const added = await attach(customerA, [mine]);
    assert.equal(added.status, 200);
    const afterCustomer = await added.json() as { attachments: { id: number; uploadedBy: string }[] };
    assert.deepEqual(afterCustomer.attachments.map(a => [a.id, a.uploadedBy]), [[mine, "customer"]]);
    assert.equal((await attach(customerA, [mine])).status, 400);

    // The office sends a file back; it is audited and visible to the customer.
    assert.equal((await call(customerA, "POST", "/office/service-requests/attachments/upload-url",
      { name: "x.pdf", size: pdf.length, contentType: "application/pdf" })).status, 403);
    const officeFile = await reserve(ownerId, true);
    assert.equal((await attach(customerA, [officeFile])).status, 400);
    const officeAdded = await attach(ownerId, [officeFile], true);
    assert.equal(officeAdded.status, 200);
    const seen = await (await call(customerA, "GET", `/service-requests/${request.id}`)).json() as { attachments: { id: number; uploadedBy: string }[] };
    assert.deepEqual(seen.attachments.map(a => [a.id, a.uploadedBy]), [[mine, "customer"], [officeFile, "office"]]);
    const download = await call(customerA, "GET", `/service-requests/attachments/${officeFile}/download`);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.equal((await call(ownerId, "GET", `/office/service-requests/attachments/${mine}/download`)).status, 200);

    // Removal: customers only their own files; others get 404.
    assert.equal((await call(customerA, "DELETE", `/service-requests/attachments/${officeFile}`)).status, 409);
    assert.equal((await call(customerB, "DELETE", `/service-requests/attachments/${mine}`)).status, 404);
    assert.equal((await call(customerA, "DELETE", `/service-requests/attachments/${mine}`)).status, 204);
    assert.equal((await call(customerA, "GET", `/service-requests/attachments/${mine}/download`)).status, 404);

    // Ten files per request.
    const more = [];
    for (let i = 0; i < 9; i++) more.push(await reserve(customerA));
    assert.equal((await attach(customerA, more)).status, 200);
    assert.equal((await attach(customerA, [await reserve(customerA)])).status, 409);

    const audit = await db.select().from(hbsAuditLog).where(and(
      eq(hbsAuditLog.targetType, "service_request"), eq(hbsAuditLog.targetId, String(request.id))));
    assert.deepEqual(audit.map(e => e.action).sort(), ["attachment.download", "attachment.upload"]);

    // Completed: the customer can no longer add or remove; after 90 days all files go.
    await db.update(hbsServiceRequests).set({ status: "completed", updatedAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(hbsServiceRequests.id, request.id));
    assert.equal((await attach(customerA, [await reserve(customerA)])).status, 409);
    assert.equal((await call(customerA, "DELETE", `/service-requests/attachments/${more[0]}`)).status, 409);
    const deleted: string[] = [];
    const purged = await purgeCompletedRequestAttachments(async path => { deleted.push(path); files.delete(path); });
    assert.equal(purged, 10);
    assert.equal(deleted.length, 10);
    assert.equal((await db.select().from(hbsRequestAttachments).where(eq(hbsRequestAttachments.requestId, request.id))).length, 0);
    const purgeAudit = await db.select().from(hbsAuditLog).where(and(
      eq(hbsAuditLog.action, "attachment.purge"), eq(hbsAuditLog.targetId, String(request.id))));
    assert.equal(purgeAudit.length, 10);
    assert.ok(purgeAudit.every(e => e.actorId === "system"));
  } finally {
    await db.delete(hbsAuditLog).where(inArray(hbsAuditLog.actorId, [ownerId, "system"]));
    await db.delete(hbsRequestAttachments).where(inArray(hbsRequestAttachments.userId, [customerA, customerB, ownerId]));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, [customerA, customerB]));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, ownerId));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    files.clear();
    await pool.end();
  }
});
