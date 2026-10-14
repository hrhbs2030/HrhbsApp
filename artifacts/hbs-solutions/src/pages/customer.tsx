import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BellRing, Building2, CalendarClock, CircleAlert, CircleCheck, ClipboardList, CreditCard, FileClock, FileSignature, Link2, MessageSquareText, MessagesSquare, Paperclip, Plus, ReceiptText, Send, UserRoundCheck, UsersRound } from 'lucide-react';
import { getGetCompanySubscriptionQueryKey, getGetPortalSettingsQueryKey, getGetPortalSummaryQueryKey, getListServiceRequestsQueryKey, getListInquiriesQueryKey, getGetServiceRequestQueryKey, getGetServiceRequestHistoryQueryKey, getListServiceRequestInvoicesQueryKey, useGetCompanySubscription, useGetPortalSettings, useGetServiceRequestHistory, useGetPortalSummary, useListServiceRequests, useGetServiceRequest, useListInquiries, useCreateInquiry, useAcceptQuote, useDeclineQuote, type Inquiry, type PortalSummary, type Reminder, type RequestEmployee, type RequestEmployeeStatus, type RequestQuote, type ServiceRequest, type Subscription } from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, RequestRow, Status, StatusTrack, dateText, categoryNames, statusNames } from '@/components/portal-ui';
import { Chip, EmptyState, FilterChip, KeyValueList, SectionHeader, Surface, Tile, TileGrid, Toolbar } from '@/components/portal-kit';
import { chartSeries } from '@/design/tokens';
import { CustomerAssistant } from '@/components/customer-assistant';
import { PrintButton } from '@/components/brand/print';
import { LOCALE, daysUntil, formatCalendarDate, formatDateTime, formatMoney, formatRelative } from '@/lib/format';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { RequestConversation, SubjectChip, focusComposer } from '@/components/request-conversation';
import { CustomerWhatsapp } from '@/components/whatsapp-follow-up';
import { RequestFiles } from '@/components/request-files';
import { CustomerInvoices, RatingPanel } from '@/components/request-billing';
import { customerTasks, type TaskKind } from '@/lib/tasks';
import { useCompanyRole } from '@/lib/company-role';
import { renewalLink } from '@/lib/renewal-link';
import { RoleNotice, WhatsappVerifyBanner } from '@/components/customer-notices';
import './customer.css';

const count = (value: number) => new Intl.NumberFormat(LOCALE).format(value);
const WEEK = 7 * 86_400_000;

/* ---------------------------------------------------------------- charts */
// New requests per week over the last `weeks` weeks, oldest first, from the
// list the dashboard already loads. No history endpoint is invented: when the
// list is too short to draw, the tile shows a trend chip instead of a line.
export function weeklyCounts(requests: ServiceRequest[] | undefined | null, weeks = 8, now = Date.now()): number[] {
  const counts = Array.from({ length: weeks }, () => 0);
  for (const r of requests ?? []) {
    const age = Math.floor((now - Date.parse(r.createdAt)) / WEEK);
    if (age >= 0 && age < weeks) counts[weeks - 1 - age] += 1;
  }
  return counts;
}
// Documents expiring in 15-day buckets over the next 60 days (already expired
// ones join the first bucket), straight from the summary's `expiringSoon`.
export function expiryBuckets(reminders: Reminder[] | undefined | null): number[] {
  const buckets = [0, 0, 0, 0];
  for (const r of reminders ?? []) {
    const days = daysUntil(r.expiresOn);
    if (days > 60) continue;
    buckets[Math.max(0, Math.min(3, Math.ceil(Math.max(days, 0) / 15) - 1))] += 1;
  }
  return buckets;
}
// A 2px line in the first series hue; the current period is a dot in the
// second with a surface ring so it reads on either background (dataviz skill).
function Sparkline({ values }: { values: number[] }) {
  const w = 88, h = 32, pad = 3;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const);
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = points[points.length - 1];
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke={chartSeries[0]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>
    <circle cx={lx} cy={ly} r="4" fill="var(--color-surface)"/>
    <circle cx={lx} cy={ly} r="2.5" fill={chartSeries[1]}/>
  </svg>;
}
// Thin bars with a 2px gap and rounded data ends; the nearest bucket takes the accent.
function MiniBars({ values }: { values: number[] }) {
  const w = 88, h = 32, gap = 2;
  const max = Math.max(1, ...values);
  const bw = (w - gap * (values.length - 1)) / values.length;
  const hot = values.findIndex((v) => v > 0);
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-hidden="true" focusable="false">
    {values.map((v, i) => { const bh = Math.max(v ? 4 : 2, (v / max) * h); return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx="2" fill={i === hot ? chartSeries[1] : chartSeries[0]} opacity={v ? 1 : .25}/>; })}
  </svg>;
}

/* ------------------------------------------------------------- dashboard */
function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Riyadh' }).format(now));
  const day = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' }).format(now);
  return `${hour < 12 ? 'صباح الخير' : 'مساء الخير'}، ${day}`;
}

function LinkedRequest({ reference }: { reference: string }) {
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-sunk px-2 py-0.5 text-xs text-quiet"><Link2 size={12} aria-hidden="true"/>الطلب <span dir="ltr" className="nums font-semibold">{reference}</span></span>;
}

