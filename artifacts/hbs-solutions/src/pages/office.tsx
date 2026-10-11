import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowLeft, ClipboardList, Clock3, Contact, FileClock, Maximize2, MessageSquareText, MessagesSquare, Save, Search, UserRound } from 'lucide-react';
import {
  getGetOfficeSummaryQueryKey, getListOfficeServiceRequestsQueryKey, getListOfficeInquiriesQueryKey, getListOfficeAssigneesQueryKey,
  useGetOfficeSummary, useListOfficeServiceRequests, useUpdateOfficeServiceRequest, useListOfficeAssignees,
  useListOfficeReminders, getListOfficeRemindersQueryKey,
  useListOfficeServiceRequestInvoices, getListOfficeServiceRequestInvoicesQueryKey,
  useListOfficeInquiries, useAnswerOfficeInquiry,
  type InquiryStatus, type OfficeServiceRequestCategory, type OfficeServiceRequestStatus,
  type OfficeServiceRequest, type OfficeInquiry, type ServiceRequestUpdateStatus, type OfficeAssignee, type ServiceAttachment,
} from '@workspace/api-client-react';
import {
  PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, Pager, STALE_AFTER_DAYS, StaleBadge,
  Status, dateText, categoryNames, isStale, statusOptions, statusNames, useDebouncedValue,
} from '@/components/portal-ui';
import { LOCALE } from '@/lib/format';
import { RequestFiles } from '@/components/request-files';
import { OfficeInvoices } from '@/components/request-billing';
import { ChecklistEditor, ExtractReminder, QuotePanel, RequestEmployees } from '@/components/office-request-extras';
import { ExportButtons } from '@/components/excel-import';
import { requestColumns, requestRows } from '@/lib/export';
import { RequestConversation, ReplyBadge, SubjectChip } from '@/components/request-conversation';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { formatCalendarDate } from '@/lib/format';
import { statusChoices } from '@/lib/request-status';

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

export function OfficeOverview() {
  const summary = useGetOfficeSummary({ query: { queryKey: getGetOfficeSummaryQueryKey(), refetchInterval: 30_000 } });
  const staleCount = summary.data?.staleRequests ?? 0;
  return <PortalLayout staff>
    <PageHeading eyebrow="مساحة المكتب" title="نظرة عامة"/>
    {summary.isLoading ? <LoadingBlock/> : summary.isError ? <ErrorBlock retry={() => summary.refetch()}/> : summary.data && <>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{([
          ['طلبات جديدة', summary.data.newRequests, '/office/requests?status=received'],
          ['طلبات نشطة', summary.data.activeRequests, null],
          ['استفسارات مفتوحة', summary.data.openInquiries, '/office/inquiries'],
          ['إجمالي الطلبات', summary.data.totalRequests, '/office/requests'],
        ] as const).map(([label, value, href], index) => {
          const body = <><div className={`flex items-center justify-between gap-2 text-xs font-bold ${index === 0 ? 'text-on-dark-2' : 'text-subtle'}`}>{label}{href && <ArrowLeft size={15} className="shrink-0 transition-transform group-hover:-translate-x-1"/>}</div><div className="display nums mt-3 text-3xl font-semibold sm:mt-4 sm:text-4xl">{count(value)}</div></>;
          const classes = `surface block p-4 text-inherit no-underline sm:p-5 ${index === 0 ? '!bg-teal !text-on-dark' : ''}`;
          return href
            ? <Link key={label} href={href} className={`group ${classes} transition-colors hover:border-line-strong`}>{body}</Link>
            : <div key={label} className={classes}>{body}</div>;
        })}</div>
        <div className="grid gap-5 pt-2 xl:grid-cols-2">
          <Queue title="متأخرة عن موعدها" icon={AlarmClock} count={summary.data.overdueRequests} href="/office/requests?overdue=true&sort=due_soon" params={{ overdue: true, sort: 'due_soon' }} empty="لا توجد طلبات متأخرة." warn/>
          <Queue title="بانتظار ردّك على العميل" icon={MessagesSquare} count={summary.data.awaitingReply} href="/office/requests?awaitingReply=true" params={{ awaitingReply: true, sort: 'oldest_update' }} empty="لا توجد رسائل تنتظر الرد."/>
          <Queue title="مسندة إليّ" icon={UserRound} count={summary.data.myRequests} href="/office/requests?assignee=me&sort=due_soon" params={{ assignee: 'me', sort: 'due_soon' }} empty="لا توجد طلبات مسندة إليك."/>
          <ExpiringQueue count={summary.data.expiringDocuments}/>
        </div>
        <div className="grid gap-4 pt-4 md:grid-cols-3">
          <Link href="/office/customers" className="group surface flex items-start justify-between gap-4 p-7 text-inherit no-underline transition-transform hover:-translate-y-1"><div><Contact className="mb-7 text-copper" size={26}/><h2 className="display text-xl font-semibold">ملفات العملاء</h2><p className="muted mt-2 text-sm leading-7">المنشأة والموظفون والتراخيص والطلبات لكل عميل في صفحة واحدة.</p></div><ArrowLeft className="shrink-0 text-subtle transition-transform group-hover:-translate-x-1"/></Link>
          <Link href="/office/requests" className="group surface flex items-start justify-between gap-4 p-7 text-inherit no-underline transition-transform hover:-translate-y-1"><div><ClipboardList className="mb-7 text-copper" size={26}/><h2 className="display text-xl font-semibold">طلبات العملاء</h2><p className="muted mt-2 text-sm leading-7">راجع المعاملات وحدّث حالتها وأضف ملاحظات المكتب الداخلية.</p></div><ArrowLeft className="shrink-0 text-subtle transition-transform group-hover:-translate-x-1"/></Link>
          <Link href="/office/inquiries" className="group surface flex items-start justify-between gap-4 p-7 text-inherit no-underline transition-transform hover:-translate-y-1"><div><MessageSquareText className="mb-7 text-copper" size={26}/><h2 className="display text-xl font-semibold">استفسارات العملاء</h2><p className="muted mt-2 text-sm leading-7">اطّلع على الأسئلة الواردة وأرسل الردود للعملاء.</p></div><ArrowLeft className="shrink-0 text-subtle transition-transform group-hover:-translate-x-1"/></Link>
        </div>
      </div>
    </>}
  </PortalLayout>;
}

