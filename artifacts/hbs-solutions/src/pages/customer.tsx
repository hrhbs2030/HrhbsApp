import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Link2, MessagesSquare, Paperclip, Plus, Send } from 'lucide-react';
import { getGetPortalSummaryQueryKey, getListServiceRequestsQueryKey, getListInquiriesQueryKey, getGetServiceRequestQueryKey, getGetServiceRequestHistoryQueryKey, useGetServiceRequestHistory, useGetPortalSummary, useListServiceRequests, useGetServiceRequest, useListInquiries, useCreateInquiry, type Inquiry, type Reminder } from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, RequestRow, Status, StatusTrack, dateText, categoryNames, statusNames } from '@/components/portal-ui';
import { CustomerAssistant } from '@/components/customer-assistant';
import { PrintButton } from '@/components/brand/print';
import { LOCALE, daysUntil, formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { RequestConversation, SubjectChip, focusComposer } from '@/components/request-conversation';
import { RequestFiles } from '@/components/request-files';
import { CustomerInvoices, RatingPanel } from '@/components/request-billing';

const count = (value: number) => new Intl.NumberFormat(LOCALE).format(value);

function SectionTitle({ title, href }: { title: string; href?: string }) {
  return <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
    <h2 className="display text-lg font-semibold sm:text-xl">{title}</h2>
    {href && <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-copper no-underline">عرض الكل<ArrowLeft size={15}/></Link>}
  </div>;
}

function LinkedRequest({ reference }: { reference: string }) {
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-sunk px-2 py-0.5 text-xs text-quiet"><Link2 size={12} aria-hidden="true"/>الطلب <span dir="ltr" className="nums font-bold">{reference}</span></span>;
}

function InquiryItem({ inquiry }: { inquiry: Inquiry }) {
  return <article className="border-b border-line px-5 py-5 last:border-0 sm:px-6">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-bold leading-7">{inquiry.subject}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span>{dateText(inquiry.createdAt)}</span>{inquiry.linkedServiceRequestReference && <LinkedRequest reference={inquiry.linkedServiceRequestReference}/>}</div>
      </div>
      <Status value={inquiry.status}/>
    </div>
    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-quiet">{inquiry.message}</p>
    {inquiry.answer && <div className="mt-4 rounded-lg border-r-[3px] border-copper bg-copper-soft px-4 py-3">
      <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs font-bold text-copper"><span>رد المكتب</span><span className="font-normal">{dateText(inquiry.answeredAt)}</span></div>
      <p className="whitespace-pre-wrap text-sm leading-7">{inquiry.answer}</p>
    </div>}
  </article>;
}

function InquiryLine({ inquiry }: { inquiry: Inquiry }) {
  return <Link href="/inquiries" className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-inherit no-underline transition-colors last:border-0 hover:bg-paper sm:px-6">
    <div className="min-w-0">
      <div className="line-clamp-2 font-bold leading-7">{inquiry.subject}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span>{dateText(inquiry.createdAt)}</span>{inquiry.linkedServiceRequestReference && <LinkedRequest reference={inquiry.linkedServiceRequestReference}/>}</div>
    </div>
    <Status value={inquiry.status}/>
  </Link>;
}

function WaitingOnYou() {
  const q = useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}});
  const waiting = q.data?.filter(r => r.status === 'waiting_on_customer') ?? [];
  if (!waiting.length) return null;
  return <section aria-labelledby="waiting-title" className="rounded-2xl border border-warn-line bg-warn-soft p-4 sm:p-5">
    <div className="flex items-start gap-3 px-1"><CircleAlert className="mt-0.5 shrink-0 text-warn" size={20}/><div><h2 id="waiting-title" className="font-bold text-warn">{waiting.length === 1 ? 'طلب ينتظر إجراءً منك' : `${count(waiting.length)} طلبات تنتظر إجراءً منك`}</h2><p className="mt-1 text-sm leading-7 text-warn">{waiting.length === 1 && waiting[0].customerMessage ? <>المكتب يحتاج منك: <span className="break-words">{waiting[0].customerMessage}</span></> : 'افتح الطلب لترى ما يحتاجه المكتب لإكماله.'}</p></div></div>
    <div className="mt-4 overflow-hidden rounded-xl border border-warn-line bg-field">{waiting.map(r => <RequestRow key={r.id} request={r}/>)}</div>
  </section>;
}
// What needs the customer now comes first: requests waiting on them, unpaid
// invoices and documents about to expire; then the company and recent work.
export function Dashboard() {
  const q = useGetPortalSummary({query:{queryKey:getGetPortalSummaryQueryKey(),refetchInterval:30000}});
  const d = q.data;
  return <PortalLayout><PageHeading eyebrow="" title="نظرة عامة" action={<Link href="/requests/new" className="btn btn-primary"><Plus size={18}/>طلب خدمة جديد</Link>}/>
    <div className="space-y-8">
      <WaitingOnYou/>
      {q.isLoading ? <LoadingBlock/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : d && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile label="طلبات قيد المتابعة" value={count(d.activeRequests)} href="/requests" accent/>
          <Tile label="فواتير غير مسددة" value={d.unpaidInvoices ? formatMoney(d.unpaidTotal) : '0'} note={d.unpaidInvoices ? `${count(d.unpaidInvoices)} فاتورة` : 'لا يوجد ما يُسدد'} warn={d.unpaidInvoices > 0} href={d.unpaidInvoices ? '/requests?status=awaiting_payment' : undefined}/>
          <Tile label="وثائق تنتهي قريبًا" value={count(d.expiringSoon.filter(r => daysUntil(r.expiresOn) >= 0).length)} note="خلال 60 يومًا" warn={d.expiringSoon.some(r => daysUntil(r.expiresOn) <= 30)} href="/documents"/>
          <Tile label="طلبات مكتملة" value={count(d.completedRequests)} note={`من ${count(d.totalRequests)} طلبًا`}/>
        </div>
        <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-8">
            <section className="min-w-0"><SectionTitle title="أحدث الطلبات" href={d.recentRequests.length ? '/requests' : undefined}/>{d.recentRequests.length ? <div className="surface overflow-hidden">{d.recentRequests.map(r => <RequestRow key={r.id} request={r}/>)}</div> : <EmptyBlock title="لا توجد طلبات بعد" text="أرسل طلبك الأول وتابع حالته من هنا." action="طلب خدمة جديد" href="/requests/new"/>}</section>
            <section className="min-w-0"><SectionTitle title="أحدث الاستفسارات" href="/inquiries"/>{d.recentInquiries.length ? <div className="surface overflow-hidden">{d.recentInquiries.map(i => <InquiryLine key={i.id} inquiry={i}/>)}</div> : <EmptyBlock title="لا توجد استفسارات" text="لديك سؤال عن معاملة؟ أرسله إلى المكتب." action="استفسار جديد" href="/inquiries"/>}</section>
          </div>
          <div className="min-w-0 space-y-8">
            <section className="min-w-0"><SectionTitle title="منشأتي" href="/company"/>
              <Link href="/company" className="surface group flex items-center justify-between gap-4 p-5 text-inherit no-underline transition-colors hover:border-line-strong">
                {d.hasCompany ? <div className="grid flex-1 grid-cols-2 gap-3">
                  <div><div className="display nums text-3xl font-semibold">{count(d.employeesCount)}</div><div className="text-xs font-bold text-subtle">موظف على رأس العمل</div></div>
                  <div><div className="display nums text-3xl font-semibold">{count(d.licensesCount)}</div><div className="text-xs font-bold text-subtle">ترخيص وشهادة</div></div>
                </div> : <div><strong className="block">أكمل ملف منشأتك</strong><span className="mt-1 block text-sm leading-7 text-quiet">أضف بيانات المنشأة وموظفيها وتراخيصها لتصلك تنبيهات التجديد ويخدمك المكتب أسرع.</span></div>}
                <ArrowLeft size={18} className="shrink-0 text-subtle transition-transform group-hover:-translate-x-1"/>
              </Link></section>
            <section className="min-w-0"><SectionTitle title="تنتهي قريبًا" href={d.expiringSoon.length ? '/documents' : undefined}/>
              {d.expiringSoon.length ? <div className="surface overflow-hidden">{d.expiringSoon.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 last:border-0">
                <div className="min-w-0"><div className="font-bold">{reminderKindNames[r.kind]} <span className="font-normal text-quiet">«{r.label}»</span></div><div className="mt-0.5 text-xs text-subtle">{formatCalendarDate(r.expiresOn)}</div></div>
                <div className="flex items-center gap-2"><ExpiryBadge expiresOn={r.expiresOn}/>{daysUntil(r.expiresOn) <= 60 && <Link href={renewalLink(r)} className="text-xs font-bold text-copper no-underline hover:underline">طلب تجديد</Link>}</div>
              </div>)}</div> : <div className="surface p-5 text-sm leading-7 text-quiet">لا توجد وثائق تنتهي خلال 60 يومًا. <Link href="/documents" className="font-bold text-copper">أضف تواريخ وثائقك</Link> لتصلك التنبيهات.</div>}
            </section>
          </div>
        </div>
      </>}
    </div>
  </PortalLayout>;
}