const taskIcons: Record<TaskKind, typeof CircleAlert> = { quote: FileSignature, request: MessagesSquare, invoice: CreditCard, subscription: CalendarClock, document: FileClock, registration: UserRoundCheck };
// Everything that waits on the customer, as links: a price quote to accept, a
// request needing a reply or a document, an unpaid invoice, a document to
// renew. Built from the requests list and the summary the page already loads.
function NeedsYou({ requests, summary, subscription }: { requests: ServiceRequest[] | undefined; summary: PortalSummary | undefined; subscription: Subscription | null | undefined }) {
  if (!requests && !summary) return null;
  const tasks = customerTasks({ requests, summary, subscription });
  if (!tasks.length) return <p className="needs-calm" role="status"><CircleCheck size={20} aria-hidden="true"/>لا شيء مطلوب منك الآن.</p>;
  return <section aria-labelledby="needs-you-title" className="needs">
    <div className="needs-head">
      <span className="needs-icon"><CircleAlert size={20} aria-hidden="true"/></span>
      <h2 id="needs-you-title" className="needs-title display">مطلوب منك الآن <span className="needs-count nums">({count(tasks.length)})</span></h2>
      <p className="needs-sub">خطوات تنتظرك لتتقدّم طلباتك: ابدأ بالأولى.</p>
    </div>
    <ul className="needs-list">{tasks.map((t) => { const Icon = taskIcons[t.kind]; return <li key={t.key}>
      <Link href={t.href} className="needs-item">
        <span className="needs-item-icon"><Icon size={18} aria-hidden="true"/></span>
        <span className="needs-item-body"><strong className="needs-item-title">{t.title}</strong><span className="needs-item-reason">{t.reason}</span></span>
        <ArrowLeft size={16} className="needs-item-arrow" aria-hidden="true"/>
      </Link></li>; })}</ul>
  </section>;
}

