import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  getGetOfficeReportQueryKey, getListOfficeRemindersQueryKey, getListOfficeServiceOffersQueryKey,
  useGetOfficeReport, useListOfficeReminders, useListOfficeServiceOffers, useSaveOfficeServiceOffer,
  getListAssignmentRulesQueryKey, getListOfficeAssigneesQueryKey, saveAssignmentRule, useListAssignmentRules, useListOfficeAssignees,
  type AssignmentRule,
  type GetOfficeReportDays, type ServiceOffer,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, categoryNames, statusNames } from '@/components/portal-ui';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { ExportButtons } from '@/components/excel-import';
import type { ExportColumn } from '@/lib/export';
import { categories, services, type Service } from '@/content/services';
import { formatCalendarDate, formatMoney, formatNumber, parseRiyals } from '@/lib/format';

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
  const halalas = price.trim() ? parseRiyals(price) : null;
  const dayCount = days.trim() ? Number(days) : null;
  const docs = documents.split('\n').map(d => d.trim()).filter(d => d.length >= 2);
  const invalid = (price.trim() !== '' && halalas === null) || (dayCount !== null && !(Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 365)) || docs.length > 15;
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

// New requests in each category go to a chosen member with a due date,
// without anyone opening them first. Changes are audited.
function AssignmentRules() {
  const qc = useQueryClient();
  const rules = useListAssignmentRules({ query: { queryKey: getListAssignmentRulesQueryKey() } });
  const members = useListOfficeAssignees({ query: { queryKey: getListOfficeAssigneesQueryKey() } });
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function save(rule: AssignmentRule, change: Partial<AssignmentRule>) {
    setSaving(rule.category); setMessage(null);
    try {
      await saveAssignmentRule(rule.category, { assignee: change.assignee !== undefined ? change.assignee : rule.assignee, dueDays: change.dueDays !== undefined ? change.dueDays : rule.dueDays });
      await qc.invalidateQueries({ queryKey: getListAssignmentRulesQueryKey() });
      setMessage('تم الحفظ. يُطبّق على الطلبات الجديدة.');
    } catch { setMessage('تعذّر الحفظ.'); } finally { setSaving(null); }
  }
  if (!rules.data) return null;
  return <section className="surface mb-6 overflow-hidden" aria-labelledby="auto-title">
    <div className="border-b border-line bg-paper px-5 py-4"><h2 id="auto-title" className="display text-lg font-semibold">توزيع الطلبات الجديدة تلقائيًا</h2>
      <p className="muted mt-1 text-xs leading-6">يُسند كل طلب جديد فور وصوله إلى المسؤول المختار لمجاله، ويُحدّد موعد إنجازه، ويصل للمسؤول بريد. ويعود الطلب تلقائيًا إلى «قيد المراجعة» عندما يرد العميل أو تُسدد فاتورته.</p></div>
    <div className="divide-y divide-line">{rules.data.map(rule => <div key={rule.category} className="grid items-end gap-3 px-5 py-3 sm:grid-cols-[1fr_14rem_9rem]">
      <strong className="text-sm">{categoryNames[rule.category]}</strong>
      <label className="form-field text-xs">المسؤول<select className="form-control" value={rule.assignee ?? ''} disabled={saving === rule.category} onChange={e => save(rule, { assignee: e.target.value || null })}>
        <option value="">بلا إسناد تلقائي</option>{members.data?.map(m => <option key={m.userId} value={m.userId}>{m.email ?? m.userId}</option>)}</select></label>
      <label className="form-field text-xs">أيام الإنجاز<select className="form-control" value={rule.dueDays ?? ''} disabled={saving === rule.category} onChange={e => save(rule, { dueDays: e.target.value ? Number(e.target.value) : null })}>
        <option value="">بلا موعد</option>{[1, 2, 3, 5, 7, 10, 14, 21, 30].map(d => <option key={d} value={d}>{formatNumber(d)}</option>)}</select></label>
    </div>)}</div>
    {message && <p role="status" className="px-5 pb-3 text-xs font-bold text-ok">{message}</p>}
  </section>;
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
    <PageHeading eyebrow="دليل الخدمات والأتمتة" title="الأسعار والمتطلبات" subtitle="وزّع الطلبات الجديدة تلقائيًا، وحدّد أتعاب كل خدمة ومدتها ومستنداتها وانشرها ليراها العميل قبل إرسال طلبه."/>
    <AssignmentRules/>
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

// A report section's heading with its own Excel / print buttons; each table
// goes out on its own, with the period in the file name.
const countColumns: ExportColumn[] = [{ key: 'label', label: 'البند' }, { key: 'value', label: 'العدد', type: 'number' }];
function ReportHead({ title, name, columns, rows }: { title: string; name: string; columns: ExportColumn[]; rows: object[] }) {
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="display text-lg font-semibold">{title}</h2>{rows.length > 0 && <ExportButtons compact name={name} columns={columns} rows={() => rows}/>}</div>;
}

function Tile({ label, value, note, long = false }: { label: string; value: string; note?: string; long?: boolean }) {
  return <div className="surface min-w-0 p-4 sm:p-5"><div className="text-xs font-bold text-subtle">{label}</div><div className={`display nums mt-3 break-words font-semibold ${long ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}`}>{value}</div>{note && <div className="mt-1 text-xs text-subtle">{note}</div>}</div>;
}

export function OfficeReports() {
  const [days, setDays] = useState<GetOfficeReportDays>(30);
  const params = { days };
  const report = useGetOfficeReport(params, { query: { queryKey: getGetOfficeReportQueryKey(params) } });
  const r = report.data;
  const period = periods.find(([value]) => value === days)?.[1] ?? '';
  const byStatus = (r?.byStatus ?? []).map(row => ({ key: row.key, label: statusNames[row.key] ?? row.key, value: row.count }));
  const byCategory = (r?.byCategory ?? []).map(row => ({ key: row.key, label: categoryNames[row.key] ?? row.key, value: row.count }));
  const ratingRows = (r?.ratings.distribution ?? []).map(d => ({ key: d.key, label: `${'★'.repeat(Number(d.key))}`, value: d.count }));
  const staffRows = (r?.staff ?? []).map(s => ({ member: s.userId ? s.email ?? 'عضو سابق' : 'غير مسندة', active: s.active, completed: s.completed, overdue: s.overdue }));
  return <PortalLayout staff>
    <PageHeading eyebrow="الأداء" title="التقارير" subtitle="أرقام المكتب في المدة المختارة: الطلبات والإنجاز والفريق ورضا العملاء والإيرادات."/>
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="المدة">{periods.map(([value, name]) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={`min-h-11 rounded-full border px-4 text-xs font-bold ${days === value ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>آخر {name}</button>)}</div>
    {report.isLoading ? <LoadingBlock/> : report.isError ? <ErrorBlock retry={() => report.refetch()}/> : r && <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="طلبات جديدة" value={formatNumber(r.created)}/>
        <Tile label="طلبات أُنجزت" value={formatNumber(r.completed)} note={r.averageCompletionDays != null ? `متوسط الإنجاز ${formatNumber(r.averageCompletionDays)} يوم` : undefined}/>
        <Tile label="رضا العملاء" value={r.ratings.average != null ? `${formatNumber(r.ratings.average)} من 5` : '-'} note={`${formatNumber(r.ratings.count)} تقييم`}/>
        <Tile long label="المحصّل شامل الضريبة" value={formatMoney(r.revenue.paidTotal)} note={`منها ضريبة ${formatMoney(r.revenue.paidVat)} · ${formatNumber(r.revenue.paidCount)} فاتورة`}/>
      </div>
      {r.revenue.outstandingCount > 0 && <p className="rounded-xl border border-warn-line bg-warn-soft px-5 py-4 text-sm text-warn">فواتير غير مسددة: {formatNumber(r.revenue.outstandingCount)} بإجمالي {formatMoney(r.revenue.outstandingTotal)}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="surface p-5"><ReportHead title="الطلبات الحالية حسب الحالة" name={`الطلبات حسب الحالة - آخر ${period}`} columns={countColumns} rows={byStatus}/>
          <BarRows label="الطلبات حسب الحالة" rows={byStatus}/></section>
        <section className="surface p-5"><ReportHead title="الطلبات الجديدة حسب المجال" name={`الطلبات حسب المجال - آخر ${period}`} columns={countColumns} rows={byCategory}/>
          <BarRows label="الطلبات حسب المجال" rows={byCategory}/></section>
      </div>
      <section className="surface overflow-x-auto p-5"><ReportHead title="أكثر الخدمات طلبًا" name={`أكثر الخدمات طلبًا - آخر ${period}`} columns={[{ key: 'service', label: 'الخدمة' }, { key: 'created', label: 'طلبات', type: 'number' }, { key: 'completed', label: 'مكتملة منها', type: 'number' }]} rows={r.topServices}/>
        {r.topServices.length ? <table className="w-full min-w-[480px] text-sm"><thead><tr className="text-right text-xs text-subtle"><th className="py-2 font-bold">الخدمة</th><th className="py-2 font-bold">طلبات</th><th className="py-2 font-bold">مكتملة منها</th></tr></thead>
          <tbody>{r.topServices.map(s => <tr key={s.service} className="border-t border-line"><td className="py-2">{s.service}</td><td className="nums py-2 text-right">{formatNumber(s.created)}</td><td className="nums py-2 text-right">{formatNumber(s.completed)}</td></tr>)}</tbody></table>
          : <p className="muted text-sm">لا توجد طلبات في هذه المدة.</p>}</section>
      <section className="surface overflow-x-auto p-5"><ReportHead title="الفريق" name={`الفريق - آخر ${period}`} columns={[{ key: 'member', label: 'المسؤول' }, { key: 'active', label: 'نشطة الآن', type: 'number' }, { key: 'completed', label: 'أُنجزت في المدة', type: 'number' }, { key: 'overdue', label: 'متأخرة', type: 'number' }]} rows={staffRows}/>
        {r.staff.length ? <table className="w-full min-w-[480px] text-sm"><thead><tr className="text-right text-xs text-subtle"><th className="py-2 font-bold">المسؤول</th><th className="py-2 font-bold">نشطة الآن</th><th className="py-2 font-bold">أُنجزت في المدة</th><th className="py-2 font-bold">متأخرة</th></tr></thead>
          <tbody>{r.staff.map(s => <tr key={s.userId ?? 'none'} className="border-t border-line"><td className="py-2" dir={s.email ? 'ltr' : undefined} style={{ textAlign: 'right' }}>{s.userId ? s.email ?? 'عضو سابق' : 'غير مسندة'}</td><td className="nums py-2 text-right">{formatNumber(s.active)}</td><td className="nums py-2 text-right">{formatNumber(s.completed)}</td><td className={`nums py-2 text-right ${s.overdue ? 'font-bold text-danger' : ''}`}>{formatNumber(s.overdue)}</td></tr>)}</tbody></table>
          : <p className="muted text-sm">لا توجد طلبات مسندة بعد.</p>}</section>
      <section className="surface p-5"><ReportHead title="توزيع التقييمات" name={`توزيع التقييمات - آخر ${period}`} columns={countColumns} rows={ratingRows}/>
        <BarRows label="توزيع التقييمات" rows={ratingRows}/></section>
    </div>}
  </PortalLayout>;
}
