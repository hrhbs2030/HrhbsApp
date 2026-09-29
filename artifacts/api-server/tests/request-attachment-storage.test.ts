import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { db, hbsOfficeStaff, hbsRequestAttachments, hbsServiceRequests, pool } from "@workspace/db";
import { objectStorageClient, ObjectStorageService } from "../src/lib/objectStorage";
import portalRouter from "../src/routes/portal";

if (process.env.NODE_ENV === "production") {
  throw new Error("Real attachment storage tests must not run in production");
}

const officeEmail = "attachment-storage-office@example.invalid";
const original = Buffer.from("%PDF-1.4\noriginal customer document\n");
const replacement = Buffer.from("%PDF-1.4\nmodified after submission\n");

function appWithTestIdentities() {
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
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
    headers: {
      "x-test-user": user,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Delete only objects issued by this test. The signed URL's pathname identifies
// the staging key even when the request fails before an attachment row is saved.
function testObject(path: string) {
  const dir = new ObjectStorageService().getPrivateObjectDir().replace(/\/$/, "");
  const [bucket, ...prefix] = dir.replace(/^\//, "").split("/");
  const expectedPrefix = `/${bucket}/${prefix.join("/")}/`;
  assert.ok(path.startsWith(expectedPrefix), "Object must belong to the private test bucket");
  const key = path.slice(`/${bucket}/`.length);
  assert.match(key, /\/(?:uploads|submitted)\/[0-9a-f-]{36}$/);
  return objectStorageClient.bucket(bucket).file(key);
}

test("reusing a real signed PUT after submission cannot alter either download", async () => {
  assert.equal(process.env.HBS_OFFICE_EMAIL, officeEmail,
    `Run with HBS_OFFICE_EMAIL=${officeEmail}`);
  // Fail rather than silently substituting a fake storage service.
  assert.ok(process.env.PRIVATE_OBJECT_DIR, "Real App Storage must be configured");
  const customer = `attachment-storage-customer-${randomUUID()}`;
  const staff = `attachment-storage-staff-${randomUUID()}`;
  const objectPaths = new Set<string>();
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId,
    emailAddresses: userId === staff
      ? [{ emailAddress: officeEmail, verification: { status: "verified" } }]
      : [],
  }));
  const server = appWithTestIdentities().listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    await db.insert(hbsServiceRequests).values({
      userId: customer, category: "other", service: "Approval fixture",
      description: "Existing activity grants customer access.", contactPhone: "0000000000",
    });
    await db.insert(hbsOfficeStaff).values({ userId: staff });

    const reserved = await call(base, customer, "/service-requests/attachments/upload-url", {
      name: "document.pdf", size: original.length, contentType: "application/pdf",
    });
    assert.equal(reserved.status, 200);
    const { attachmentId, uploadURL } = await reserved.json() as {
      attachmentId: number; uploadURL: string;
    };
    const stagingPath = new URL(uploadURL).pathname;
    objectPaths.add(stagingPath);
    assert.match(stagingPath, /\/uploads\/[0-9a-f-]{36}$/);
    const put = (bytes: Buffer) => fetch(uploadURL, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: bytes,
    });
    const initialPut = await put(original);
    assert.ok(initialPut.ok, `Initial signed PUT returned ${initialPut.status}`);
    await initialPut.arrayBuffer();

    const submitted = await call(base, customer, "/service-requests", {
      category: "business", service: "Document review",
      description: "Please review the original document.", contactPhone: "0000000000",
      clientRequestId: randomUUID(), attachmentIds: [attachmentId],
    });
    assert.equal(submitted.status, 201);
    const record = await submitted.json() as { id: number; attachments: { id: number }[] };
    assert.deepEqual(record.attachments.map(item => item.id), [attachmentId]);
    const [saved] = await db.select().from(hbsRequestAttachments)
      .where(eq(hbsRequestAttachments.id, attachmentId));
    assert.equal(saved.requestId, record.id);
    assert.match(saved.objectPath, /^\/objects\/submitted\/[0-9a-f-]{36}$/);
    assert.notEqual(saved.objectPath, `/objects/uploads/${stagingPath.split("/").at(-1)}`);
    const dir = new ObjectStorageService().getPrivateObjectDir().replace(/\/$/, "");
    objectPaths.add(`${dir}/submitted/${saved.objectPath.split("/").at(-1)}`);

    // The signed PUT should still be valid now; even a successful overwrite of
    // its staging key must not change the submitted copy.
    const replay = await put(replacement);
    assert.ok(replay.ok, `Signed PUT replay returned ${replay.status}`);
    await replay.arrayBuffer();
    const [stagingBytes] = await testObject(stagingPath).download();
    assert.deepEqual(stagingBytes, replacement);

    const path = `/service-requests/attachments/${attachmentId}/download`;
    for (const [user, route] of [
      [customer, path],
      [staff, `/office${path}`],
    ]) {
      const download = await call(base, user, route);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
    }
  } finally {
    await db.delete(hbsRequestAttachments).where(eq(hbsRequestAttachments.userId, customer));
    await db.delete(hbsServiceRequests).where(eq(hbsServiceRequests.userId, customer));
    await db.delete(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, staff));
    await Promise.all([...objectPaths].map(path => testObject(path).delete({ ignoreNotFound: true })));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});