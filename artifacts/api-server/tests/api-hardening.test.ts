import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import cors from "cors";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  API_REQUEST_LIMIT,
  API_SENSITIVE_WRITE_LIMIT,
  API_WRITE_LIMIT,
  createApiRateLimits,
  createCorsOptions,
  createSecurityHeaders,
  getAllowedOrigins,
} from "../src/middlewares/apiSecurity";
import { apiNotFound, bodyErrors, requestIdHeader, unhandledError } from "../src/middlewares/errors";

function createApp() {
  const app = express();
  app.use(cors(createCorsOptions(getAllowedOrigins({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://app.example.test" }))));
  app.use("/api", createSecurityHeaders({ NODE_ENV: "production" }), ...createApiRateLimits());
  app.all(/.*/, (_req, res) => { res.json({ ok: true }); });
  return app;
}

async function withServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function hit(url: string, method: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    const response = await fetch(url, { method });
    await response.arrayBuffer();
    statuses.push(response.status);
  }
  return statuses;
}

test("API responses carry hardening headers and no cache", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/portal/me`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=/);
  });
});

test("CORS preflight allows the PUT and DELETE methods the API uses", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/company`, {
      method: "OPTIONS",
      headers: { Origin: "https://app.example.test", "Access-Control-Request-Method": "DELETE" },
    });
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /PUT/);
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /DELETE/);
  });
});

test("sensitive writes are limited per visitor while reads continue", async () => {
  await withServer(async (base) => {
    const statuses = await hit(`${base}/api/inquiries`, "POST", API_SENSITIVE_WRITE_LIMIT + 1);
    assert.deepEqual(statuses.slice(0, API_SENSITIVE_WRITE_LIMIT), Array(API_SENSITIVE_WRITE_LIMIT).fill(200));
    const limited = await fetch(`${base}/api/inquiries`, { method: "POST" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    // Reads and ordinary writes are counted separately.
    assert.equal((await fetch(`${base}/api/inquiries`)).status, 200);
    assert.equal((await fetch(`${base}/api/company`, { method: "PUT" })).status, 200);
  });
});

test("writes and all requests have their own ceilings; health and the payment webhook are exempt", async () => {
  await withServer(async (base) => {
    const writes = await hit(`${base}/api/company`, "PUT", API_WRITE_LIMIT + 1);
    assert.equal(writes.filter((status) => status === 429).length, 1);
    assert.equal((await hit(`${base}/api/payments/moyasar/webhook`, "POST", 5)).every((status) => status === 200), true);
    const reads = await hit(`${base}/api/portal/me`, "GET", API_REQUEST_LIMIT - API_WRITE_LIMIT);
    assert.equal(reads.at(-1), 429);
    assert.equal((await fetch(`${base}/api/healthz`)).status, 200);
  });
});

// The same handlers app.ts mounts, around a throwaway router.
function createErrorApp() {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(requestIdHeader);
  app.use(express.json());
  app.get("/api/ok", (_req, res) => { res.json({ ok: true }); });
  app.get("/api/boom", () => { throw new Error("database exploded: secret details"); });
  app.get("/api/boom-async", async () => { await Promise.resolve(); throw new Error("later"); });
  app.post("/api/echo", (req, res) => { res.json(req.body); });
  app.use("/api", apiNotFound);
  app.use(bodyErrors);
  app.use(unhandledError);
  return app;
}

test("every response names its request; unknown paths and failures answer in JSON", async () => {
  const server = createErrorApp().listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const ok = await fetch(`${base}/api/ok`);
    assert.equal(ok.status, 200);
    const requestId = ok.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id is set");
    assert.notEqual((await fetch(`${base}/api/ok`)).headers.get("x-request-id"), requestId);

    const missing = await fetch(`${base}/api/nowhere`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await missing.json(), { error: "غير موجود" });

    for (const path of ["/api/boom", "/api/boom-async"]) {
      const failed = await fetch(`${base}${path}`);
      assert.equal(failed.status, 500, path);
      const body = await failed.json();
      assert.equal(body.error, "حدث خطأ غير متوقع. حاول مرة أخرى.");
      assert.equal(body.requestId, failed.headers.get("x-request-id"));
      assert.ok(!JSON.stringify(body).includes("secret"), "the error itself stays in the log");
    }

    const badJson = await fetch(`${base}/api/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(badJson.status, 400);
    assert.deepEqual(await badJson.json(), { error: "صيغة الطلب غير صالحة." });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
