import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Clock3, MessageSquareText, Save, Search } from 'lucide-react';
import {
  getGetOfficeSummaryQueryKey, getListOfficeServiceRequestsQueryKey, getListOfficeInquiriesQueryKey,
  useGetOfficeSummary, useListOfficeServiceRequests, useUpdateOfficeServiceRequest,
  useListOfficeInquiries, useAnswerOfficeInquiry,
  type InquiryStatus, type OfficeServiceRequestCategory, type OfficeServiceRequestStatus,
  type OfficeServiceRequest, type OfficeInquiry, type ServiceRequestUpdateStatus,
} from '@workspace/api-client-react';
import {
  PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, Pager, STALE_AFTER_DAYS, StaleBadge,
  Status, dateText, categoryNames, isStale, statusOptions, statusNames, useDebouncedValue,
} from '@/components/portal-ui';
import { LOCALE } from '@/lib/format';

const pageSize = 20;
type RequestSort = 'newest' | 'oldest_update';
const requestSorts: Record<RequestSort, string> = { newest: 'الأحدث إرسالًا', oldest_update: 'الأقدم تحديثًا' };
const count = (value: number) => new Intl.NumberFormat(LOCALE).format(value);

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
        {staleCount > 0 && <Link href="/office/requests?sort=oldest_update" className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-5 py-4 text-sm text-warn no-underline">
          <span className="flex items-center gap-2"><Clock3 size={17} className="shrink-0"/><span><strong className="nums">{count(staleCount)}</strong> {staleCount === 1 ? 'طلب نشط' : 'طلبات نشطة'} بلا تحديث منذ {count(STALE_AFTER_DAYS)} أيام أو أكثر</span></span>
          <span className="flex items-center gap-1 font-bold">عرض من الأقدم تحديثًا<ArrowLeft size={15}/></span>
        </Link>}
        <div className="grid gap-4 pt-4 md:grid-cols-2">
          <Link href="/office/requests" className="group surface flex items-start justify-between gap-4 p-7 text-inherit no-underline transition-transform hover:-translate-y-1"><div><ClipboardList className="mb-7 text-copper" size={26}/><h2 className="display text-xl font-semibold">طلبات العملاء</h2><p className="muted mt-2 text-sm leading-7">راجع المعاملات وحدّث حالتها وأضف ملاحظات المكتب الداخلية.</p></div><ArrowLeft className="shrink-0 text-subtle transition-transform group-hover:-translate-x-1"/></Link>
          <Link href="/office/inquiries" className="group surface flex items-start justify-between gap-4 p-7 text-inherit no-underline transition-transform hover:-translate-y-1"><div><MessageSquareText className="mb-7 text-copper" size={26}/><h2 className="display text-xl font-semibold">استفسارات العملاء</h2><p className="muted mt-2 text-sm leading-7">اطّلع على الأسئلة الواردة وأرسل الردود للعملاء.</p></div><ArrowLeft className="shrink-0 text-subtle transition-transform group-hover:-translate-x-1"/></Link>
        </div>
      </div>
    </>}
  </PortalLayout>;
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
  return <p className="mb-2 text-xs font-semibold text-subtle"><span className="nums">{count(total)}</span> نتيجة</p>;
}

