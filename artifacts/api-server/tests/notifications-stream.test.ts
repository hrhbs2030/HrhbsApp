import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import notificationsRouter, { closeNotificationStreams, openStreams } from "../src/routes/notifications";
import { subscriberCount } from "../src/lib/notification-stream";

// The SSE endpoint against a migrated test database: a client that drops
// while the stream is still opening (during the first queries) must leave
// no listener, no stream slot and no heartbeat behind, and a graceful
// shutdown must end every open stream.

if (process.env.NODE_ENV === "production") throw new Error("Notification stream tests must not run in production");

const user = `sse-stream-${randomUUID()}`;

function testApp() {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user") ?? user;
    // Only this ephemeral app supplies test identities; production auth is untouched.
    const auth = () => ({ tokenType: "session_token" as const, userId, sessionClaims: { sub: userId, sid: "test-session" } });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", notificationsRouter);
  return app;
}

async function until(check: () => boolean, what: string, timeoutMs = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("notification stream lifecycle", async (t) => {
  const server = http.createServer(testApp());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  try {
    await t.test("streams aborted during the opening queries leave nothing behind", async () => {
      const attempts = 30;
      for (let i = 0; i < attempts; i++) {
        const socket = net.connect(port, "127.0.0.1");
        await once(socket, "connect");
        socket.write("GET /api/notifications/stream HTTP/1.1\r\nHost: x\r\n\r\n");
        // Abort right away: before the handler finished canReceiveOffice/unreadCount.
        await new Promise((resolve) => setTimeout(resolve, i % 3));
        socket.destroy();
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      assert.equal(subscriberCount(user), 0, "every aborted stream should have been cleaned up");
      assert.equal(openStreams(user), 0);
    });

    await t.test("a stream that opened fully is cleaned up when the client leaves", async () => {
      const request = http.get({ host: "127.0.0.1", port, path: "/api/notifications/stream" });
      const [response] = await once(request, "response") as [http.IncomingMessage];
      assert.equal(response.statusCode, 200);
      await once(response, "data");
      assert.equal(openStreams(user), 1);
      assert.equal(subscriberCount(user), 1);
      response.destroy();
      request.destroy();
      await until(() => openStreams(user) === 0 && subscriberCount(user) === 0, "stream cleanup");
    });

    await t.test("closeNotificationStreams ends every open stream for shutdown", async () => {
      const users = [`${user}-a`, `${user}-b`];
      const clients = users.map((id) => http.get({ host: "127.0.0.1", port, path: "/api/notifications/stream", headers: { "x-test-user": id } }));
      const responses: http.IncomingMessage[] = [];
      for (const client of clients) {
        const [response] = await once(client, "response") as [http.IncomingMessage];
        await once(response, "data");
        responses.push(response);
      }
      assert.equal(users.reduce((sum, id) => sum + openStreams(id), 0), 2);
      const ended: boolean[] = responses.map(() => false);
      responses.forEach((response, index) => response.on("end", () => { ended[index] = true; }));
      assert.equal(closeNotificationStreams(), 2);
      await until(() => ended.every(Boolean), "both streams to end");
      await until(() => users.every((id) => openStreams(id) === 0 && subscriberCount(id) === 0), "stream slots to clear");
      assert.equal(closeNotificationStreams(), 0, "nothing left open");
      for (const client of clients) client.destroy();
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});