type ThreadLine = { key: string; kind: 'request' | 'inquiry'; href: string; title: string; status: string; at: string; meta: ReactNode; fromOffice: boolean };
// The latest conversations, from the recent requests and inquiries the summary carries.
function recentThreads(d: PortalSummary): ThreadLine[] {
  const requests: ThreadLine[] = d.recentRequests.map((r) => ({ key: `r${r.id}`, kind: 'request', href: `/requests/${r.id}#messages`, title: r.service, status: r.status, at: r.lastMessage?.at ?? r.updatedAt, fromOffice: r.lastMessage?.by === 'office' && r.status !== 'completed', meta: <span dir="ltr" className="nums">{r.reference}</span> }));
  const inquiries: ThreadLine[] = d.recentInquiries.map((i) => ({ key: `i${i.id}`, kind: 'inquiry', href: `/inquiries/${i.id}`, title: i.subject, status: i.status, at: i.answeredAt ?? i.createdAt, fromOffice: !!i.answeredAt, meta: i.linkedServiceRequestReference ? <LinkedRequest reference={i.linkedServiceRequestReference}/> : <span>استفسار</span> }));
  return [...requests, ...inquiries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
}

const expiryTone = (days: number) => days < 0 ? 'danger' : days <= 30 ? 'warn' : 'ok';

// Sixty days from today on one track, each document a dot, then the rows.
function ExpiryTimeline({ items }: { items: Reminder[] }) {
  const shown = items.filter((r) => daysUntil(r.expiresOn) <= 60);
  return <>
    <div className="dash-tl" aria-hidden="true">
      <div className="dash-tl-track">
        {[0, 30, 60].map((day) => <span key={day} className="dash-tl-tick" data-pos={day === 0 ? 'start' : day === 60 ? 'end' : 'mid'} style={{ insetInlineStart: `${(day / 60) * 100}%` }}><span>{day === 0 ? 'اليوم' : `${day} يومًا`}</span></span>)}
        {shown.map((r) => { const days = daysUntil(r.expiresOn); return <span key={r.id} className="dash-tl-dot" data-tone={expiryTone(days)} style={{ insetInlineStart: `${(Math.max(0, Math.min(60, days)) / 60) * 100}%` }} title={`${r.label}: ${formatCalendarDate(r.expiresOn)}`}/>; })}
      </div>
      <p className="dash-tl-legend"><span data-tone="danger">منتهية</span><span data-tone="warn">خلال 30 يومًا</span><span>حتى 60 يومًا</span></p>
    </div>
    {shown.map((r) => <div key={r.id} className="dash-exp">
      <div className="dash-exp-main"><div className="dash-exp-title">{reminderKindNames[r.kind]} <span>«{r.label}»</span></div><div className="dash-exp-date">{formatCalendarDate(r.expiresOn)}</div></div>
      <div className="dash-exp-side"><ExpiryBadge expiresOn={r.expiresOn}/><Link href={renewalLink(r)} className="dash-exp-renew">طلب تجديد</Link></div>
    </div>)}
  </>;
}

// What needs the customer now comes first: requests waiting on them, unpaid
// invoices and documents about to expire; then the figures, the latest
// conversations and the company.
export function Dashboard() {
  const q = useGetPortalSummary({query:{queryKey:getGetPortalSummaryQueryKey(),refetchInterval:30000}});
  const requests = useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}});
  const settings = useGetPortalSettings({ query: { queryKey: getGetPortalSettingsQueryKey(), retry: false, staleTime: 60_000 } });
  const { canCreate } = useCompanyRole();
  const d = q.data;
  // Only company accounts can hold a subscription; for anyone else (or until
  // the server has it) the call fails quietly and the task list ignores it.
  const sub = useGetCompanySubscription({ query: { queryKey: getGetCompanySubscriptionQueryKey(), enabled: !!d?.hasCompany, retry: false } });
  const weekly = useMemo(() => weeklyCounts(requests.data), [requests.data]);
  const weeklyTotal = weekly.reduce((a, b) => a + b, 0);
  const weekDelta = weekly[weekly.length - 1] - weekly[weekly.length - 2];
  const buckets = d ? expiryBuckets(d.expiringSoon) : [];
  const expiring = d ? d.expiringSoon.filter((r) => daysUntil(r.expiresOn) >= 0 && daysUntil(r.expiresOn) <= 60).length : 0;
  const urgent = d ? d.expiringSoon.filter((r) => daysUntil(r.expiresOn) <= 30).length : 0;
  const completion = d && d.totalRequests ? Math.round((d.completedRequests / d.totalRequests) * 100) : 0;
  const threads = d ? recentThreads(d) : [];
  return <PortalLayout><PageHeading eyebrow={greeting()} title="نظرة عامة" subtitle="ما يحتاج انتباهك، وأرقام منشأتك، وآخر ما دار مع المكتب." action={canCreate && <Link href="/requests/new" className="btn btn-primary"><Plus size={18} aria-hidden="true"/>طلب خدمة جديد</Link>}/>
    <div className="dash">
      <RoleNotice/>
      <WhatsappVerifyBanner settings={settings.data}/>
      <NeedsYou requests={requests.data} summary={d} subscription={sub.data?.subscription}/>
      {q.isLoading ? <LoadingBlock variant="tiles"/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : d && <>
        <TileGrid>
          <Tile label="طلبات قيد المتابعة" value={count(d.activeRequests)} href="/requests" icon={<ClipboardList size={16} aria-hidden="true"/>} testId="tile-active"
            spark={weeklyTotal >= 2 ? <Sparkline values={weekly}/> : undefined}
            trend={weeklyTotal ? { direction: weekDelta > 0 ? 'up' : weekDelta < 0 ? 'down' : 'flat', value: `${weekDelta > 0 ? '+' : ''}${count(weekDelta)}`, label: 'هذا الأسبوع', good: weekDelta >= 0 } : undefined}
            note={weeklyTotal ? `${count(weeklyTotal)} خلال 8 أسابيع` : 'لا طلبات جديدة خلال 8 أسابيع'}/>
          <Tile label="فواتير غير مسددة" value={d.unpaidInvoices ? formatMoney(d.unpaidTotal) : '0'} long={d.unpaidInvoices > 0} note={d.unpaidInvoices ? `${count(d.unpaidInvoices)} فاتورة` : 'لا يوجد ما يُسدد'} tone={d.unpaidInvoices > 0 ? 'warn' : 'default'} href={d.unpaidInvoices ? '/requests?status=awaiting_payment' : undefined} icon={<ReceiptText size={16} aria-hidden="true"/>} testId="tile-unpaid"/>
          <Tile label="وثائق تنتهي قريبًا" value={count(expiring)} note="خلال 60 يومًا" tone={urgent > 0 ? 'warn' : 'default'} href="/documents" icon={<FileClock size={16} aria-hidden="true"/>} testId="tile-expiring"
            spark={expiring > 0 ? <MiniBars values={buckets}/> : undefined}
            trend={urgent > 0 ? { direction: 'down', value: count(urgent), label: 'خلال 30 يومًا', good: false } : undefined}/>
          <Tile label="طلبات مكتملة" value={count(d.completedRequests)} note={`من ${count(d.totalRequests)} طلبًا`} icon={<CircleCheck size={16} aria-hidden="true"/>} testId="tile-completed"
            trend={d.totalRequests ? { direction: completion >= 50 ? 'up' : 'flat', value: `${count(completion)}%`, label: 'نسبة الإنجاز', good: true } : undefined}/>
        </TileGrid>
        <div className="dash-cols">
          <div className="dash-col">
            <section className="min-w-0" aria-labelledby="dash-threads"><SectionHeader id="dash-threads" title="أحدث المحادثات" description="آخر ما دار بينك وبين المكتب على الطلبات والاستفسارات." action={threads.length ? <Link href="/messages" className="btn btn-ghost btn-sm">كل الرسائل<ArrowLeft size={15} aria-hidden="true"/></Link> : undefined}/>
              {threads.length ? <Surface padding="none" className="overflow-hidden"><ul className="dash-threads">{threads.map((t) => { const Icon = t.kind === 'request' ? MessagesSquare : MessageSquareText; return <li key={t.key}>
                <Link href={t.href} className="dash-thread">
                  <span className={`dash-thread-icon ${t.kind === 'inquiry' ? 'is-inquiry' : ''}`}><Icon size={18} aria-hidden="true"/></span>
                  <span className="dash-thread-body">
                    <span className="dash-thread-top"><span className="dash-thread-title">{t.title}</span>{t.fromOffice && <Chip tone="info" size="sm">رسالة من المكتب</Chip>}</span>
                    <span className="dash-thread-meta">{t.meta}<Status value={t.status}/></span>
                  </span>
                  <time className="dash-thread-time" dateTime={t.at}>{formatRelative(t.at)}</time>
                </Link></li>; })}</ul></Surface>
                : <EmptyBlock title="لا توجد محادثات بعد" text="تظهر هنا رسائل المكتب على طلباتك واستفساراتك." action="استفسار جديد" href="/inquiries"/>}
            </section>
            <section className="min-w-0" aria-labelledby="dash-recent"><SectionHeader id="dash-recent" title="أحدث الطلبات" count={d.recentRequests.length || undefined} action={d.recentRequests.length ? <Link href="/requests" className="btn btn-ghost btn-sm">عرض الكل<ArrowLeft size={15} aria-hidden="true"/></Link> : undefined}/>
              {d.recentRequests.length ? <Surface padding="none" className="overflow-hidden">{d.recentRequests.map(r => <RequestRow key={r.id} request={r}/>)}</Surface> : <EmptyBlock title="لا توجد طلبات بعد" text={canCreate ? 'أرسل طلبك الأول وتابع حالته من هنا.' : 'تظهر هنا طلبات المنشأة حين تُرسل.'} action={canCreate ? 'طلب خدمة جديد' : undefined} href={canCreate ? '/requests/new' : undefined}/>}
            </section>
          </div>
          <div className="dash-col">
            <section className="min-w-0" aria-labelledby="dash-company"><SectionHeader id="dash-company" title="منشأتي" action={<Link href="/company" className="btn btn-ghost btn-sm">ملف المنشأة<ArrowLeft size={15} aria-hidden="true"/></Link>}/>
              <Link href="/company" className="surface surface-hover dash-company p-5 sm:p-6">
                {d.hasCompany ? <div className="dash-company-figs">
                  <div className="dash-company-fig"><div className="dash-company-num display nums">{count(d.employeesCount)}</div><div className="dash-company-lbl">موظف على رأس العمل</div></div>
                  <div className="dash-company-fig"><div className="dash-company-num display nums">{count(d.licensesCount)}</div><div className="dash-company-lbl">ترخيص وشهادة</div></div>
                </div> : <div className="flex min-w-0 items-start gap-3"><span className="kit-tile-icon"><Building2 size={16} aria-hidden="true"/></span><div><strong className="block">أكمل ملف منشأتك</strong><span className="mt-1 block text-sm leading-7 text-quiet">أضف بيانات المنشأة وموظفيها وتراخيصها لتصلك تنبيهات التجديد ويخدمك المكتب أسرع.</span></div></div>}
                <ArrowLeft size={18} className="shrink-0 text-subtle" aria-hidden="true"/>
              </Link></section>
            <section className="min-w-0" aria-labelledby="dash-expiring"><SectionHeader id="dash-expiring" title="تنتهي قريبًا" description="الوثائق خلال الستين يومًا القادمة." action={d.expiringSoon.length ? <Link href="/documents" className="btn btn-ghost btn-sm">كل الوثائق<ArrowLeft size={15} aria-hidden="true"/></Link> : undefined}/>
              {d.expiringSoon.length ? <Surface padding="none" className="overflow-hidden"><ExpiryTimeline items={d.expiringSoon}/></Surface>
                : <Surface><EmptyState compact icon={<BellRing size={22} strokeWidth={1.5} aria-hidden="true"/>} title="لا توجد وثائق تنتهي خلال 60 يومًا" text="أضف تواريخ وثائقك لتصلك التنبيهات قبل انتهائها." action="أضف تواريخ وثائقك" href="/documents"/></Surface>}
            </section>
          </div>
        </div>
      </>}
    </div>
  </PortalLayout>;
}