type QueueParams = { overdue?: boolean; awaitingReply?: boolean; assignee?: string; sort: RequestSort };
// A short list of today's work; the full filtered list is one click away.
function Queue({ title, icon: Icon, count: total, href, params, empty, warn = false }: { title: string; icon: typeof AlarmClock; count: number; href: string; params: QueueParams; empty: string; warn?: boolean }) {
  const query = { page: 1, pageSize: 5, ...params };
  const list = useListOfficeServiceRequests(query, { query: { queryKey: getListOfficeServiceRequestsQueryKey(query), refetchInterval: 60_000 } });
  return <section className={`surface overflow-hidden ${warn && total ? '!border-warn-line' : ''}`}>
    <Link href={href} className={`flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-inherit no-underline ${warn && total ? 'bg-warn-soft text-warn' : 'bg-paper'}`}>
      <span className="flex items-center gap-2 font-bold"><Icon size={17}/>{title}</span><span className="flex items-center gap-2"><strong className="display nums text-xl">{count(total)}</strong><ArrowLeft size={15}/></span>
    </Link>
    {list.data?.items.length ? list.data.items.map(r => <Link key={r.id} href={`/office/requests?q=${encodeURIComponent(r.reference)}`} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 text-inherit no-underline last:border-0 hover:bg-paper">
      <div className="min-w-0"><div className="truncate font-semibold">{r.service}</div><div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr">{r.reference}</span>{r.customer && <span>{r.customer.fullName}</span>}{r.dueAt && <span>الموعد {dateText(r.dueAt)}</span>}</div></div>
      <Status value={r.status}/>
    </Link>) : <p className="px-5 py-6 text-sm text-subtle">{list.isLoading ? 'جارٍ التحميل…' : empty}</p>}
  </section>;
}

function ExpiringQueue({ count: total }: { count: number }) {
  const params = { withinDays: 30 };
  const list = useListOfficeReminders(params, { query: { queryKey: getListOfficeRemindersQueryKey(params), refetchInterval: 300_000 } });
  return <section className="surface overflow-hidden">
    <Link href="/office/reminders" className="flex items-center justify-between gap-3 border-b border-line bg-paper px-5 py-4 text-inherit no-underline">
      <span className="flex items-center gap-2 font-bold"><FileClock size={17}/>وثائق عملاء تنتهي خلال 30 يومًا</span><span className="flex items-center gap-2"><strong className="display nums text-xl">{count(total)}</strong><ArrowLeft size={15}/></span>
    </Link>
    {list.data?.length ? list.data.slice(0, 5).map(r => <div key={r.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-0">
      <div className="min-w-0"><div className="truncate font-semibold">{reminderKindNames[r.kind]} «{r.label}»</div><div className="mt-0.5 text-xs text-subtle">{r.customer?.fullName ?? 'عميل'} · {formatCalendarDate(r.expiresOn)}</div></div>
      <ExpiryBadge expiresOn={r.expiresOn}/>
    </div>) : <p className="px-5 py-6 text-sm text-subtle">{list.isLoading ? 'جارٍ التحميل…' : 'لا توجد وثائق تنتهي خلال 30 يومًا.'}</p>}
  </section>;
}

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
  return <p className="text-xs font-semibold text-subtle"><span className="nums">{count(total)}</span> نتيجة</p>;
}

