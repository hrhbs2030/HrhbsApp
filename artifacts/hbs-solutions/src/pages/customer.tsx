import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, CircleHelp, Link2, Plus, Send } from 'lucide-react';
import { getGetPortalSummaryQueryKey, getListServiceRequestsQueryKey, getListInquiriesQueryKey, getGetServiceRequestQueryKey, useGetPortalSummary, useListServiceRequests, useGetServiceRequest, useListInquiries, useCreateInquiry, type Inquiry } from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, RequestRow, Status, StatusTrack, dateText, categoryNames, statusNames } from '@/components/portal-ui';
import { CustomerAssistant } from '@/components/customer-assistant';
import { LOCALE } from '@/lib/format';

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

/** Full inquiry with the office answer; the linked request sits in the meta line. */
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

/** One-line inquiry for the dashboard; the full thread lives on /inquiries. */
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
    <div className="flex items-start gap-3 px-1"><CircleAlert className="mt-0.5 shrink-0 text-warn" size={20}/><div><h2 id="waiting-title" className="font-bold text-warn">{waiting.length === 1 ? 'طلب ينتظر إجراءً منك' : `${count(waiting.length)} طلبات تنتظر إجراءً منك`}</h2><p className="mt-1 text-sm leading-7 text-warn">افتح الطلب واستفسر من المكتب عمّا يلزم لإكماله.</p></div></div>
    <div className="mt-4 overflow-hidden rounded-xl border border-warn-line bg-field">{waiting.map(r => <RequestRow key={r.id} request={r}/>)}</div>
  </section>;
}

export function Dashboard() {
  const q = useGetPortalSummary({query:{queryKey:getGetPortalSummaryQueryKey(),refetchInterval:30000}});
  return <PortalLayout><PageHeading eyebrow="" title="نظرة عامة" action={<Link href="/requests/new" className="btn btn-primary"><Plus size={18}/>طلب خدمة جديد</Link>}/>
    <div className="space-y-8">
      <WaitingOnYou/>
      {q.isLoading ? <LoadingBlock/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : q.data && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{([['إجمالي الطلبات',q.data.totalRequests],['قيد المتابعة',q.data.activeRequests],['مكتملة',q.data.completedRequests],['استفسارات مفتوحة',q.data.openInquiries]] as const).map(([label,value],i) =>
          <div key={label} className={`surface p-4 sm:p-5 ${i===1?'!bg-teal !text-on-dark':''}`}><div className={`text-xs font-bold ${i===1?'text-on-dark-2':'text-subtle'}`}>{label}</div><div className="display nums mt-3 text-3xl font-semibold sm:mt-4 sm:text-4xl">{count(value)}</div></div>)}
        </div>
        <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <section className="min-w-0"><SectionTitle title="أحدث الطلبات" href={q.data.recentRequests.length ? '/requests' : undefined}/>{q.data.recentRequests.length ? <div className="surface overflow-hidden">{q.data.recentRequests.map(r => <RequestRow key={r.id} request={r}/>)}</div> : <EmptyBlock title="لا توجد طلبات بعد" text="أرسل طلبك الأول وتابع حالته من هنا." action="طلب خدمة جديد" href="/requests/new"/>}</section>
          <section className="min-w-0"><SectionTitle title="أحدث الاستفسارات" href="/inquiries"/>{q.data.recentInquiries.length ? <div className="surface overflow-hidden">{q.data.recentInquiries.map(i => <InquiryLine key={i.id} inquiry={i}/>)}</div> : <EmptyBlock title="لا توجد استفسارات" text="لديك سؤال عن معاملة؟ أرسله إلى المكتب." action="استفسار جديد" href="/inquiries"/>}</section>
        </div>
      </>}
    </div>
  </PortalLayout>;
}

