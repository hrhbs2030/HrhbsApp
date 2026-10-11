import assert from "node:assert/strict";
import { test } from "node:test";
import type { Notification } from "@workspace/api-zod";
import {
  KINDS, buildBrief, coalesced, deliveryPlan, digestMail, groupKeyFor, inQuietHours, intentOf, maskPhone,
  nextDigestAt, prioritize, riyadhParts, suggestReplies, MAX_REPLY_LENGTH,
} from "../src/lib/notification-intelligence";

// Pure module: no database, no clock. Times are given in UTC and checked
// against Riyadh (UTC+3, no daylight saving).

const utc = (iso: string) => new Date(iso);
const notification = (overrides: Partial<Notification> & Pick<Notification, "id" | "kind">): Notification => ({
  audience: KINDS[overrides.kind].audience,
  title: `إشعار ${overrides.id}`,
  body: "نص",
  path: null,
  priority: "normal",
  count: 1,
  targetType: null,
  targetId: null,
  createdAt: utc("2026-10-11T08:00:00Z"),
  readAt: null,
  ...overrides,
});

test("every kind has Arabic copy and the audience its name says", () => {
  for (const [kind, info] of Object.entries(KINDS)) {
    assert.equal(info.audience, kind.startsWith("office.") ? "office" : "customer", kind);
    assert.match(info.label, /[؀-ۿ]/, kind);
  }
});

test("priorities escalate on overdue days, expiry, amount, urgency words and repetition", () => {
  assert.equal(prioritize("request.file"), "low");
  assert.equal(prioritize("invoice.overdue", { daysOverdue: 3 }), "high");
  assert.equal(prioritize("invoice.overdue", { daysOverdue: 8 }), "urgent");
  assert.equal(prioritize("reminder.expiring", { daysLeft: 7 }), "urgent");
  assert.equal(prioritize("reminder.expiring", { daysLeft: 45 }), "high");
  assert.equal(prioritize("request.message", { text: "ضروري أحتاج الرد اليوم" }), "urgent");
  assert.equal(prioritize("request.message", { text: "شكرًا" }), "normal");
  assert.equal(prioritize("invoice.issued", { amountHalalas: 500_000 }), "urgent");
  assert.equal(prioritize("request.file", { repeated: true }), "normal");
  assert.equal(prioritize("office.request_new", { repeated: true, amountHalalas: 1 }), "urgent");
});

test("group keys and coalesced copy count the repeats in Arabic", () => {
  assert.equal(groupKeyFor("request.message", "request", 41), "request.message:request:41");
  assert.equal(groupKeyFor("office.inquiry_new", null, undefined), "office.inquiry_new:-:-");
  const base = { title: "رسالة جديدة في الطلب HBS-2026-00041", body: "المكتب: تم رفع الطلب" };
  assert.deepEqual(coalesced("request.message", 1, base), base);
  assert.equal(coalesced("request.message", 2, base).title, "رسالتان جديدتان في الطلب HBS-2026-00041");
  const three = coalesced("request.message", 3, base);
  assert.equal(three.title, "3 رسائل جديدة في الطلب HBS-2026-00041");
  assert.equal(three.body, "آخر تحديث: المكتب: تم رفع الطلب");
  assert.equal(coalesced("request.message", 12, base).title, "12 رسالة جديدة في الطلب HBS-2026-00041");
  assert.equal(coalesced("company.invite", 4, { title: "دعوة", body: "x" }).title, "4 إشعارات · دعوة للانضمام إلى شركة");
});

test("Riyadh wall clock does not depend on the server time zone", () => {
  const parts = riyadhParts(utc("2026-10-11T20:30:00Z"));
  assert.deepEqual([parts.year, parts.month, parts.day, parts.hour, parts.minute], [2026, 10, 11, 23, 30]);
  assert.equal(riyadhParts(utc("2026-10-11T22:00:00Z")).day, 12);
  // Next 08:00 Riyadh = 05:00 UTC.
  assert.equal(nextDigestAt(utc("2026-10-11T03:00:00Z")).toISOString(), "2026-10-11T05:00:00.000Z");
  assert.equal(nextDigestAt(utc("2026-10-11T05:00:00Z")).toISOString(), "2026-10-12T05:00:00.000Z");
  assert.equal(nextDigestAt(utc("2026-10-11T20:30:00Z")).toISOString(), "2026-10-12T05:00:00.000Z");
});

