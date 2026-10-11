import type { Invoice, PortalSummary, Reminder, ServiceRequest, Subscription } from '@workspace/api-client-react';
import { daysLabel, daysUntil, formatMoney } from './format';

// "What you need to do now" on the customer dashboard: one list built from
// the queries the dashboard already runs (requests, portal summary), so no
// extra round trip. Pure so it can be unit-tested; order is by urgency for
// the office's cash flow and the request's progress: price quotes to accept,
// requests waiting on the customer, unpaid invoices, a subscription whose
// invoice is overdue, expiring documents, then a registration still under review.

export type TaskKind = 'quote' | 'request' | 'invoice' | 'subscription' | 'document' | 'registration';
export type Task = { key: string; kind: TaskKind; title: string; reason: string; href: string };

// The quote arrives with the backend's regenerated client; until then the
// field is read loosely so the list keeps working either way.
type QuoteLike = { acceptedAt?: string | null; declinedAt?: string | null } | null | undefined;
export const pendingQuote = (request: ServiceRequest): boolean => {
  const quote = (request as ServiceRequest & { quote?: QuoteLike }).quote;
  return !!quote && !quote.acceptedAt && !quote.declinedAt;
};

export const DOCUMENT_WINDOW_DAYS = 30;

export function customerTasks(input: {
  requests?: ServiceRequest[] | null;
  summary?: PortalSummary | null;
  // Invoices already loaded by a request page, when there are any.
  invoices?: Invoice[] | null;
  registrationStatus?: string | null;
  // The company's subscription, when the dashboard could load one (owners only).
  subscription?: Subscription | null;
}): Task[] {
  const tasks: Task[] = [];
  const requests = input.requests ?? [];
  const ref = (r: ServiceRequest) => `${r.service} (${r.reference})`;
  for (const r of requests) if (pendingQuote(r)) tasks.push({ key: `quote-${r.id}`, kind: 'quote', title: 'راجع عرض السعر', reason: `${ref(r)}: وافق على العرض ليبدأ المكتب العمل.`, href: `/requests/${r.id}#quote` });
  for (const r of requests) if (r.status === 'waiting_on_customer') tasks.push({ key: `request-${r.id}`, kind: 'request', title: `ردّ على المكتب: ${r.service}`, reason: r.customerMessage ? `المكتب يحتاج منك: ${r.customerMessage}` : `${r.reference}: أرفق ما يطلبه المكتب أو ردّ في المحادثة.`, href: `/requests/${r.id}#messages` });
  const invoices = (input.invoices ?? []).filter(i => i.status === 'issued');
  const invoiceRequests = new Set<number>();
  // A subscription invoice has no request; it is paid from the company page.
  for (const i of invoices) { if (i.requestId !== null) invoiceRequests.add(i.requestId); tasks.push({ key: `invoice-${i.id}`, kind: 'invoice', title: `سدّد فاتورة ${formatMoney(i.total)}`, reason: `${i.description} (${i.requestReference ?? 'اشتراك'})`, href: i.requestId === null ? SUBSCRIPTION_LINK : `/requests/${i.requestId}?invoice=${i.id}#invoices` }); }
  // Without the invoices themselves, a request awaiting payment stands for its invoice.
  let awaiting = 0;
  for (const r of requests) if (r.status === 'awaiting_payment' && !invoiceRequests.has(r.id)) { awaiting++; tasks.push({ key: `pay-${r.id}`, kind: 'invoice', title: `سدّد فاتورة ${r.service}`, reason: `${r.reference}: الطلب بانتظار السداد ليكتمل.`, href: `/requests/${r.id}#invoices` }); }
  const unpaid = input.summary?.unpaidInvoices ?? 0;
  if (unpaid > invoices.length + awaiting) tasks.push({ key: 'invoices', kind: 'invoice', title: unpaid === 1 ? 'سدّد فاتورة غير مسددة' : `سدّد ${unpaid} فواتير غير مسددة`, reason: `الإجمالي ${formatMoney(input.summary!.unpaidTotal)}.`, href: '/requests?status=awaiting_payment' });
  const sub = input.subscription;
  if (sub?.status === 'past_due') tasks.push({ key: `subscription-${sub.id}`, kind: 'subscription', title: 'سدّد فاتورة الاشتراك', reason: `باقة «${sub.plan.name}» متأخرة السداد${sub.latestInvoice?.status === 'issued' ? ` (${formatMoney(sub.latestInvoice.total)})` : ''}؛ سدّدها ليستمر الاشتراك.`, href: SUBSCRIPTION_LINK });
  for (const d of input.summary?.expiringSoon ?? []) {
    const days = daysUntil(d.expiresOn);
    if (days > DOCUMENT_WINDOW_DAYS) continue;
    tasks.push({ key: `document-${d.id}`, kind: 'document', title: `جدّد ${d.label}`, reason: days < 0 ? 'انتهت صلاحيتها؛ اطلب التجديد الآن.' : days === 0 ? 'تنتهي اليوم.' : `تنتهي خلال ${daysLabel(days)}.`, href: documentLink(d) });
  }
  if (input.registrationStatus === 'pending') tasks.push({ key: 'registration', kind: 'registration', title: 'طلب التسجيل قيد المراجعة', reason: 'يراجع المكتب بياناتك ويفعّل حسابك قريبًا.', href: '/registration' });
  return tasks;
}

// The subscription tab of the company page.
export const SUBSCRIPTION_LINK = '/company?tab=subscription';

// Company-file reminders are renewed from the company file; manual ones from the reminders page.
export const documentLink = (d: Reminder) => d.source === 'manual' ? '/documents' : '/company';