function Tile({ label, value, note, href, accent = false, warn = false }: { label: string; value: string; note?: string; href?: string; accent?: boolean; warn?: boolean }) {
  const body = <><div className={`flex items-center justify-between gap-2 text-xs font-bold ${accent ? 'text-on-dark-2' : warn ? 'text-warn' : 'text-subtle'}`}>{label}{href && <ArrowLeft size={14} className="shrink-0"/>}</div>
    <div className="display nums mt-3 truncate text-2xl font-semibold sm:mt-4 sm:text-3xl">{value}</div>{note && <div className={`mt-1 text-xs ${accent ? 'text-on-dark-2' : 'text-subtle'}`}>{note}</div>}</>;
  const classes = `surface block min-w-0 p-4 text-inherit no-underline sm:p-5 ${accent ? '!bg-teal !text-on-dark' : warn ? '!border-warn-line !bg-warn-soft' : ''}`;
  return href ? <Link href={href} className={`${classes} transition-colors hover:border-line-strong`}>{body}</Link> : <div className={classes}>{body}</div>;
}

// Renewal request for a reminder: the matching service, linked to its employee or license.
function renewalLink(r: Reminder) {
  const service: Record<string, string> = { iqama: 'iqama-renewal', passport: 'passport-info-update', work_permit: 'work-permit' };
  const params = new URLSearchParams();
  if (service[r.kind]) params.set('service', service[r.kind]);
  else { params.set('category', r.kind === 'commercial_register' ? 'business' : 'other'); params.set('name', `تجديد ${reminderKindNames[r.kind]}`); }
  if (r.source !== 'manual' && r.sourceId) params.set(r.source, String(r.sourceId));
  return `/requests/new?${params}`;
}
const requestFilters = ['all', 'received', 'reviewing', 'waiting_on_customer', 'submitted_to_authority', 'awaiting_payment', 'completed'] as const;
export function Requests() {
  const initial = new URLSearchParams(useSearch()).get('status') ?? 'all';
  const q = useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}}); const [filter,setFilter] = useState((requestFilters as readonly string[]).includes(initial) ? initial : 'all');
  const filtered = q.data?.filter(r => filter === 'all' || r.status === filter) ?? [];
  const total = (key: string) => q.data?.filter(r => key === 'all' || r.status === key).length ?? 0;
  return <PortalLayout><PageHeading eyebrow="" title="طلباتي" action={<Link href="/requests/new" className="btn btn-primary"><Plus size={18}/>طلب خدمة جديد</Link>}/>
    {q.isLoading ? <LoadingBlock/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : !q.data?.length ? <EmptyBlock title="لا توجد طلبات بعد" text="أرسل طلبك الأول وتابع حالته من هنا." action="طلب خدمة جديد" href="/requests/new"/> : <>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="تصفية حسب الحالة">{requestFilters.map(key => <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter===key} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition-colors sm:min-h-9 ${filter===key?'border-teal bg-teal text-on-dark':'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>{key === 'all' ? 'الكل' : statusNames[key]}<span className={`nums ${filter===key?'text-on-dark-2':'text-subtle'}`}>{count(total(key))}</span></button>)}</div>
      {filtered.length ? <div className="surface overflow-hidden">{filtered.map(r => <RequestRow key={r.id} request={r}/>)}</div> : <EmptyBlock title="لا توجد طلبات بهذه الحالة" text="اختر حالة أخرى لعرض طلباتك."/>}
    </>}
  </PortalLayout>;
}
export { NewRequest } from './new-request';

function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-bold text-subtle no-underline hover:text-ink"><ArrowRight size={16}/>{children}</Link>;
}