/* -------------------------------------------------------------- requests */
const requestFilters = ['all', 'received', 'reviewing', 'waiting_on_customer', 'submitted_to_authority', 'awaiting_payment', 'completed'] as const;
export function Requests() {
  const initial = new URLSearchParams(useSearch()).get('status') ?? 'all';
  const q = useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}}); const [filter,setFilter] = useState((requestFilters as readonly string[]).includes(initial) ? initial : 'all');
  const [search, setSearch] = useState('');
  const needle = search.trim();
  const filtered = q.data?.filter(r => (filter === 'all' || r.status === filter) && (!needle || [r.service, r.reference, r.description].some((x) => x?.includes(needle)))) ?? [];
  const total = (key: string) => q.data?.filter(r => key === 'all' || r.status === key).length ?? 0;
  const { canCreate } = useCompanyRole();
  return <PortalLayout><PageHeading eyebrow="طلباتي" title="طلباتي" subtitle="كل طلباتك مع حالتها الحالية وآخر رسالة من المكتب." action={canCreate && <Link href="/requests/new" className="btn btn-primary"><Plus size={18} aria-hidden="true"/>طلب خدمة جديد</Link>}/>
    <RoleNotice/>
    {q.isLoading ? <LoadingBlock variant="table"/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : !q.data?.length ? <EmptyBlock title="لا توجد طلبات بعد" text={canCreate ? 'أرسل طلبك الأول وتابع حالته من هنا.' : 'تظهر هنا طلبات المنشأة حين تُرسل.'} action={canCreate ? 'طلب خدمة جديد' : undefined} href={canCreate ? '/requests/new' : undefined}/> : <>
      <Toolbar search={{ value: search, onChange: setSearch, label: 'بحث في الطلبات', placeholder: 'ابحث بالخدمة أو الرقم المرجعي' }} filters={<div className="flex flex-wrap gap-2" role="group" aria-label="تصفية حسب الحالة">{requestFilters.map(key => <FilterChip key={key} active={filter === key} count={total(key)} onClick={() => setFilter(key)}>{key === 'all' ? 'الكل' : statusNames[key]}</FilterChip>)}</div>}/>
      {filtered.length ? <Surface padding="none" className="reqs-rows">{filtered.map(r => <RequestRow key={r.id} request={r}/>)}</Surface> : <EmptyBlock title={needle ? 'لا توجد طلبات مطابقة' : 'لا توجد طلبات بهذه الحالة'} text={needle ? 'جرّب كلمة أخرى أو أزل التصفية.' : 'اختر حالة أخرى لعرض طلباتك.'}/>}
    </>}
  </PortalLayout>;
}
export { NewRequest } from './new-request';

