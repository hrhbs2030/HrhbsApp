import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { mock } from "node:test";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, hbsApprovedInformation, hbsServiceRequests, pool } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import assistantRouter from "../src/routes/anthropic";
import { ensureRequestTrackingGuide, requestTrackingGuide } from "../src/lib/portal-usage-information";

if (process.env.NODE_ENV === "production") {
  throw new Error("Assistant citation tests must not run in production");
}

test("assistant sends only relevant published text and accepts only retrieved citations", async () => {
  const userId = `assistant-citation-${randomUUID()}`;
  const secondUserId = `assistant-citation-${randomUUID()}`;
  const unique = randomUUID().replaceAll("-", "");
  const subject = `جواز${unique} وثيقة${unique}`;
  const question = `ما ${subject}؟`;
  const privateDraft = `SECRET_DRAFT_${unique}`;
  const withdrawnText = `SECRET_WITHDRAWN_${unique}`;
  const reviewedAt = new Date("2026-01-02T12:00:00.000Z");
  const publishedAt = new Date("2026-01-03T12:00:00.000Z");
  const ids: number[] = [];
  const calls: unknown[] = [];
  let modelReply = "";
  mock.method(anthropic.messages, "create", async (input: unknown) => {
    calls.push(input);
    return { content: [{ type: "text", text: modelReply }] };
  });
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const auth = () => ({
      tokenType: "session_token" as const,
      userId: req.header("x-test-user") === "second" ? secondUserId : userId,
      sessionClaims: { sub: userId, sid: "test-session" },
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", assistantRouter);
  const server = app.listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/answer-inquiry`;
    const ask = async (text = question, second = false) => {
      const response = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json", ...(second ? { "x-test-user": "second" } : {}) },
        body: JSON.stringify({ question: text }),
      });
      assert.equal(response.status, 200);
      return response.json() as Promise<{
        answer: string; needsOffice: boolean;
        sources: { id: number; title: string; reviewedAt: string; publishedAt: string }[];
      }>;
    };
    // An existing request grants this synthetic customer access; no real identity is used.
    await db.insert(hbsServiceRequests).values([userId, secondUserId].map(userId => ({
      userId, category: "other" as const, service: "Test access",
      description: `PRIVATE_CASE_${unique}`, contactPhone: "0000000000",
    })));
    await ensureRequestTrackingGuide();
    const rows = await db.insert(hbsApprovedInformation).values([
      {
        draftTitle: `مسودة ${subject}`, draftContent: privateDraft,
        publishedTitle: `متطلبات تجديد ${subject}`,
        publishedContent: `متطلبات تجديد ${subject}. أحضر نسخة من الوثيقة.`,
        publishedReviewedAt: reviewedAt, publishedAt,
      },
      {
        draftTitle: `مسودة ${subject}`, draftContent: `SECRET_UNPUBLISHED_${unique}`,
      },
      {
        draftTitle: `مسودة ${subject}`, draftContent: withdrawnText,
        publishedTitle: `متطلبات تجديد ${subject}`,
        publishedContent: withdrawnText,
        publishedReviewedAt: reviewedAt, publishedAt: null,
      },
      {
        draftTitle: "موضوع آخر", draftContent: `SECRET_UNRELATED_DRAFT_${unique}`,
        publishedTitle: "رسوم خدمة مختلفة",
        publishedContent: `SECRET_UNRELATED_PUBLISHED_${unique}`,
        publishedReviewedAt: reviewedAt, publishedAt,
      },
    ]).returning();
    ids.push(...rows.map(row => row.id));
    const publishedId = rows[0].id;

    modelReply = JSON.stringify({ answer: "أحضر نسخة من الوثيقة.", sourceIds: [publishedId], needsOffice: false });
    const accepted = await ask();
    assert.equal(accepted.needsOffice, false);
    assert.equal(accepted.answer, "أحضر نسخة من الوثيقة.");
    assert.deepEqual(accepted.sources, [{
      id: publishedId, title: rows[0].publishedTitle,
      reviewedAt: reviewedAt.toISOString(), publishedAt: publishedAt.toISOString(),
    }]);
    assert.equal(calls.length, 1);
    const input = calls[0] as { messages: { content: string }[] };
    const payload = JSON.parse(input.messages[0].content);
    assert.equal(payload.question, question);
    assert.deepEqual(payload.publishedInformation, [{
      id: publishedId, title: rows[0].publishedTitle, content: rows[0].publishedContent,
    }]);
    for (const forbidden of [privateDraft, withdrawnText, `SECRET_UNPUBLISHED_${unique}`,
      `SECRET_UNRELATED_DRAFT_${unique}`, `SECRET_UNRELATED_PUBLISHED_${unique}`]) {
      assert.ok(!JSON.stringify(input).includes(forbidden), `Model received ${forbidden}`);
      assert.ok(!JSON.stringify(accepted).includes(forbidden), `Response exposed ${forbidden}`);
    }

    for (const sourceIds of [[], [rows[1].id], [rows[2].id], [rows[3].id], [publishedId, rows[2].id]]) {
      modelReply = JSON.stringify({ answer: "إجابة غير مدعومة", sourceIds, needsOffice: false });
      const result = await ask();
      assert.equal(result.needsOffice, true);
      assert.deepEqual(result.sources, []);
      assert.match(result.answer, /المكتب/);
      assert.ok(!result.answer.includes("إجابة غير مدعومة"));
    }
    modelReply = JSON.stringify({ answer: "ادعاء بلا دليل", sourceIds: [publishedId], needsOffice: true });
    assert.equal((await ask(question, true)).needsOffice, true);

    const priorCalls = calls.length;
    const noMatch = await ask(`ما موضوع${unique} غيرمعروف${unique}؟`, true);
    assert.equal(noMatch.needsOffice, true);
    assert.deepEqual(noMatch.sources, []);
    assert.match(noMatch.answer, /المكتب/);
    assert.equal(calls.length, priorCalls, "No relevant published information must skip the model");

    const [guide] = await db.select().from(hbsApprovedInformation)
      .where(eq(hbsApprovedInformation.publishedTitle, requestTrackingGuide.title)).limit(1);
    assert.ok(guide?.publishedAt && guide.publishedReviewedAt);
    modelReply = JSON.stringify({
      answer: "افتح صفحة «طلباتي» واختر طلبك لمتابعة حالته. الحالات: تم الاستلام، قيد المراجعة، بانتظار العميل، مكتملة.",
      sourceIds: [guide.id], needsOffice: false,
    });
    const tracking = await ask("كيف أتابع حالة طلبي؟", true);
    assert.equal(tracking.needsOffice, false);
    assert.match(tracking.answer, /«طلباتي»/);
    assert.deepEqual(tracking.sources.map(source => source.id), [guide.id]);
    const trackingInput = calls.at(-1) as { messages: { content: string }[] };
    const trackingPayload = JSON.parse(trackingInput.messages[0].content);
    assert.equal(trackingPayload.question, "كيف أتابع حالة طلبي؟");
    assert.deepEqual(trackingPayload.publishedInformation.map((source: { id: number }) => source.id), [guide.id]);
    assert.ok(!JSON.stringify(trackingInput).includes(`PRIVATE_CASE_${unique}`));

    const callCount = calls.length;
    const specific = await ask("ما حالة طلبي رقم الطلب 123؟", true);
    assert.equal(specific.needsOffice, true);
    assert.deepEqual(specific.sources, []);
    assert.equal(calls.length, callCount, "Case-specific question must not reach the model");
  } finally {
    if (ids.length) await db.delete(hbsApprovedInformation).where(inArray(hbsApprovedInformation.id, ids));
    await db.delete(hbsServiceRequests).where(inArray(hbsServiceRequests.userId, [userId, secondUserId]));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
  }
});