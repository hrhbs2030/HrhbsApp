import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, Check, ChevronDown, ChevronUp, Contact, FileText, Keyboard, ListChecks, Mail, MessagesSquare, Phone, ReceiptText, Save, StickyNote, UserRound, UsersRound } from 'lucide-react';
import {
  getGetOfficeServiceRequestQueryKey, getGetOfficeSummaryQueryKey, getListOfficeServiceRequestInvoicesQueryKey, getListOfficeServiceRequestsQueryKey,
  useGetOfficeServiceRequest, useListOfficeServiceRequestInvoices, useUpdateOfficeServiceRequest,
  type OfficeServiceRequest, type OfficeServiceRequestPage, type ServiceAttachment, type ServiceRequestUpdateStatus,
} from '@workspace/api-client-react';
import { EmptyBlock, ErrorBlock, LoadingBlock, PortalLayout, StaleBadge, Status, categoryNames, dateText, isStale, statusNames, statusOptions } from '@/components/portal-ui';
import { RequestFiles } from '@/components/request-files';
import { OfficeInvoices } from '@/components/request-billing';
import { ChecklistEditor, ExtractReminder, QuotePanel, RequestEmployees, employeeProgress } from '@/components/office-request-extras';
import { RequestConversation, SubjectChip } from '@/components/request-conversation';
import { WhatsappFollowUp, useOfficeThread } from '@/components/whatsapp-follow-up';
import { statusChoices } from '@/lib/request-status';
import { formatMoney, formatNumber } from '@/lib/format';
import { dateInput, dueFromInput, isOverdue, memberName, useAssignees } from '@/pages/office';
import './office-request.css';

// The full page for one request: the side editor in the inbox is for a quick
// status change; this is for the work itself (reading the file, the thread,
// the employees of a bulk request) with the update bar always in reach. On
// desktop the rail (stage, customer, assignment, internal note, checklist and
// invoice summaries) sits beside the tabbed workspace; on a phone it stacks.

type Tab = 'request' | 'conversation' | 'files' | 'invoices' | 'employees';
const tabNames: Record<Tab, string> = { request: 'الطلب', conversation: 'المحادثة', files: 'المستندات', invoices: 'الفواتير', employees: 'الموظفون' };
const tabIcons: Record<Tab, typeof FileText> = { request: FileText, conversation: MessagesSquare, files: Contact, invoices: ReceiptText, employees: UsersRound };

// The request is fetched by id; until it answers, the row from the inbox list
// the person just left (any cached page holding it) shows at once.
function cachedListPages(qc: ReturnType<typeof useQueryClient>): { params: Record<string, unknown> | undefined; items: OfficeServiceRequest[]; at: number }[] {
  return qc.getQueryCache().findAll({ queryKey: getListOfficeServiceRequestsQueryKey() })
    .map(q => ({ params: q.queryKey[1] as Record<string, unknown> | undefined, items: (q.state.data as OfficeServiceRequestPage | undefined)?.items ?? [], at: q.state.dataUpdatedAt }))
    .filter(p => p.items.length > 0)
    .sort((a, b) => b.at - a.at);
}
export function useOfficeRequest(id: number) {
  const qc = useQueryClient();
  const lookup = useGetOfficeServiceRequest(id, { query: { queryKey: getGetOfficeServiceRequestQueryKey(id), enabled: id > 0, refetchInterval: 30_000, retry: false } });
  const cached = useMemo(() => cachedListPages(qc).flatMap(p => p.items).find(r => r.id === id), [qc, id, lookup.dataUpdatedAt]);
  const request = lookup.data ?? cached;
  // Gone (or never existed): said so even when an old list page still holds it.
  const notFound = (lookup.error as { status?: number } | null)?.status === 404;
  return { request: notFound ? undefined : request, isLoading: lookup.isLoading && !cached, isError: lookup.isError && !notFound && !cached, notFound, refetch: lookup.refetch };
}