function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-subtle no-underline hover:text-ink"><ArrowRight size={16} aria-hidden="true"/>{children}</Link>;
}

/* ------------------------------------------------------- request detail */
const reqTabs = [['conversation', 'المحادثة'], ['documents', 'المستندات'], ['invoices', 'الفواتير']] as const;
type ReqTab = (typeof reqTabs)[number][0];
const tabFromHash = (hash: string, invoice: boolean): ReqTab => hash === '#documents' ? 'documents' : hash === '#invoices' || invoice ? 'invoices' : 'conversation';
function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number, select: (key: ReqTab) => void) {
  let next = index;
  if (event.key === 'ArrowLeft') next = (index + 1) % reqTabs.length;
  else if (event.key === 'ArrowRight') next = (index - 1 + reqTabs.length) % reqTabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = reqTabs.length - 1;
  else return;
  event.preventDefault();
  select(reqTabs[next][0]);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}

// The request as a workspace: the status rail with the quote, the facts and
// the description on one side; the conversation, the documents and the
// invoices as tabs on the other. Stacked on phones with the primary action
// pinned above the tab bar.
export function RequestDetail() {
  const {id} = useParams<{id:string}>(); const parsed = Number(id); const search = new URLSearchParams(useSearch()); const justSent = search.get('sent') === '1'; const returnedInvoiceId = Number(search.get('invoice')) || null; const q = useGetServiceRequest(parsed,{query:{enabled:Number.isInteger(parsed)&&parsed>0,queryKey:getGetServiceRequestQueryKey(parsed),refetchInterval:30000}});
  const [tab, setTab] = useState<ReqTab>(() => tabFromHash(typeof window !== 'undefined' ? window.location.hash : '', !!returnedInvoiceId));
  // Arriving at /requests/:id#messages (from an email, say) lands in the composer.
  const open = !!q.data && q.data.status !== 'completed';
  useEffect(() => { if (open && window.location.hash === '#messages') requestAnimationFrame(() => focusComposer(parsed)); }, [open, parsed]);
  const reply = () => { setTab('conversation'); requestAnimationFrame(() => focusComposer(parsed)); };
  const toDocuments = () => { setTab('documents'); requestAnimationFrame(() => document.getElementById('documents')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  const toQuote = () => document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const r = q.data;
  const missing = r ? r.checklist.filter((item) => item.attachmentId === null).length : 0;
  const pendingQuote = !!r?.quote && !r.quote.acceptedAt && !r.quote.declinedAt;
  // Viewers and finance members read the request; only hr and the owner reply, upload, and answer quotes.
  const { canCreate: canWrite } = useCompanyRole();
  return <PortalLayout><div className="req"><BackLink href="/requests">طلباتي</BackLink>
    {!Number.isInteger(parsed)||parsed<=0 ? <EmptyBlock title="الطلب غير متاح" text="تحقق من رابط الطلب وحاول مرة أخرى."/> : q.isLoading ? <LoadingBlock/> : q.error?.status === 404 ? <EmptyBlock title="الطلب غير متاح" text="هذا الطلب غير موجود في حسابك."/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : r && <>
      {justSent && <div role="status" className="rise req-notice"><CircleCheck size={22} aria-hidden="true"/><div><strong>تم إرسال طلبك إلى المكتب</strong><span>الرقم المرجعي <span dir="ltr" className="nums font-semibold">{r.reference}</span>. تابع حالته من هذه الصفحة.</span></div></div>}
      {/* One channel per request: the conversation tab. Questions unrelated to a request go through the Inquiries page. */}
      <PageHeading eyebrow={`طلب رقم ${r.reference}`} title={r.service} meta={<><Status value={r.status}/><Chip tone="outline">{categoryNames[r.category]}</Chip>{r.subject && <SubjectChip subject={r.subject}/>}</>} action={<div className="flex flex-wrap items-center gap-2"><CustomerWhatsapp thread={{ type: 'request', id: r.id }}/><PrintButton label="طباعة الطلب"/>{/* One reply CTA per page: the waiting banner below carries it when the request waits on the customer. */}{canWrite && r.status !== 'completed' && r.status !== 'waiting_on_customer' && <button type="button" className="btn btn-primary" onClick={reply}><MessagesSquare size={17} aria-hidden="true"/>ردّ على المكتب</button>}</div>}/>
      <RoleNotice/>
      <div className="req-grid">
        <div className="req-rail">
          <Surface padding="none" className="req-card">
            <section aria-label="مراحل الطلب" className="req-card-sec">
              <StatusTrack status={r.status} createdAt={r.createdAt} updatedAt={r.updatedAt}/>
              {r.status==='waiting_on_customer'&&<div className="req-waiting"><span className="req-waiting-text"><CircleAlert size={16} aria-hidden="true"/>{r.customerMessage
                ? <span><strong>المكتب يحتاج منك:</strong><span className="whitespace-pre-line break-words">{r.customerMessage}</span><small>أرفق المطلوب في «المستندات»، أو ردّ على المكتب في المحادثة.</small></span>
                : <span>اسأل المكتب في المحادثة عمّا يلزم لإكمال الطلب.</span>}</span>{canWrite && <span className="req-waiting-actions"><button type="button" className="btn btn-primary btn-sm" onClick={reply}><MessagesSquare size={15} aria-hidden="true"/>ردّ على المكتب</button><button type="button" className="btn btn-outline btn-sm !text-warn" onClick={toDocuments}><Paperclip size={15} aria-hidden="true"/>أرفق المستندات</button></span>}</div>}
              <StatusHistory id={r.id} updatedAt={r.updatedAt}/>
            </section>
            {r.quote && <QuoteCard requestId={r.id} quote={r.quote} canDecide={canWrite}/>}
            <div className="req-card-sec bg-paper">
              <KeyValueList items={[{ label: 'مجال الخدمة', value: categoryNames[r.category] }, { label: 'رقم التواصل', value: <span dir="ltr">{r.contactPhone}</span>, nums: true }, { label: 'أُرسل في', value: dateText(r.createdAt) }, { label: 'آخر تحديث', value: dateText(r.updatedAt) }]}/>
            </div>
            <div className="req-card-sec"><h2 className="req-sec-title"><ClipboardList size={15} aria-hidden="true"/>تفاصيل الطلب</h2><p className="req-desc">{r.description}</p></div>
            {(r.employees?.length ?? 0) > 0 && <RequestEmployees employees={r.employees}/>}
            {canWrite && r.status === 'completed' && <div className="req-card-sec"><RatingPanel requestId={r.id} rating={r.rating} comment={r.ratingComment} onRated={() => q.refetch()}/></div>}
          </Surface>
        </div>
        <div className="req-work">
          <div className="req-tabs" role="tablist" aria-label="أقسام الطلب">{reqTabs.map(([key, label], index) => <button key={key} id={`req-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`req-panel-${key}`} tabIndex={tab === key ? 0 : -1} className="req-tab" onClick={() => setTab(key)} onKeyDown={(e) => onTabKey(e, index, setTab)}>
            {key === 'conversation' ? <MessagesSquare size={16} aria-hidden="true"/> : key === 'documents' ? <Paperclip size={16} aria-hidden="true"/> : <ReceiptText size={16} aria-hidden="true"/>}{label}
            {key === 'documents' && r.attachments.length > 0 && <span className="req-tab-count nums">{count(r.attachments.length)}</span>}
            {key === 'documents' && missing > 0 && <><span className="req-tab-dot" aria-hidden="true"/><span className="sr-only">{count(missing)} مستندات مطلوبة</span></>}
          </button>)}</div>
          <Surface padding="none" className="req-card">
            <div id={`req-panel-${tab}`} role="tabpanel" aria-labelledby={`req-tab-${tab}`} tabIndex={0} className="req-panel">
              {tab === 'conversation' && <RequestConversation requestId={r.id} scope="customer" closed={r.status === 'completed' || !canWrite}/>}
              {tab === 'documents' && <div id="documents" className="scroll-mt-24"><RequestFiles scope="customer" requestId={r.id} attachments={r.attachments} checklist={r.checklist} canUpload={canWrite && r.status !== 'completed'} onChanged={() => q.refetch()}/></div>}
              {tab === 'invoices' && <div id="invoices" className="req-invoices scroll-mt-24"><CustomerInvoices requestId={r.id} returnedInvoiceId={returnedInvoiceId}/><div className="req-invoices-empty"><EmptyState compact icon={<ReceiptText size={22} strokeWidth={1.5} aria-hidden="true"/>} title="لا توجد فواتير بعد" text="تظهر الفاتورة هنا عندما يصدرها المكتب، وتسددها من الصفحة نفسها."/></div></div>}
            </div>
          </Surface>
        </div>
      </div>
      {r.status !== 'completed' && (canWrite || r.status === 'awaiting_payment') && <div className="req-bar" aria-label="إجراءات الطلب">
        {pendingQuote && canWrite ? <button type="button" className="btn btn-primary" onClick={toQuote}><FileSignature size={17} aria-hidden="true"/>راجع عرض السعر</button>
          : r.status === 'awaiting_payment' ? <button type="button" className="btn btn-primary" onClick={() => setTab('invoices')}><CreditCard size={17} aria-hidden="true"/>الفواتير</button>
          : <button type="button" className="btn btn-primary" onClick={reply}><MessagesSquare size={17} aria-hidden="true"/>ردّ على المكتب</button>}
        <button type="button" className="btn btn-outline" onClick={toDocuments}><Paperclip size={17} aria-hidden="true"/>المستندات</button>
      </div>}
    </>}
  </div></PortalLayout>;
}
// The office's price before work starts. Accepting issues the invoice (the
// invoices section below picks it up), declining sends the note as a message.
function QuoteCard({ requestId, quote, canDecide = true }: { requestId: number; quote: RequestQuote; canDecide?: boolean }) {
  const qc = useQueryClient();
  const accept = useAcceptQuote();
  const decline = useDeclineQuote();
  const [noting, setNoting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all([getGetServiceRequestQueryKey(requestId), getListServiceRequestInvoicesQueryKey(requestId), getListServiceRequestsQueryKey(), getGetPortalSummaryQueryKey()].map(queryKey => qc.invalidateQueries({ queryKey })));
  async function run(action: () => Promise<unknown>) {
    setError(null);
    try { await action(); await refresh(); setNoting(false); }
    catch (e) { setError((e as { status?: number })?.status === 409 ? 'تغيّرت حالة العرض. أعد تحميل الصفحة.' : 'تعذّر إرسال ردّك. حاول مجددًا.'); }
  }
  const busy = accept.isPending || decline.isPending;
  const amounts = <dl className="m-0 mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><div className="min-w-0"><dt className="text-xs text-subtle">المبلغ</dt><dd className="nums m-0 font-semibold">{formatMoney(quote.amount)}</dd></div><div className="min-w-0"><dt className="text-xs text-subtle">الضريبة</dt><dd className="nums m-0 font-semibold">{formatMoney(quote.vat)}</dd></div><div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-xs text-subtle">الإجمالي</dt><dd className="nums display m-0 text-lg font-semibold">{formatMoney(quote.total)}</dd></div></dl>;
  if (quote.acceptedAt) return <p id="quote" className="m-0 flex items-center gap-2 border-t border-line bg-ok-soft px-5 py-3 text-sm font-semibold text-ok sm:px-6"><CircleCheck size={16} aria-hidden="true"/>وافقت على العرض ({formatMoney(quote.total)}) بتاريخ {formatDateTime(quote.acceptedAt)}.</p>;
  if (quote.declinedAt) return <p id="quote" className="m-0 flex items-center gap-2 border-t border-line bg-sunk px-5 py-3 text-sm text-quiet sm:px-6"><MessageSquareText size={16} aria-hidden="true"/>أرسلت ملاحظتك؛ المكتب سيراجعها ويعود إليك.</p>;
  return <section id="quote" aria-labelledby={`quote-${requestId}`} className="req-card-sec scroll-mt-24 bg-copper-soft">
    <h2 id={`quote-${requestId}`} className="display flex items-center gap-2 text-lg font-semibold"><FileSignature size={18} className="text-copper" aria-hidden="true"/>عرض السعر</h2>
    <p className="mt-1 text-sm leading-7 text-quiet">أرسل المكتب سعر هذه الخدمة بتاريخ {formatDateTime(quote.quotedAt)}. بموافقتك تُصدر الفاتورة ويبدأ العمل.</p>
    {amounts}
    {quote.note && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface px-4 py-3 text-sm leading-7">{quote.note}</p>}
    {!canDecide ? <p className="mt-3 text-sm text-quiet">قبول العرض أو الملاحظة عليه لمالك المنشأة أو عضو الموارد البشرية.</p> : noting ? <form className="mt-4" onSubmit={e => { e.preventDefault(); void run(() => decline.mutateAsync({ id: requestId, data: reason.trim() ? { reason: reason.trim() } : {} })); }}>
      <label className="form-field">ملاحظتك على العرض<textarea className="form-control !min-h-20" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="مثال: هل يشمل السعر رسوم الجهة؟" autoFocus/></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{decline.isPending ? 'جارٍ الإرسال…' : 'إرسال الملاحظة'}</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setNoting(false)} disabled={busy}>رجوع</button></div>
    </form> : <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => accept.mutateAsync({ id: requestId }))}><CircleCheck size={17} aria-hidden="true"/>{accept.isPending ? 'جارٍ التأكيد…' : 'أوافق وابدأ'}</button>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setNoting(true)}><MessageSquareText size={17} aria-hidden="true"/>لديّ ملاحظة</button>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </section>;
}

// A bulk request lists its employees, each with the office's progress on them.
export const requestEmployeeStatusNames: Record<RequestEmployeeStatus, string> = { pending: 'قيد الانتظار', in_progress: 'جارٍ', done: 'مكتمل', blocked: 'متوقف' };
const requestEmployeePill: Record<RequestEmployeeStatus, string> = { pending: 'received', in_progress: 'reviewing', done: 'completed', blocked: 'waiting_on_customer' };
function RequestEmployees({ employees }: { employees: RequestEmployee[] }) {
  const done = employees.filter(e => e.itemStatus === 'done').length;
  return <section aria-labelledby="req-employees" className="req-card-sec">
    <h2 id="req-employees" className="req-sec-title"><UsersRound size={15} aria-hidden="true"/>الموظفون في هذا الطلب <span className="nums font-normal">({count(done)}/{count(employees.length)} مكتمل)</span></h2>
    <ul className="req-employees">{employees.map(e => <li key={e.employeeId}>
      <span className="min-w-0 flex-1"><strong>{e.fullName}</strong>{e.note && <small>{e.note}</small>}</span>
      <span className={`pill pill-${requestEmployeePill[e.itemStatus]}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{requestEmployeeStatusNames[e.itemStatus]}</span>
    </li>)}</ul>
  </section>;
}

// Every status change with its date and time, oldest first. Refetched when the
// request's updatedAt changes, so it follows the page's own polling.
function StatusHistory({ id, updatedAt }: { id: number; updatedAt: string }) {
  const history = useGetServiceRequestHistory(id, { query: { queryKey: [...getGetServiceRequestHistoryQueryKey(id), updatedAt] } });
  if (!history.data || history.data.length < 2) return null;
  return <div className="req-history">
    <h2 className="req-history-title">سجل الحالة</h2>
    <ol>{[...history.data].reverse().map((event, index) => <li key={`${event.status}-${event.at}`} data-latest={index === 0 || undefined}>
      <span className={`pill pill-${event.status}`}>{statusNames[event.status]}</span>
      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
    </li>)}</ol>
  </div>;
}

/* ------------------------------------------------------------- inquiries */
function InquiryItem({ inquiry }: { inquiry: Inquiry }) {
  // The whole card opens the conversation (/inquiries/:id); the answer shown
  // here is the office's first reply, later messages live in the thread.
  return <article className="inq-item">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold leading-7"><Link href={`/inquiries/${inquiry.id}`} className="text-inherit no-underline hover:text-teal">{inquiry.subject}</Link></h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span>{dateText(inquiry.createdAt)}</span>{inquiry.linkedServiceRequestReference && <LinkedRequest reference={inquiry.linkedServiceRequestReference}/>}</div>
      </div>
      <Status value={inquiry.status}/>
    </div>
    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-quiet">{inquiry.message}</p>
    {inquiry.answer && <div className="inq-answer">
      <div className="inq-answer-head"><span>رد المكتب</span><span>{dateText(inquiry.answeredAt)}</span></div>
      <p className="m-0 whitespace-pre-wrap text-sm leading-7">{inquiry.answer}</p>
    </div>}
    <Link href={`/inquiries/${inquiry.id}`} className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-teal no-underline"><MessagesSquare size={14} aria-hidden="true"/>افتح المحادثة<ArrowLeft size={14} aria-hidden="true"/></Link>
  </article>;
}

// General questions. Anything about one request belongs in that request's
// conversation, so nothing pre-links a request here any more; the optional
// link stays for people who want the office to see a request's details.
export function Inquiries() {
  const q=useListInquiries({query:{queryKey:getListInquiriesQueryKey(),refetchInterval:30000}}); const requests=useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}}); const qc=useQueryClient(); const mutation=useCreateInquiry(); const [subject,setSubject]=useState(''); const [message,setMessage]=useState(''); const [linkedServiceRequestId,setLinkedServiceRequestId]=useState(''); const [showForm,setShowForm]=useState(false);
  async function submit(e:FormEvent) { e.preventDefault(); try { await mutation.mutateAsync({data:{subject:subject.trim(),message:message.trim(),linkedServiceRequestId:linkedServiceRequestId?Number(linkedServiceRequestId):null}}); setSubject('');setMessage('');setLinkedServiceRequestId('');setShowForm(false); await Promise.all([qc.invalidateQueries({queryKey:getListInquiriesQueryKey()}),qc.invalidateQueries({queryKey:getGetPortalSummaryQueryKey()})]); } catch { /* error shown */ } }
  const { canCreate } = useCompanyRole();
  function openForm() { if (!canCreate) return; setShowForm(true); requestAnimationFrame(() => document.getElementById('inquiry-subject')?.focus()); }
  return <PortalLayout><PageHeading eyebrow="تواصل مع المكتب" title="استفساراتي" subtitle="أسئلة عامة لا تخص طلبًا بعينه؛ يجيبك المكتب هنا وتستمر المحادثة." action={canCreate && !showForm && <button type="button" onClick={openForm} className="btn btn-primary"><Plus size={18} aria-hidden="true"/>استفسار جديد</button>}/>
    <RoleNotice/>
    {canCreate && showForm && <form onSubmit={submit} className="surface rise mb-8 p-6 sm:p-8" aria-labelledby="inquiry-form-title">
      <SectionHeader id="inquiry-form-title" title="استفسار جديد" description="اكتب سؤالك بوضوح ليصلك رد دقيق من المكتب."/>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="form-field">الموضوع<input id="inquiry-subject" className="form-control" placeholder="موضوع الاستفسار باختصار" value={subject} onChange={e=>setSubject(e.target.value)} minLength={3} maxLength={160} required/></label>
        <label className="form-field">الطلب المرتبط (اختياري)<select className="form-control" value={linkedServiceRequestId} onChange={e=>setLinkedServiceRequestId(e.target.value)}><option value="">بدون ربط</option>{requests.data?.map(r=><option key={r.id} value={r.id}>{r.reference} · {r.service}</option>)}</select><small className="field-hint">يطّلع المكتب على تفاصيل الطلب المرتبط ليجيبك بدقة.</small></label>
        <label className="form-field md:col-span-2">نص الاستفسار<textarea className="form-control" placeholder="اكتب سؤالك بالتفصيل" value={message} onChange={e=>setMessage(e.target.value)} minLength={10} maxLength={5000} required/><small className="field-hint">لا تشارك كلمات مرور المنصات أو رموز التحقق.</small></label>
      </div>
      {requests.isError&&<p role="alert" className="mt-4 text-sm text-danger">تعذّر تحميل طلباتك. أعد المحاولة قبل اختيار طلب للربط.</p>}
      {mutation.isError && <p role="alert" className="mt-4 text-sm text-danger">تعذّر إرسال الاستفسار. حاول مجددًا.</p>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5"><button type="button" onClick={()=>setShowForm(false)} className="btn btn-outline" disabled={mutation.isPending}>إلغاء</button><button disabled={mutation.isPending} type="submit" className="btn btn-primary">{mutation.isPending?'جارٍ الإرسال…':'إرسال الاستفسار'}<Send size={16} aria-hidden="true"/></button></div>
    </form>}
    <div className="inq-grid">
      <section aria-labelledby="inquiries-list-title" className="min-w-0"><h2 id="inquiries-list-title" className="sr-only">سجل الاستفسارات</h2>{q.isLoading?<LoadingBlock/>:q.isError?<ErrorBlock retry={()=>q.refetch()}/>:!q.data?.length?<EmptyBlock title="لا توجد استفسارات بعد" text="يظهر هنا كل استفسار ترسله مع رد المكتب عليه." action={canCreate ? 'استفسار جديد' : undefined} onAction={canCreate ? openForm : undefined}/>:<Surface padding="none" className="overflow-hidden">{q.data.map(i=><InquiryItem key={i.id} inquiry={i}/>)}</Surface>}</section>
      {canCreate && <CustomerAssistant onAskOffice={openForm}/>}
    </div>
  </PortalLayout>;
}