export function RequestDetail() {
  const {id} = useParams<{id:string}>(); const parsed = Number(id); const search = new URLSearchParams(useSearch()); const justSent = search.get('sent') === '1'; const returnedInvoiceId = Number(search.get('invoice')) || null; const q = useGetServiceRequest(parsed,{query:{enabled:Number.isInteger(parsed)&&parsed>0,queryKey:getGetServiceRequestQueryKey(parsed),refetchInterval:30000}});
  // Arriving at /requests/:id#messages (from an email, say) lands in the composer.
  const open = !!q.data && q.data.status !== 'completed';
  useEffect(() => { if (open && window.location.hash === '#messages') requestAnimationFrame(() => focusComposer(parsed)); }, [open, parsed]);
  const scrollToDocuments = () => document.getElementById('documents')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <PortalLayout><div className="max-w-[860px]"><BackLink href="/requests">طلباتي</BackLink>
    {!Number.isInteger(parsed)||parsed<=0 ? <EmptyBlock title="الطلب غير متاح" text="تحقق من رابط الطلب وحاول مرة أخرى."/> : q.isLoading ? <LoadingBlock/> : q.error?.status === 404 ? <EmptyBlock title="الطلب غير متاح" text="هذا الطلب غير موجود في حسابك."/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : q.data && <>
      {justSent && <div role="status" className="rise mb-6 flex items-start gap-3 rounded-2xl border border-sage-2 bg-ok-soft p-4 text-ok sm:p-5"><CircleCheck className="mt-0.5 shrink-0" size={22}/><div><strong className="block text-ink">تم إرسال طلبك إلى المكتب</strong><span className="text-sm leading-7">الرقم المرجعي <span dir="ltr" className="nums font-bold">{q.data.reference}</span>. تابع حالته من هذه الصفحة.</span></div></div>}
      {/* One channel per request: the conversation below. Questions unrelated to a request go through the Inquiries page. */}
      <PageHeading eyebrow={`طلب رقم ${q.data.reference}`} title={q.data.service} action={<div className="flex flex-wrap gap-2"><PrintButton label="طباعة الطلب"/>{q.data.status !== 'completed' && <button type="button" className="btn btn-primary" onClick={() => focusComposer(q.data!.id)}><MessagesSquare size={17}/>ردّ على المكتب</button>}</div>}/>
      <div className="surface overflow-hidden">
        <section aria-label="مراحل الطلب" className="px-5 py-6 sm:px-8">
          <StatusTrack status={q.data.status} createdAt={q.data.createdAt} updatedAt={q.data.updatedAt}/>
          {q.data.status==='waiting_on_customer'&&<div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn"><span className="flex min-w-0 flex-1 items-start gap-2 leading-7"><CircleAlert className="mt-1 shrink-0" size={16}/>{q.data.customerMessage
            ? <span><strong className="block">المكتب يحتاج منك:</strong><span className="whitespace-pre-line break-words">{q.data.customerMessage}</span><span className="mt-1 block text-xs">أرفق المطلوب في «المستندات» أدناه، أو ردّ على المكتب في المحادثة.</span></span>
            : 'اسأل المكتب في المحادثة عمّا يلزم لإكمال الطلب.'}</span><span className="flex flex-wrap gap-2"><button type="button" className="btn btn-primary btn-sm" onClick={() => focusComposer(q.data!.id)}><MessagesSquare size={15}/>ردّ على المكتب</button><button type="button" className="btn btn-outline btn-sm !text-warn" onClick={scrollToDocuments}><Paperclip size={15}/>أرفق المستندات</button></span></div>}
          <StatusHistory id={q.data.id} updatedAt={q.data.updatedAt}/>
        </section>
        <dl className="m-0 grid gap-x-8 gap-y-5 border-t border-line bg-paper px-5 py-6 sm:grid-cols-3 sm:px-8">
          {q.data.subject && <div className="sm:col-span-3"><SubjectChip subject={q.data.subject}/></div>}
          <Info label="مجال الخدمة" value={categoryNames[q.data.category]}/><Info label="رقم التواصل" value={q.data.contactPhone} ltr/><Info label="آخر تحديث" value={dateText(q.data.updatedAt)}/>
        </dl>
        <div className="border-t border-line px-5 py-6 sm:px-8"><h2 className="mb-2 text-xs font-bold text-subtle">تفاصيل الطلب</h2><p className="whitespace-pre-wrap text-sm leading-8">{q.data.description}</p></div>
        <div id="documents" className="scroll-mt-24 border-t border-line px-5 py-6 sm:px-8"><RequestFiles scope="customer" requestId={q.data.id} attachments={q.data.attachments} canUpload={q.data.status !== 'completed'} onChanged={() => q.refetch()}/></div>
        <InvoicesSlot requestId={q.data.id} returnedInvoiceId={returnedInvoiceId}/>
        <div className="border-t border-line px-5 py-6 sm:px-8"><RequestConversation requestId={q.data.id} scope="customer" closed={q.data.status === 'completed'}/></div>
        {q.data.status === 'completed' && <div className="border-t border-line px-5 py-6 sm:px-8"><RatingPanel requestId={q.data.id} rating={q.data.rating} comment={q.data.ratingComment} onRated={() => q.refetch()}/></div>}
      </div>
    </>}
  </div></PortalLayout>;
}
// Invoices appear only when the office has issued one.
function InvoicesSlot({ requestId, returnedInvoiceId }: { requestId: number; returnedInvoiceId: number | null }) {
  return <div className="border-t border-line px-5 py-6 empty:hidden sm:px-8"><CustomerInvoices requestId={requestId} returnedInvoiceId={returnedInvoiceId}/></div>;
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

function Info({label,value,ltr=false}:{label:string;value:string;ltr?:boolean}) { return <div className="min-w-0"><dt className="mb-1 text-xs font-bold text-subtle">{label}</dt><dd className="m-0 font-semibold" dir={ltr?'ltr':undefined} style={ltr?{textAlign:'right'}:undefined}>{value}</dd></div>; }

// General questions. Anything about one request belongs in that request's
// conversation, so nothing pre-links a request here any more; the optional
// link stays for people who want the office to see a request's details.
export function Inquiries() {
  const q=useListInquiries({query:{queryKey:getListInquiriesQueryKey(),refetchInterval:30000}}); const requests=useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}}); const qc=useQueryClient(); const mutation=useCreateInquiry(); const [subject,setSubject]=useState(''); const [message,setMessage]=useState(''); const [linkedServiceRequestId,setLinkedServiceRequestId]=useState(''); const [showForm,setShowForm]=useState(false);
  async function submit(e:FormEvent) { e.preventDefault(); try { await mutation.mutateAsync({data:{subject:subject.trim(),message:message.trim(),linkedServiceRequestId:linkedServiceRequestId?Number(linkedServiceRequestId):null}}); setSubject('');setMessage('');setLinkedServiceRequestId('');setShowForm(false); await Promise.all([qc.invalidateQueries({queryKey:getListInquiriesQueryKey()}),qc.invalidateQueries({queryKey:getGetPortalSummaryQueryKey()})]); } catch { /* error shown */ } }
  function openForm() { setShowForm(true); requestAnimationFrame(() => document.getElementById('inquiry-subject')?.focus()); }
  return <PortalLayout><PageHeading eyebrow="تواصل مع المكتب" title="استفساراتي" action={!showForm && <button type="button" onClick={openForm} className="btn btn-primary"><Plus size={18}/>استفسار جديد</button>}/>
    {showForm && <form onSubmit={submit} className="surface mb-8 p-5 sm:p-7" aria-labelledby="inquiry-form-title">
      <h2 id="inquiry-form-title" className="display mb-5 text-lg font-semibold sm:text-xl">استفسار جديد</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="form-field">الموضوع<input id="inquiry-subject" className="form-control" placeholder="موضوع الاستفسار باختصار" value={subject} onChange={e=>setSubject(e.target.value)} minLength={3} maxLength={160} required/></label>
        <label className="form-field">الطلب المرتبط (اختياري)<select className="form-control" value={linkedServiceRequestId} onChange={e=>setLinkedServiceRequestId(e.target.value)}><option value="">بدون ربط</option>{requests.data?.map(r=><option key={r.id} value={r.id}>{r.reference} · {r.service}</option>)}</select><small className="muted font-normal">يطّلع المكتب على تفاصيل الطلب المرتبط ليجيبك بدقة.</small></label>
        <label className="form-field md:col-span-2">نص الاستفسار<textarea className="form-control" placeholder="اكتب سؤالك بالتفصيل" value={message} onChange={e=>setMessage(e.target.value)} minLength={10} maxLength={5000} required/><small className="muted font-normal">لا تشارك كلمات مرور المنصات أو رموز التحقق.</small></label>
      </div>
      {requests.isError&&<p role="alert" className="mt-4 text-sm text-danger">تعذّر تحميل طلباتك. أعد المحاولة قبل اختيار طلب للربط.</p>}
      {mutation.isError && <p role="alert" className="mt-4 text-sm text-danger">تعذّر إرسال الاستفسار. حاول مجددًا.</p>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5"><button type="button" onClick={()=>setShowForm(false)} className="btn btn-outline" disabled={mutation.isPending}>إلغاء</button><button disabled={mutation.isPending} type="submit" className="btn btn-primary">{mutation.isPending?'جارٍ الإرسال…':'إرسال الاستفسار'}<Send size={16}/></button></div>
    </form>}
    <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-labelledby="inquiries-list-title" className="min-w-0"><h2 id="inquiries-list-title" className="sr-only">سجل الاستفسارات</h2>{q.isLoading?<LoadingBlock/>:q.isError?<ErrorBlock retry={()=>q.refetch()}/>:!q.data?.length?<EmptyBlock title="لا توجد استفسارات بعد" text="يظهر هنا كل استفسار ترسله مع رد المكتب عليه." action="استفسار جديد" onAction={openForm}/>:<div className="surface overflow-hidden">{q.data.map(i=><InquiryItem key={i.id} inquiry={i}/>)}</div>}</section>
      <CustomerAssistant onAskOffice={openForm}/>
    </div>
  </PortalLayout>;
}