const requestFilters = ['all', 'received', 'reviewing', 'waiting_on_customer', 'completed'] as const;
export function Requests() {
  const q = useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}}); const [filter,setFilter] = useState('all');
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
  const {id} = useParams<{id:string}>(); const parsed = Number(id); const justSent = new URLSearchParams(useSearch()).get('sent') === '1'; const q = useGetServiceRequest(parsed,{query:{enabled:Number.isInteger(parsed)&&parsed>0,queryKey:getGetServiceRequestQueryKey(parsed),refetchInterval:30000}});
  return <PortalLayout><div className="max-w-[860px]"><BackLink href="/requests">طلباتي</BackLink>
    {!Number.isInteger(parsed)||parsed<=0 ? <EmptyBlock title="الطلب غير متاح" text="تحقق من رابط الطلب وحاول مرة أخرى."/> : q.isLoading ? <LoadingBlock/> : q.error?.status === 404 ? <EmptyBlock title="الطلب غير متاح" text="هذا الطلب غير موجود في حسابك."/> : q.isError ? <ErrorBlock retry={() => q.refetch()}/> : q.data && <>
      {justSent && <div role="status" className="rise mb-6 flex items-start gap-3 rounded-2xl border border-sage-2 bg-ok-soft p-4 text-ok sm:p-5"><CircleCheck className="mt-0.5 shrink-0" size={22}/><div><strong className="block text-ink">تم إرسال طلبك إلى المكتب</strong><span className="text-sm leading-7">الرقم المرجعي <span dir="ltr" className="nums font-bold">{q.data.reference}</span>. تابع حالته من هذه الصفحة.</span></div></div>}
      <PageHeading eyebrow={`طلب رقم ${q.data.reference}`} title={q.data.service} action={<Link href={`/inquiries?request=${q.data.id}`} className="btn btn-outline"><CircleHelp size={17}/>استفسر عن الطلب</Link>}/>
      <div className="surface overflow-hidden">
        <section aria-label="مراحل الطلب" className="px-5 py-6 sm:px-8">
          <StatusTrack status={q.data.status} createdAt={q.data.createdAt} updatedAt={q.data.updatedAt}/>
          {q.data.status==='waiting_on_customer'&&<div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn"><span className="flex items-start gap-2 leading-7"><CircleAlert className="mt-1 shrink-0" size={16}/>استفسر من المكتب عمّا يلزم لإكمال الطلب.</span><Link href={`/inquiries?request=${q.data.id}`} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-warn underline sm:min-h-0">أرسل استفسارًا<ArrowLeft size={14}/></Link></div>}
        </section>
        <dl className="m-0 grid gap-x-8 gap-y-5 border-t border-line bg-paper px-5 py-6 sm:grid-cols-3 sm:px-8">
          <Info label="مجال الخدمة" value={categoryNames[q.data.category]}/><Info label="رقم التواصل" value={q.data.contactPhone} ltr/><Info label="آخر تحديث" value={dateText(q.data.updatedAt)}/>
        </dl>
        <div className="border-t border-line px-5 py-6 sm:px-8"><h2 className="mb-2 text-xs font-bold text-subtle">تفاصيل الطلب</h2><p className="whitespace-pre-wrap text-sm leading-8">{q.data.description}</p></div>
      </div>
    </>}
  </div></PortalLayout>;
}
function Info({label,value,ltr=false}:{label:string;value:string;ltr?:boolean}) { return <div className="min-w-0"><dt className="mb-1 text-xs font-bold text-subtle">{label}</dt><dd className="m-0 font-semibold" dir={ltr?'ltr':undefined} style={ltr?{textAlign:'right'}:undefined}>{value}</dd></div>; }

export function Inquiries() {
  const requestFromLink = Number(new URLSearchParams(useSearch()).get('request')) || null;
  const q=useListInquiries({query:{queryKey:getListInquiriesQueryKey(),refetchInterval:30000}}); const requests=useListServiceRequests({query:{queryKey:getListServiceRequestsQueryKey(),refetchInterval:30000}}); const qc=useQueryClient(); const mutation=useCreateInquiry(); const [subject,setSubject]=useState(''); const [message,setMessage]=useState(''); const [linkedServiceRequestId,setLinkedServiceRequestId]=useState(requestFromLink ? String(requestFromLink) : ''); const [showForm,setShowForm]=useState(Boolean(requestFromLink));
  async function submit(e:FormEvent) { e.preventDefault(); try { await mutation.mutateAsync({data:{subject:subject.trim(),message:message.trim(),linkedServiceRequestId:linkedServiceRequestId?Number(linkedServiceRequestId):null}}); setSubject('');setMessage('');setLinkedServiceRequestId('');setShowForm(false); await Promise.all([qc.invalidateQueries({queryKey:getListInquiriesQueryKey()}),qc.invalidateQueries({queryKey:getGetPortalSummaryQueryKey()})]); } catch { /* error shown */ } }
  function openForm() { setShowForm(true); requestAnimationFrame(() => document.getElementById('inquiry-subject')?.focus()); }
  return <PortalLayout><PageHeading eyebrow="" title="استفساراتي" action={!showForm && <button type="button" onClick={openForm} className="btn btn-primary"><Plus size={18}/>استفسار جديد</button>}/>
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
      <section aria-label="سجل الاستفسارات" className="min-w-0">{q.isLoading?<LoadingBlock/>:q.isError?<ErrorBlock retry={()=>q.refetch()}/>:!q.data?.length?<EmptyBlock title="لا توجد استفسارات بعد" text="يظهر هنا كل استفسار ترسله مع رد المكتب عليه." action="استفسار جديد" onAction={openForm}/>:<div className="surface overflow-hidden">{q.data.map(i=><InquiryItem key={i.id} inquiry={i}/>)}</div>}</section>
      <CustomerAssistant onAskOffice={openForm}/>
    </div>
  </PortalLayout>;
}
