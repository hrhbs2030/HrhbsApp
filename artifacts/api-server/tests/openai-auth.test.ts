import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

// The real app imports the database and AI clients, which only need these
// values to be present. Signed-out requests are rejected before either is used.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
process.env.CLERK_SECRET_KEY ??= "sk_test_placeholder";
process.env.CLERK_PUBLISHABLE_KEY ??= `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`;
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:1";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
process.env.CORS_ALLOWED_ORIGINS = "https://portal.example.test";

const { default: app } = await import("../src/app");

test("transaction extraction requires a signed-in office account", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/openai/extract-transaction`;

  try {
    const anonymous = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "تجديد إقامة" }),
    });
    assert.equal(anonymous.status, 401);

    const invalidToken = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not-a-valid-session-token",
      },
      body: JSON.stringify({ text: "تجديد إقامة" }),
    });
    assert.equal(invalidToken.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
