import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";
import { brand } from "./brand";

// Email notifications. Sent over SMTP after the change they describe has been
// saved; a failure is logged and never fails the request. With no SMTP
// settings the notifier is off and every message is skipped.
//
// Settings (Replit secrets):
//   SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS   the mailbox to send from
//   MAIL_FROM          sender shown to clients, e.g. "HBS حلول الغد <hr@hrhbs.com>"
//   HBS_NOTIFY_EMAIL   office inbox for new requests (falls back to HBS_OFFICE_EMAIL)
//   PUBLIC_SITE_URL    links in messages (https://hrhbs.com)
//
// Messages carry the reference, service name and status only: request
// details, notes and answers stay behind sign-in.

export type Mail = {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  action?: { label: string; path: string };
};

const statusLabels: Record<string, string> = {
  received: "تم الاستلام",
  reviewing: "قيد المراجعة",
  waiting_on_customer: "بانتظار العميل",
  submitted_to_authority: "تم الرفع للجهة",
  awaiting_payment: "بانتظار السداد",
  completed: "مكتملة",
};
const categoryLabels: Record<string, string> = {
  passports: "الجوازات والإقامة",
  labor: "الموارد البشرية والعمل",
  business: "تأسيس الشركات والتراخيص",
  other: "دعم الأعمال",
};