// The order J/K move through: the ids the list page put in `?list=`, or,
// arriving another way, the most recent inbox page that holds this request.
export function siblingIds(id: number, search: string, qc: ReturnType<typeof useQueryClient>): number[] {
  const listed = (new URLSearchParams(search).get('list') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (listed.includes(id)) return listed;
  const page = cachedListPages(qc).find(p => !p.params?.q && p.items.some(r => r.id === id));
  return page ? page.items.map(r => r.id) : [];
}
export function neighbours(ids: number[], id: number): { prev: number | null; next: number | null; index: number; total: number } {
  const index = ids.indexOf(id);
  return { prev: index > 0 ? ids[index - 1] : null, next: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null, index, total: ids.length };
}
// Keys by physical position, so an Arabic layout (ت/ن/س on the same keys)
// works the same; letters are the fallback for browsers without `code`.
export const shortcutOf = (e: { code?: string; key?: string }): 'next' | 'prev' | 'save' | 'close' | null =>
  e.code === 'KeyJ' || e.key === 'j' || e.key === 'J' ? 'next' : e.code === 'KeyK' || e.key === 'k' || e.key === 'K' ? 'prev' : e.code === 'KeyS' || e.key === 's' || e.key === 'S' ? 'save' : e.key === 'Escape' ? 'close' : null;
const isTyping = (target: EventTarget | null) => { const el = target as HTMLElement | null; return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? '') || !!el.isContentEditable); };

export function OfficeRequestPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  const valid = Number.isInteger(id) && id > 0;
  const search = useSearch();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { request, isLoading, isError, notFound, refetch } = useOfficeRequest(valid ? id : 0);
  const ids = useMemo(() => siblingIds(id, search, qc), [id, search, qc]);
  const { prev, next, index, total } = neighbours(ids, id);
  const go = (target: number) => setLocation(`/office/requests/${target}${search ? `?${search}` : ''}`);
  return <PortalLayout staff>
    <div className="orq">
      <Link href="/office/requests" className="orq-back"><ArrowRight size={15} aria-hidden="true" />طلبات العملاء</Link>
      {!valid ? <EmptyBlock title="الطلب غير متاح" text="تحقق من رابط الطلب وحاول مرة أخرى." action="طلبات العملاء" href="/office/requests" />
        : isLoading ? <LoadingBlock />
        : isError ? <ErrorBlock retry={() => refetch()} />
        : notFound || !request ? <EmptyBlock title="الطلب غير موجود" text="لم يُعثر على هذا الطلب. ربما حُذف أو أن الرابط غير صحيح." action="طلبات العملاء" href="/office/requests" />
        : <RequestWorkspace key={request.id} request={request} nav={{ prev, next, index, total, go }} />}
    </div>
  </PortalLayout>;
}

type Nav = { prev: number | null; next: number | null; index: number; total: number; go: (id: number) => void };

// The open stages in pipeline order; a pause (waiting/awaiting) sits at its milestone.
const stageRail = statusOptions;

