import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import {
  AI_REQUEST_BODY_LIMIT,
  createCorsOptions,
  createOriginGuard,
  createRateLimitMiddleware,
  getAllowedOrigins,
} from "../src/middlewares/apiSecurity";
import { createOpenAIRouter } from "../src/routes/openai";

const allowedOrigins = getAllowedOrigins({
  NODE_ENV: "production",
  CORS_ALLOWED_ORIGINS: "https://mobile.example.test",
});

const validExtraction = {
  clientName: "مؤسسة الأفق",
  service: "تجديد إقامة",
  serviceFee: 1000,
  governmentFee: 650,
  period: "3 أيام",
  duration: null,
  receiptDate: null,
  notes: null,
};

function createTestApp(
  generate: (text: string) => Promise<string>,
  rateLimit = 10,
) {
  const app = express();
  app.use(cors(createCorsOptions(allowedOrigins)));
  app.use("/api/openai", createOriginGuard(allowedOrigins));
  app.use(
    "/api/openai",
    createRateLimitMiddleware({ limit: rateLimit, windowMs: 60_000 }),
  );
  app.use("/api/openai", express.json({ limit: AI_REQUEST_BODY_LIMIT }));
  app.use(express.json());
  app.use("/api/openai", createOpenAIRouter(generate));
  const parserErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    const parserError = error as { type?: string; status?: number };
    if (parserError.type === "entity.too.large" || parserError.status === 413) {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    if (parserError.type === "entity.parse.failed" || parserError.status === 400) {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    next(error);
  };
  app.use(parserErrorHandler);
  return app;
}

async function withServer<T>(
  app: express.Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(
  baseUrl: string,
  body: unknown,
  origin?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (origin) headers.Origin = origin;

  return fetch(`${baseUrl}/api/openai/extract-transaction`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("validates the request and returns only schema-checked AI fields", async () => {
  let receivedText = "";
  const app = createTestApp(async (text) => {
    receivedText = text;
    return JSON.stringify(validExtraction);
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(
      baseUrl,
      { text: "  تجديد إقامة لمؤسسة الأفق  " },
      "https://mobile.example.test",
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://mobile.example.test",
    );
    assert.equal(receivedText, "تجديد إقامة لمؤسسة الأفق");
    assert.deepEqual(await response.json(), validExtraction);
  });
});

test("rejects invalid input before calling the AI service", async () => {
  let calls = 0;
  const app = createTestApp(async () => {
    calls += 1;
    return JSON.stringify(validExtraction);
  });

  await withServer(app, async (baseUrl) => {
    for (const body of [
      { text: "   " },
      { text: "x".repeat(2001) },
      { text: "مقبول", untrusted: true },
      {},
    ]) {
      const response = await postJson(baseUrl, body);
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });
});

test("rejects disallowed browser origins and permits originless native clients", async () => {
  let calls = 0;
  const app = createTestApp(async () => {
    calls += 1;
    return JSON.stringify(validExtraction);
  });

  await withServer(app, async (baseUrl) => {
    const blocked = await postJson(
      baseUrl,
      { text: "معاملة" },
      "https://untrusted.example",
    );
    assert.equal(blocked.status, 403);

    const native = await postJson(baseUrl, { text: "معاملة" });
    assert.equal(native.status, 200);
    assert.equal(calls, 1);
  });
});

test("returns safe errors for malformed or invalid AI output", async () => {
  const app = createTestApp(async () => JSON.stringify({ clientName: "اسم" }));

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, { text: "معاملة" });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /تعذر التحقق/);
  });

  const malformedJsonApp = createTestApp(async () => "{not-json");
  await withServer(malformedJsonApp, async (baseUrl) => {
    const response = await postJson(baseUrl, { text: "معاملة" });
    assert.equal(response.status, 502);
  });

  const failedServiceApp = createTestApp(async () => {
    throw new Error("upstream error");
  });
  await withServer(failedServiceApp, async (baseUrl) => {
    const response = await postJson(baseUrl, { text: "معاملة" });
    assert.equal(response.status, 502);
  });
});

test("limits request size and throttles repeated requests", async () => {
  const app = createTestApp(async () => JSON.stringify(validExtraction), 4);

  await withServer(app, async (baseUrl) => {
    const tooLarge = await postJson(baseUrl, { text: "x".repeat(20_000) });
    assert.equal(tooLarge.status, 413);

    assert.equal((await postJson(baseUrl, { text: "الأولى" })).status, 200);
    assert.equal((await postJson(baseUrl, { text: "الثانية" })).status, 200);
    assert.equal((await postJson(baseUrl, { text: "الثالثة" })).status, 200);

    const limited = await postJson(baseUrl, { text: "الرابعة" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
});

test("allows only configured production origins", () => {
  assert.deepEqual(
    [...getAllowedOrigins({
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS: "https://portal.example.test",
      REPLIT_DEV_DOMAIN: "preview.example.test",
    })],
    ["https://portal.example.test"],
  );
  assert.ok(
    getAllowedOrigins({
      NODE_ENV: "development",
      REPLIT_DEV_DOMAIN: "preview.example.test",
    }).has("https://preview.example.test"),
  );
});