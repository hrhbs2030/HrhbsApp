import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Readable } from "node:stream";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { db, hbsOfficeStaff, hbsRequestAttachments, hbsServiceRequests, pool } from "@workspace/db";
import { ObjectStorageService } from "../src/lib/objectStorage";
import portalRouter from "../src/routes/portal";

if (process.env.NODE_ENV === "production") {
  throw new Error("Attachment access tests must not run in production");
}

const customerA = `attachment-access-a-${randomUUID()}`;
const customerB = `attachment-access-b-${randomUUID()}`;
const ownerId = `attachment-access-owner-${randomUUID()}`;
const staff = `attachment-access-staff-${randomUUID()}`;
const officeEmail = "attachment-access-office@example.invalid";
const staffEmail = "attachment-access-staff@example.invalid";
const users = [customerA, customerB];
const pdf = Buffer.from("%PDF-1.4\nattachment-access-test\n");
const files = new Map<string, Buffer>();
const privateDir = "/test-bucket/attachment-access";

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
    // Only this ephemeral app supplies test identities; production auth is untouched.
    const auth = () => ({
      tokenType: "session_token" as const,
      userId,
      sessionClaims: { sub: userId, sid: "test-session" },
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", portalRouter);
  return app;
}

async function call(base: string, user: string, path: string, body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function reserve(base: string, user: string) {
  const response = await call(base, user, "/service-requests/attachments/upload-url", {
    name: "document.pdf", size: pdf.length, contentType: "application/pdf",
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<{ attachmentId: number; uploadURL: string }>;
}

function requestBody(attachmentIds: number[]) {
  return {
    category: "business", service: "Document review",
    description: "Please review the attached documents.", contactPhone: "0000000000",
    clientRequestId: randomUUID(), attachmentIds,
  };
}

test("only the owner or verified office staff can download a submitted attachment", async () => {
  // Use a dedicated test address, never the real office identity.
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail,
    `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  const verifiedStaffEmail = { emailAddress: staffEmail, verification: { status: "verified" } };
  let staffEmailAddresses = [verifiedStaffEmail];
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId,
    emailAddresses: userId === staff ? staffEmailAddresses
      : userId === ownerId ? [{ emailAddress: officeEmail, verification: { status: "verified" } }]
        : [],
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
    const base = `http://127.0.0.1:${address.port}`;
    await db.insert(hbsServiceRequests).values(users.map(userId => ({
      userId, category: "other" as const, service: "Approval fixture",
      description: "Existing activity grants customer access.", contactPhone: "0000000000",
    })));
    await db.insert(hbsOfficeStaff).values([
      { userId: ownerId },
      { userId: staff, email: staffEmail },
    ]);

    const a = await reserve(base, customerA);
    const b = await reserve(base, customerB);
    const tempA = (await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.id, a.attachmentId)))[0];
    const tempB = (await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.id, b.attachmentId)))[0];
    assert.equal(tempA.userId, customerA);
    assert.equal(tempB.userId, customerB);
    assert.equal(tempA.requestId, null);
    files.set(tempA.objectPath, pdf);
    files.set(tempB.objectPath, pdf);

    const temporaryPath = `/service-requests/attachments/${a.attachmentId}/download`;
    assert.equal((await call(base, customerA, temporaryPath)).status, 404);
    assert.equal((await call(base, staff, `/office${temporaryPath}`)).status, 404);

    const stolen = await call(base, customerA, "/service-requests", requestBody([b.attachmentId]));
    assert.equal(stolen.status, 400);
    const mixed = await call(base, customerA, "/service-requests", requestBody([a.attachmentId, b.attachmentId]));
    assert.equal(mixed.status, 400);
    assert.equal((await db.select().from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.userId, customerA))).length, 1);
    assert.equal((await db.select().from(hbsRequestAttachments)
      .where(inArray(hbsRequestAttachments.id, [a.attachmentId, b.attachmentId])))
      .every(row => row.requestId === null), true);

    const submitted = await call(base, customerA, "/service-requests", requestBody([a.attachmentId]));
    assert.equal(submitted.status, 201);
    const record = await submitted.json() as { id: number; attachments: { id: number }[] };
    assert.deepEqual(record.attachments.map(item => item.id), [a.attachmentId]);
    const [saved] = await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.id, a.attachmentId));
    assert.equal(saved.requestId, record.id);
    assert.match(saved.objectPath, /^\/objects\/submitted\//);
    const path = `/service-requests/attachments/${a.attachmentId}/download`;
    const owner = await call(base, customerA, path);
    assert.equal(owner.status, 200);
    assert.deepEqual(Buffer.from(await owner.arrayBuffer()), pdf);
    assert.equal(owner.headers.get("cache-control"), "private, no-store");
    assert.equal(owner.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await call(base, customerB, path)).status, 404);
    assert.equal((await call(base, customerB, `/service-requests/${record.id}`)).status, 404);
    assert.equal((await call(base, customerA, `/office${path}`)).status, 403);
    const office = await call(base, staff, `/office${path}`);
    assert.equal(office.status, 200);
    assert.deepEqual(Buffer.from(await office.arrayBuffer()), pdf);
    const ownerDownload = await call(base, ownerId, `/office${path}`);
    assert.equal(ownerDownload.status, 200);
    assert.deepEqual(Buffer.from(await ownerDownload.arrayBuffer()), pdf);

    // The existing staff row alone must not authorize another download once
    // Clerk no longer confirms the approved email.
    staffEmailAddresses = [];
    assert.equal((await call(base, staff, `/office${path}`)).status, 403);
    staffEmailAddresses = [{ emailAddress: staffEmail, verification: { status: "unverified" } }];
    assert.equal((await call(base, staff, `/office${path}`)).status, 403);
    assert.deepEqual(await db.select({ email: hbsOfficeStaff.email }).from(hbsOfficeStaff)
      .where(eq(hbsOfficeStaff.userId, staff)), [{ email: staffEmail }]);
    staffEmailAddresses = [verifiedStaffEmail];
    const restoredOffice = await call(base, staff, `/office${path}`);
    assert.equal(restoredOffice.status, 200);
    assert.deepEqual(Buffer.from(await restoredOffice.arrayBuffer()), pdf);

    // A reserved but never uploaded file, and a corrupt file of the declared
    // size, must both fail before the service-request transaction begins.
    const incomplete = await reserve(base, customerB);
    const corrupt = await reserve(base, customerB);
    const [corruptRow] = await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.id, corrupt.attachmentId));
    files.set(corruptRow.objectPath, Buffer.alloc(pdf.length, 0x58));
    for (const id of [incomplete.attachmentId, corrupt.attachmentId]) {
      const response = await call(base, customerB, "/service-requests", requestBody([id]));
      assert.equal(response.status, 400);
    }
    assert.equal((await db.select().from(hbsServiceRequests)
      .where(eq(hbsServiceRequests.userId, customerB))).length, 1);
    assert.equal((await db.select().from(hbsRequestAttachments)
      .where(inArray(hbsRequestAttachments.id, [incomplete.attachmentId, corrupt.attachmentId])))
      .every(row => row.requestId === null), true);

    const submittedB = await call(base, customerB, "/service-requests", requestBody([b.attachmentId]));
    assert.equal(submittedB.status, 201);
    const bPath = `/service-requests/attachments/${b.attachmentId}/download`;
    const bOwner = await call(base, customerB, bPath);
    assert.equal(bOwner.status, 200);
    assert.deepEqual(Buffer.from(await bOwner.arrayBuffer()), pdf);
    assert.equal((await call(base, customerA, bPath)).status, 404);
    const bOffice = await call(base, staff, `/office${bPath}`);
    assert.equal(bOffice.status, 200);
    assert.deepEqual(Buffer.from(await bOffice.arrayBuffer()), pdf);
  } finally {
    await db.delete(hbsRequestAttachments).where(inArray(hbsRequestAttachments.userId, users));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, users));
    await db.delete(hbsOfficeStaff).where(inArray(hbsOfficeStaff.userId, [ownerId, staff]));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    files.clear();
    await pool.end();
  }
});