const siteUrl = () => (process.env.PUBLIC_SITE_URL ?? "https://hrhbs.com").replace(/\/$/, "");
export const officeInbox = () => process.env.HBS_NOTIFY_EMAIL || process.env.HBS_OFFICE_EMAIL || null;

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter: Transporter | null = null;
function transport(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Arabic, right-to-left, table layout with inline styles for mail clients.
export function renderMail(mail: Mail): { html: string; text: string } {
  const url = mail.action ? `${siteUrl()}${mail.action.path}` : null;
  const paragraphs = mail.lines
    .map((line) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.9;color:${brand.ink}">${escapeHtml(line)}</p>`)
    .join("");
  const button = url && mail.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px"><tr><td style="border-radius:12px;background:${brand.teal}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:${brand.onDark};text-decoration:none">${escapeHtml(mail.action.label)}</a></td></tr></table>`
    : "";
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(mail.subject)}</title></head>
<body style="margin:0;padding:0;background:${brand.paper};font-family:Tahoma,'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${brand.paper};padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${brand.surface};border:1px solid ${brand.line};border-radius:18px;overflow:hidden">
<tr><td style="background:${brand.night};padding:20px 28px;color:${brand.onDark};font-size:19px;font-weight:700">HBS <span style="color:${brand.copperLight}">|</span> حلول الغد</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.5;color:${brand.ink}">${escapeHtml(mail.heading)}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid ${brand.line};font-size:12.5px;line-height:1.8;color:${brand.quiet}">رسالة آلية من بوابة HBS حلول الغد. لا يطلب المكتب كلمات المرور أو رموز التحقق عبر البريد.<br>للتواصل: 0555208213 · hr@hrhbs.com</td></tr>
</table></td></tr></table></body></html>`;
  const text = [mail.heading, "", ...mail.lines, ...(url && mail.action ? ["", `${mail.action.label}: ${url}`] : []), "", "رسالة آلية من بوابة HBS حلول الغد."].join("\n");
  return { html, text };
}

let warnedOff = false;

// Sends now and rejects when SMTP refuses, for callers that must know (the
// reminder sweeps give their claim back on failure). Skipped silently when
// mail is off. Subjects and SMTP errors can carry customer names and
// addresses, so the log keeps only the outcome and the SMTP error code.
export async function sendMailNow(mail: Mail, send: (options: Parameters<Transporter["sendMail"]>[0]) => Promise<unknown> = options => transport().sendMail(options)): Promise<void> {
  if (!mailConfigured()) {
    if (!warnedOff) { logger.info("Email notifications are off (SMTP settings missing)"); warnedOff = true; }
    return;
  }
  const { html, text } = renderMail(mail);
  const from = process.env.MAIL_FROM || `HBS حلول الغد <${process.env.SMTP_USER}>`;
  try {
    await send({ from, to: mail.to, subject: mail.subject, html, text });
    logger.info("Notification sent");
  } catch (error) {
    logger.warn({ code: (error as { code?: string })?.code ?? "unknown" }, "Notification failed");
    throw new Error(`Notification failed (${(error as { code?: string })?.code ?? "unknown"})`);
  }
}

// Fire and forget, after the change it describes is saved: a failure is
// logged by sendMailNow and never fails the request.
export function notify(mail: Mail | null): void {
  if (!mail) return;
  sendMailNow(mail).catch(() => {});
}

// ---- messages ---------------------------------------------------------------

type RequestInfo = { id: number; reference: string; service: string; category?: string };

export function statusChangedMail(to: string | null, request: RequestInfo, status: string, officeMessage?: string | null): Mail | null {
  if (!to) return null;
  const service = `«${request.service}»`;
  const byStatus: Record<string, { heading: string; line: string }> = {
    received: { heading: "طلبك في مرحلة الاستلام", line: `أعاد المكتب طلبك ${service} إلى مرحلة الاستلام.` },
    reviewing: { heading: "طلبك قيد المراجعة", line: `بدأ المكتب العمل على طلبك ${service}.` },
    waiting_on_customer: { heading: "المكتب يحتاج ردّك", line: officeMessage
      ? `يحتاج المكتب منك لإكمال طلبك ${service}: ${officeMessage}`
      : `يحتاج المكتب معلومة منك لإكمال طلبك ${service}. افتح الطلب واستفسر من المكتب عمّا يلزم.` },
    submitted_to_authority: { heading: "رُفع طلبك للجهة المختصة", line: `رفع المكتب طلبك ${service} إلى الجهة المختصة، ونتابعه حتى يكتمل.` },
    awaiting_payment: { heading: "طلبك بانتظار السداد", line: `طلبك ${service} بانتظار سداد الفاتورة. تجدها في صفحة الطلب.` },
    completed: { heading: "اكتمل طلبك", line: `اكتمل طلبك ${service}، وتجد تفاصيله في سجلك. يسعدنا أن تقيّم الخدمة من صفحة الطلب.` },
  };
  const copy = byStatus[status];
  if (!copy) return null;
  return {
    to,
    subject: `${copy.heading} · ${request.reference}`,
    heading: copy.heading,
    lines: [copy.line, `الحالة: «${statusLabels[status]}»`],
    action: { label: "افتح الطلب", path: `/requests/${request.id}` },
  };
}

export function inquiryAnsweredMail(to: string | null, subject: string): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: "ردّ المكتب على استفسارك",
    heading: "ردّ المكتب على استفسارك",
    lines: [`وصل ردّ المكتب على استفسارك «${subject}».`],
    action: { label: "اقرأ الرد", path: "/inquiries" },
  };
}

// Follow-up messages in an inquiry thread; like request messages, the mail
// says that a message arrived, never what it says.
export function customerInquiryMessageMail(to: string | null, inquiryId: number, subject: string): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `رسالة من المكتب على استفسارك «${subject}»`,
    heading: "رسالة جديدة من المكتب",
    lines: [`كتب لك المكتب بخصوص استفسارك «${subject}». اقرأ الرسالة وردّ عليها من صفحة الاستفسار.`],
    action: { label: "افتح المحادثة", path: `/inquiries/${inquiryId}` },
  };
}

export function officeInquiryMessageMail(inquiryId: number, subject: string): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `رسالة عميل في الاستفسار #${inquiryId}`,
    heading: "رسالة جديدة من عميل في استفسار",
    lines: [`الاستفسار #${inquiryId}: ${subject}`],
    action: { label: "افتح استفسارات العملاء", path: "/office/inquiries" },
  };
}

export function registrationDecisionMail(to: string | null, approved: boolean): Mail | null {
  if (!to) return null;
  return approved
    ? { to, subject: "تمت الموافقة على تسجيلك", heading: "مرحبًا بك في بوابة العملاء", lines: ["وافق المكتب على طلب تسجيلك، وتستطيع الآن إرسال طلباتك ومتابعتها من حسابك."], action: { label: "ادخل إلى حسابك", path: "/dashboard" } }
    : { to, subject: "بخصوص طلب تسجيلك", heading: "لم تتم الموافقة على طلب التسجيل", lines: ["راجع المكتب طلب تسجيلك ولم تتم الموافقة عليه. تجد السبب في حسابك، ويمكنك تعديل البيانات وإعادة التقديم."], action: { label: "اطّلع على التفاصيل", path: "/registration" } };
}

