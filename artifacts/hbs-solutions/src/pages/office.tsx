import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowLeft, ArrowUpLeft, CalendarClock, ClipboardList, Contact, FileClock, Inbox, KanbanSquare, LayoutList, Maximize2, MessageSquareText, MessagesSquare, MoreHorizontal, Save, UserRound, UserRoundPlus, Users, X } from 'lucide-react';
import {
  getGetOfficeSummaryQueryKey, getListOfficeServiceRequestsQueryKey, getListOfficeInquiriesQueryKey, getListOfficeAssigneesQueryKey,
  useGetOfficeSummary, useListOfficeServiceRequests, useUpdateOfficeServiceRequest, useListOfficeAssignees,
  useListOfficeReminders, getListOfficeRemindersQueryKey,
  useListOfficeServiceRequestInvoices, getListOfficeServiceRequestInvoicesQueryKey,
  useListOfficeInquiries,
  useGetOfficeReport, getGetOfficeReportQueryKey, useGetPortalMe, getGetPortalMeQueryKey, useListOfficeMessageThreads, getListOfficeMessageThreadsQueryKey,
  type InquiryStatus, type OfficeServiceRequestCategory, type OfficeServiceRequestStatus,
  type OfficeServiceRequest, type OfficeInquiry, type ServiceRequestUpdateStatus, type OfficeAssignee, type ServiceAttachment,
} from '@workspace/api-client-react';
import {
  PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, Pager, STALE_AFTER_DAYS, StaleBadge,
  Status, dateText, categoryNames, isStale, statusOptions, statusNames, useDebouncedValue,
} from '@/components/portal-ui';
import { DataTable, EmptyState, FilterChip, Tile, TileGrid, Toolbar, type DataColumn } from '@/components/portal-kit';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { OfficeCommandPalette } from '@/components/office-command';
import { StackedBar } from '@/components/office-charts';
import { Reveal, safeStorage, stagger } from '@/lib/motion';
import { LOCALE } from '@/lib/format';
import { RequestFiles } from '@/components/request-files';
import { OfficeInvoices } from '@/components/request-billing';
import { ChecklistEditor, ExtractReminder, QuotePanel, RequestEmployees } from '@/components/office-request-extras';
import { ExportButtons } from '@/components/excel-import';
import { requestColumns, requestRows } from '@/lib/export';
import { RequestConversation, ReplyBadge, SubjectChip } from '@/components/request-conversation';
import { Conversation } from '@/components/conversation';
import { WhatsappFollowUp, useOfficeThread } from '@/components/whatsapp-follow-up';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { formatCalendarDate, formatRelative } from '@/lib/format';
import { nextStatuses, statusChoices } from '@/lib/request-status';
import './office.css';

const pageSize = 20;
type RequestSort = 'newest' | 'oldest_update' | 'due_soon';
const requestSorts: Record<RequestSort, string> = { newest: 'الأحدث إرسالًا', oldest_update: 'الأقدم تحديثًا', due_soon: 'الأقرب موعدًا' };
// Shared with the standalone request page (pages/office-request.tsx).
export const isOverdue = (r: { status: string; dueAt?: string | null }) => r.status !== 'completed' && !!r.dueAt && new Date(r.dueAt).getTime() < Date.now();
export const memberName = (members: OfficeAssignee[] | undefined, userId: string | null | undefined) =>
  !userId ? null : members?.find(m => m.userId === userId)?.email ?? 'عضو سابق';
