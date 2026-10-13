import type {
  BriefItem, MessageIntent, MessageIntentIntent, Notification, NotificationBrief, NotificationKind, NotificationPriority,
} from "@workspace/api-zod";
import type { Mail } from "./notify";

// The free, in-process "intelligence" behind notifications: priority
// scoring, coalescing, delivery timing, Arabic intent detection for inbound
// messages, suggested replies and the daily brief. Everything here is pure
// (no network, no database, no clock other than the `now` passed in) so it
// is cheap to run on every event and easy to test.

export type Audience = "customer" | "office";
export type KindCategory = "request" | "billing" | "reminder" | "account" | "subscription" | "inbox";
export type Priority = NotificationPriority;
export type KindInfo = { audience: Audience; label: string; basePriority: Priority; category: KindCategory };

export const KINDS: Record<NotificationKind, KindInfo> = {
  "request.status": { audience: "customer", label: "تحديث حالة الطلب", basePriority: "normal", category: "request" },
  "request.message": { audience: "customer", label: "رسالة من المكتب", basePriority: "normal", category: "request" },
  "request.file": { audience: "customer", label: "ملف جديد في الطلب", basePriority: "low", category: "request" },
  "request.assigned": { audience: "customer", label: "تعيين موظف للطلب", basePriority: "low", category: "request" },
  "quote.sent": { audience: "customer", label: "عرض سعر بانتظار ردك", basePriority: "high", category: "billing" },
  "invoice.issued": { audience: "customer", label: "فاتورة جديدة", basePriority: "high", category: "billing" },
  "invoice.overdue": { audience: "customer", label: "فاتورة متأخرة", basePriority: "high", category: "billing" },
  "reminder.expiring": { audience: "customer", label: "وثيقة تقترب من الانتهاء", basePriority: "high", category: "reminder" },
  "registration.decision": { audience: "customer", label: "قرار طلب التسجيل", basePriority: "high", category: "account" },
  "inquiry.answered": { audience: "customer", label: "رد على استفسارك", basePriority: "normal", category: "request" },
  "inquiry.message": { audience: "customer", label: "رسالة من المكتب في استفسارك", basePriority: "normal", category: "request" },
  "company.invite": { audience: "customer", label: "دعوة للانضمام إلى شركة", basePriority: "normal", category: "account" },
  "subscription.started": { audience: "customer", label: "بدء الاشتراك", basePriority: "normal", category: "subscription" },
  "subscription.invoice": { audience: "customer", label: "فاتورة الاشتراك", basePriority: "high", category: "subscription" },
  "subscription.past_due": { audience: "customer", label: "اشتراك متأخر السداد", basePriority: "urgent", category: "subscription" },
  "subscription.cancelled": { audience: "customer", label: "إلغاء الاشتراك", basePriority: "high", category: "subscription" },
  "office.request_new": { audience: "office", label: "طلب جديد", basePriority: "high", category: "request" },
  "office.registration_new": { audience: "office", label: "طلب تسجيل جديد", basePriority: "normal", category: "account" },
  "office.inquiry_new": { audience: "office", label: "استفسار جديد", basePriority: "normal", category: "inbox" },
  "office.inquiry_message": { audience: "office", label: "رسالة عميل في استفسار", basePriority: "normal", category: "inbox" },
  "office.file_new": { audience: "office", label: "ملف جديد من العميل", basePriority: "normal", category: "request" },
  "office.message_new": { audience: "office", label: "رسالة جديدة من العميل", basePriority: "normal", category: "request" },
  "office.quote_answered": { audience: "office", label: "رد العميل على عرض السعر", basePriority: "high", category: "billing" },
  "office.invoice_paid": { audience: "office", label: "تم سداد فاتورة", basePriority: "normal", category: "billing" },
  "office.whatsapp_unmatched": { audience: "office", label: "رسالة واتساب من رقم غير معروف", basePriority: "normal", category: "inbox" },
  "office.whatsapp_message": { audience: "office", label: "رسالة واتساب من عميل", basePriority: "normal", category: "inbox" },
};

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_ORDER: Priority[] = ["urgent", "high", "normal", "low"];
const bump = (priority: Priority, steps = 1): Priority => PRIORITY_ORDER[Math.max(0, PRIORITY_RANK[priority] - steps)];
export const priorityRank = (priority: Priority): number => PRIORITY_RANK[priority];