export function officeNewRequestMail(request: RequestInfo): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `طلب جديد ${request.reference}: ${request.service}`,
    heading: "طلب خدمة جديد",
    lines: [`الخدمة: ${request.service}`, `المجال: ${categoryLabels[request.category ?? ""] ?? "غير محدد"}`],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function officeNewRegistrationMail(fullName: string): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `طلب تسجيل جديد: ${fullName}`,
    heading: "طلب تسجيل جديد",
    lines: [`قدّم ${fullName} طلب تسجيل في بوابة العملاء، وينتظر مراجعتك.`],
    action: { label: "راجع طلبات التسجيل", path: "/office/registrations" },
  };
}

export function officeNewInquiryMail(subject: string, reference: string | null): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `استفسار جديد: ${subject}`,
    heading: "استفسار جديد من عميل",
    lines: [`الموضوع: ${subject}`, ...(reference ? [`مرتبط بالطلب: ${reference}`] : [])],
    action: { label: "افتح استفسارات العملاء", path: "/office/inquiries" },
  };
}

export function officeNewFileMail(request: RequestInfo, fileNames: string): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `مستند جديد في الطلب ${request.reference}`,
    heading: "أرفق العميل مستندًا",
    lines: [`الطلب: ${request.reference} · ${request.service}`, `الملفات: ${fileNames}`],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function invoiceIssuedMail(to: string | null, request: RequestInfo, invoiceReference: string, total: string): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `فاتورة جديدة على طلبك ${request.reference}`,
    heading: "أصدر المكتب فاتورة على طلبك",
    lines: [`الطلب: «${request.service}»`, `رقم الفاتورة: ${invoiceReference} · الإجمالي شامل الضريبة: ${total}`],
    action: { label: "اعرض الفاتورة", path: `/requests/${request.id}` },
  };
}

export function invoicePaidOfficeMail(request: RequestInfo, invoiceReference: string, total: string): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `سُددت الفاتورة ${invoiceReference}`,
    heading: "سدّد العميل فاتورة إلكترونيًا",
    lines: [`الطلب: ${request.reference} · ${request.service}`, `المبلغ: ${total}`],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function closedInvoicePaidMail(request: RequestInfo, invoiceReference: string, total: string): Mail | null {
  const to = officeInbox();
  if (!to) return null;
  return {
    to,
    subject: `تنبيه: سداد إلكتروني لفاتورة مغلقة ${invoiceReference}`,
    heading: "وصل سداد إلكتروني لفاتورة ملغاة أو مسددة يدويًا",
    lines: [`الطلب: ${request.reference} · ${request.service}`, `المبلغ: ${total}`, "راجع السداد في لوحة ميسّر وردّ المبلغ للعميل أو طابقه."],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function assignedMail(to: string | null, request: RequestInfo, dueText: string | null): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `أُسند إليك الطلب ${request.reference}`,
    heading: "طلب جديد في مسؤوليتك",
    lines: [`الطلب: ${request.reference} · ${request.service}`, ...(dueText ? [`موعد الإنجاز: ${dueText}`] : [])],
    action: { label: "افتح طلباتي", path: "/office/requests?assignee=me" },
  };
}

export function reminderMail(to: string | null, reminder: { kindLabel: string; label: string; expiresText: string; days: number }): Mail | null {
  if (!to) return null;
  const when = reminder.days <= 1 ? "غدًا أو اليوم" : `خلال ${reminder.days} يومًا`;
  return {
    to,
    subject: `تنبيه: ${reminder.kindLabel} تنتهي ${when}`,
    heading: `${reminder.kindLabel} تقترب من الانتهاء`,
    lines: [`${reminder.kindLabel} «${reminder.label}» تنتهي في ${reminder.expiresText}.`, "يسعد المكتب بإنجاز التجديد عنك. أرسل طلب تجديد من حسابك."],
    action: { label: "اطلب التجديد", path: "/requests/new" },
  };
}