export function OfficeRequests() {
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
  const members = useAssignees();
  useEffect(() => setPage(1), [q, status, category, sort, assignee, overdue, awaitingReply]);
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

  return <PortalLayout staff>
    <PageHeading eyebrow="صندوق الوارد" title="طلبات العملاء" subtitle="ابحث بالرقم المرجعي أو الخدمة أو تفاصيل الطلب أو رقم التواصل، وحدّث الحالة بحسب تقدم كل طلب."/>
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,11rem)]">
      <label className="relative col-span-2 lg:col-span-1"><span className="sr-only">بحث</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="اسم العميل، الرقم المرجعي، الخدمة، رقم التواصل..." value={search} onChange={e => setSearch(e.target.value)} maxLength={120}/></label>
      <label><span className="sr-only">الحالة</span><select className="form-control" value={status} onChange={e => setStatus(e.target.value as OfficeServiceRequestStatus | '')}><option value="">كل الحالات</option>{statusOptions.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></label>
      <label><span className="sr-only">المجال</span><select className="form-control" value={category} onChange={e => setCategory(e.target.value as OfficeServiceRequestCategory | '')}><option value="">كل المجالات</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="col-span-2 lg:col-span-1"><span className="sr-only">الترتيب</span><select className="form-control" value={sort} onChange={e => setSort(e.target.value as RequestSort)}>{Object.entries(requestSorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="min-w-[14rem]"><span className="sr-only">المسؤول</span><select className="form-control" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">كل المسؤولين</option><option value="me">المسندة إليّ</option><option value="unassigned">غير مسندة</option>{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
      <button type="button" aria-pressed={overdue} onClick={() => setOverdue(!overdue)} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition-colors ${overdue ? 'border-warn-line bg-warn-soft text-warn' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}><AlarmClock size={15}/>المتأخرة فقط</button>
      <button type="button" aria-pressed={awaitingReply} onClick={() => setAwaitingReply(!awaitingReply)} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition-colors ${awaitingReply ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}><MessagesSquare size={15}/>بانتظار ردّنا</button>
    </div>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.total && !filtered
      ? <EmptyBlock title="لا توجد طلبات واردة" text="ستظهر طلبات العملاء هنا عند إرسالها عبر البوابة."/>
       : <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
         <div className="min-w-0"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><ResultCount total={list.data?.total ?? 0}/>
           {/* The rows on screen (this page, with the filters applied), with the names as the list shows them. */}
           {rows.length > 0 && <ExportButtons compact name="طلبات العملاء" columns={requestColumns} rows={() => requestRows(rows, { statusNames, categoryNames, memberName: id => memberName(members.data, id) })}/>}</div><div className={`surface overflow-hidden transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.length ? rows.map(r => <div key={r.id} className={`flex items-stretch border-b border-line transition-colors last:border-0 ${selected === r.id ? 'bg-sage shadow-[inset_-3px_0_0_var(--color-teal)]' : ''}`}>
          {/* The row selects for the inline editor; the link beside it opens the full page (J/K moves through these rows there). */}
          <button type="button" aria-pressed={selected === r.id} onClick={() => setSelected(r.id)} className="block min-w-0 flex-1 px-5 py-4 text-right hover:bg-paper sm:px-6">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-bold">{r.service}</div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr">{r.reference}</span><span>{categoryNames[r.category]}</span><span>{dateText(r.createdAt)}</span>{memberName(members.data, r.assignedTo) && <span className="inline-flex items-center gap-1"><UserRound size={12} aria-hidden="true"/>{memberName(members.data, r.assignedTo)}</span>}{isOverdue(r) && <span className="inline-flex items-center whitespace-nowrap rounded-md bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">متأخر عن موعده</span>}{r.employees?.length > 0 && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-sunk px-2 py-0.5 text-xs font-bold text-quiet">{count(r.employees.filter(e => e.itemStatus === 'done').length)}/{count(r.employees.length)} موظف</span>}<SubjectChip subject={r.subject}/><ReplyBadge lastMessage={r.lastMessage} status={r.status} viewer="office"/>{isStale(r) && <StaleBadge updatedAt={r.updatedAt}/>}</div></div><Status value={r.status}/></div>
        </button>
          <Link href={fullPageHref(r.id, rows)} className="flex shrink-0 items-center gap-1 border-r border-line px-3 text-xs font-bold text-copper no-underline hover:bg-paper" title="فتح الصفحة الكاملة"><Maximize2 size={14} aria-hidden="true"/><span className="hidden sm:inline">فتح الصفحة الكاملة</span><span className="sr-only sm:hidden">فتح الصفحة الكاملة</span></Link>
        </div>) : <div className="p-10 text-center text-sm text-subtle">لا توجد نتائج مطابقة.</div>}</div><Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage}/></div>
         <div ref={editorRef} className="scroll-mt-24 xl:sticky xl:top-24">{active ? <RequestEditor key={active.id} request={active}/> : <div className="surface hidden min-h-64 flex-col items-center justify-center p-8 text-center text-subtle xl:flex"><ClipboardList className="mb-3" size={30} strokeWidth={1.5}/><p className="text-sm">اختر طلبًا من القائمة لعرض تفاصيله وتحديث حالته.</p></div>}</div>
      </div>}
  </PortalLayout>;
}

function RequestEditor({ request }: { request: OfficeServiceRequest }) {
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
  const [status, setStatus] = useState<ServiceRequestUpdateStatus>(request.status);
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
    setStatus(request.status);
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
  return <div className="surface overflow-hidden">
    <div className="border-b border-line bg-sage p-5"><div className="flex items-start justify-between gap-3"><div><span className="text-xs font-bold text-subtle" dir="ltr">{request.reference}</span><h2 className="display mt-2 text-lg font-semibold"><Link href={fullPageHref(request.id)} className="text-inherit no-underline hover:underline" title="فتح الصفحة الكاملة">{request.service}</Link></h2></div><Status value={request.status}/></div></div>
    <div className="space-y-5 p-5">
      {isStale(request) && <StaleBadge updatedAt={request.updatedAt}/>}
      {(request.customer || request.subject) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2 text-xs">
        <span>{request.customer ? <><strong>{request.customer.fullName}</strong> <span className="text-subtle" dir="ltr">{request.customer.email}</span></> : 'العميل'}</span>
        <Link href={`/office/customers/${encodeURIComponent(request.userId)}`} className="inline-flex items-center gap-1 font-bold text-copper no-underline hover:underline"><Contact size={13}/>ملف العميل</Link>
        {request.subject && <span className="w-full"><SubjectChip subject={request.subject}/></span>}
      </div>}
      <div className="grid grid-cols-2 gap-3 text-xs"><div><span className="muted block">المجال</span><strong>{categoryNames[request.category]}</strong></div><div><span className="muted block">تاريخ الإرسال</span><strong>{dateText(request.createdAt)}</strong></div><div className="col-span-2"><span className="muted block">رقم التواصل</span><strong dir="ltr" className="inline-block">{request.contactPhone}</strong></div></div>
      <div className="border-t border-line pt-4"><div className="mb-2 text-xs font-bold text-subtle">تفاصيل العميل</div><p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{request.description}</p></div>
      {/* Bulk requests: each employee's progress, compact here; the full page has the notes. */}
      {request.employees?.length > 0 && <div className="border-t border-line pt-4"><RequestEmployees compact requestId={request.id} employees={request.employees} onChanged={refreshOffice}/></div>}
      <div className="border-t border-line pt-4"><ChecklistEditor requestId={request.id} checklist={request.checklist} attachments={request.attachments} onChanged={refreshOffice}/></div>
      <div className="border-t border-line pt-4"><RequestFiles key={request.id} scope="office" requestId={request.id} attachments={request.attachments} checklist={request.checklist} canUpload onChanged={refreshOffice} onExtract={setExtracting}/></div>
      {extracting && <ExtractReminder requestId={request.id} file={extracting} onClose={() => setExtracting(null)}/>}
      <div className="border-t border-line pt-4"><RequestConversation requestId={request.id} scope="office"/></div>
      {/* A quote comes before the invoice: accepting it issues the invoice. */}
      <div className="border-t border-line pt-4"><QuotePanel requestId={request.id} quote={request.quote} onChanged={refreshOffice}/></div>
      <div className="border-t border-line pt-4"><OfficeInvoices requestId={request.id} onChanged={refreshOffice} employeesCount={request.employees?.length ?? 0}/></div>
      {request.rating && <div className="border-t border-line pt-4 text-sm"><span className="muted block text-xs">تقييم العميل</span><strong className="text-copper">{'★'.repeat(request.rating)}{'☆'.repeat(5 - request.rating)}</strong>{request.ratingComment && <p className="mt-1 whitespace-pre-wrap leading-7">«{request.ratingComment}»</p>}</div>}
      <form onSubmit={submit} className="space-y-4 border-t border-line pt-5">
        {/* Only the moves allowed from the current status; the API refuses the rest. */}
        <label className="form-field">تحديث الحالة<select className="form-control" value={status} onChange={e => { setStatus(e.target.value as ServiceRequestUpdateStatus); setRejected(null); }}>{statusChoices(request.status, status).map(s => <option value={s} key={s}>{statusNames[s]}</option>)}</select></label>
        {unpaidBlocksMove && <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-xs font-bold text-warn">{status === 'completed' ? 'توجد فاتورة غير مسددة؛ لا يمكن الإكمال قبل تسويتها.' : 'توجد فاتورة غير مسددة؛ لا يمكن نقل الطلب قبل تسويتها.'}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="form-field">المسؤول<select className="form-control" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}><option value="">غير مسند</option>{assignedTo && !members.data?.some(m => m.userId === assignedTo) && <option value={assignedTo}>عضو سابق</option>}{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
          <label className="form-field">موعد الإنجاز<input className="form-control" type="date" dir="ltr" value={due} onChange={e => setDue(e.target.value)}/></label>
        </div>
        {isOverdue({ status: request.status, dueAt: request.dueAt }) && <p className="text-xs font-bold text-danger">تجاوز الطلب موعد إنجازه.</p>}
        {status === 'waiting_on_customer' && <label className="form-field">ما يحتاجه المكتب من العميل<textarea className="form-control !min-h-24" value={customerMessage} onChange={e => setCustomerMessage(e.target.value)} maxLength={2000} minLength={2} required placeholder="وضّح للعميل ما يلزم لإكمال الطلب..."/><small className="muted font-normal">تظهر هذه الرسالة للعميل في طلبه.</small></label>}
        <label className="form-field">ملاحظة المكتب الداخلية<textarea className="form-control !min-h-28" value={officeNote} onChange={e => setOfficeNote(e.target.value)} maxLength={2000} placeholder="ملاحظة داخلية للفريق..."/><small className="muted font-normal">هذه الملاحظة داخلية ولا تُعرض للعميل في البوابة.</small></label>
        {(conflict || changedSinceOpened) ? <div role="alert" className="text-xs text-danger">تغيّر هذا الطلب منذ فتحه. راجع النسخة الجديدة قبل الحفظ. <button type="button" className="underline" onClick={reviewLatest} disabled={request.updatedAt === version}>مراجعة النسخة الجديدة</button></div> : rejected ? <p role="alert" className="text-xs text-danger">{rejected}</p> : mutation.isError && <p role="alert" className="text-xs text-danger">تعذّر حفظ التحديث. حاول مجددًا.</p>}
        {saved && <p role="status" className="text-xs font-bold text-ok">تم حفظ التحديث.</p>}
        <button type="submit" disabled={mutation.isPending || conflict || changedSinceOpened || unpaidBlocksMove} className="btn btn-primary w-full">{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ التحديث'}<Save size={16}/></button>
      </form>
    </div>
  </div>;
}

const inquiryFilters: [InquiryStatus | '', string][] = [['open', 'المفتوحة'], ['answered', 'المجاب عنها'], ['', 'الكل']];
export function OfficeInquiries() {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = useState<InquiryStatus | ''>('open');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
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
    <PageHeading eyebrow="صندوق الوارد" title="استفسارات العملاء" subtitle="اقرأ الأسئلة وأجب عنها من مساحة واحدة."/>
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center"><div className="flex gap-2" role="group" aria-label="تصفية حسب الحالة">{inquiryFilters.map(([key, label]) => <button type="button" key={label} onClick={() => setStatus(key)} aria-pressed={status === key} className={`min-h-11 flex-1 rounded-full border px-4 text-xs font-bold transition-colors lg:flex-none ${status === key ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>{label}</button>)}</div><label className="relative flex-1"><span className="sr-only">بحث في الاستفسارات</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="ابحث باسم العميل أو الموضوع أو مرجع الطلب" value={search} onChange={e => setSearch(e.target.value)} maxLength={120}/></label></div>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0"><div className="mb-2"><ResultCount total={list.data?.total ?? 0}/></div><div className={`surface overflow-hidden transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.length ? rows.map(i => <button type="button" aria-pressed={selected === i.id} key={i.id} onClick={() => setSelected(i.id)} className={`block w-full border-b border-line px-5 py-4 text-right transition-colors last:border-0 hover:bg-paper sm:px-6 ${selected === i.id ? '!bg-sage shadow-[inset_-3px_0_0_var(--color-teal)]' : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold">{i.subject}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span>{dateText(i.createdAt)}</span></div></div><Status value={i.status}/></div><p className="mt-2 line-clamp-2 text-xs leading-6 text-quiet">{i.message}</p></button>) : <div className="p-10 text-center text-sm text-subtle">{q || status ? 'لا توجد استفسارات مطابقة.' : 'لا توجد استفسارات بعد.'}</div>}</div><Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage}/></div>
      <div ref={editorRef} className="scroll-mt-24 xl:sticky xl:top-24">{active ? <InquiryEditor key={active.id} inquiry={active}/> : <div className="surface hidden min-h-64 flex-col items-center justify-center p-8 text-center text-subtle xl:flex"><MessageSquareText className="mb-3" size={30} strokeWidth={1.5}/><p className="text-sm">اختر استفسارًا لقراءته والرد عليه.</p></div>}</div>
    </div>}
  </PortalLayout>;
}