// ---- Arabic text helpers ----------------------------------------------------

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// Western digits, like the rest of the copy in notify.ts.
export function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => {
    const index = ARABIC_DIGITS.indexOf(digit);
    return String(index >= 0 ? index : PERSIAN_DIGITS.indexOf(digit));
  });
}

// Same normalisation the assistant uses for retrieval: strip tashkeel and
// unify the letters customers spell differently (أ/إ/آ, ى, ة).
export function normalizeArabic(value: string): string {
  return westernDigits(value)
    .normalize("NFD")
    .replace(/[ً-ٰٟـ̀-ͯ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase("ar")
    .replace(/\s+/g, " ")
    .trim();
}

// Arabic counted nouns: dual has its own form, 3–10 take the plural, 11+
// take the singular (accusative).
export type CountForms = { one: string; two: string; few: string; many: string };
export function countPhrase(count: number, forms: CountForms): string {
  if (count === 1) return forms.one;
  if (count === 2) return forms.two;
  if (count >= 3 && count <= 10) return `${count} ${forms.few}`;
  return `${count} ${forms.many}`;
}

// ---- priority ---------------------------------------------------------------

export type PrioritySignals = { daysOverdue?: number; daysLeft?: number; amountHalalas?: number; text?: string; repeated?: boolean };

const URGENT_WORDS = ["عاجل", "مستعجل", "ضروري", "اليوم", "فورا", "فوري", "الان", "حالا", "بسرعه", "طارئ", "طوارئ", "سريع", "urgent", "asap"]
  .map(normalizeArabic);

export function hasUrgentWords(text: string): boolean {
  const normalized = normalizeArabic(text);
  return URGENT_WORDS.some(word => normalized.includes(word));
}

// Large amounts: 5,000 SAR and up get one step more attention.
const LARGE_AMOUNT_HALALAS = 500_000;

export function prioritize(kind: NotificationKind, signals: PrioritySignals = {}): Priority {
  let priority = KINDS[kind].basePriority;
  const overdue = signals.daysOverdue ?? 0;
  if (overdue > 7) return "urgent";
  if (overdue > 0 && PRIORITY_RANK[priority] > PRIORITY_RANK.high) priority = "high";
  if (signals.daysLeft !== undefined) {
    if (signals.daysLeft <= 7) return "urgent";
    if (signals.daysLeft <= 30 && PRIORITY_RANK[priority] > PRIORITY_RANK.high) priority = "high";
  }
  if (signals.text && hasUrgentWords(signals.text)) return "urgent";
  if ((signals.amountHalalas ?? 0) >= LARGE_AMOUNT_HALALAS) priority = bump(priority);
  if (signals.repeated) priority = bump(priority);
  return priority;
}

// ---- grouping ---------------------------------------------------------------

export function groupKeyFor(kind: NotificationKind, targetType: string | null | undefined, targetId: string | number | null | undefined): string {
  return `${kind}:${targetType ?? "-"}:${targetId ?? "-"}`;
}

const COALESCE_FORMS: Partial<Record<NotificationKind, CountForms>> = {
  "request.message": { one: "رسالة جديدة في الطلب", two: "رسالتان جديدتان في الطلب", few: "رسائل جديدة في الطلب", many: "رسالة جديدة في الطلب" },
  "office.message_new": { one: "رسالة جديدة من العميل في الطلب", two: "رسالتان جديدتان من العميل في الطلب", few: "رسائل جديدة من العميل في الطلب", many: "رسالة جديدة من العميل في الطلب" },
  "request.file": { one: "ملف جديد في الطلب", two: "ملفان جديدان في الطلب", few: "ملفات جديدة في الطلب", many: "ملفًا جديدًا في الطلب" },
  "office.file_new": { one: "ملف جديد من العميل في الطلب", two: "ملفان جديدان من العميل في الطلب", few: "ملفات جديدة من العميل في الطلب", many: "ملفًا جديدًا من العميل في الطلب" },
  "request.status": { one: "تحديث على الطلب", two: "تحديثان على الطلب", few: "تحديثات على الطلب", many: "تحديثًا على الطلب" },
  "office.whatsapp_message": { one: "رسالة واتساب من العميل", two: "رسالتا واتساب من العميل", few: "رسائل واتساب من العميل", many: "رسالة واتساب من العميل" },
  "office.whatsapp_unmatched": { one: "رسالة واتساب من رقم غير معروف", two: "رسالتا واتساب من أرقام غير معروفة", few: "رسائل واتساب من أرقام غير معروفة", many: "رسالة واتساب من أرقام غير معروفة" },
  "office.request_new": { one: "طلب جديد", two: "طلبان جديدان", few: "طلبات جديدة", many: "طلبًا جديدًا" },
  "office.inquiry_new": { one: "استفسار جديد", two: "استفساران جديدان", few: "استفسارات جديدة", many: "استفسارًا جديدًا" },
  "office.registration_new": { one: "طلب تسجيل جديد", two: "طلبا تسجيل جديدان", few: "طلبات تسجيل جديدة", many: "طلب تسجيل جديد" },
  "reminder.expiring": { one: "وثيقة تقترب من الانتهاء", two: "وثيقتان تقتربان من الانتهاء", few: "وثائق تقترب من الانتهاء", many: "وثيقة تقترب من الانتهاء" },
  "invoice.overdue": { one: "فاتورة متأخرة", two: "فاتورتان متأخرتان", few: "فواتير متأخرة", many: "فاتورة متأخرة" },
};
const GENERIC_FORMS: CountForms = { one: "إشعار", two: "إشعاران", few: "إشعارات", many: "إشعارًا" };
const REFERENCE_RE = /HBS-\d{4}-\d+|HBS-\d+/i;

// Repeated events on one target become one row: "3 رسائل جديدة في الطلب
// HBS-2026-00041". The latest body is kept so the row still says what the
// last event was.
export function coalesced(kind: NotificationKind, count: number, base: { title: string; body: string }): { title: string; body: string } {
  if (count <= 1) return { title: base.title, body: base.body };
  const forms = COALESCE_FORMS[kind];
  const reference = base.title.match(REFERENCE_RE)?.[0] ?? base.body.match(REFERENCE_RE)?.[0] ?? null;
  const title = forms
    ? `${countPhrase(count, forms)}${reference ? ` ${reference}` : ""}`
    : `${countPhrase(count, GENERIC_FORMS)} · ${KINDS[kind].label}${reference ? ` ${reference}` : ""}`;
  return { title, body: `آخر تحديث: ${base.body}` };
}

// ---- Riyadh time ------------------------------------------------------------

const RIYADH = "Asia/Riyadh";
const riyadhFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: RIYADH, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

export type RiyadhParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function riyadhParts(date: Date): RiyadhParts {
  const parts: Record<string, number> = {};
  for (const part of riyadhFormat.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

// The instant at `hour`:00 on the Riyadh calendar day of `date` plus
// `dayOffset` days, independent of the server's own time zone.
export function riyadhTime(date: Date, hour: number, dayOffset = 0): Date {
  const p = riyadhParts(date);
  const wallNow = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = wallNow - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, hour) - offsetMs);
}

// The next Riyadh `hour`:00 strictly after `now`.
export function nextRiyadhHour(now: Date, hour: number): Date {
  const today = riyadhTime(now, hour);
  return today.getTime() > now.getTime() ? today : riyadhTime(now, hour, 1);
}

export const DIGEST_HOUR = 8;
export function nextDigestAt(now: Date): Date {
  return nextRiyadhHour(now, DIGEST_HOUR);
}

export function inQuietHours(hour: number, quietStart: number | null | undefined, quietEnd: number | null | undefined): boolean {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return false;
  return quietStart < quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd;
}

// ---- delivery plan ----------------------------------------------------------

export type DeliveryPrefs = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietStart: number | null;
  quietEnd: number | null;
  digest: "instant" | "daily";
  mutedKinds: readonly string[];
};
export const DEFAULT_PREFS: DeliveryPrefs = { emailEnabled: true, pushEnabled: true, quietStart: null, quietEnd: null, digest: "instant", mutedKinds: [] };

export type ChannelTiming = "now" | "digest" | "skip";
export type DeliveryPlan = {
  inapp: true;
  email: ChannelTiming;
  push: ChannelTiming;
  whatsapp: "now" | "skip";
  deliverAfter: Date | null;
};

// In-app always; the other channels follow the user's choices. Muted kinds
// stay in-app only, urgent goes out at once, quiet hours hold mail/push
// until they end, and a daily digest holds normal/low until 08:00 Riyadh.
// WhatsApp is only for immediate customer messages: it is never held.
export function deliveryPlan(input: { kind: NotificationKind; priority: Priority; prefs?: Partial<DeliveryPrefs> | null; now: Date }): DeliveryPlan {
  const prefs: DeliveryPrefs = { ...DEFAULT_PREFS, ...(input.prefs ?? {}) };
  const customer = KINDS[input.kind].audience === "customer";
  if (prefs.mutedKinds.includes(input.kind)) {
    return { inapp: true, email: "skip", push: "skip", whatsapp: "skip", deliverAfter: null };
  }
  const email: ChannelTiming = prefs.emailEnabled ? "now" : "skip";
  const push: ChannelTiming = prefs.pushEnabled ? "now" : "skip";
  if (input.priority === "urgent") {
    return { inapp: true, email, push, whatsapp: customer ? "now" : "skip", deliverAfter: null };
  }
  let deliverAfter: Date | null = null;
  if (inQuietHours(riyadhParts(input.now).hour, prefs.quietStart, prefs.quietEnd)) {
    deliverAfter = nextRiyadhHour(input.now, prefs.quietEnd as number);
  }
  if (prefs.digest === "daily" && (input.priority === "normal" || input.priority === "low")) {
    const digestAt = nextDigestAt(input.now);
    if (!deliverAfter || digestAt.getTime() > deliverAfter.getTime()) deliverAfter = digestAt;
  }
  const held = (timing: ChannelTiming): ChannelTiming => (timing === "now" && deliverAfter ? "digest" : timing);
  return {
    inapp: true,
    email: held(email),
    push: held(push),
    whatsapp: customer && !deliverAfter ? "now" : "skip",
    deliverAfter,
  };
}

// ---- intent -----------------------------------------------------------------

type Lexicon = { intent: MessageIntentIntent; weight: number; phrases: string[] };

// Phrases are matched as substrings of the normalised text, so a prefix
// like و or ال does not hide a hit. Multi-word phrases carry more weight.
const LEXICONS: Lexicon[] = ([
  { intent: "complaint", weight: 1, phrases: [
    "شكوي", "اشتكي", "تاخير", "تاخر", "متاخر", "مشكله", "غير راضي", "مو راضي", "ما احد يرد", "لم يرد", "لا احد يرد", "محد يرد",
    "ما رديتو", "ما رديتم", "سيء", "تجاهل", "زعلان", "غلط", "خطا", "مستاء", "ازعاج", "لا يرد", "ماحد يرد", "صار له فتره",
  ] },
  { intent: "payment", weight: 1, phrases: [
    "سداد", "سدد", "دفع", "دفعت", "فاتور", "تحويل", "حولت", "مبلغ", "رسوم", "ايبان", "iban", "ريال", "حساب بنكي", "رابط الدفع",
    "ايصال", "سند", "مدي", "فيزا", "بطاقه", "تكلفه", "سعر", "بكم", "كم يكلف",
  ] },
  { intent: "document", weight: 1, phrases: [
    "مستند", "وثيق", "ملف", "صوره", "ارفق", "ارسلت لكم", "مرفق", "جواز", "اقامه", "رخصه", "شهاده", "نسخه", "pdf", "اوراق",
    "هويه", "تاشيره", "عقد", "ناقص", "تحتاجون", "المطلوب", "ابعث", "ارسل لكم",
  ] },
  { intent: "status_question", weight: 1, phrases: [
    "حاله طلبي", "حاله الطلب", "وضع طلبي", "وضع الطلب", "وش صار", "ايش صار", "وش الاخبار", "وين وصل", "اين وصل", "الي اين وصل",
    "وصل طلبي", "متي يخلص", "متي ينتهي", "متي يجهز", "متي يكون جاهز", "تحديث", "اخر تطورات", "كم باقي", "صار شي", "فيه جديد",
    "في جديد", "خلص", "جاهز", "متي", "طلبي",
  ] },
  { intent: "new_request", weight: 1, phrases: [
    "طلب جديد", "ابي اقدم", "ابغي", "ابغا", "اريد", "احتاج", "نقل كفاله", "تجديد", "اصدار", "استخراج", "تاسيس", "خدمه", "ممكن تسوون",
    "تقدرون", "هل تقدمون", "عندكم خدمه", "كيف اقدم", "ودي", "محتاج",
  ] },
  { intent: "thanks", weight: 0.6, phrases: [
    "شكرا", "مشكور", "يعطيك العافيه", "يعطيكم العافيه", "جزاك الله", "جزاكم الله", "ما قصرت", "ماقصرت", "ما قصرتو", "الله يعطيك",
    "تسلم", "ممتن", "كثر الله خيرك", "بارك الله",
  ] },
  { intent: "greeting", weight: 0.5, phrases: [
    "السلام عليكم", "سلام عليكم", "مرحبا", "اهلا", "صباح الخير", "مساء الخير", "هلا", "حياكم", "السلام", "مرحبتين", "صباح النور",
  ] },
] satisfies Lexicon[]).map(lexicon => ({ ...lexicon, phrases: lexicon.phrases.map(normalizeArabic) }));

// Tie-break: the intents the office must act on come first.
const INTENT_ORDER: MessageIntentIntent[] = ["complaint", "payment", "document", "status_question", "new_request", "thanks", "greeting", "other"];

export function extractReference(text: string): string | null {
  const normalized = westernDigits(text);
  const full = normalized.match(/\bHBS\s*-?\s*(\d{4})\s*-\s*(\d{1,9})\b/i);
  if (full) return `HBS-${full[1]}-${full[2]}`;
  const short = normalized.match(/\bHBS\s*-?\s*(\d{1,9})\b/i);
  if (short) return `HBS-${short[1]}`;
  const spoken = normalizeArabic(normalized).match(/(?:طلب(?:ي)?\s*(?:رقم)?|رقم\s*(?:الطلب|المعامله)|المعامله\s*(?:رقم)?)\s*[:#]?\s*(\d{1,9})\b/);
  return spoken ? spoken[1] : null;
}

export function intentOf(text: string): MessageIntent {
  const normalized = normalizeArabic(text);
  const scores = new Map<MessageIntentIntent, number>();
  let total = 0;
  for (const lexicon of LEXICONS) {
    let score = 0;
    for (const phrase of lexicon.phrases) {
      if (!phrase || !normalized.includes(phrase)) continue;
      score += lexicon.weight * (phrase.includes(" ") ? 2 : 1);
    }
    if (score > 0) { scores.set(lexicon.intent, score); total += score; }
  }
  let intent: MessageIntentIntent = "other";
  let top = 0;
  for (const candidate of INTENT_ORDER) {
    const score = scores.get(candidate) ?? 0;
    if (score > top) { intent = candidate; top = score; }
  }
  // The share of the evidence the winner holds, discounted when it rests on
  // a single word.
  const confidence = top === 0 ? 0 : Math.min(1, Math.round((top / total) * (top >= 2 ? 1 : 0.6) * 100) / 100);
  return { intent, confidence, urgent: hasUrgentWords(text), reference: extractReference(text) };
}

// ---- suggested replies ------------------------------------------------------

export type ReplyContext = { customerName?: string | null; reference?: string | null; status?: string | null; freeText: boolean };

const STATUS_LABELS: Record<string, string> = {
  received: "تم استلامه",
  reviewing: "قيد المراجعة",
  waiting_on_customer: "بانتظار استكمال من طرفكم",
  submitted_to_authority: "مرفوع للجهة المختصة",
  awaiting_payment: "بانتظار السداد",
  completed: "مكتمل",
};
export const MAX_REPLY_LENGTH = 300;

export function suggestReplies(intent: MessageIntentIntent, ctx: ReplyContext): string[] {
  const greeting = ctx.customerName ? `أهلًا ${ctx.customerName.trim()}،` : "أهلًا بك،";
  const request = ctx.reference ? `طلبكم ${ctx.reference}` : "طلبكم";
  const status = ctx.status ? STATUS_LABELS[ctx.status] ?? null : null;
  const closing = "نسعد بخدمتكم.";
  const portal = "يمكنكم متابعة التفاصيل من حسابكم في الموقع.";
  // Outside the 24 h window only a template goes out, so keep to a short
  // nudge the office can paste into it.
  if (!ctx.freeText) {
    return [
      `${greeting} لدينا تحديث بخصوص ${request}. ${portal} ${closing}`,
      `${greeting} نرجو التواصل معنا على هذا الرقم لمتابعة ${request}. ${closing}`,
    ].map(trimReply);
  }
  let drafts: string[];
  switch (intent) {
    case "status_question":
      drafts = [
        status
          ? `${greeting} ${request} حاليًا ${status}. سنوافيكم بأي جديد فور حدوثه. ${closing}`
          : `${greeting} ${request} قيد المتابعة لدى فريقنا، وسنوافيكم بأي جديد فور حدوثه. ${closing}`,
        `${greeting} ${portal} وإن احتجتم أي توضيح فنحن في خدمتكم.`,
        `${greeting} نتحقق الآن من آخر مستجدات ${request} ونعود إليكم خلال وقت قصير. شكرًا لصبركم.`,
      ];
      break;
    case "payment":
      drafts = [
        `${greeting} يمكنكم سداد الفاتورة إلكترونيًا من صفحة ${request} في حسابكم، وسيُحدَّث الطلب تلقائيًا بعد السداد. ${closing}`,
        `${greeting} شكرًا لتحويلكم. سنتحقق من وصول المبلغ ونؤكد لكم خلال وقت قصير.`,
        `${greeting} إن واجهتكم صعوبة في السداد فأرسلوا لنا صورة الإيصال وسنتولى الباقي. ${closing}`,
      ];
      break;
    case "document":
      drafts = [
        `${greeting} وصلنا المستند، شكرًا لكم. سنراجعه ونوافيكم إن احتجنا شيئًا آخر.`,
        `${greeting} نرجو رفع المستندات من صفحة ${request} في حسابكم حتى تُحفظ مع الطلب مباشرة. ${closing}`,
        `${greeting} نحتاج نسخة واضحة من المستند المطلوب لاستكمال ${request}. شكرًا لتعاونكم.`,
      ];
      break;
    case "complaint":
      drafts = [
        `${greeting} نعتذر عن الإزعاج. أحلنا الأمر إلى المسؤول المباشر وسنتواصل معكم اليوم بالحل. شكرًا لصبركم.`,
        `${greeting} نأسف لما حصل بخصوص ${request}. نرجو منكم تزويدنا بالتفاصيل لنعالج الأمر فورًا.`,
        `${greeting} ملاحظتكم محل اهتمامنا، وسنحرص على ألا يتكرر ذلك. ${closing}`,
      ];
      break;
    case "new_request":
      drafts = [
        `${greeting} يسعدنا خدمتكم. يمكنكم تقديم الطلب من حسابكم في الموقع وسنبدأ العمل عليه مباشرة.`,
        `${greeting} أخبرونا بتفاصيل الخدمة المطلوبة وسنوافيكم بالمتطلبات والتكلفة. ${closing}`,
        `${greeting} أسعار الخدمات ومتطلباتها موضحة في صفحة الخدمات على الموقع، ونحن جاهزون للإجابة عن أي سؤال.`,
      ];
      break;
    case "thanks":
      drafts = [
        `${greeting} العفو، سعدنا بخدمتكم ونتطلع لخدمتكم دائمًا.`,
        `${greeting} شكرًا لثقتكم بنا. ${closing}`,
      ];
      break;
    case "greeting":
      drafts = [
        `${greeting} وعليكم السلام ورحمة الله. كيف نقدر نخدمكم؟`,
        `${greeting} حياكم الله، تفضلوا بطرح استفساركم ونحن في خدمتكم.`,
      ];
      break;
    default:
      drafts = [
        `${greeting} وصلتنا رسالتكم وسيتواصل معكم فريقنا قريبًا. ${closing}`,
        `${greeting} هل يمكنكم توضيح طلبكم أكثر حتى نخدمكم بشكل أفضل؟`,
        `${greeting} ${portal} ${closing}`,
      ];
  }
  return drafts.slice(0, 3).map(trimReply);
}

function trimReply(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= MAX_REPLY_LENGTH ? clean : `${clean.slice(0, MAX_REPLY_LENGTH - 1).trimEnd()}…`;
}

// ---- brief ------------------------------------------------------------------

export type BriefInput = {
  audience: Audience;
  now: Date;
  unread: Notification[];
  overdueInvoices: { reference: string; days: number; total: string; path?: string | null }[];
  expiringReminders: { label: string; days: number; path?: string | null }[];
  waitingRequests: { reference: string; service: string; path?: string | null }[];
  office?: { unassigned: number; openInquiries: number; unmatchedWhatsapp: number; overdueTotalHalalas: number };
};

export const MAX_BRIEF_ITEMS = 8;
const dayPhrase = (days: number) => countPhrase(days, { one: "يوم واحد", two: "يومين", few: "أيام", many: "يومًا" });
const sar = (halalas: number) => `${(halalas / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س`;

// What needs attention, ranked: overdue money and expiring documents first,
// then requests waiting on someone, then the office queues, then whatever
// is unread. Deterministic, so the same inputs always give the same brief.
export function buildBrief(input: BriefInput): NotificationBrief {
  const items: BriefItem[] = [];
  const office = input.audience === "office";
  for (const invoice of [...input.overdueInvoices].sort((a, b) => b.days - a.days)) {
    items.push({
      kind: "invoice.overdue",
      priority: invoice.days > 7 ? "urgent" : "high",
      title: `فاتورة ${invoice.reference} متأخرة بقيمة ${invoice.total}`,
      reason: `مضى على استحقاقها ${dayPhrase(invoice.days)}`,
      path: invoice.path ?? (office ? "/office/invoices" : "/invoices"),
    });
  }
  for (const reminder of [...input.expiringReminders].sort((a, b) => a.days - b.days)) {
    items.push({
      kind: "reminder.expiring",
      priority: reminder.days <= 7 ? "urgent" : reminder.days <= 30 ? "high" : "normal",
      title: reminder.days <= 0 ? `${reminder.label} انتهت صلاحيتها` : `${reminder.label} تنتهي خلال ${dayPhrase(reminder.days)}`,
      reason: reminder.days <= 7 ? "يلزم البدء في التجديد الآن لتفادي الغرامات" : "ابدأ التجديد مبكرًا",
      path: reminder.path ?? (office ? "/office/reminders" : "/reminders"),
    });
  }
  for (const request of input.waitingRequests) {
    items.push({
      kind: office ? "office.request_new" : "request.status",
      priority: "high",
      title: `${request.service} · ${request.reference}`,
      reason: office ? "طلب بانتظار إجراء من المكتب" : "الطلب بانتظار ردك حتى يستمر العمل عليه",
      path: request.path ?? null,
    });
  }
  if (office && input.office) {
    const o = input.office;
    if (o.unassigned > 0) items.push({
      kind: "office.request_new", priority: "high",
      title: countPhrase(o.unassigned, { one: "طلب واحد بلا موظف مسؤول", two: "طلبان بلا موظف مسؤول", few: "طلبات بلا موظف مسؤول", many: "طلبًا بلا موظف مسؤول" }),
      reason: "الطلبات غير المعينة تتأخر دون متابعة", path: "/office/requests",
    });
    if (o.unmatchedWhatsapp > 0) items.push({
      kind: "office.whatsapp_unmatched", priority: "high",
      title: countPhrase(o.unmatchedWhatsapp, { one: "رسالة واتساب واحدة بلا رد", two: "رسالتا واتساب بلا رد", few: "رسائل واتساب بلا رد", many: "رسالة واتساب بلا رد" }),
      reason: "الرد خلال 24 ساعة يبقي المحادثة مفتوحة بدون قوالب", path: "/office/whatsapp",
    });
    if (o.overdueTotalHalalas > 0) items.push({
      kind: "office.invoice_paid", priority: "high",
      title: `فواتير متأخرة بإجمالي ${sar(o.overdueTotalHalalas)}`,
      reason: "مبالغ مستحقة لم تُسدد بعد", path: "/office/invoices",
    });
    if (o.openInquiries > 0) items.push({
      kind: "office.inquiry_new", priority: "normal",
      title: countPhrase(o.openInquiries, { one: "استفسار واحد بانتظار الرد", two: "استفساران بانتظار الرد", few: "استفسارات بانتظار الرد", many: "استفسارًا بانتظار الرد" }),
      reason: "عملاء ينتظرون إجابة", path: "/office/inquiries",
    });
  }
  // Unread notifications: the pressing ones stand on their own, the rest
  // fold into one line per kind.
  const unread = [...input.unread].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.createdAt.getTime() - a.createdAt.getTime());
  const folded = new Map<string, { count: number; first: Notification }>();
  for (const n of unread) {
    if (n.priority === "urgent" || n.priority === "high") {
      items.push({ kind: n.kind, priority: n.priority, title: n.title, reason: "إشعار مهم لم تقرأه بعد", path: n.path });
    } else {
      const entry = folded.get(n.kind);
      if (entry) entry.count += n.count; else folded.set(n.kind, { count: n.count, first: n });
    }
  }
  for (const [kind, entry] of folded) {
    const info = KINDS[kind as NotificationKind];
    items.push({
      kind,
      priority: entry.first.priority,
      title: entry.count === 1 ? entry.first.title : `${countPhrase(entry.count, GENERIC_FORMS)} · ${info?.label ?? kind}`,
      reason: "غير مقروء",
      path: entry.count === 1 ? entry.first.path : "/notifications",
    });
  }
  // Stable sort: priority first, then the order the sections above pushed.
  const ranked = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => priorityRank(a.item.priority) - priorityRank(b.item.priority) || a.index - b.index)
    .map(({ item }) => item)
    .slice(0, MAX_BRIEF_ITEMS);
  return { generatedAt: input.now, headline: briefHeadline(ranked), items: ranked };
}

export function briefHeadline(items: BriefItem[]): string {
  if (items.length === 0) return "كل شيء هادئ، لا يوجد ما يحتاج انتباهك الآن.";
  const pressing = items.filter(item => item.priority === "urgent" || item.priority === "high").length;
  if (pressing === 0) {
    return `لديك ${countPhrase(items.length, { one: "تحديث واحد", two: "تحديثان", few: "تحديثات جديدة", many: "تحديثًا جديدًا" })} دون أمور عاجلة.`;
  }
  if (pressing === 1) return "لديك أمر واحد يحتاج انتباهك اليوم.";
  if (pressing === 2) return "لديك أمران يحتاجان انتباهك اليوم.";
  return pressing <= 10 ? `لديك ${pressing} أمور تحتاج انتباهك اليوم.` : `لديك ${pressing} أمرًا يحتاج انتباهك اليوم.`;
}

// ---- digest mail ------------------------------------------------------------

const MAX_TITLES_PER_KIND = 3;

export function digestMail(to: string, items: Notification[]): Mail {
  const groups = new Map<string, Notification[]>();
  for (const item of items) {
    const list = groups.get(item.kind);
    if (list) list.push(item); else groups.set(item.kind, [item]);
  }
  const lines: string[] = [];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  lines.push(`لديك ${countPhrase(total, GENERIC_FORMS)} منذ آخر ملخص.`);
  const ordered = [...groups.entries()].sort((a, b) => {
    const pa = Math.min(...a[1].map(n => priorityRank(n.priority)));
    const pb = Math.min(...b[1].map(n => priorityRank(n.priority)));
    return pa - pb || b[1].length - a[1].length;
  });
  for (const [kind, list] of ordered) {
    const count = list.reduce((sum, item) => sum + item.count, 0);
    lines.push(`${KINDS[kind as NotificationKind]?.label ?? kind} (${count}):`);
    for (const item of list.slice(0, MAX_TITLES_PER_KIND)) lines.push(`• ${item.title}`);
    if (list.length > MAX_TITLES_PER_KIND) lines.push(`• و${list.length - MAX_TITLES_PER_KIND} غيرها`);
  }
  return {
    to,
    subject: "ملخص إشعاراتك اليومي",
    heading: "ملخص إشعاراتك اليومي",
    lines,
    action: { label: "فتح الإشعارات", path: "/notifications" },
  };
}

// ---- misc -------------------------------------------------------------------

// "966512345678" → "9665••••••78": enough to recognise a number, not to
// dial it.
export function maskPhone(phone: string): string {
  const digits = westernDigits(phone).replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  const head = digits.length >= 8 ? 4 : 2;
  const tail = 2;
  return `${digits.slice(0, head)}${"•".repeat(digits.length - head - tail)}${digits.slice(-tail)}`;
}