test("quiet hours wrap past midnight", () => {
  assert.equal(inQuietHours(23, 22, 7), true);
  assert.equal(inQuietHours(3, 22, 7), true);
  assert.equal(inQuietHours(7, 22, 7), false);
  assert.equal(inQuietHours(12, 22, 7), false);
  assert.equal(inQuietHours(13, 12, 14), true);
  assert.equal(inQuietHours(14, 12, 14), false);
  assert.equal(inQuietHours(5, null, 7), false);
  assert.equal(inQuietHours(5, 5, 5), false);
});

test("delivery plan: instant by default, WhatsApp only for customers", () => {
  const now = utc("2026-10-11T09:00:00Z");
  assert.deepEqual(deliveryPlan({ kind: "request.message", priority: "normal", prefs: null, now }),
    { inapp: true, email: "now", push: "now", whatsapp: "now", deliverAfter: null });
  assert.deepEqual(deliveryPlan({ kind: "office.request_new", priority: "high", prefs: { pushEnabled: false }, now }),
    { inapp: true, email: "now", push: "skip", whatsapp: "skip", deliverAfter: null });
});

test("delivery plan: muted kinds stay in-app only, even when urgent", () => {
  const plan = deliveryPlan({ kind: "request.file", priority: "urgent", prefs: { mutedKinds: ["request.file"] }, now: utc("2026-10-11T09:00:00Z") });
  assert.deepEqual(plan, { inapp: true, email: "skip", push: "skip", whatsapp: "skip", deliverAfter: null });
});

test("delivery plan: quiet hours hold mail and push until they end (wrapping midnight)", () => {
  const prefs = { quietStart: 22, quietEnd: 7 };
  // 23:30 Riyadh → held until 07:00 Riyadh next day (04:00 UTC).
  const late = deliveryPlan({ kind: "request.message", priority: "normal", prefs, now: utc("2026-10-11T20:30:00Z") });
  assert.equal(late.email, "digest");
  assert.equal(late.push, "digest");
  assert.equal(late.whatsapp, "skip");
  assert.equal(late.deliverAfter?.toISOString(), "2026-10-12T04:00:00.000Z");
  // 03:00 Riyadh → same morning.
  const early = deliveryPlan({ kind: "request.message", priority: "high", prefs, now: utc("2026-10-12T00:00:00Z") });
  assert.equal(early.deliverAfter?.toISOString(), "2026-10-12T04:00:00.000Z");
  // 07:00 Riyadh is outside the window.
  const morning = deliveryPlan({ kind: "request.message", priority: "normal", prefs, now: utc("2026-10-12T04:00:00Z") });
  assert.equal(morning.deliverAfter, null);
  assert.equal(morning.email, "now");
});

test("delivery plan: urgent bypasses quiet hours and the digest", () => {
  const plan = deliveryPlan({ kind: "invoice.overdue", priority: "urgent", prefs: { quietStart: 22, quietEnd: 7, digest: "daily" }, now: utc("2026-10-11T20:30:00Z") });
  assert.deepEqual(plan, { inapp: true, email: "now", push: "now", whatsapp: "now", deliverAfter: null });
});

test("delivery plan: daily digest holds normal and low until 08:00 Riyadh, high goes now", () => {
  const now = utc("2026-10-11T09:00:00Z");
  const normal = deliveryPlan({ kind: "request.status", priority: "normal", prefs: { digest: "daily" }, now });
  assert.equal(normal.email, "digest");
  assert.equal(normal.push, "digest");
  assert.equal(normal.whatsapp, "skip");
  assert.equal(normal.deliverAfter?.toISOString(), "2026-10-12T05:00:00.000Z");
  const high = deliveryPlan({ kind: "invoice.issued", priority: "high", prefs: { digest: "daily" }, now });
  assert.equal(high.email, "now");
  assert.equal(high.deliverAfter, null);
  // Disabled channels stay skipped rather than becoming "digest".
  const noMail = deliveryPlan({ kind: "request.status", priority: "low", prefs: { digest: "daily", emailEnabled: false }, now });
  assert.equal(noMail.email, "skip");
  assert.equal(noMail.push, "digest");
  // Quiet hours ending after the digest time: the later of the two wins.
  const both = deliveryPlan({ kind: "request.status", priority: "low", prefs: { digest: "daily", quietStart: 23, quietEnd: 10 }, now: utc("2026-10-11T21:00:00Z") });
  assert.equal(both.deliverAfter?.toISOString(), "2026-10-12T07:00:00.000Z");
});