export function OfficeRequests() {
  const initial = new URLSearchParams(useSearch());
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = useState<OfficeServiceRequestStatus | ''>(() =>
    (statusOptions as string[]).includes(initial.get('status') ?? '') ? initial.get('status') as OfficeServiceRequestStatus : '');
  const [category, setCategory] = useState<OfficeServiceRequestCategory | ''>('');
  const [sort, setSort] = useState<RequestSort>(initial.get('sort') === 'oldest_update' ? 'oldest_update' : 'newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setPage(1), [q, status, category, sort]);
  const params = {
    page, pageSize, ...(q ? { q } : {}), ...(status ? { status } : {}),
    ...(category ? { category } : {}), sort,
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
  const filtered = Boolean(q || status || category);

  return <PortalLayout staff>
    <PageHeading eyebrow="صندوق الوارد" title="طلبات العملاء" subtitle="ابحث بالرقم المرجعي أو الخدمة أو تفاصيل الطلب أو رقم التواصل، وحدّث الحالة بحسب تقدم كل طلب."/>
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,11rem)]">
      <label className="relative col-span-2 lg:col-span-1"><span className="sr-only">بحث</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="الرقم المرجعي، الخدمة، التفاصيل، رقم التواصل..." value={search} onChange={e => setSearch(e.target.value)} maxLength={120}/></label>
      <label><span className="sr-only">الحالة</span><select className="form-control" value={status} onChange={e => setStatus(e.target.value as OfficeServiceRequestStatus | '')}><option value="">كل الحالات</option>{statusOptions.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></label>
      <label><span className="sr-only">المجال</span><select className="form-control" value={category} onChange={e => setCategory(e.target.value as OfficeServiceRequestCategory | '')}><option value="">كل المجالات</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="col-span-2 lg:col-span-1"><span className="sr-only">الترتيب</span><select className="form-control" value={sort} onChange={e => setSort(e.target.value as RequestSort)}>{Object.entries(requestSorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.total && !filtered
      ? <EmptyBlock title="لا توجد طلبات واردة" text="ستظهر طلبات العملاء هنا عند إرسالها عبر البوابة."/>
       : <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
         <div className="min-w-0"><ResultCount total={list.data?.total ?? 0}/><div className={`surface overflow-hidden transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.length ? rows.map(r => <button type="button" aria-pressed={selected === r.id} key={r.id} onClick={() => setSelected(r.id)} className={`block w-full border-b border-line px-5 py-4 text-right transition-colors last:border-0 hover:bg-paper sm:px-6 ${selected === r.id ? 'bg-sage shadow-[inset_-3px_0_0_var(--color-teal)]' : ''}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-bold">{r.service}</div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr">{r.reference}</span><span>{categoryNames[r.category]}</span><span>{dateText(r.createdAt)}</span>{isStale(r) && <StaleBadge updatedAt={r.updatedAt}/>}</div></div><Status value={r.status}/></div>
        </button>) : <div className="p-10 text-center text-sm text-subtle">لا توجد نتائج مطابقة.</div>}</div><Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage}/></div>
         <div ref={editorRef} className="scroll-mt-24 xl:sticky xl:top-24">{active ? <RequestEditor key={active.id} request={active}/> : <div className="surface hidden min-h-64 flex-col items-center justify-center p-8 text-center text-subtle xl:flex"><ClipboardList className="mb-3" size={30} strokeWidth={1.5}/><p className="text-sm">اختر طلبًا من القائمة لعرض تفاصيله وتحديث حالته.</p></div>}</div>
      </div>}
  </PortalLayout>;
}