export function customerMessageMail(to: string | null, request: RequestInfo): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `رسالة من المكتب على طلبك ${request.reference}`,
    heading: "رسالة جديدة من المكتب",
    lines: [`كتب لك المكتب بخصوص طلبك «${request.service}». اقرأ الرسالة وردّ عليها من صفحة الطلب.`],
    action: { label: "افتح المحادثة", path: `/requests/${request.id}#messages` },
  };
}

export function officeMessageMail(to: string | null, request: RequestInfo): Mail | null {
  const address = to ?? officeInbox();
  if (!address) return null;
  return {
    to: address,
    subject: `ردّ العميل على الطلب ${request.reference}`,
    heading: "رسالة جديدة من عميل",
    lines: [`الطلب: ${request.reference} · ${request.service}`],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function customerNewFileMail(to: string | null, request: RequestInfo): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `مستند جديد في طلبك ${request.reference}`,
    heading: "أرفق المكتب مستندًا على طلبك",
    lines: [`أضاف المكتب مستندًا إلى طلبك «${request.service}». تجده في صفحة الطلب.`],
    action: { label: "افتح الطلب", path: `/requests/${request.id}` },
  };
}

export function quoteSentMail(to: string | null, request: RequestInfo, total: string, note: string | null): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `عرض سعر لطلبك ${request.reference}`,
    heading: "أرسل المكتب عرض سعر لطلبك",
    lines: [`الطلب: «${request.service}»`, `الإجمالي شامل الضريبة: ${total}`, ...(note ? [`تعليق المكتب: ${note}`] : []),
      "راجع العرض ووافق عليه من صفحة الطلب ليبدأ المكتب العمل، أو ارفضه مع توضيح السبب."],
    action: { label: "راجع عرض السعر", path: `/requests/${request.id}` },
  };
}

export function quoteAcceptedMail(to: string | null, request: RequestInfo, total: string): Mail | null {
  const address = to ?? officeInbox();
  if (!address) return null;
  return {
    to: address,
    subject: `وافق العميل على عرض السعر ${request.reference}`,
    heading: "وافق العميل على عرض السعر",
    lines: [`الطلب: ${request.reference} · ${request.service}`, `أُصدرت فاتورة بقيمة ${total} شاملة الضريبة.`],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function quoteDeclinedMail(to: string | null, request: RequestInfo): Mail | null {
  const address = to ?? officeInbox();
  if (!address) return null;
  return {
    to: address,
    subject: `رفض العميل عرض السعر ${request.reference}`,
    heading: "رفض العميل عرض السعر",
    lines: [`الطلب: ${request.reference} · ${request.service}`, "تجد سبب الرفض، إن كتبه العميل، في محادثة الطلب."],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function invoiceOverdueMail(to: string | null, request: RequestInfo, invoice: { id: number; reference: string; total: string; days: number }): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `تذكير بسداد الفاتورة ${invoice.reference}`,
    heading: "فاتورة بانتظار السداد",
    lines: [`الطلب: «${request.service}» · ${request.reference}`,
      `الفاتورة ${invoice.reference} بقيمة ${invoice.total} صدرت قبل ${invoice.days} أيام ولم تُسدد بعد.`,
      "يمكنك السداد إلكترونيًا من صفحة الطلب، أو التواصل مع المكتب لترتيب السداد."],
    // Same return address the payment page uses, so the page checks the invoice on arrival.
    action: { label: "سدّد الفاتورة", path: `/requests/${request.id}?invoice=${invoice.id}` },
  };
}

const companyRoleLabels: Record<string, string> = {
  hr: "الموارد البشرية",
  finance: "المالية",
  viewer: "مشاهدة فقط",
};

// Sent to the address a company owner invited. The invitation is accepted
// by signing in with that same (verified) address.
export function companyInviteMail(to: string | null, companyName: string | null, role: string, inviterName?: string | null): Mail | null {
  if (!to) return null;
  const company = companyName ? `منشأة «${companyName}»` : "منشأة على بوابة HBS";
  const who = inviterName ? `دعاك ${inviterName} للانضمام` : "دُعيت للانضمام";
  return {
    to,
    subject: `دعوة للانضمام إلى ${companyName ?? "منشأة"} على بوابة HBS`,
    heading: "دعوة للانضمام إلى منشأة",
    lines: [
      `${who} إلى ${company} بصلاحية «${companyRoleLabels[role] ?? role}».`,
      "أنشئ حسابًا على البوابة بهذا البريد نفسه وتحقق منه (أو سجّل الدخول إن كان لديك حساب به)، ولا تحتاج إلى تقديم طلب تسجيل.",
      "بعد الدخول افتح صفحة «منشأتي» وستجد ملف المنشأة فيها مباشرة بحسب صلاحيتك.",
    ],
    action: { label: "إنشاء حساب", path: "/sign-up" },
  };
}

// ---- subscriptions ------------------------------------------------------------

type SubscriptionInvoiceInfo = { id: number; reference: string; total: string };

export function subscriptionStartedMail(to: string | null, planName: string, invoice: SubscriptionInvoiceInfo, renewsText: string): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `بدأ اشتراكك في باقة «${planName}»`,
    heading: "بدأ اشتراكك",
    lines: [`اشتركت في باقة «${planName}»، ويتجدد الاشتراك شهريًا في ${renewsText}.`,
      `صدرت فاتورة الشهر الأول ${invoice.reference} بقيمة ${invoice.total} شاملة الضريبة. تجدها في صفحة الاشتراك.`],
    action: { label: "اعرض الاشتراك", path: `/company?tab=subscription&invoice=${invoice.id}` },
  };
}