// <input type="date"> value from an API timestamp, in local time.
export const dateInput = (value: string | null | undefined) => {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Due at the end of the chosen day, local time.
export const dueFromInput = (value: string) => value ? new Date(`${value}T23:59:00`).toISOString() : null;
export function useAssignees() {
  return useListOfficeAssignees({ query: { queryKey: getListOfficeAssigneesQueryKey(), staleTime: 300_000 } });
}
const count = (value: number) => new Intl.NumberFormat(LOCALE).format(value);
// The full page for a request, with the rows on screen (in list order) for its
// J/K navigation; the ids are short, so the address stays readable.
export const fullPageHref = (id: number, rows: { id: number }[] = []) => `/office/requests/${id}${rows.length > 1 ? `?list=${rows.map(r => r.id).join(',')}` : ''}`;
// Open stages, in the order the pipeline runs (completed is not workload).
const openStages = statusOptions.filter(s => s !== 'completed');
const apiError = (error: unknown, fallback: string) => { const data = (error as { data?: { error?: string } } | null)?.data; return data && typeof data.error === 'string' ? data.error : fallback; };

/* =============================================================== overview */

export function OfficeOverview() {
  const summary = useGetOfficeSummary({ query: { queryKey: getGetOfficeSummaryQueryKey(), refetchInterval: 30_000 } });
  // The report is for the owner only; staff get the stage workload from the list counts instead.
  const me = useGetPortalMe({ query: { queryKey: getGetPortalMeQueryKey(), staleTime: 300_000 } });
  const owner = me.data?.officeRole === 'owner';
  const reportParams = { days: 7 as const };
  const report = useGetOfficeReport(reportParams, { query: { queryKey: getGetOfficeReportQueryKey(reportParams), enabled: owner, staleTime: 120_000 } });
  const s = summary.data;
  const week = owner ? report.data : undefined;
  return <PortalLayout staff>
    <OfficeCommandPalette />
    <PageHeading eyebrow="مساحة المكتب" title="نظرة عامة" subtitle="ما يحتاج انتباهك اليوم: الجديد، والمتأخر، وما ينتظر ردّك، والوارد غير المقروء." />
    {summary.isLoading ? <LoadingBlock variant="tiles" /> : summary.isError ? <ErrorBlock retry={() => summary.refetch()} /> : s && <div className="ov">
      <TileGrid cols={4}>
        <Tile label="طلبات جديدة" value={count(s.newRequests)} tone="accent" href="/office/requests?status=received" icon={<Inbox size={15} />}
          trend={week ? { direction: week.created > 0 ? 'up' : 'flat', value: `+${count(week.created)}`, label: 'خلال 7 أيام', good: true } : undefined}
          note={week ? undefined : 'بانتظار أول مراجعة'} />
        <Tile label="طلبات نشطة" value={count(s.activeRequests)} href="/office/requests" icon={<ClipboardList size={15} />}
          trend={week ? { direction: week.completed > 0 ? 'up' : 'flat', value: count(week.completed), label: 'أُنجزت خلال 7 أيام', good: true } : undefined}
          note={s.staleRequests > 0 ? `${count(s.staleRequests)} بلا تحديث منذ ${count(STALE_AFTER_DAYS)} أيام` : 'كلها محدّثة'} />
        <Tile label="بانتظار ردّك" value={count(s.awaitingReply)} tone={s.awaitingReply > 0 ? 'warn' : 'default'} href="/office/requests?awaitingReply=true" icon={<MessagesSquare size={15} />} note={s.awaitingReply > 0 ? 'آخر رسالة من العميل' : 'لا رسائل تنتظر'} />
        <Tile label="متأخرة عن موعدها" value={count(s.overdueRequests)} tone={s.overdueRequests > 0 ? 'danger' : 'default'} href="/office/requests?overdue=true&sort=due_soon" icon={<AlarmClock size={15} />} note={s.overdueRequests > 0 ? 'تجاوزت موعد الإنجاز' : 'لا شيء متأخر'} />
      </TileGrid>
      <div className="ov-grid">
        <div className="ov-stack">
          <Reveal style={stagger(0)}><StageWorkload owner={owner} byStatus={week?.byStatus} /></Reveal>
          <Reveal style={stagger(1)}><DueToday /></Reveal>
          <Reveal style={stagger(2)}><UnassignedQueue /></Reveal>
        </div>
        <div className="ov-stack">
          <Reveal style={stagger(1)}><InboxPreview /></Reveal>
          <Reveal style={stagger(2)}><Queue title="مسندة إليّ" icon={UserRound} count={s.myRequests} href="/office/requests?assignee=me&sort=due_soon" params={{ assignee: 'me', sort: 'due_soon' }} empty="لا توجد طلبات مسندة إليك." /></Reveal>
          <Reveal style={stagger(3)}><ExpiringQueue count={s.expiringDocuments} /></Reveal>
        </div>
      </div>
      <div className="ov-shortcuts">
        {([
          ['/office/customers', Contact, 'ملفات العملاء', 'المنشأة والموظفون والتراخيص والطلبات لكل عميل في صفحة واحدة.'],
          ['/office/inquiries', MessageSquareText, 'استفسارات العملاء', `${count(s.openInquiries)} استفسارًا مفتوحًا بانتظار الرد.`],
          ['/office/requests', ClipboardList, 'كل الطلبات', `${count(s.totalRequests)} طلبًا منذ البداية؛ جدول أو لوحة بالمراحل.`],
        ] as const).map(([href, Icon, title, text], index) => <Reveal key={href} style={stagger(index + 2)}>
          <Link href={href} className="surface surface-hover ov-shortcut"><div><span className="ov-shortcut-icon"><Icon size={20} aria-hidden="true" /></span><h2 className="display">{title}</h2><p>{text}</p></div><ArrowUpLeft size={18} className="ov-shortcut-arrow" aria-hidden="true" /></Link>
        </Reveal>)}
      </div>
    </div>}
  </PortalLayout>;
}

// Card frame used by every overview list: heading row with a count and a link, then rows.
function OverviewCard({ title, icon: Icon, count: total, href, linkLabel = 'عرض الكل', tone, children, id }: { title: string; icon: typeof AlarmClock; count?: number; href?: string; linkLabel?: string; tone?: 'warn' | 'danger'; children: ReactNode; id: string }) {
  return <section className="surface ov-card" aria-labelledby={id}>
    <div className={`ov-card-head ${tone === 'warn' ? 'is-warn' : tone === 'danger' ? 'is-danger' : ''}`}>
      <h2 id={id} className="ov-card-title"><Icon size={17} aria-hidden="true" />{title}{total !== undefined && <span className="ov-count display nums">{count(total)}</span>}</h2>
      {href && <Link href={href} className="ov-card-link">{linkLabel}<ArrowLeft size={14} aria-hidden="true" /></Link>}
    </div>
    {children}
  </section>;
}

// Workload by stage: the owner's report carries the counts; staff read them
// from the list totals (one light query per open stage).
function StageWorkload({ owner, byStatus }: { owner: boolean; byStatus?: { key: string; count: number }[] }) {
  const counts = useStageCounts(!owner);
  const segments = openStages.map(stage => ({ key: stage, label: statusNames[stage] ?? stage, value: owner ? (byStatus?.find(r => r.key === stage)?.count ?? 0) : (counts[stage] ?? 0) }));
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const busiest = [...segments].sort((a, b) => b.value - a.value)[0];
  return <OverviewCard id="ov-workload" title="حجم العمل حسب المرحلة" icon={KanbanSquare} href="/office/requests?view=board" linkLabel="لوحة المراحل">
    <div className="ov-workload">
      <StackedBar segments={segments} label="الطلبات المفتوحة حسب المرحلة" />
      <div className="ov-workload-foot"><span><strong className="nums">{count(total)}</strong> طلبًا مفتوحًا</span>{busiest && busiest.value > 0 && <span>أكثرها في «{busiest.label}»</span>}</div>
    </div>
  </OverviewCard>;
}
function useStageCounts(enabled: boolean): Partial<Record<string, number>> {
  const result: Partial<Record<string, number>> = {};
  for (const stage of openStages) {
    const params = { page: 1, pageSize: 1, status: stage as OfficeServiceRequestStatus };
    // Fixed list of stages, so the hook order never changes.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const list = useListOfficeServiceRequests(params, { query: { queryKey: getListOfficeServiceRequestsQueryKey(params), enabled, refetchInterval: 60_000 } });
    result[stage] = list.data?.total;
  }
  return result;
}

function RequestLine({ r, side }: { r: OfficeServiceRequest; side?: ReactNode }) {
  return <li className="ov-row">
    <Link href={fullPageHref(r.id)} className="ov-row-main text-inherit no-underline">
      <span className="ov-row-title">{r.service}</span>
      <span className="ov-row-meta"><span dir="ltr" className="nums">{r.reference}</span>{r.customer && <span>{r.customer.fullName}</span>}{r.dueAt && <span className={`ov-due ${isOverdue(r) ? 'is-late' : ''}`}><CalendarClock size={11} aria-hidden="true" />{isOverdue(r) ? 'متأخر' : 'الموعد'} {dateText(r.dueAt)}</span>}</span>
    </Link>
    <div className="ov-row-side">{side ?? <Status value={r.status} />}</div>
  </li>;
}

// Requests due by the end of today (the overdue ones first, since due_soon sorts by date).
function DueToday() {
  const params = { page: 1, pageSize: 8, sort: 'due_soon' as const };
  const list = useListOfficeServiceRequests(params, { query: { queryKey: getListOfficeServiceRequestsQueryKey(params), refetchInterval: 60_000 } });
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const rows = (list.data?.items ?? []).filter(r => r.status !== 'completed' && r.dueAt && new Date(r.dueAt).getTime() <= end.getTime());
  const late = rows.filter(isOverdue).length;
  return <OverviewCard id="ov-due" title="مستحقة اليوم" icon={AlarmClock} count={rows.length} href="/office/requests?sort=due_soon" tone={late > 0 ? 'danger' : rows.length ? 'warn' : undefined}>
    {rows.length ? <ul className="ov-list">{rows.map(r => <RequestLine key={r.id} r={r} />)}</ul> : <p className="ov-empty">{list.isLoading ? 'جارٍ التحميل…' : 'لا توجد طلبات مستحقة اليوم.'}</p>}
  </OverviewCard>;
}

// New requests nobody owns yet, with a one-step assign in the row.
function UnassignedQueue() {
  const qc = useQueryClient();
  const members = useAssignees();
  const mutation = useUpdateOfficeServiceRequest();
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const params = { page: 1, pageSize: 5, sort: 'newest' as const, assignee: 'unassigned' };
  const list = useListOfficeServiceRequests(params, { query: { queryKey: getListOfficeServiceRequestsQueryKey(params), refetchInterval: 60_000 } });
  async function assign(r: OfficeServiceRequest, userId: string) {
    if (!userId) return;
    setBusy(r.id); setNotice(null);
    try {
      await mutation.mutateAsync({ id: r.id, data: { expectedUpdatedAt: r.updatedAt, status: r.status, assignedTo: userId } });
      await Promise.all([qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() }), qc.invalidateQueries({ queryKey: getGetOfficeSummaryQueryKey() })]);
    } catch (error) { setNotice(apiError(error, 'تعذّر الإسناد. حاول مجددًا.')); } finally { setBusy(null); }
  }
  const rows = list.data?.items ?? [];
  return <OverviewCard id="ov-unassigned" title="غير مسندة" icon={UserRoundPlus} count={list.data?.total} href="/office/requests?assignee=unassigned">
    {rows.length ? <ul className="ov-list">{rows.map(r => <RequestLine key={r.id} r={r} side={<label><span className="sr-only">إسناد {r.reference}</span><select className="form-control ov-row-select" value="" disabled={busy === r.id} onChange={e => assign(r, e.target.value)}><option value="">{busy === r.id ? 'جارٍ الإسناد…' : 'إسناد إلى…'}</option>{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>} />)}</ul>
      : <p className="ov-empty">{list.isLoading ? 'جارٍ التحميل…' : 'كل الطلبات المفتوحة مسندة.'}</p>}
    {notice && <p role="alert" className="ov-empty text-danger">{notice}</p>}
  </OverviewCard>;
}

