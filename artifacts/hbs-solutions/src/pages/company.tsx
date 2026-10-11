import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, Mail, Phone, Search } from 'lucide-react';
import {
  getGetCompanyFileQueryKey, getGetOfficeCustomerFileQueryKey, getListOfficeCustomersQueryKey,
  useGetCompanyFile, useGetOfficeCustomerFile, useListOfficeCustomers,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, Status, dateText, useDebouncedValue } from '@/components/portal-ui';
import { CompanyFileView, customerCompanyApi, officeCompanyApi } from '@/components/company-file';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { SubjectChip } from '@/components/request-conversation';
import { formatCalendarDate, formatNumber } from '@/lib/format';

export function CompanyPage() {
  const qc = useQueryClient();
  const file = useGetCompanyFile({ query: { queryKey: getGetCompanyFileQueryKey() } });
  return <PortalLayout>
    <PageHeading eyebrow="منشأتي" title="ملف المنشأة" subtitle="بيانات المنشأة وموظفوها وتراخيصها في مكان واحد. يطّلع عليها المكتب ليخدمك أسرع، وتصلك تنبيهات قبل انتهاء أي وثيقة."/>
    {file.isLoading ? <LoadingBlock/> : file.isError ? <ErrorBlock retry={() => file.refetch()}/> : file.data &&
      <CompanyFileView file={file.data} api={customerCompanyApi} onChanged={() => qc.invalidateQueries({ queryKey: getGetCompanyFileQueryKey() })}/>}
  </PortalLayout>;
}

export function OfficeCustomers() {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const params = q ? { q } : {};
  const list = useListOfficeCustomers(params, { query: { queryKey: getListOfficeCustomersQueryKey(params) } });
  return <PortalLayout staff>
    <PageHeading eyebrow="العملاء" title="ملفات العملاء" subtitle="كل عميل في صفحة واحدة: المنشأة والموظفون والتراخيص والطلبات والوثائق التي تقترب من الانتهاء."/>
    <label className="relative mb-4 block max-w-xl"><span className="sr-only">بحث</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="اسم العميل أو المنشأة أو البريد أو الجوال" value={search} onChange={e => setSearch(e.target.value)} maxLength={120}/></label>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.length
      ? <EmptyBlock title={q ? 'لا يوجد عملاء مطابقون' : 'لا يوجد عملاء بعد'} text="يظهر هنا كل عميل وافق المكتب على تسجيله أو أرسل طلبًا."/>
      : <div className="surface overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line bg-paper text-right text-xs text-subtle"><th className="px-5 py-3 font-bold">العميل</th><th className="px-5 py-3 font-bold">المنشأة</th><th className="px-5 py-3 font-bold">موظفون</th><th className="px-5 py-3 font-bold">طلبات نشطة</th><th className="px-5 py-3 font-bold">وثائق تنتهي خلال 60 يومًا</th><th className="px-5 py-3 font-bold">آخر نشاط</th><th/></tr></thead>
        <tbody>{list.data.map(c => <tr key={c.userId} className="border-b border-line last:border-0 hover:bg-paper">
          <td className="px-5 py-3"><Link href={`/office/customers/${encodeURIComponent(c.userId)}`} className="font-bold text-inherit no-underline hover:underline">{c.customer?.fullName ?? 'عميل سابق للتسجيل'}</Link>{c.customer && <span className="block text-xs text-subtle" dir="ltr" style={{ textAlign: 'right' }}>{c.customer.email}</span>}</td>
          <td className="px-5 py-3">{c.companyName ?? <span className="text-subtle">-</span>}</td>
          <td className="nums px-5 py-3 text-right">{formatNumber(c.employees)}</td>
          <td className="nums px-5 py-3 text-right">{formatNumber(c.activeRequests)}</td>
          <td className={`nums px-5 py-3 text-right ${c.expiringSoon ? 'font-bold text-warn' : ''}`}>{formatNumber(c.expiringSoon)}</td>
          <td className="px-5 py-3 text-xs text-subtle">{dateText(c.lastActivityAt)}</td>
          <td className="px-3 py-3"><Link href={`/office/customers/${encodeURIComponent(c.userId)}`} className="rf-btn" aria-label={`فتح ملف ${c.customer?.fullName ?? c.userId}`}><ArrowLeft size={16}/></Link></td>
        </tr>)}</tbody></table></div>}
  </PortalLayout>;
}