test("intentOf classifies Arabic messages", () => {
  const cases: [string, string][] = [
    ["السلام عليكم، وش صار على طلبي؟", "status_question"],
    ["رقم الطلب 41 وين وصل؟", "status_question"],
    ["طلبي رقم ٤٢ متى يخلص", "status_question"],
    ["حوّلت المبلغ أمس، متى تتحدث الفاتورة؟", "payment"],
    ["كيف أسدد الرسوم؟", "payment"],
    ["أرفقت صورة الجواز والإقامة في الطلب", "document"],
    ["للأسف ما أحد يرد علي والطلب متأخر جدًا", "complaint"],
    ["أبغى أقدم طلب نقل كفالة جديد، كم التكلفة؟", "new_request"],
    ["ممكن تسوون لنا تأسيس شركة", "new_request"],
    ["شكرًا لكم، يعطيكم العافية", "thanks"],
    ["مرحبا", "greeting"],
    ["ok", "other"],
  ];
  for (const [text, intent] of cases) assert.equal(intentOf(text).intent, intent, text);
  assert.equal(intentOf("ok").confidence, 0);
  assert.ok(intentOf("مرحبا").confidence < intentOf("رقم الطلب 41 وين وصل؟").confidence);
  for (const text of cases.map(([t]) => t)) {
    const c = intentOf(text).confidence;
    assert.ok(c >= 0 && c <= 1, text);
  }
});

test("intentOf flags urgency and extracts references in either digit set", () => {
  const urgent = intentOf("عاجل: الإقامة تنتهي اليوم ضروري تجديدها");
  assert.equal(urgent.urgent, true);
  assert.equal(intentOf("أرسلت المستندات فورًا").urgent, true);
  assert.equal(intentOf("شكرًا لكم").urgent, false);
  assert.equal(intentOf("وش صار على طلبي HBS-2026-00041؟").reference, "HBS-2026-00041");
  assert.equal(intentOf("الطلب hbs-41 متأخر").reference, "HBS-41");
  assert.equal(intentOf("رقم الطلب 41 وين وصل؟").reference, "41");
  assert.equal(intentOf("طلب رقم ٤٢").reference, "42");
  assert.equal(intentOf("مرحبا").reference, null);
});

test("suggested replies are short, polite Arabic drafts with the context filled in", () => {
  const drafts = suggestReplies("status_question", { customerName: "أحمد", reference: "HBS-2026-00041", status: "reviewing", freeText: true });
  assert.ok(drafts.length >= 1 && drafts.length <= 3);
  assert.match(drafts[0], /أحمد/);
  assert.match(drafts[0], /HBS-2026-00041/);
  assert.match(drafts[0], /قيد المراجعة/);
  for (const intent of ["status_question", "payment", "document", "complaint", "new_request", "thanks", "greeting", "other"] as const) {
    for (const freeText of [true, false]) {
      const list = suggestReplies(intent, { freeText });
      assert.ok(list.length >= 1 && list.length <= 3, intent);
      for (const draft of list) {
        assert.ok(draft.length <= MAX_REPLY_LENGTH, `${intent}: ${draft.length}`);
        assert.match(draft, /[؀-ۿ]/);
        assert.doesNotMatch(draft, /undefined|null/);
      }
    }
  }
  // Outside the free-text window the drafts are the template nudges.
  assert.ok(suggestReplies("complaint", { freeText: false }).length <= 2);
});