// The latest unread threads from the messages inbox.
function InboxPreview() {
  const params = { page: 1, pageSize: 5, unread: true };
  const list = useListOfficeMessageThreads(params, { query: { queryKey: getListOfficeMessageThreadsQueryKey(params), refetchInterval: 60_000 } });
  const rows = list.data?.items ?? [];
  return <OverviewCard id="ov-inbox" title="الوارد غير المقروء" icon={MessagesSquare} count={list.data?.unreadTotal} href="/office/messages" linkLabel="الرسائل">
    {rows.length ? <ul className="ov-list">{rows.map(t => <li key={`${t.type}-${t.id}`} className="ov-row">
      <Link href={t.type === 'request' ? `/office/requests/${t.id}?tab=conversation` : `/office/inquiries?open=${t.id}`} className="ov-row-main text-inherit no-underline">
        <span className="ov-row-title">{t.customer?.fullName ?? t.title}</span>
        <span className="ov-row-meta"><span className="truncate">{t.lastMessage?.preview ?? t.title}</span></span>
      </Link>
      <div className="ov-row-side"><span className="text-xs text-subtle">{formatRelative(t.updatedAt)}</span>{t.unread > 0 && <span className="ov-unread nums" aria-label={`${count(t.unread)} رسائل غير مقروءة`}>{count(t.unread)}</span>}</div>
    </li>)}</ul> : <p className="ov-empty">{list.isLoading ? 'جارٍ التحميل…' : 'لا رسائل غير مقروءة.'}</p>}
  </OverviewCard>;
}

type QueueParams = { overdue?: boolean; awaitingReply?: boolean; assignee?: string; sort: RequestSort };
// A short list of today's work; the full filtered list is one click away.
function Queue({ title, icon, count: total, href, params, empty, warn = false }: { title: string; icon: typeof AlarmClock; count: number; href: string; params: QueueParams; empty: string; warn?: boolean }) {
  const query = { page: 1, pageSize: 5, ...params };
  const list = useListOfficeServiceRequests(query, { query: { queryKey: getListOfficeServiceRequestsQueryKey(query), refetchInterval: 60_000 } });
  return <OverviewCard id={`ov-queue-${params.assignee ?? 'q'}`} title={title} icon={icon} count={total} href={href} tone={warn && total ? 'warn' : undefined}>
    {list.data?.items.length ? <ul className="ov-list">{list.data.items.map(r => <RequestLine key={r.id} r={r} />)}</ul> : <p className="ov-empty">{list.isLoading ? 'جارٍ التحميل…' : empty}</p>}
  </OverviewCard>;
}

function ExpiringQueue({ count: total }: { count: number }) {
  const params = { withinDays: 30 };
  const list = useListOfficeReminders(params, { query: { queryKey: getListOfficeRemindersQueryKey(params), refetchInterval: 300_000 } });
  return <OverviewCard id="ov-expiring" title="وثائق تنتهي خلال 30 يومًا" icon={FileClock} count={total} href="/office/reminders">
    {list.data?.length ? <ul className="ov-list">{list.data.slice(0, 5).map(r => <li key={r.id} className="ov-row">
      <div className="ov-row-main"><span className="ov-row-title">{reminderKindNames[r.kind]} «{r.label}»</span><span className="ov-row-meta"><span>{r.customer?.fullName ?? 'عميل'}</span><span>{formatCalendarDate(r.expiresOn)}</span></span></div>
      <div className="ov-row-side"><ExpiryBadge expiresOn={r.expiresOn} /></div>
    </li>)}</ul> : <p className="ov-empty">{list.isLoading ? 'جارٍ التحميل…' : 'لا توجد وثائق تنتهي خلال 30 يومًا.'}</p>}
  </OverviewCard>;
}

