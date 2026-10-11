import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  getGetOfficeReportQueryKey, getListOfficeRemindersQueryKey, getListOfficeServiceOffersQueryKey,
  useGetOfficeReport, useListOfficeReminders, useListOfficeServiceOffers, useSaveOfficeServiceOffer,
  type GetOfficeReportDays, type ServiceOffer,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, categoryNames, statusNames } from '@/components/portal-ui';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { categories, services, type Service } from '@/content/services';
import { formatCalendarDate, formatMoney, formatNumber } from '@/lib/format';

// ---- documents expiring soon -------------------------------------------------

const windows = [30, 60, 90] as const;
export function OfficeReminders() {
  const [within, setWithin] = useState<number>(60);
  const params = { withinDays: within };
  const list = useListOfficeReminders(params, { query: { queryKey: getListOfficeRemindersQueryKey(params), refetchInterval: 300_000 } });
  return <PortalLayout staff>
    <PageHeading eyebrow="فرص تجديد" title="وثائق العملاء التي تنتهي قريبًا" subtitle="وثائق أضافها العملاء أو المكتب. يصل للعميل تنبيه بالبريد قبل الانتهاء بـ30 يومًا ثم 7 ثم يوم واحد، ويمكنك التواصل معه لعرض التجديد."/>
    <div className="mb-4 flex gap-2" role="group" aria-label="المدة">{windows.map(days => <button key={days} type="button" aria-pressed={within === days} onClick={() => setWithin(days)} className={`min-h-11 rounded-full border px-4 text-xs font-bold ${within === days ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>خلال {formatNumber(days)} يومًا</button>)}</div>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.length
      ? <EmptyBlock title="لا توجد وثائق تنتهي في هذه المدة" text="عند إضافة العملاء تواريخ انتهاء وثائقهم تظهر هنا مرتبة بالأقرب."/>
      : <div className="surface overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-line bg-paper text-right text-xs text-subtle"><th className="px-5 py-3 font-bold">الوثيقة</th><th className="px-5 py-3 font-bold">العميل</th><th className="px-5 py-3 font-bold">التواصل</th><th className="px-5 py-3 font-bold">تنتهي في</th></tr></thead>
        <tbody>{list.data.map(item => <tr key={item.id} className="border-b border-line last:border-0">
          <td className="px-5 py-3"><strong>{reminderKindNames[item.kind]}</strong><span className="block text-xs text-subtle">«{item.label}»{item.addedBy === 'office' ? ' · أضافها المكتب' : ''}</span></td>
          <td className="px-5 py-3">{item.customer ? <>{item.customer.fullName}<span className="block text-xs text-subtle" dir="ltr" style={{ textAlign: 'right' }}>{item.customer.email}</span></> : <span className="text-subtle">عميل سابق للتسجيل</span>}</td>
          <td className="px-5 py-3" dir="ltr" style={{ textAlign: 'right' }}>{item.contactPhone ? <a href={`tel:${item.contactPhone}`}>{item.contactPhone}</a> : '-'}</td>
          <td className="px-5 py-3"><span className="block">{formatCalendarDate(item.expiresOn)}</span><ExpiryBadge expiresOn={item.expiresOn}/></td>
        </tr>)}</tbody>
      </table></div>}
  </PortalLayout>;
}

// ---- prices and requirements -------------------------------------------------

function OfferEditor({ service, offer, onSaved }: { service: Service; offer: ServiceOffer | undefined; onSaved: () => void }) {
  const save = useSaveOfficeServiceOffer();
  const [price, setPrice] = useState('');
  const [days, setDays] = useState('');
  const [fees, setFees] = useState('');
  const [documents, setDocuments] = useState('');
  const [published, setPublished] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setPrice(offer?.price != null ? String(offer.price / 100) : '');
    setDays(offer?.processingDays != null ? String(offer.processingDays) : '');
    setFees(offer?.governmentFeesNote ?? '');
    setDocuments(offer?.requiredDocuments.join('\n') ?? '');
    setPublished(offer?.published ?? false);
    setSaved(false);
  }, [service.slug, offer?.updatedAt]);
  const halalas = price.trim() ? Math.round(Number(price.replace(/[^\d.]/g, '')) * 100) : null;
  const dayCount = days.trim() ? Number(days) : null;
  const docs = documents.split('\n').map(d => d.trim()).filter(d => d.length >= 2);
  const invalid = (halalas !== null && !Number.isFinite(halalas)) || (dayCount !== null && !(Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 365)) || docs.length > 15;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSaved(false);
    try {
      await save.mutateAsync({ slug: service.slug, data: { price: halalas, processingDays: dayCount, governmentFeesNote: fees.trim() || null, requiredDocuments: docs, published } });
      setSaved(true); onSaved();
    } catch { /* shown below */ }
  }
  return <form onSubmit={submit} className="surface space-y-4 p-5">
    <div><span className="text-xs font-bold text-subtle">{categoryNames[service.category]}</span><h2 className="display mt-1 text-lg font-semibold">{service.name}</h2></div>
    <div className="grid grid-cols-2 gap-3">
      <label className="form-field">أتعاب المكتب قبل الضريبة (ر.س)<input className="form-control" dir="ltr" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="بعد المراجعة"/></label>
      <label className="form-field">مدة الإنجاز (أيام عمل)<input className="form-control" dir="ltr" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} placeholder="-"/></label>
    </div>
    <label className="form-field">الرسوم الحكومية (وصف)<input className="form-control" value={fees} onChange={e => setFees(e.target.value)} maxLength={300} placeholder="مثال: حسب مدة التجديد، تُدفع لمنصة أبشر"/></label>
    <label className="form-field">المستندات المطلوبة (مستند في كل سطر)<textarea className="form-control !min-h-28" value={documents} onChange={e => setDocuments(e.target.value)} placeholder={'صورة الإقامة الحالية\nصورة جواز السفر'}/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)}/>نشر في دليل الخدمات وصفحة الطلب الجديد</label>
    <p className="muted text-xs leading-6">لا يظهر للعملاء إلا ما تنشره هنا. الحقل الفارغ لا يُعرض.</p>
    {invalid && <p role="alert" className="text-xs text-danger">تحقق من المبلغ ومدة الإنجاز (1-365) وعدد المستندات (15 كحد أقصى).</p>}
    {save.isError && <p role="alert" className="text-xs text-danger">تعذّر الحفظ. حاول مجددًا.</p>}
    {saved && <p role="status" className="text-xs font-bold text-ok">تم الحفظ{published ? ' والنشر' : ''}.</p>}
    <button type="submit" className="btn btn-primary w-full" disabled={save.isPending || invalid}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</button>
  </form>;
}

export function OfficeCatalog() {
  const qc = useQueryClient();
  const offers = useListOfficeServiceOffers({ query: { queryKey: getListOfficeServiceOffersQueryKey() } });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>(services[0]?.slug ?? '');
  const bySlug = useMemo(() => new Map((offers.data ?? []).map(o => [o.slug, o])), [offers.data]);
  const shown = services.filter(s => !search.trim() || s.name.includes(search.trim()));
  const active = services.find(s => s.slug === selected);
  return <PortalLayout staff>
    <PageHeading eyebrow="دليل الخدمات" title="الأسعار والمتطلبات" subtitle="حدّد أتعاب كل خدمة ومدتها ومستنداتها، وانشرها ليراها العميل قبل إرسال طلبه."/>
    {offers.isLoading ? <LoadingBlock/> : offers.isError ? <ErrorBlock retry={() => offers.refetch()}/> : <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <label className="relative mb-3 block"><span className="sr-only">بحث</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="ابحث باسم الخدمة" value={search} onChange={e => setSearch(e.target.value)}/></label>
        {categories.map(category => {
          const items = shown.filter(s => s.category === category.id);
          if (!items.length) return null;
          return <section key={category.id} className="mb-5"><h2 className="mb-2 text-xs font-bold text-subtle">{category.name}</h2><div className="surface overflow-hidden">{items.map(s => {
            const offer = bySlug.get(s.slug);
            return <button key={s.slug} type="button" aria-pressed={selected === s.slug} onClick={() => setSelected(s.slug)} className={`flex w-full items-center justify-between gap-3 border-b border-line px-5 py-3 text-right last:border-0 hover:bg-paper ${selected === s.slug ? 'bg-sage' : ''}`}>
              <span className="font-semibold">{s.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-subtle">{offer?.price != null && <span>{formatMoney(offer.price)}</span>}<span className={`pill ${offer?.published ? 'pill-completed' : 'pill-cancelled'}`}>{offer?.published ? 'منشور' : offer ? 'مسودة' : 'غير محدد'}</span></span>
            </button>;
          })}</div></section>;
        })}
      </div>
      <div className="xl:sticky xl:top-24">{active && <OfferEditor service={active} offer={bySlug.get(active.slug)} onSaved={() => qc.invalidateQueries({ queryKey: getListOfficeServiceOffersQueryKey() })}/>}</div>
    </div>}
  </PortalLayout>;
}

// ---- reports ---------------------------------------------------------------------

const periods: [GetOfficeReportDays, string][] = [[7, '7 أيام'], [30, '30 يومًا'], [90, '90 يومًا'], [365, 'سنة']];

// Labelled rows with a proportional bar; the number is always written, so
// the bar only helps comparison and nothing depends on colour.
function BarRows({ rows, label }: { rows: { key: string; label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (!rows.length) return <p className="muted text-sm">لا توجد بيانات في هذه المدة.</p>;
  return <table className="w-full text-sm" aria-label={label}><tbody>{rows.map(row => <tr key={row.key} className="align-middle">
    <th scope="row" className="w-[42%] py-1.5 pl-3 text-right font-semibold">{row.label}</th>
    <td className="py-1.5"><div className="flex items-center gap-2"><span className="block h-2.5 rounded-sm bg-teal" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} aria-hidden="true"/><span className="nums text-xs font-bold">{formatNumber(row.value)}</span></div></td>
  </tr>)}</tbody></table>;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="surface p-4 sm:p-5"><div className="text-xs font-bold text-subtle">{label}</div><div className="display nums mt-3 text-2xl font-semibold sm:text-3xl">{value}</div>{note && <div className="mt-1 text-xs text-subtle">{note}</div>}</div>;
}

export function OfficeReports() {
  const [days, setDays] = useState<GetOfficeReportDays>(30);
  const params = { days };
  const report = useGetOfficeReport(params, { query: { queryKey: getGetOfficeReportQueryKey(params) } });
  const r = report.data;
  return <PortalLayout staff>
    <PageHeading eyebrow="الأداء" title="التقارير" subtitle="أرقام المكتب في المدة المختارة: الطلبات والإنجاز والفريق ورضا العملاء والإيرادات."/>
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="المدة">{periods.map(([value, name]) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={`min-h-11 rounded-full border px-4 text-xs font-bold ${days === value ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>آخر {name}</button>)}</div>
    {report.isLoading ? <LoadingBlock/> : report.isError ? <ErrorBlock retry={() => report.refetch()}/> : r && <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="طلبات جديدة" value={formatNumber(r.created)}/>
        <Tile label="طلبات أُنجزت" value={formatNumber(r.completed)} note={r.averageCompletionDays != null ? `متوسط الإنجاز ${formatNumber(r.averageCompletionDays)} يوم` : undefined}/>
        <Tile label="رضا العملاء" value={r.ratings.average != null ? `${formatNumber(r.ratings.average)} / 5` : '-'} note={`${formatNumber(r.ratings.count)} تقييم`}/>
        <Tile label="المحصّل شامل الضريبة" value={formatMoney(r.revenue.paidTotal)} note={`منها ضريبة ${formatMoney(r.revenue.paidVat)} · ${formatNumber(r.revenue.paidCount)} فاتورة`}/>
      </div>
      {r.revenue.outstandingCount > 0 && <p className="rounded-xl border border-warn-line bg-warn-soft px-5 py-4 text-sm text-warn">فواتير غير مسددة: {formatNumber(r.revenue.outstandingCount)} بإجمالي {formatMoney(r.revenue.outstandingTotal)}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="surface p-5"><h2 className="display mb-3 text-lg font-semibold">الطلبات الحالية حسب الحالة</h2>
          <BarRows label="الطلبات حسب الحالة" rows={r.byStatus.map(row => ({ key: row.key, label: statusNames[row.key] ?? row.key, value: row.count }))}/></section>
        <section className="surface p-5"><h2 className="display mb-3 text-lg font-semibold">الطلبات الجديدة حسب المجال</h2>
          <BarRows label="الطلبات حسب المجال" rows={r.byCategory.map(row => ({ key: row.key, label: categoryNames[row.key] ?? row.key, value: row.count }))}/></section>
      </div>
      <section className="surface overflow-x-auto p-5"><h2 className="display mb-3 text-lg font-semibold">أكثر الخدمات طلبًا</h2>
        {r.topServices.length ? <table className="w-full min-w-[480px] text-sm"><thead><tr className="text-right text-xs text-subtle"><th className="py-2 font-bold">الخدمة</th><th className="py-2 font-bold">طلبات</th><th className="py-2 font-bold">مكتملة منها</th></tr></thead>
          <tbody>{r.topServices.map(s => <tr key={s.service} className="border-t border-line"><td className="py-2">{s.service}</td><td className="nums py-2">{formatNumber(s.created)}</td><td className="nums py-2">{formatNumber(s.completed)}</td></tr>)}</tbody></table>
          : <p className="muted text-sm">لا توجد طلبات في هذه المدة.</p>}</section>
      <section className="surface overflow-x-auto p-5"><h2 className="display mb-3 text-lg font-semibold">الفريق</h2>
        {r.staff.length ? <table className="w-full min-w-[480px] text-sm"><thead><tr className="text-right text-xs text-subtle"><th className="py-2 font-bold">المسؤول</th><th className="py-2 font-bold">نشطة الآن</th><th className="py-2 font-bold">أُنجزت في المدة</th><th className="py-2 font-bold">متأخرة</th></tr></thead>
          <tbody>{r.staff.map(s => <tr key={s.userId ?? 'none'} className="border-t border-line"><td className="py-2" dir={s.email ? 'ltr' : undefined} style={{ textAlign: 'right' }}>{s.userId ? s.email ?? 'عضو سابق' : 'غير مسندة'}</td><td className="nums py-2">{formatNumber(s.active)}</td><td className="nums py-2">{formatNumber(s.completed)}</td><td className={`nums py-2 ${s.overdue ? 'font-bold text-danger' : ''}`}>{formatNumber(s.overdue)}</td></tr>)}</tbody></table>
          : <p className="muted text-sm">لا توجد طلبات مسندة بعد.</p>}</section>
      <section className="surface p-5"><h2 className="display mb-3 text-lg font-semibold">توزيع التقييمات</h2>
        <BarRows label="توزيع التقييمات" rows={r.ratings.distribution.map(d => ({ key: d.key, label: `${'★'.repeat(Number(d.key))}`, value: d.count }))}/></section>
    </div>}
  </PortalLayout>;
}