// The monthly invoice when it is issued (days null), or an overdue reminder
// for it (days since issue).
export function subscriptionInvoiceMail(to: string | null, planName: string, invoice: SubscriptionInvoiceInfo, days: number | null): Mail | null {
  if (!to) return null;
  const reminder = days !== null;
  return {
    to,
    subject: reminder ? `تذكير بسداد فاتورة الاشتراك ${invoice.reference}` : `فاتورة اشتراكك الشهرية ${invoice.reference}`,
    heading: reminder ? "فاتورة اشتراك بانتظار السداد" : "صدرت فاتورة اشتراكك الشهرية",
    lines: [`الباقة: «${planName}»`,
      reminder
        ? `الفاتورة ${invoice.reference} بقيمة ${invoice.total} صدرت قبل ${days} أيام ولم تُسدد بعد.`
        : `رقم الفاتورة: ${invoice.reference} · الإجمالي شامل الضريبة: ${invoice.total}`,
      "يمكنك السداد إلكترونيًا من صفحة الاشتراك، أو التواصل مع المكتب لترتيب السداد."],
    action: { label: "سدّد الفاتورة", path: `/company?tab=subscription&invoice=${invoice.id}` },
  };
}

// Past due for two months with the invoice still unpaid: the subscription is closed.
export function subscriptionCancelledUnpaidMail(to: string | null, planName: string, invoice: SubscriptionInvoiceInfo): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `أُلغي اشتراكك لعدم السداد · ${invoice.reference}`,
    heading: "أُلغي اشتراكك لعدم السداد",
    lines: [`لم تُسدد فاتورة اشتراكك في باقة «${planName}» ${invoice.reference} بقيمة ${invoice.total} خلال 60 يومًا من صدورها، فأُلغي الاشتراك.`,
      "يمكنك الاشتراك مجددًا من صفحة الاشتراك متى شئت، أو التواصل مع المكتب لترتيب السداد."],
    action: { label: "اعرض الاشتراك", path: "/company?tab=subscription" },
  };
}

export function subscriptionPastDueMail(to: string | null, planName: string, invoice: SubscriptionInvoiceInfo): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `اشتراكك متأخر السداد · ${invoice.reference}`,
    heading: "اشتراكك متأخر السداد",
    lines: [`لم تُسدد فاتورة اشتراكك في باقة «${planName}» ${invoice.reference} بقيمة ${invoice.total} خلال 14 يومًا من صدورها، فأصبح الاشتراك متأخر السداد.`,
      "سدّد الفاتورة ليعود الاشتراك نشطًا، أو تواصل مع المكتب لترتيب السداد."],
    action: { label: "سدّد الفاتورة", path: `/company?tab=subscription&invoice=${invoice.id}` },
  };
}