/* =============================================================== requests */

// Below the xl breakpoint the editor sits under the list.
function useRevealOnSelect(selected: number | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected != null && !window.matchMedia('(min-width: 1280px)').matches) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selected]);
  return ref;
}

function ResultCount({ total }: { total: number }) {
  return <p className="rq-count"><span className="nums">{count(total)}</span> نتيجة</p>;
}

type View = 'table' | 'board';
const VIEW_KEY = 'hbs.office.requests.view';

export function OfficeRequests() {
  const qc = useQueryClient();
  const initial = new URLSearchParams(useSearch());
  const [search, setSearch] = useState(initial.get('q') ?? '');
  const q = useDebouncedValue(search.trim());
  const [awaitingReply, setAwaitingReply] = useState(initial.get('awaitingReply') === 'true');
  const [status, setStatus] = useState<OfficeServiceRequestStatus | ''>(() =>
    (statusOptions as string[]).includes(initial.get('status') ?? '') ? initial.get('status') as OfficeServiceRequestStatus : '');
  const [category, setCategory] = useState<OfficeServiceRequestCategory | ''>('');
  const [sort, setSort] = useState<RequestSort>(() => (Object.keys(requestSorts) as string[]).includes(initial.get('sort') ?? '') ? initial.get('sort') as RequestSort : 'newest');
  const [assignee, setAssignee] = useState(initial.get('assignee') ?? '');
  const [overdue, setOverdue] = useState(initial.get('overdue') === 'true');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  // Board or table; the choice is remembered on this device.
  const [view, setView] = useState<View>(() => initial.get('view') === 'board' ? 'board' : safeStorage.get(VIEW_KEY) === 'board' ? 'board' : 'table');
  const changeView = (next: View) => { setView(next); safeStorage.set(VIEW_KEY, next); };
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // A status chosen from the board menu that needs the editor (a message to the customer).
  const [preset, setPreset] = useState<{ id: number; status: ServiceRequestUpdateStatus } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const members = useAssignees();
  const mutation = useUpdateOfficeServiceRequest();
  useEffect(() => { setPage(1); setPicked(new Set()); }, [q, status, category, sort, assignee, overdue, awaitingReply]);
  const params = {
    page, pageSize, ...(q ? { q } : {}), ...(status ? { status } : {}),
    ...(category ? { category } : {}), sort, ...(assignee ? { assignee } : {}), ...(overdue ? { overdue: true } : {}),
    ...(awaitingReply ? { awaitingReply: true } : {}),
  };
  const list = useListOfficeServiceRequests(params, { query: {
    queryKey: getListOfficeServiceRequestsQueryKey(params), refetchInterval: 30_000,
  } });
  useEffect(() => {
    if (list.data && page > 1 && page > Math.max(1, Math.ceil(list.data.total / pageSize))) {
      setPage(Math.max(1, Math.ceil(list.data.total / pageSize)));
    }
  }, [list.data, page]);
  const rows = list.data?.items ?? [];
  const active = rows.find(r => r.id === selected);
  const editorRef = useRevealOnSelect(selected);
  const filtered = Boolean(q || status || category || assignee || overdue || awaitingReply);
  // Opening the list from a reference link selects that request.
  useEffect(() => { if (q && rows.length === 1 && selected === null) setSelected(rows[0].id); }, [q, rows.length]);
  const refreshOffice = () => Promise.all([
    qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetOfficeSummaryQueryKey() }),
  ]);
  const togglePick = (id: number) => setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const pickedRows = rows.filter(r => picked.has(r.id));
  // Bulk assign: one update per request with its own version, so a request that changed meanwhile is refused, not overwritten.
  async function bulkAssign(event: FormEvent) {
    event.preventDefault();
    if (!bulkAssignee || !pickedRows.length) return;
    setBulkBusy(true); setNotice(null);
    let done = 0; let failed = 0;
    for (const r of pickedRows) {
      try { await mutation.mutateAsync({ id: r.id, data: { expectedUpdatedAt: r.updatedAt, status: r.status, assignedTo: bulkAssignee } }); done++; } catch { failed++; }
    }
    await refreshOffice();
    setPicked(new Set()); setBulkBusy(false);
    setNotice(failed ? { kind: 'error', text: `أُسند ${count(done)} وتعذّر ${count(failed)}؛ ربما تغيّرت تلك الطلبات. حدّث القائمة وأعد المحاولة.` } : { kind: 'ok', text: `أُسند ${count(done)} طلبًا إلى ${memberName(members.data, bulkAssignee) ?? bulkAssignee}.` });
  }
  // Board move: statuses that need the customer's message open the editor instead.
  async function move(r: OfficeServiceRequest, target: ServiceRequestUpdateStatus) {
    if (target === 'waiting_on_customer') { setPreset({ id: r.id, status: target }); setSelected(r.id); return; }
    setMoving(r.id); setNotice(null);
    try {
      await mutation.mutateAsync({ id: r.id, data: { expectedUpdatedAt: r.updatedAt, status: target } });
      await refreshOffice();
      setNotice({ kind: 'ok', text: `نُقل ${r.reference} إلى «${statusNames[target]}».` });
    } catch (error) { setNotice({ kind: 'error', text: apiError(error, 'تعذّر نقل الطلب. حاول مجددًا.') }); } finally { setMoving(null); }
  }
  const quick: { label: string; active: boolean; onClick: () => void; count?: number }[] = [
    { label: 'المتأخرة فقط', active: overdue, onClick: () => setOverdue(!overdue) },
    { label: 'بانتظار ردّنا', active: awaitingReply, onClick: () => setAwaitingReply(!awaitingReply) },
    { label: 'المسندة إليّ', active: assignee === 'me', onClick: () => setAssignee(assignee === 'me' ? '' : 'me') },
    { label: 'غير مسندة', active: assignee === 'unassigned', onClick: () => setAssignee(assignee === 'unassigned' ? '' : 'unassigned') },
  ];
  const columns: DataColumn<OfficeServiceRequest>[] = [
    { key: 'pick', header: <span className="sr-only">تحديد</span>, label: 'تحديد', width: '44px', cell: r => <label className="rq-check"><input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} aria-label={`تحديد ${r.reference}`} /></label> },
    { key: 'request', header: 'الطلب', primary: true, cell: r => <button type="button" className="rq-cell-main" aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}>
      <span className="rq-cell-title">{r.service}</span>
      <span className="rq-cell-meta"><span dir="ltr" className="nums">{r.reference}</span><span>{categoryNames[r.category]}</span><span>{dateText(r.createdAt)}</span>{isOverdue(r) && <span className="rq-late">متأخر عن موعده</span>}{r.employees?.length > 0 && <span className="rq-emp">{count(r.employees.filter(e => e.itemStatus === 'done').length)}/{count(r.employees.length)} موظف</span>}<SubjectChip subject={r.subject} /><ReplyBadge lastMessage={r.lastMessage} status={r.status} viewer="office" />{isStale(r) && <StaleBadge updatedAt={r.updatedAt} />}</span>
    </button> },
    { key: 'customer', header: 'العميل', hideBelow: 'lg', cell: r => r.customer ? <span className="block truncate">{r.customer.fullName}</span> : <span className="text-subtle">—</span> },
    { key: 'status', header: 'الحالة', cell: r => <Status value={r.status} /> },
    { key: 'assignee', header: 'المسؤول', hideBelow: 'md', cell: r => memberName(members.data, r.assignedTo) ? <span className="inline-flex items-center gap-1 text-xs"><UserRound size={12} aria-hidden="true" />{memberName(members.data, r.assignedTo)}</span> : <span className="text-xs text-subtle">غير مسند</span> },
    { key: 'due', header: 'الموعد', hideBelow: 'md', nums: true, cell: r => r.dueAt ? <span className={isOverdue(r) ? 'font-bold text-danger' : ''}>{dateText(r.dueAt)}</span> : <span className="text-subtle">—</span> },
    { key: 'open', header: <span className="sr-only">فتح</span>, label: 'الصفحة الكاملة', width: '1%', align: 'end', cell: r => <Link href={fullPageHref(r.id, rows)} className="rq-open" title="فتح الصفحة الكاملة"><Maximize2 size={14} aria-hidden="true" /><span className="hidden xl:inline">فتح</span><span className="sr-only xl:hidden">فتح الصفحة الكاملة</span></Link> },
  ];

  return <PortalLayout staff>
    <OfficeCommandPalette />
    <PageHeading eyebrow="صندوق الوارد" title="طلبات العملاء" subtitle="ابحث بالرقم المرجعي أو الخدمة أو تفاصيل الطلب أو رقم التواصل، وحدّث الحالة بحسب تقدم كل طلب." />
    <Toolbar className="rq-toolbar" search={{ value: search, onChange: setSearch, label: 'بحث', placeholder: 'اسم العميل، الرقم المرجعي، الخدمة، رقم التواصل...', maxLength: 120 }}
      filters={<>
        <label className="rq-toolbar-select"><span className="sr-only">الحالة</span><select className="form-control" value={status} onChange={e => setStatus(e.target.value as OfficeServiceRequestStatus | '')}><option value="">كل الحالات</option>{statusOptions.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></label>
        <label className="rq-toolbar-select"><span className="sr-only">المجال</span><select className="form-control" value={category} onChange={e => setCategory(e.target.value as OfficeServiceRequestCategory | '')}><option value="">كل المجالات</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="rq-toolbar-select"><span className="sr-only">الترتيب</span><select className="form-control" value={sort} onChange={e => setSort(e.target.value as RequestSort)}>{Object.entries(requestSorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="rq-toolbar-select"><span className="sr-only">المسؤول</span><select className="form-control" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">كل المسؤولين</option><option value="me">المسندة إليّ</option><option value="unassigned">غير مسندة</option>{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
      </>}
      actions={<div className="rq-view" role="group" aria-label="طريقة العرض">
        <button type="button" aria-pressed={view === 'table'} onClick={() => changeView('table')}><LayoutList size={15} aria-hidden="true" />جدول</button>
        <button type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}><KanbanSquare size={15} aria-hidden="true" />لوحة</button>
      </div>} />
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="تصفية سريعة">
      {quick.map(chip => <FilterChip key={chip.label} active={chip.active} onClick={chip.onClick}>{chip.label === 'المتأخرة فقط' ? <AlarmClock size={14} aria-hidden="true" /> : chip.label === 'بانتظار ردّنا' ? <MessagesSquare size={14} aria-hidden="true" /> : <UserRound size={14} aria-hidden="true" />}{chip.label}</FilterChip>)}
    </div>
    {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`rq-notice ${notice.kind === 'ok' ? 'is-ok' : 'is-error'}`}>{notice.text}</p>}
    {list.isLoading ? <LoadingBlock variant="table" /> : list.isError ? <ErrorBlock retry={() => list.refetch()} /> : !list.data?.total && !filtered
      ? <EmptyBlock title="لا توجد طلبات واردة" text="ستظهر طلبات العملاء هنا عند إرسالها عبر البوابة." />
      : <div className="rq-grid">
        <div className="min-w-0">
          <div className="rq-meta"><ResultCount total={list.data?.total ?? 0} />
            {/* The rows on screen (this page, with the filters applied), with the names as the list shows them. */}
            {rows.length > 0 && <ExportButtons compact name="طلبات العملاء" columns={requestColumns} rows={() => requestRows(rows, { statusNames, categoryNames, memberName: id => memberName(members.data, id) })} />}</div>
          {pickedRows.length > 0 && <form className="rq-bulk" onSubmit={bulkAssign} aria-label="إسناد جماعي">
            <strong><span className="nums">{count(pickedRows.length)}</span> محددة</strong>
            <label><span className="sr-only">إسناد المحددة إلى</span><select className="form-control" value={bulkAssignee} onChange={e => setBulkAssignee(e.target.value)} required><option value="">إسناد إلى…</option>{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={bulkBusy || !bulkAssignee} data-loading={bulkBusy || undefined}><Users size={15} aria-hidden="true" />إسناد</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}><X size={15} aria-hidden="true" />إلغاء التحديد</button>
            <span className="rq-bulk-note">تبقى الحالة والموعد كما هي.</span>
          </form>}
          {view === 'board'
            ? <Board rows={rows} selected={selected} onSelect={setSelected} members={members.data} moving={moving} onMove={move} />
            : <div className={`rq-table transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}><DataTable columns={columns} rows={rows} rowKey={r => r.id} onRowClick={r => setSelected(r.id)} rowSelected={r => selected === r.id} rowTone={r => isOverdue(r) ? 'danger' : isStale(r) ? 'warn' : undefined} caption="طلبات العملاء" stickyHeader={false} empty={<EmptyState compact title="لا توجد نتائج مطابقة" text="جرّب تصفية أخرى أو امسح البحث." />} /></div>}
          <Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} />
        </div>
        <div ref={editorRef} className="rq-editor-slot">{active ? <RequestEditor key={active.id} request={active} presetStatus={preset?.id === active.id ? preset.status : undefined} /> : <div className="surface rq-placeholder"><ClipboardList size={30} strokeWidth={1.5} aria-hidden="true" /><p className="m-0">اختر طلبًا من القائمة لعرض تفاصيله وتحديث حالته.</p></div>}</div>
      </div>}
  </PortalLayout>;
}

// Kanban by stage: the cards on screen grouped by status. Dragging is off on
// purpose; each card's menu moves it (keyboard operable) through the same
// status update the editor uses, so the API's rules still apply.
function Board({ rows, selected, onSelect, members, moving, onMove }: { rows: OfficeServiceRequest[]; selected: number | null; onSelect: (id: number) => void; members: OfficeAssignee[] | undefined; moving: number | null; onMove: (r: OfficeServiceRequest, target: ServiceRequestUpdateStatus) => void }) {
  const [, navigate] = useLocation();
  return <div className="rq-board" role="list" aria-label="لوحة المراحل">
    {statusOptions.map(stage => {
      const cards = rows.filter(r => r.status === stage);
      return <section key={stage} className="rq-col" role="listitem" aria-labelledby={`rq-col-${stage}`}>
        <div className="rq-col-head"><span id={`rq-col-${stage}`}>{statusNames[stage]}</span><span className="rq-col-count nums">{count(cards.length)}</span></div>
        <div className="rq-col-body">
          {cards.length ? cards.map((r, index) => <article key={r.id} className={`rq-card ${selected === r.id ? 'is-selected' : ''} ${moving === r.id ? 'is-busy' : ''}`} style={stagger(index, 40)} aria-busy={moving === r.id || undefined}>
            <div className="rq-card-top"><span className="rq-card-ref nums" dir="ltr">{r.reference}</span>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild><button type="button" className="rq-card-menu" aria-label={`إجراءات ${r.reference}`}><MoreHorizontal size={18} aria-hidden="true" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rq-menu">
                  <DropdownMenuLabel className="rq-menu-label">نقل إلى</DropdownMenuLabel>
                  {(nextStatuses[r.status] ?? []).map(target => <DropdownMenuItem key={target} className="rq-menu-item" onSelect={() => onMove(r, target)}>{statusNames[target]}</DropdownMenuItem>)}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="rq-menu-item" onSelect={() => onSelect(r.id)}>تحرير في اللوحة الجانبية</DropdownMenuItem>
                  <DropdownMenuItem className="rq-menu-item" onSelect={() => navigate(fullPageHref(r.id, rows))}>فتح الصفحة الكاملة</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button type="button" className="rq-card-title" aria-pressed={selected === r.id} onClick={() => onSelect(r.id)}>{r.service}</button>
            <div className="rq-card-meta">{r.customer && <span>{r.customer.fullName}</span>}<span>{categoryNames[r.category]}</span>{r.dueAt && <span className={`ov-due ${isOverdue(r) ? 'is-late' : ''}`}><CalendarClock size={11} aria-hidden="true" />{dateText(r.dueAt)}</span>}</div>
            <div className="rq-card-foot"><span className="text-xs text-subtle inline-flex items-center gap-1"><UserRound size={12} aria-hidden="true" />{memberName(members, r.assignedTo) ?? 'غير مسند'}</span><ReplyBadge lastMessage={r.lastMessage} status={r.status} viewer="office" /></div>
          </article>) : <p className="rq-col-empty">لا طلبات في هذه المرحلة ضمن النتائج.</p>}
        </div>
      </section>;
    })}
  </div>;
}

function RequestEditor({ request, presetStatus }: { request: OfficeServiceRequest; presetStatus?: ServiceRequestUpdateStatus }) {
  const qc = useQueryClient();
  const mutation = useUpdateOfficeServiceRequest();
  // Every change here moves the request in the inbox lists and the overview
  // counters (new, overdue, awaiting reply), so both are refreshed together.
  const refreshOffice = () => Promise.all([
    qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetOfficeSummaryQueryKey() }),
  ]);
  // Same key as the invoice panel below, so this is the cached list, not a second request.
  const invoices = useListOfficeServiceRequestInvoices(request.id, { query: { queryKey: getListOfficeServiceRequestInvoicesQueryKey(request.id) } });
  const [status, setStatus] = useState<ServiceRequestUpdateStatus>(presetStatus ?? request.status);
  const [rejected, setRejected] = useState<string | null>(null);
  const [officeNote, setOfficeNote] = useState(request.officeNote ?? '');
  const [customerMessage, setCustomerMessage] = useState(request.customerMessage ?? '');
  const [assignedTo, setAssignedTo] = useState(request.assignedTo ?? '');
  const [due, setDue] = useState(dateInput(request.dueAt));
  const [extracting, setExtracting] = useState<ServiceAttachment | null>(null);
  const members = useAssignees();
  const [version, setVersion] = useState(request.updatedAt);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    setStatus(presetStatus ?? request.status);
    setOfficeNote(request.officeNote ?? '');
    setCustomerMessage(request.customerMessage ?? '');
    setAssignedTo(request.assignedTo ?? '');
    setDue(dateInput(request.dueAt));
    setVersion(request.updatedAt);
    setConflict(false);
    setSaved(false);
    setRejected(null);
  }, [request.id]);
  const changedSinceOpened = request.updatedAt !== version;
  // Completing, or leaving "awaiting payment", with an unpaid invoice is refused
  // by the API (needsInvoicesSettled); say so before the save instead of after.
  const hasUnpaid = !!invoices.data?.some(i => i.status === 'issued');
  const unpaidBlocksMove = hasUnpaid && status !== request.status && (status === 'completed' || request.status === 'awaiting_payment');
  function reviewLatest() {
    setStatus(request.status);
    setOfficeNote(request.officeNote ?? '');
    setCustomerMessage(request.customerMessage ?? '');
    setAssignedTo(request.assignedTo ?? '');
    setDue(dateInput(request.dueAt));
    setVersion(request.updatedAt);
    setConflict(false);
    setSaved(false);
    setRejected(null);
    mutation.reset();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (changedSinceOpened || conflict || unpaidBlocksMove) return;
    setSaved(false); setRejected(null);
    try {
      const updated = await mutation.mutateAsync({ id: request.id, data: {
        expectedUpdatedAt: version,
        status, officeNote: officeNote.trim() || null,
        customerMessage: status === 'waiting_on_customer' ? customerMessage.trim() : null,
        // Only changed fields are sent; omitted means "keep".
        ...(assignedTo !== (request.assignedTo ?? '') ? { assignedTo: assignedTo || null } : {}),
        ...(due !== dateInput(request.dueAt) ? { dueAt: dueFromInput(due) } : {}),
      } });
      setVersion(updated.updatedAt);
      await refreshOffice();
      setSaved(true);
    } catch (error) {
      const failure = error as { status?: number; data?: { error?: string } | null };
      if (failure?.status === 409) {
        // 409 is either the version check (fixed English text, shown as the
        // conflict notice) or a rule the API enforces, whose Arabic text is
        // shown as is: a move not allowed from this status, an unpaid invoice.
        const reason = failure.data?.error;
        if (reason && !/^This request changed/.test(reason)) setRejected(reason); else setConflict(true);
        await qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() });
      }
    }
  }
  return <div className="surface rq-editor">
    <div className="rq-editor-head"><div className="min-w-0"><span className="rq-editor-ref nums" dir="ltr">{request.reference}</span><h2 className="display rq-editor-title"><Link href={fullPageHref(request.id)} title="فتح الصفحة الكاملة">{request.service}</Link></h2></div><Status value={request.status} /></div>
    <div className="rq-editor-body">
      {isStale(request) && <StaleBadge updatedAt={request.updatedAt} />}
      {(request.customer || request.subject) && <div className="rq-customer">
        <span>{request.customer ? <><strong>{request.customer.fullName}</strong> <span className="text-subtle" dir="ltr">{request.customer.email}</span></> : 'العميل'}</span>
        <Link href={`/office/customers/${encodeURIComponent(request.userId)}`} className="rq-customer-link"><Contact size={13} aria-hidden="true" />ملف العميل</Link>
        {request.subject && <span className="w-full"><SubjectChip subject={request.subject} /></span>}
      </div>}
      <div className="rq-facts"><div><span className="muted">المجال</span><strong>{categoryNames[request.category]}</strong></div><div><span className="muted">تاريخ الإرسال</span><strong>{dateText(request.createdAt)}</strong></div><div className="col-span-2"><span className="muted">رقم التواصل</span><strong dir="ltr" className="inline-block nums">{request.contactPhone}</strong></div></div>
      <div><div className="mb-2 text-xs font-bold text-subtle">تفاصيل العميل</div><p className="rq-description">{request.description}</p></div>
      {/* Bulk requests: each employee's progress, compact here; the full page has the notes. */}
      {request.employees?.length > 0 && <div><RequestEmployees compact requestId={request.id} employees={request.employees} onChanged={refreshOffice} /></div>}
      <div><ChecklistEditor requestId={request.id} checklist={request.checklist} attachments={request.attachments} onChanged={refreshOffice} /></div>
      <div><RequestFiles key={request.id} scope="office" requestId={request.id} attachments={request.attachments} checklist={request.checklist} canUpload onChanged={refreshOffice} onExtract={setExtracting} /></div>
      {extracting && <ExtractReminder requestId={request.id} file={extracting} onClose={() => setExtracting(null)} />}
      <div><RequestConversation requestId={request.id} scope="office" /></div>
      {/* A quote comes before the invoice: accepting it issues the invoice. */}
      <div><QuotePanel requestId={request.id} quote={request.quote} onChanged={refreshOffice} /></div>
      <div><OfficeInvoices requestId={request.id} onChanged={refreshOffice} employeesCount={request.employees?.length ?? 0} /></div>
      {request.rating && <div className="text-sm"><span className="muted block text-xs">تقييم العميل</span><strong className="text-copper">{'★'.repeat(request.rating)}{'☆'.repeat(5 - request.rating)}</strong>{request.ratingComment && <p className="mt-1 whitespace-pre-wrap leading-7">«{request.ratingComment}»</p>}</div>}
      <form onSubmit={submit} className="rq-form">
        {/* Only the moves allowed from the current status; the API refuses the rest. */}
        <label className="form-field">تحديث الحالة<select className="form-control" value={status} onChange={e => { setStatus(e.target.value as ServiceRequestUpdateStatus); setRejected(null); }}>{statusChoices(request.status, status).map(s => <option value={s} key={s}>{statusNames[s]}</option>)}</select></label>
        {unpaidBlocksMove && <p role="alert" className="rq-alert is-warn">{status === 'completed' ? 'توجد فاتورة غير مسددة؛ لا يمكن الإكمال قبل تسويتها.' : 'توجد فاتورة غير مسددة؛ لا يمكن نقل الطلب قبل تسويتها.'}</p>}
        <div className="rq-form-row">
          <label className="form-field">المسؤول<select className="form-control" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}><option value="">غير مسند</option>{assignedTo && !members.data?.some(m => m.userId === assignedTo) && <option value={assignedTo}>عضو سابق</option>}{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
          <label className="form-field">موعد الإنجاز<input className="form-control" type="date" dir="ltr" value={due} onChange={e => setDue(e.target.value)} /></label>
        </div>
        {isOverdue({ status: request.status, dueAt: request.dueAt }) && <p className="text-xs font-bold text-danger">تجاوز الطلب موعد إنجازه.</p>}
        {status === 'waiting_on_customer' && <label className="form-field">ما يحتاجه المكتب من العميل<textarea className="form-control !min-h-24" value={customerMessage} onChange={e => setCustomerMessage(e.target.value)} maxLength={2000} minLength={2} required placeholder="وضّح للعميل ما يلزم لإكمال الطلب..." /><small className="muted font-normal">تظهر هذه الرسالة للعميل في طلبه.</small></label>}
        <label className="form-field">ملاحظة المكتب الداخلية<textarea className="form-control !min-h-28" value={officeNote} onChange={e => setOfficeNote(e.target.value)} maxLength={2000} placeholder="ملاحظة داخلية للفريق..." /><small className="muted font-normal">هذه الملاحظة داخلية ولا تُعرض للعميل في البوابة.</small></label>
        {(conflict || changedSinceOpened) ? <div role="alert" className="rq-alert is-danger">تغيّر هذا الطلب منذ فتحه. راجع النسخة الجديدة قبل الحفظ. <button type="button" className="underline" onClick={reviewLatest} disabled={request.updatedAt === version}>مراجعة النسخة الجديدة</button></div> : rejected ? <p role="alert" className="rq-alert is-danger">{rejected}</p> : mutation.isError && <p role="alert" className="rq-alert is-danger">تعذّر حفظ التحديث. حاول مجددًا.</p>}
        {saved && <p role="status" className="rq-alert is-ok">تم حفظ التحديث.</p>}
        <button type="submit" disabled={mutation.isPending || conflict || changedSinceOpened || unpaidBlocksMove} className="btn btn-primary w-full" data-loading={mutation.isPending || undefined}>{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ التحديث'}<Save size={16} aria-hidden="true" /></button>
      </form>
    </div>
  </div>;
}

/* ============================================================== inquiries */

const inquiryFilters: [InquiryStatus | '', string][] = [['open', 'المفتوحة'], ['answered', 'المجاب عنها'], ['', 'الكل']];
export function OfficeInquiries() {
  // Arriving from the messages inbox (?open=id) lands on that thread, with the
  // status filter widened so an answered inquiry is in the list too.
  const opened = Number(new URLSearchParams(useSearch()).get('open')) || null;
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = useState<InquiryStatus | ''>(opened ? '' : 'open');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(opened);
  useEffect(() => setPage(1), [q, status]);
  const params = {
    page, pageSize, ...(q ? { q } : {}), ...(status ? { status } : {}),
  };
  const list = useListOfficeInquiries(params, { query: {
    queryKey: getListOfficeInquiriesQueryKey(params), refetchInterval: 30_000,
  } });
  useEffect(() => {
    if (list.data && page > 1 && page > Math.max(1, Math.ceil(list.data.total / pageSize))) {
      setPage(Math.max(1, Math.ceil(list.data.total / pageSize)));
    }
  }, [list.data, page]);
  const rows = list.data?.items ?? [];
  const active = rows.find(i => i.id === selected);
  const editorRef = useRevealOnSelect(selected);
  return <PortalLayout staff>
    <OfficeCommandPalette />
    <PageHeading eyebrow="صندوق الوارد" title="استفسارات العملاء" subtitle="اقرأ الأسئلة وتابع المحادثة مع كل عميل من مساحة واحدة." />
    <Toolbar search={{ value: search, onChange: setSearch, label: 'بحث في الاستفسارات', placeholder: 'ابحث باسم العميل أو الموضوع أو مرجع الطلب', maxLength: 120 }}
      filters={<div className="flex flex-wrap gap-2" role="group" aria-label="تصفية حسب الحالة">{inquiryFilters.map(([key, label]) => <FilterChip key={label} active={status === key} onClick={() => setStatus(key)}>{label}</FilterChip>)}</div>} />
    {list.isLoading ? <LoadingBlock variant="table" /> : list.isError ? <ErrorBlock retry={() => list.refetch()} /> : <div className="rq-grid">
      <div className="min-w-0"><div className="rq-meta"><ResultCount total={list.data?.total ?? 0} /></div>
        <div className={`surface iq-list transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.length ? rows.map(i => <button type="button" aria-pressed={selected === i.id} key={i.id} onClick={() => setSelected(i.id)} className="iq-row">
          <div className="iq-row-top"><div className="min-w-0"><div className="iq-row-title">{i.subject}</div><div className="iq-row-meta">{i.customer && <span>{i.customer.fullName}</span>}<span>{dateText(i.createdAt)}</span></div></div><Status value={i.status} /></div>
          <p className="iq-row-preview">{i.message}</p>
        </button>) : <EmptyState compact title={q || status ? 'لا توجد استفسارات مطابقة.' : 'لا توجد استفسارات بعد.'} text={q || status ? 'جرّب تصفية أخرى أو امسح البحث.' : 'تصل استفسارات العملاء هنا فور إرسالها من البوابة.'} icon={<MessageSquareText size={22} strokeWidth={1.5} />} />}</div>
        <Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} /></div>
      <div ref={editorRef} className="rq-editor-slot">{selected ? <InquiryPanel key={selected} id={selected} inquiry={active} /> : <div className="surface rq-placeholder"><MessageSquareText size={30} strokeWidth={1.5} aria-hidden="true" /><p className="m-0">اختر استفسارًا لقراءته والرد عليه.</p></div>}</div>
    </div>}
  </PortalLayout>;
}

