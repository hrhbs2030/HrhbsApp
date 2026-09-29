import assert from "node:assert/strict";
import test from "node:test";
import { isCaseSpecificQuestion, selectRelevantPublishedDocuments } from "../src/routes/anthropic";
import { requestTrackingGuide } from "../src/lib/portal-usage-information";

test("assistant retains an answer in the sentence after a matching heading", () => {
  const documents = [{
    id: 1,
    publishedTitle: "رسوم الجوازات",
    publishedContent: "رسوم الجوازات. التكلفة 100 ريال.",
    publishedReviewedAt: new Date(),
    publishedAt: new Date(),
  }];

  const selected = selectRelevantPublishedDocuments(documents, "ما رسوم الجوازات؟");
  assert.equal(selected.length, 1);
  assert.match(selected[0].content, /التكلفة 100 ريال/);
});

test("assistant selects relevant documents beyond the oldest records", () => {
  const documents = Array.from({ length: 51 }, (_, index) => ({
    id: index + 1,
    publishedTitle: index === 50 ? "متطلبات تجديد الجواز" : "إجراءات سجل مختلف",
    publishedContent: index === 50
      ? "متطلبات تجديد الجواز. إحضار نسخة واضحة من الهوية."
      : "هذه معلومات عن موضوع آخر.",
    publishedReviewedAt: new Date(),
    publishedAt: new Date(),
  }));

  const selected = selectRelevantPublishedDocuments(documents, "ما متطلبات تجديد الجواز؟");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].document.id, 51);
  assert.match(selected[0].content, /إحضار نسخة واضحة/);
});

test("Arabic request tracking question retrieves the public portal guide, not a case status", () => {
  const documents = [{
    id: 89, publishedTitle: requestTrackingGuide.title,
    publishedContent: requestTrackingGuide.content,
    publishedReviewedAt: new Date(), publishedAt: new Date(),
  }];
  assert.equal(isCaseSpecificQuestion("كيف أتابع حالة طلبي؟"), false);
  const selected = selectRelevantPublishedDocuments(documents, "كيف أتابع حالة طلبي؟");
  assert.equal(selected.length, 1);
  assert.match(selected[0].content, /«طلباتي»/);
  assert.match(selected[0].content, /«تم الاستلام»/);
  assert.match(selected[0].content, /«بانتظار العميل»/);
  assert.equal(isCaseSpecificQuestion("ما حالة طلبي رقم الطلب 123؟"), true);
  assert.equal(isCaseSpecificQuestion("وين وصل طلبي؟"), true);
});