const tabs = [['file', 'المنشأة والموظفون'], ['requests', 'الطلبات'], ['reminders', 'الوثائق والتنبيهات']] as const;

export function OfficeCustomerFilePage() {
  const { userId: raw } = useParams<{ userId: string }>();
  const userId = decodeURIComponent(raw ?? '');
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('file');
  const file = useGetOfficeCustomerFile(userId, { query: { queryKey: getGetOfficeCustomerFileQueryKey(userId), enabled: !!userId } });
  const refresh = () => qc.invalidateQueries({ queryKey: getGetOfficeCustomerFileQueryKey(userId) });
  const d = file.data;
  return <PortalLayout staff>
    <Link href="/office/customers" className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-bold text-subtle no-underline hover:text-ink"><ArrowRight size={16}/>ملفات العملاء</Link>
    {file.isLoading ? <LoadingBlock/> : file.error?.status === 404 ? <EmptyBlock title="العميل غير موجود" text="تحقق من الرابط أو ابحث في ملفات العملاء."/> : file.isError ? <ErrorBlock retry={() => file.refetch()}/> : d && <>
      <div className="surface mb-6 flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-sage text-teal"><Building2 size={26}/></span>
          <div><span className="eyebrow">ملف عميل</span><h1 className="display text-2xl font-semibold sm:text-3xl">{d.company?.name ?? d.customer?.fullName ?? 'عميل'}</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">{d.customer && <span>{d.customer.fullName}</span>}{d.customer && <span className="inline-flex items-center gap-1" dir="ltr"><Mail size={12}/>{d.customer.email}</span>}{d.contactPhone && <a className="inline-flex items-center gap-1 text-inherit" dir="ltr" href={`tel:${d.contactPhone}`}><Phone size={12}/>{d.contactPhone}</a>}</div></div></div>
        <div className="grid grid-cols-3 gap-3 text-center">{([['موظفون', d.employees.filter(e => e.status === 'active').length], ['تراخيص', d.licenses.length], ['طلبات نشطة', d.requests.filter(r => r.status !== 'completed').length]] as const).map(([label, value]) =>
          <div key={label} className="rounded-xl bg-paper px-4 py-2"><div className="display nums text-xl font-semibold">{formatNumber(value)}</div><div className="text-xs text-subtle">{label}</div></div>)}</div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)} className={`cf-chip ${tab === key ? 'is-on' : ''}`}>{label}</button>)}</div>
      {tab === 'file' && <CompanyFileView file={d} api={officeCompanyApi(userId)} office onChanged={refresh}/>}
      {tab === 'requests' && (d.requests.length ? <div className="surface overflow-hidden">{d.requests.map(r => <Link key={r.id} href={`/office/requests?q=${encodeURIComponent(r.reference)}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 text-inherit no-underline last:border-0 hover:bg-paper">
        <div className="min-w-0"><div className="font-bold">{r.service}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr">{r.reference}</span><span>{dateText(r.createdAt)}</span><SubjectChip subject={r.subject}/></div></div><Status value={r.status}/>
      </Link>)}</div> : <EmptyBlock title="لا توجد طلبات" text="لم يرسل هذا العميل طلبات بعد."/>)}
      {tab === 'reminders' && (d.reminders.length ? <div className="surface overflow-hidden">{d.reminders.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 last:border-0">
        <div><strong>{reminderKindNames[r.kind]}</strong> <span className="text-quiet">«{r.label}»</span><span className="block text-xs text-subtle">تنتهي في {formatCalendarDate(r.expiresOn)}{r.source !== 'manual' ? ' · من ملف المنشأة' : ''}</span></div><ExpiryBadge expiresOn={r.expiresOn}/>
      </div>)}</div> : <EmptyBlock title="لا توجد وثائق مؤرخة" text="أضف تواريخ انتهاء الموظفين والتراخيص لتظهر هنا."/>)}
    </>}
  </PortalLayout>;
}