// The thread of one inquiry: the customer's question opens it (the API
// composes it as the first message), the office's first reply marks the
// inquiry answered. Opened by id so a thread from the inbox shows even when
// the current filter page does not list it.
function InquiryPanel({ id, inquiry }: { id: number; inquiry: OfficeInquiry | undefined }) {
  const thread = useOfficeThread('inquiry', id, `استفسار #${id}`);
  return <div className="surface overflow-hidden">
    <div className="iq-panel-head">
      <div className="min-w-0"><h2 className="display rq-editor-title !mt-0">{inquiry?.subject ?? `استفسار #${id}`}</h2>{inquiry?.customer && <div className="muted mt-1 text-xs">{inquiry.customer.fullName} · <span dir="ltr">{inquiry.customer.email}</span></div>}<div className="muted mt-1 text-xs">{inquiry ? dateText(inquiry.createdAt) : `استفسار #${id}`}</div></div>
      <div className="flex shrink-0 items-center gap-2">{inquiry && <Status value={inquiry.status} />}<WhatsappFollowUp link={thread?.whatsapp.link ?? null} number={thread?.whatsapp.number ?? null} verified={!!thread?.whatsapp.verified} scope="office" /></div>
    </div>
    <div className="space-y-5 p-5">
      {inquiry?.linkedServiceRequest && <div className="iq-linked"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-bold text-subtle">طلب الخدمة المرتبط: <span dir="ltr" className="nums">{inquiry.linkedServiceRequest.reference}</span></div><Status value={inquiry.linkedServiceRequest.status} /></div><div className="mt-2 font-semibold">{inquiry.linkedServiceRequest.service}<span className="font-normal text-subtle">، {categoryNames[inquiry.linkedServiceRequest.category]}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-subtle">{inquiry.linkedServiceRequest.description}</p></div>}
      <Conversation thread={{ type: 'inquiry', id }} scope="office" whatsapp={thread?.whatsapp ?? null} />
    </div>
  </div>;
}
