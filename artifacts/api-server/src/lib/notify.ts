import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

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
    .map((line) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.9;color:#2f4a47">${escapeHtml(line)}</p>`)
    .join("");
  const button = url && mail.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px"><tr><td style="border-radius:12px;background:#174b50"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#f6efe3;text-decoration:none">${escapeHtml(mail.action.label)}</a></td></tr></table>`
    : "";
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(mail.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f4ed;font-family:Tahoma,'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f4ed;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e3ded0;border-radius:18px;overflow:hidden">
<tr><td style="background:#081a1c;padding:20px 28px;color:#f6efe3;font-size:19px;font-weight:700">HBS <span style="color:#e5a27b">|</span> حلول الغد</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.5;color:#173e42">${escapeHtml(mail.heading)}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e3ded0;font-size:12.5px;line-height:1.8;color:#5d706a">رسالة آلية من بوابة HBS حلول الغد. لا يطلب المكتب كلمات المرور أو رموز التحقق عبر البريد.<br>للتواصل: 0555208213 · hr@hrhbs.com</td></tr>
</table></td></tr></table></body></html>`;
  const text = [mail.heading, "", ...mail.lines, ...(url && mail.action ? ["", `${mail.action.label}: ${url}`] : []), "", "رسالة آلية من بوابة HBS حلول الغد."].join("\n");
  return { html, text };
}

let warnedOff = false;
export function notify(mail: Mail | null): void {
  if (!mail) return;
  if (!mailConfigured()) {
    if (!warnedOff) { logger.info("Email notifications are off (SMTP settings missing)"); warnedOff = true; }
    return;
  }
  const { html, text } = renderMail(mail);
  const from = process.env.MAIL_FROM || `HBS حلول الغد <${process.env.SMTP_USER}>`;
  transport().sendMail({ from, to: mail.to, subject: mail.subject, html, text })
    .then(() => logger.info({ subject: mail.subject }, "Notification sent"))
    .catch((error: unknown) => logger.warn({ err: error, subject: mail.subject }, "Notification failed"));
}

// ---- messages ---------------------------------------------------------------

type RequestInfo = { id: number; reference: string; service: string; category?: string };

export function statusChangedMail(to: string | null, request: RequestInfo, status: string): Mail | null {
  if (!to) return null;
  const service = `«${request.service}»`;
  const byStatus: Record<string, { heading: string; line: string }> = {
    received: { heading: "طلبك في مرحلة الاستلام", line: `أعاد المكتب طلبك ${service} إلى مرحلة الاستلام.` },
    reviewing: { heading: "طلبك قيد المراجعة", line: `بدأ المكتب العمل على طلبك ${service}.` },
    waiting_on_customer: { heading: "المكتب يحتاج ردّك", line: `يحتاج المكتب معلومة منك لإكمال طلبك ${service}. افتح الطلب واستفسر من المكتب عمّا يلزم.` },
    completed: { heading: "اكتمل طلبك", line: `اكتمل طلبك ${service}، وتجد تفاصيله في سجلك.` },
  };
  const copy = byStatus[status];
  if (!copy) return null;
  return {
    to,
    subject: `${copy.heading} · ${request.reference}`,
    heading: copy.heading,
    lines: [copy.line, `رقم الطلب: ${request.reference} · الحالة: ${statusLabels[status]}`],
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
    lines: [`الخدمة: ${request.service}`, `المجال: ${categoryLabels[request.category ?? ""] ?? "غير محدد"}`, `رقم الطلب: ${request.reference}`],
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
    subject: `مستند جديد على الطلب ${request.reference}`,
    heading: "أرفق العميل مستندًا",
    lines: [`الطلب: ${request.reference} · ${request.service}`, `الملفات: ${fileNames}`],
    action: { label: "افتح طلبات العملاء", path: "/office/requests" },
  };
}

export function customerNewFileMail(to: string | null, request: RequestInfo): Mail | null {
  if (!to) return null;
  return {
    to,
    subject: `مستند جديد على طلبك ${request.reference}`,
    heading: "أرفق المكتب مستندًا على طلبك",
    lines: [`أضاف المكتب مستندًا إلى طلبك «${request.service}». تجده في صفحة الطلب.`],
    action: { label: "افتح الطلب", path: `/requests/${request.id}` },
  };
}