function InquiryEditor({ inquiry }: { inquiry: OfficeInquiry }) {
  const qc = useQueryClient();
  const mutation = useAnswerOfficeInquiry();
  const [answer, setAnswer] = useState(inquiry.answer ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setAnswer(inquiry.answer ?? ''); setSaved(false); }, [inquiry.id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    try {
      await mutation.mutateAsync({ id: inquiry.id, data: { answer: answer.trim() } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListOfficeInquiriesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetOfficeSummaryQueryKey() }),
      ]);
      setSaved(true);
    } catch { /* mutation error is displayed below */ }
  }
  return <div className="surface overflow-hidden">
    <div className="border-b border-line bg-sage p-5"><div className="flex items-center justify-between gap-2"><h2 className="display text-lg font-semibold">{inquiry.subject}</h2><Status value={inquiry.status}/></div><div className="muted mt-2 text-xs">{dateText(inquiry.createdAt)}</div></div>
    <div className="space-y-5 p-5">
      {inquiry.linkedServiceRequest && <div className="rounded-lg border border-sage-2 bg-paper p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-bold text-subtle">طلب الخدمة المرتبط: <span dir="ltr">{inquiry.linkedServiceRequest.reference}</span></div><Status value={inquiry.linkedServiceRequest.status}/></div><div className="mt-2 font-semibold">{inquiry.linkedServiceRequest.service}<span className="font-normal text-subtle">، {categoryNames[inquiry.linkedServiceRequest.category]}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-subtle">{inquiry.linkedServiceRequest.description}</p></div>}
      <div><div className="mb-2 text-xs font-bold text-subtle">رسالة العميل</div><p className="whitespace-pre-wrap text-sm leading-8">{inquiry.message}</p></div>
      {inquiry.answer && <div className="border-r-[3px] border-copper bg-copper-soft p-4"><div className="mb-2 text-xs font-bold text-copper">الرد الحالي، {dateText(inquiry.answeredAt)}</div><p className="whitespace-pre-wrap text-sm leading-7">{inquiry.answer}</p></div>}
      <form onSubmit={submit} className="space-y-4 border-t border-line pt-5"><label className="form-field">{inquiry.answer ? 'تعديل الرد' : 'اكتب ردّك'}<textarea className="form-control" value={answer} onChange={e => setAnswer(e.target.value)} minLength={2} maxLength={5000} placeholder="اكتب الرد الذي سيظهر للعميل..." required/></label>{mutation.isError && <p role="alert" className="text-xs text-danger">تعذّر إرسال الرد. حاول مجددًا.</p>}{saved && <p role="status" className="text-xs font-bold text-ok">تم حفظ الرد.</p>}<button disabled={mutation.isPending} type="submit" className="btn btn-primary w-full">{mutation.isPending ? 'جارٍ الإرسال...' : inquiry.answer ? 'حفظ الرد' : 'إرسال الرد'}<ArrowLeft size={16}/></button></form>
    </div>
  </div>;
}