function RequestEditor({ request }: { request: OfficeServiceRequest }) {
  const qc = useQueryClient();
  const mutation = useUpdateOfficeServiceRequest();
  const [status, setStatus] = useState<ServiceRequestUpdateStatus>(request.status);
  const [officeNote, setOfficeNote] = useState(request.officeNote ?? '');
  const [customerMessage, setCustomerMessage] = useState(request.customerMessage ?? '');
  const [version, setVersion] = useState(request.updatedAt);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    setStatus(request.status);
    setOfficeNote(request.officeNote ?? '');
    setCustomerMessage(request.customerMessage ?? '');
    setVersion(request.updatedAt);
    setConflict(false);
    setSaved(false);
  }, [request.id]);
  const changedSinceOpened = request.updatedAt !== version;
  function reviewLatest() {
    setStatus(request.status);
    setOfficeNote(request.officeNote ?? '');
    setCustomerMessage(request.customerMessage ?? '');
    setVersion(request.updatedAt);
    setConflict(false);
    setSaved(false);
    mutation.reset();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (changedSinceOpened || conflict) return;
    setSaved(false);
    try {
      const updated = await mutation.mutateAsync({ id: request.id, data: {
        expectedUpdatedAt: version,
        status, officeNote: officeNote.trim() || null,
        customerMessage: status === 'waiting_on_customer' ? customerMessage.trim() : null,
      } });
      setVersion(updated.updatedAt);
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetOfficeSummaryQueryKey() }),
      ]);
      setSaved(true);
    } catch (error) {
      if ((error as { status?: number })?.status === 409) {
        setConflict(true);
        await qc.invalidateQueries({ queryKey: getListOfficeServiceRequestsQueryKey() });
      }
    }
  }
  return <div className="surface overflow-hidden">
    <div className="border-b border-line bg-sage p-5"><div className="flex items-start justify-between gap-3"><div><span className="text-xs font-bold text-subtle" dir="ltr">{request.reference}</span><h2 className="display mt-2 text-lg font-semibold">{request.service}</h2></div><Status value={request.status}/></div></div>
    <div className="space-y-5 p-5">
      {isStale(request) && <StaleBadge updatedAt={request.updatedAt}/>}
      <div className="grid grid-cols-2 gap-3 text-xs"><div><span className="muted block">المجال</span><strong>{categoryNames[request.category]}</strong></div><div><span className="muted block">تاريخ الإرسال</span><strong>{dateText(request.createdAt)}</strong></div><div className="col-span-2"><span className="muted block">رقم التواصل</span><strong dir="ltr" className="inline-block">{request.contactPhone}</strong></div></div>
      <div className="border-t border-line pt-4"><div className="mb-2 text-xs font-bold text-subtle">تفاصيل العميل</div><p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{request.description}</p></div>
      <form onSubmit={submit} className="space-y-4 border-t border-line pt-5">
        <label className="form-field">تحديث الحالة<select className="form-control" value={status} onChange={e => setStatus(e.target.value as ServiceRequestUpdateStatus)}>{statusOptions.map(s => <option value={s} key={s}>{statusNames[s]}</option>)}</select></label>
        {status === 'waiting_on_customer' && <label className="form-field">ما يحتاجه المكتب من العميل<textarea className="form-control !min-h-24" value={customerMessage} onChange={e => setCustomerMessage(e.target.value)} maxLength={2000} minLength={2} required placeholder="وضّح للعميل ما يلزم لإكمال الطلب..."/><small className="muted font-normal">تظهر هذه الرسالة للعميل في طلبه.</small></label>}
        <label className="form-field">ملاحظة المكتب الداخلية<textarea className="form-control !min-h-28" value={officeNote} onChange={e => setOfficeNote(e.target.value)} maxLength={2000} placeholder="ملاحظة داخلية للفريق..."/><small className="muted font-normal">هذه الملاحظة داخلية ولا تُعرض للعميل في البوابة.</small></label>
        {(conflict || changedSinceOpened) ? <div role="alert" className="text-xs text-danger">تغيّر هذا الطلب منذ فتحه. راجع النسخة الجديدة قبل الحفظ. <button type="button" className="underline" onClick={reviewLatest} disabled={request.updatedAt === version}>مراجعة النسخة الجديدة</button></div> : mutation.isError && <p role="alert" className="text-xs text-danger">تعذّر حفظ التحديث. حاول مجددًا.</p>}
        {saved && <p role="status" className="text-xs font-bold text-ok">تم حفظ التحديث.</p>}
        <button type="submit" disabled={mutation.isPending || conflict || changedSinceOpened} className="btn btn-primary w-full">{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ التحديث'}<Save size={16}/></button>
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
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center"><div className="flex gap-2" role="group" aria-label="تصفية حسب الحالة">{inquiryFilters.map(([key, label]) => <button type="button" key={label} onClick={() => setStatus(key)} aria-pressed={status === key} className={`min-h-11 flex-1 rounded-full border px-4 text-xs font-bold transition-colors lg:flex-none ${status === key ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>{label}</button>)}</div><label className="relative flex-1"><span className="sr-only">بحث في الاستفسارات</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="ابحث بالموضوع أو نص السؤال أو مرجع الطلب" value={search} onChange={e => setSearch(e.target.value)} maxLength={120}/></label></div>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0"><ResultCount total={list.data?.total ?? 0}/><div className={`surface overflow-hidden transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.length ? rows.map(i => <button type="button" aria-pressed={selected === i.id} key={i.id} onClick={() => setSelected(i.id)} className={`block w-full border-b border-line px-5 py-4 text-right transition-colors last:border-0 hover:bg-paper sm:px-6 ${selected === i.id ? '!bg-sage shadow-[inset_-3px_0_0_var(--color-teal)]' : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold">{i.subject}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span>{dateText(i.createdAt)}</span></div></div><Status value={i.status}/></div><p className="mt-2 line-clamp-2 text-xs leading-6 text-quiet">{i.message}</p></button>) : <div className="p-10 text-center text-sm text-subtle">{q || status ? 'لا توجد استفسارات مطابقة.' : 'لا توجد استفسارات بعد.'}</div>}</div><Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage}/></div>
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