test("buildBrief ranks urgent money and documents first and counts the headline", () => {
  const brief = buildBrief({
    audience: "customer",
    now: utc("2026-10-11T09:00:00Z"),
    unread: [
      notification({ id: 1, kind: "request.file", priority: "low" }),
      notification({ id: 2, kind: "request.file", priority: "low", count: 2 }),
      notification({ id: 3, kind: "quote.sent", priority: "high", title: "عرض سعر", path: "/requests/3" }),
    ],
    overdueInvoices: [{ reference: "INV-7", days: 10, total: "1,150 ر.س" }, { reference: "INV-8", days: 2, total: "500 ر.س" }],
    expiringReminders: [{ label: "إقامة محمد", days: 5 }],
    waitingRequests: [{ reference: "HBS-2026-00041", service: "تجديد إقامة", path: "/requests/41" }],
  });
  assert.equal(brief.generatedAt.toISOString(), "2026-10-11T09:00:00.000Z");
  assert.deepEqual(brief.items.map(item => item.priority), ["urgent", "urgent", "high", "high", "high", "low"]);
  assert.match(brief.items[0].title, /INV-7/);
  assert.match(brief.items[1].title, /إقامة محمد/);
  assert.equal(brief.items[1].reason.length > 0, true);
  assert.equal(brief.items[2].path, "/invoices");
  assert.equal(brief.items[3].path, "/requests/41");
  assert.equal(brief.items[4].path, "/requests/3");
  // The two low notifications of one kind fold into a single line.
  assert.equal(brief.items[5].title, "3 إشعارات · ملف جديد في الطلب");
  assert.equal(brief.items[5].path, "/notifications");
  assert.equal(brief.headline, "لديك 5 أمور تحتاج انتباهك اليوم.");
  // Same input, same brief.
  assert.deepEqual(buildBrief({ audience: "customer", now: utc("2026-10-11T09:00:00Z"), unread: [], overdueInvoices: [{ reference: "A", days: 1, total: "1" }], expiringReminders: [], waitingRequests: [] }).headline, "لديك أمر واحد يحتاج انتباهك اليوم.");
});

test("buildBrief office queues and the empty state", () => {
  const empty = buildBrief({ audience: "office", now: utc("2026-10-11T09:00:00Z"), unread: [], overdueInvoices: [], expiringReminders: [], waitingRequests: [], office: { unassigned: 0, openInquiries: 0, unmatchedWhatsapp: 0, overdueTotalHalalas: 0 } });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.headline, "كل شيء هادئ، لا يوجد ما يحتاج انتباهك الآن.");
  const busy = buildBrief({ audience: "office", now: utc("2026-10-11T09:00:00Z"), unread: [], overdueInvoices: [], expiringReminders: [], waitingRequests: [], office: { unassigned: 2, openInquiries: 1, unmatchedWhatsapp: 3, overdueTotalHalalas: 123_450 } });
  assert.deepEqual(busy.items.map(item => item.path), ["/office/requests", "/office/whatsapp", "/office/invoices", "/office/inquiries"]);
  assert.equal(busy.items[0].title, "طلبان بلا موظف مسؤول");
  assert.equal(busy.items[1].title, "3 رسائل واتساب بلا رد");
  assert.match(busy.items[2].title, /1,234\.5 ر\.س/);
  assert.equal(busy.headline, "لديك 3 أمور تحتاج انتباهك اليوم.");
  const calm = buildBrief({ audience: "customer", now: utc("2026-10-11T09:00:00Z"), unread: [notification({ id: 9, kind: "request.status" })], overdueInvoices: [], expiringReminders: [], waitingRequests: [] });
  assert.equal(calm.headline, "لديك تحديث واحد دون أمور عاجلة.");
});

test("digestMail groups by kind with counts and links to the notification centre", () => {
  const mail = digestMail("client@example.test", [
    notification({ id: 1, kind: "request.message", title: "رسالة في HBS-1", count: 2 }),
    notification({ id: 2, kind: "request.message", title: "رسالة في HBS-2" }),
    notification({ id: 3, kind: "invoice.issued", priority: "high", title: "فاتورة INV-3" }),
  ]);
  assert.equal(mail.to, "client@example.test");
  assert.equal(mail.subject, "ملخص إشعاراتك اليومي");
  assert.equal(mail.lines[0], "لديك 4 إشعارات منذ آخر ملخص.");
  // Higher priority group first, each with its count and titles.
  assert.deepEqual(mail.lines.slice(1), ["فاتورة جديدة (1):", "• فاتورة INV-3", "رسالة من المكتب (3):", "• رسالة في HBS-1", "• رسالة في HBS-2"]);
  assert.deepEqual(mail.action, { label: "فتح الإشعارات", path: "/notifications" });
  const many = digestMail("c@example.test", [1, 2, 3, 4, 5].map(id => notification({ id, kind: "request.file", title: `ملف ${id}` })));
  assert.ok(many.lines.includes("• و2 غيرها"));
});

test("maskPhone keeps only the prefix and the last two digits", () => {
  assert.equal(maskPhone("966512345678"), "9665••••••78");
  assert.equal(maskPhone("+966 51 234 5678"), "9665••••••78");
  assert.equal(maskPhone("٠٥١٢٣٤٥٦٧٨"), "0512••••78");
  assert.equal(maskPhone("12345"), "12•45");
  assert.equal(maskPhone("123"), "•••");
});
