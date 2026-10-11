import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import cors from "cors";
import express from "express";
import {
  API_REQUEST_LIMIT,
  API_SENSITIVE_WRITE_LIMIT,
  API_WRITE_LIMIT,
  createApiRateLimits,
  createCorsOptions,
  createSecurityHeaders,
  getAllowedOrigins,
} from "../src/middlewares/apiSecurity";

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