function RequestWorkspace({ request, nav }: { request: OfficeServiceRequest; nav: Nav }) {
  const qc = useQueryClient();
  const members = useAssignees();
  const mutation = useUpdateOfficeServiceRequest();
  const invoices = useListOfficeServiceRequestInvoices(request.id, { query: { queryKey: getListOfficeServiceRequestInvoicesQueryKey(request.id) } });
  const refreshOffice = () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetOfficeServiceRequestQueryKey(request.id) }),
    qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetOfficeSummaryQueryKey() }),
  ]);
  // The messages inbox links straight to the thread (?tab=conversation).
  const openTab = new URLSearchParams(useSearch()).get('tab');
  const [tab, setTab] = useState<Tab>(openTab === 'conversation' ? 'conversation' : 'request');
  // The thread row carries whether the customer's WhatsApp number is verified.
  const thread = useOfficeThread('request', request.id, request.reference);
  const [drawer, setDrawer] = useState(false);
  const [extracting, setExtracting] = useState<ServiceAttachment | null>(null);
  // The draft, the version it was taken from, and what the last save said.
  const [status, setStatus] = useState<ServiceRequestUpdateStatus>(request.status);
  const [assignedTo, setAssignedTo] = useState(request.assignedTo ?? '');
  const [due, setDue] = useState(dateInput(request.dueAt));
  const [customerMessage, setCustomerMessage] = useState(request.customerMessage ?? '');
  const [officeNote, setOfficeNote] = useState(request.officeNote ?? '');
  const [version, setVersion] = useState(request.updatedAt);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const changedSinceOpened = request.updatedAt !== version;
  const unpaid = invoices.data?.filter(i => i.status === 'issued') ?? [];
  const hasUnpaid = unpaid.length > 0;
  const unpaidBlocksMove = hasUnpaid && status !== request.status && (status === 'completed' || request.status === 'awaiting_payment');
  const blocked = mutation.isPending || conflict || changedSinceOpened || unpaidBlocksMove;
  function reviewLatest() {
    setStatus(request.status); setAssignedTo(request.assignedTo ?? ''); setDue(dateInput(request.dueAt));
    setCustomerMessage(request.customerMessage ?? ''); setOfficeNote(request.officeNote ?? '');
    setVersion(request.updatedAt); setConflict(false); setSaved(false); setRejected(null); mutation.reset();
  }
  async function save() {
    if (blocked) return;
    // The customer's message is required to put the request on their side; the
    // drawer opens on it rather than failing quietly from the S shortcut.
    if (status === 'waiting_on_customer' && customerMessage.trim().length < 2) { setDrawer(true); setRejected('اكتب للعميل ما يحتاجه المكتب منه قبل الحفظ.'); return; }
    setSaved(false); setRejected(null);
    try {
      const updated = await mutation.mutateAsync({ id: request.id, data: {
        expectedUpdatedAt: version,
        status, officeNote: officeNote.trim() || null,
        customerMessage: status === 'waiting_on_customer' ? customerMessage.trim() : null,
        ...(assignedTo !== (request.assignedTo ?? '') ? { assignedTo: assignedTo || null } : {}),
        ...(due !== dateInput(request.dueAt) ? { dueAt: dueFromInput(due) } : {}),
      } });
      setVersion(updated.updatedAt);
      await refreshOffice();
      setSaved(true);
    } catch (error) {
      const failure = error as { status?: number; data?: { error?: string } | null };
      if (failure?.status === 409) {
        // The version check (fixed English text) or a rule the API enforces, in Arabic, shown as is.
        const reason = failure.data?.error;
        if (reason && !/^This request changed/.test(reason)) setRejected(reason); else setConflict(true);
        await qc.invalidateQueries({ queryKey: getGetOfficeServiceRequestQueryKey(request.id) });
        await qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() });
      }
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const shortcut = shortcutOf(e);
      if (shortcut === 'close') { if (drawer) { e.preventDefault(); setDrawer(false); } return; }
      if (!shortcut || isTyping(e.target)) return;
      e.preventDefault();
      if (shortcut === 'next' && nav.next) nav.go(nav.next);
      else if (shortcut === 'prev' && nav.prev) nav.go(nav.prev);
      else if (shortcut === 'save') void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const assignee = memberName(members.data, request.assignedTo);
  const tabs: Tab[] = ['request', 'conversation', 'files', 'invoices', ...(request.employees?.length ? ['employees' as const] : [])];
  const badge: Partial<Record<Tab, string>> = {
    files: request.attachments.length ? formatNumber(request.attachments.length) : undefined,
    invoices: invoices.data?.length ? formatNumber(invoices.data.length) : undefined,
    employees: request.employees?.length ? employeeProgress(request.employees) : undefined,
  };
  const checklist = request.checklist ?? [];
  const linked = checklist.filter(i => i.attachmentId).length;
  const stageIndex = stageRail.indexOf(request.status);
  const notice: ReactNode = (conflict || changedSinceOpened) ? <span role="alert" className="orq-alert">تغيّر هذا الطلب منذ فتحه. <button type="button" className="underline" onClick={reviewLatest} disabled={request.updatedAt === version}>مراجعة النسخة الجديدة</button></span>
    : unpaidBlocksMove ? <span role="alert" className="orq-alert">{status === 'completed' ? 'توجد فاتورة غير مسددة؛ لا يمكن الإكمال قبل تسويتها.' : 'توجد فاتورة غير مسددة؛ لا يمكن نقل الطلب قبل تسويتها.'}</span>
    : rejected ? <span role="alert" className="orq-alert">{rejected}</span>
    : mutation.isError ? <span role="alert" className="orq-alert">تعذّر حفظ التحديث. حاول مجددًا.</span>
    : saved ? <span role="status" className="orq-ok">تم حفظ التحديث.</span> : null;
  return <>
    <header className="orq-head surface">
      <div className="orq-head-main">
        <div className="orq-ref"><span dir="ltr" className="nums">{request.reference}</span><span>{categoryNames[request.category]}</span><span>{dateText(request.createdAt)}</span>{isOverdue(request) && <span className="orq-overdue">متأخر عن موعده</span>}{isStale(request) && <StaleBadge updatedAt={request.updatedAt} />}</div>
        <h1 className="display orq-title">{request.service}</h1>
        <div className="orq-who">
          {request.customer ? <Link href={`/office/customers/${encodeURIComponent(request.userId)}`} className="orq-customer" title="ملف العميل"><Contact size={14} aria-hidden="true" /><strong>{request.customer.fullName}</strong></Link> : <span className="orq-customer"><Contact size={14} aria-hidden="true" />العميل</span>}
          <a href={`tel:${request.contactPhone}`} dir="ltr" className="orq-phone nums">{request.contactPhone}</a>
          <span className="orq-assignee"><UserRound size={14} aria-hidden="true" />{assignee ?? 'غير مسند'}</span>
          {request.dueAt && <span className="orq-assignee"><CalendarClock size={14} aria-hidden="true" />الموعد {dateText(request.dueAt)}</span>}
          {request.subject && <SubjectChip subject={request.subject} />}
        </div>
      </div>
      <div className="orq-head-side">
        <WhatsappFollowUp link={thread?.whatsapp.link ?? null} number={thread?.whatsapp.number ?? null} verified={!!thread?.whatsapp.verified} scope="office" />
        <Status value={request.status} />
        <div className="orq-nav" role="group" aria-label="التنقل بين الطلبات">
          <button type="button" className="btn btn-outline btn-sm" disabled={!nav.prev} onClick={() => nav.prev && nav.go(nav.prev)} title="السابق (K)">السابق</button>
          <span className="nums">{nav.total > 0 && nav.index >= 0 ? `${formatNumber(nav.index + 1)} من ${formatNumber(nav.total)}` : '—'}</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={!nav.next} onClick={() => nav.next && nav.go(nav.next)} title="التالي (J)">التالي</button>
        </div>
      </div>
    </header>
    <div className="orq-layout">
      <aside className="orq-rail" aria-label="ملخص الطلب">
        <section className="surface orq-rail-card" aria-labelledby="orq-stage-title">
          <h2 id="orq-stage-title" className="orq-rail-title">المرحلة</h2>
          <ol className="orq-stages">{stageRail.map((stage, i) => <li key={stage} className={`orq-stage ${i < stageIndex ? 'is-done' : i === stageIndex ? 'is-now' : ''}`} aria-current={i === stageIndex ? 'step' : undefined}><span className="orq-stage-dot" aria-hidden="true">{i < stageIndex ? <Check size={11} strokeWidth={3} /> : null}</span><span>{statusNames[stage]}</span></li>)}</ol>
        </section>
        <section className="surface orq-rail-card" aria-labelledby="orq-customer-title">
          <h2 id="orq-customer-title" className="orq-rail-title">العميل</h2>
          <dl className="orq-kv">
            <div><dt>الاسم</dt><dd>{request.customer?.fullName ?? 'العميل'}</dd></div>
            <div><dt><Mail size={12} aria-hidden="true" />البريد</dt><dd dir="ltr" className="nums">{request.customer?.email ?? '-'}</dd></div>
            <div><dt><Phone size={12} aria-hidden="true" />الجوال</dt><dd dir="ltr" className="nums"><a href={`tel:${request.contactPhone}`} className="text-inherit">{request.contactPhone}</a></dd></div>
            <div><dt>آخر تحديث</dt><dd>{dateText(request.updatedAt)}</dd></div>
          </dl>
          <Link href={`/office/customers/${encodeURIComponent(request.userId)}`} className="btn btn-outline btn-sm w-full">ملف العميل الكامل</Link>
        </section>
        <section className="surface orq-rail-card" aria-labelledby="orq-note-title">
          <h2 id="orq-note-title" className="orq-rail-title"><StickyNote size={14} aria-hidden="true" />الملاحظة الداخلية</h2>
          {request.officeNote ? <p className="orq-rail-note">{request.officeNote}</p> : <p className="orq-rail-empty">لا توجد ملاحظة للفريق بعد.</p>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawer(true)}>{request.officeNote ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}</button>
        </section>
        <section className="surface orq-rail-card" aria-labelledby="orq-summary-title">
          <h2 id="orq-summary-title" className="orq-rail-title">المتابعة</h2>
          <ul className="orq-checks">
            <li><ListChecks size={14} aria-hidden="true" /><span>المستندات المطلوبة</span><strong className="nums">{checklist.length ? `${formatNumber(linked)}/${formatNumber(checklist.length)}` : "—"}</strong></li>
            <li><Contact size={14} aria-hidden="true" /><span>الملفات المرفوعة</span><strong className="nums">{formatNumber(request.attachments?.length ?? 0)}</strong></li>
            <li className={hasUnpaid ? 'is-warn' : ''}><ReceiptText size={14} aria-hidden="true" /><span>{hasUnpaid ? 'فواتير غير مسددة' : 'الفواتير'}</span><strong className="nums">{hasUnpaid ? formatMoney(unpaid.reduce((sum, i) => sum + (i.total ?? 0), 0)) : formatNumber(invoices.data?.length ?? 0)}</strong></li>
            {request.employees?.length > 0 && <li><UsersRound size={14} aria-hidden="true" /><span>الموظفون</span><strong className="nums">{employeeProgress(request.employees)}</strong></li>}
          </ul>
        </section>
      </aside>
      <div className="orq-main">
        <div className="orq-tabs" role="tablist" aria-label="أقسام الطلب">{tabs.map(key => { const Icon = tabIcons[key]; return <button key={key} type="button" role="tab" id={`orq-tab-${key}`} aria-selected={tab === key} aria-controls={`orq-panel-${key}`} className="orq-tab" onClick={() => setTab(key)}><Icon size={15} aria-hidden="true" />{tabNames[key]}{badge[key] && <span className="orq-badge nums">{badge[key]}</span>}</button>; })}</div>
        <section role="tabpanel" id={`orq-panel-${tab}`} aria-labelledby={`orq-tab-${tab}`} className="orq-panel surface">
          {tab === 'request' && <div className="orq-request">
            <div className="orq-facts"><div><span className="muted block">المجال</span><strong>{categoryNames[request.category]}</strong></div><div><span className="muted block">تاريخ الإرسال</span><strong>{dateText(request.createdAt)}</strong></div><div><span className="muted block">آخر تحديث</span><strong>{dateText(request.updatedAt)}</strong></div><div><span className="muted block">البريد</span><strong dir="ltr" className="inline-block">{request.customer?.email ?? '-'}</strong></div></div>
            <div><div className="orq-label">تفاصيل العميل</div><p className="orq-description">{request.description}</p></div>
            {request.customerMessage && <div><div className="orq-label">آخر ما طُلب من العميل</div><p className="orq-description">{request.customerMessage}</p></div>}
            <ChecklistEditor requestId={request.id} checklist={request.checklist} attachments={request.attachments} onChanged={refreshOffice} />
            <QuotePanel requestId={request.id} quote={request.quote} onChanged={refreshOffice} />
            {request.rating && <div className="text-sm"><span className="muted block text-xs">تقييم العميل</span><strong className="text-copper">{'★'.repeat(request.rating)}{'☆'.repeat(5 - request.rating)}</strong>{request.ratingComment && <p className="mt-1 whitespace-pre-wrap leading-7">«{request.ratingComment}»</p>}</div>}
          </div>}
          {tab === 'conversation' && <RequestConversation requestId={request.id} scope="office" whatsapp={thread?.whatsapp ?? null} />}
          {tab === 'files' && <div className="orq-request">
            <RequestFiles key={request.id} scope="office" requestId={request.id} attachments={request.attachments} checklist={request.checklist} canUpload onChanged={refreshOffice} onExtract={setExtracting} />
            {extracting && <ExtractReminder requestId={request.id} file={extracting} onClose={() => setExtracting(null)} />}
          </div>}
          {tab === 'invoices' && <OfficeInvoices requestId={request.id} onChanged={refreshOffice} employeesCount={request.employees?.length ?? 0} />}
          {tab === 'employees' && <RequestEmployees requestId={request.id} employees={request.employees ?? []} onChanged={refreshOffice} />}
        </section>
      </div>
    </div>
    <form className="orq-bar" aria-label="تحديث الطلب" onSubmit={e => { e.preventDefault(); void save(); }}>
      {drawer && <div className="orq-drawer">
        {status === 'waiting_on_customer' && <label className="form-field">ما يحتاجه المكتب من العميل<textarea className="form-control !min-h-24" value={customerMessage} onChange={e => { setCustomerMessage(e.target.value); setRejected(null); }} maxLength={2000} placeholder="وضّح للعميل ما يلزم لإكمال الطلب..." autoFocus /><small className="muted font-normal">تظهر هذه الرسالة للعميل في طلبه.</small></label>}
        <label className="form-field">ملاحظة المكتب الداخلية<textarea className="form-control !min-h-24" value={officeNote} onChange={e => setOfficeNote(e.target.value)} maxLength={2000} placeholder="ملاحظة داخلية للفريق..." /><small className="muted font-normal">داخلية ولا تُعرض للعميل.</small></label>
      </div>}
      <div className="orq-bar-row">
        {/* Only the moves allowed from the current status; the API refuses the rest. */}
        <label className="orq-field"><span>الحالة</span><select className="form-control" value={status} onChange={e => { setStatus(e.target.value as ServiceRequestUpdateStatus); setRejected(null); if (e.target.value === 'waiting_on_customer') setDrawer(true); }}>{statusChoices(request.status, status).map(s => <option value={s} key={s}>{statusNames[s]}</option>)}</select></label>
        <label className="orq-field"><span>المسؤول</span><select className="form-control" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}><option value="">غير مسند</option>{assignedTo && !members.data?.some(m => m.userId === assignedTo) && <option value={assignedTo}>عضو سابق</option>}{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
        <label className="orq-field"><span>موعد الإنجاز</span><input className="form-control" type="date" dir="ltr" value={due} onChange={e => setDue(e.target.value)} /></label>
        <button type="button" className="btn btn-outline" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>{drawer ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}تحديث{(officeNote.trim() || (status === 'waiting_on_customer' && customerMessage.trim())) && !drawer ? <span className="orq-dot" aria-label="يوجد نص" /> : null}</button>
        <button type="submit" className="btn btn-primary" disabled={blocked} title="حفظ (S)" data-loading={mutation.isPending || undefined}>{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}<Save size={16} aria-hidden="true" /></button>
      </div>
      <div className="orq-bar-foot">
        {notice}
        <span className="orq-keys" aria-label="اختصارات لوحة المفاتيح"><Keyboard size={13} aria-hidden="true" /><kbd>J</kbd> التالي <kbd>K</kbd> السابق <kbd>S</kbd> حفظ <kbd>Esc</kbd> إغلاق</span>
      </div>
    </form>
  </>;
}

export default OfficeRequestPage;
