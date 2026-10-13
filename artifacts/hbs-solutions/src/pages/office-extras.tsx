import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOfficeReportQueryKey, getListOfficeRemindersQueryKey, getListOfficeServiceOffersQueryKey,
  useGetOfficeReport, useListOfficeReminders, useListOfficeServiceOffers, useSaveOfficeServiceOffer,
  getListAssignmentRulesQueryKey, getListOfficeAssigneesQueryKey, saveAssignmentRule, useListAssignmentRules, useListOfficeAssignees,
  type AssignmentRule,
  type GetOfficeReportDays, type ServiceOffer,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, categoryNames, statusNames } from '@/components/portal-ui';
import { Chip, DataTable, FilterChip, SectionHeader, Tile, TileGrid, Toolbar, type DataColumn } from '@/components/portal-kit';
import { BarList, ChartTable, Columns, StackedBar } from '@/components/office-charts';
import { OfficeCommandPalette } from '@/components/office-command';
import { chartSeries } from '@/design/tokens';
import { Reveal, stagger } from '@/lib/motion';
import { BarChart3, Banknote, CalendarDays, ReceiptText, Search, Star } from 'lucide-react';
import type { OfficeReminder } from '@workspace/api-client-react';
import './office.css';
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
  const columns: DataColumn<OfficeReminder>[] = [
    { key: 'doc', header: 'الوثيقة', primary: true, cell: item => <><strong>{reminderKindNames[item.kind]}</strong><span className="block text-xs text-subtle">«{item.label}»{item.addedBy === 'office' ? ' · أضافها المكتب' : ''}</span></> },
    { key: 'customer', header: 'العميل', cell: item => item.customer ? <>{item.customer.fullName}<span className="block text-xs text-subtle nums" dir="ltr">{item.customer.email}</span></> : <span className="text-subtle">عميل سابق للتسجيل</span> },
    { key: 'phone', header: 'التواصل', hideBelow: 'md', nums: true, cell: item => item.contactPhone ? <a href={`tel:${item.contactPhone}`} dir="ltr" className="nums">{item.contactPhone}</a> : '-' },
    { key: 'expires', header: 'تنتهي في', cell: item => <><span className="block nums">{formatCalendarDate(item.expiresOn)}</span><ExpiryBadge expiresOn={item.expiresOn} /></> },
  ];
  return <PortalLayout staff>
    <OfficeCommandPalette />
    <PageHeading eyebrow="فرص تجديد" title="وثائق العملاء التي تنتهي قريبًا" subtitle="وثائق أضافها العملاء أو المكتب. يصل للعميل تنبيه بالبريد قبل الانتهاء بـ30 يومًا ثم 7 ثم يوم واحد، ويمكنك التواصل معه لعرض التجديد."/>
    <Toolbar filters={<div className="flex flex-wrap gap-2" role="group" aria-label="المدة">{windows.map(days => <FilterChip key={days} active={within === days} onClick={() => setWithin(days)}>خلال {formatNumber(days)} يومًا</FilterChip>)}</div>}
      actions={list.data?.length ? <ExportButtons compact name={`وثائق تنتهي خلال ${within} يومًا`} columns={[{ key: 'kind', label: 'النوع' }, { key: 'label', label: 'الوثيقة' }, { key: 'customer', label: 'العميل' }, { key: 'phone', label: 'التواصل' }, { key: 'expiresOn', label: 'تنتهي في' }]} rows={() => (list.data ?? []).map(i => ({ kind: reminderKindNames[i.kind], label: i.label, customer: i.customer?.fullName ?? '', phone: i.contactPhone ?? '', expiresOn: i.expiresOn }))}/> : undefined} />
    {list.isLoading ? <LoadingBlock variant="table"/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.length
      ? <EmptyBlock title="لا توجد وثائق تنتهي في هذه المدة" text="عند إضافة العملاء تواريخ انتهاء وثائقهم تظهر هنا مرتبة بالأقرب."/>
      : <DataTable columns={columns} rows={list.data} rowKey={item => item.id} caption="وثائق تنتهي قريبًا" rowTone={item => new Date(item.expiresOn).getTime() < Date.now() ? 'danger' : undefined} />}
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
    <OfficeCommandPalette />
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

// A report section's heading with its own Excel / print buttons; each table
// goes out on its own, with the period in the file name.
const countColumns: ExportColumn[] = [{ key: 'label', label: 'البند' }, { key: 'value', label: 'العدد', type: 'number' }];
function ReportHead({ id, title, name, columns, rows, description }: { id?: string; title: string; name: string; columns: ExportColumn[]; rows: object[]; description?: string }) {
  return <SectionHeader id={id} title={title} description={description} action={rows.length > 0 ? <ExportButtons compact name={name} columns={columns} rows={() => rows}/> : undefined}/>;
}

// What the report returns, drawn honestly: created vs completed in the
// period (throughput), the open pipeline by stage, demand by category, the top
// services, the team, ratings and revenue. There is no per-week series or
// time-in-stage in the API, so neither is invented here.
export function OfficeReports() {
  const [days, setDays] = useState<GetOfficeReportDays>(30);
  const params = { days };
  const report = useGetOfficeReport(params, { query: { queryKey: getGetOfficeReportQueryKey(params), placeholderData: previous => previous } });
  const r = report.data;
  const period = periods.find(([value]) => value === days)?.[1] ?? '';
  const byStatus = (r?.byStatus ?? []).map(row => ({ key: row.key, label: statusNames[row.key] ?? row.key, value: row.count }));
  const byCategory = (r?.byCategory ?? []).map(row => ({ key: row.key, label: categoryNames[row.key] ?? row.key, value: row.count }));
  const ratingRows = [5, 4, 3, 2, 1].map(star => ({ key: String(star), label: `${formatNumber(star)} ${star === 1 ? 'نجمة' : 'نجوم'}`, value: r?.ratings.distribution.find(d => Number(d.key) === star)?.count ?? 0 }));
  const staffRows = (r?.staff ?? []).map(s => ({ key: s.userId ?? 'none', member: s.userId ? s.email ?? 'عضو سابق' : 'غير مسندة', active: s.active, completed: s.completed, overdue: s.overdue }));
  const maxActive = Math.max(1, ...staffRows.map(s => s.active));
  const completionRate = r && r.created > 0 ? Math.round((r.completed / r.created) * 100) : null;
  const staffColumns: DataColumn<typeof staffRows[number]>[] = [
    { key: 'member', header: 'المسؤول', primary: true, cell: s => <span dir={s.key === 'none' ? undefined : 'ltr'} className="nums">{s.member}</span> },
    { key: 'active', header: 'نشطة الآن', nums: true, cell: s => <span className="rp-mini"><span className="rp-mini-bar" aria-hidden="true"><span style={{ width: `${(s.active / maxActive) * 100}%` }}/></span>{formatNumber(s.active)}</span> },
    { key: 'completed', header: 'أُنجزت في المدة', nums: true, cell: s => formatNumber(s.completed) },
    { key: 'overdue', header: 'متأخرة', nums: true, cell: s => s.overdue ? <Chip tone="danger" size="sm" dot>{formatNumber(s.overdue)}</Chip> : <span className="text-subtle">0</span> },
  ];
  return <PortalLayout staff>
    <OfficeCommandPalette />
    <PageHeading eyebrow="الأداء" title="التقارير" subtitle="أرقام المكتب في المدة المختارة: الطلبات والإنجاز والفريق ورضا العملاء والإيرادات."/>
    <Toolbar filters={<div className="flex flex-wrap gap-2" role="group" aria-label="المدة">{periods.map(([value, name]) => <FilterChip key={value} active={days === value} onClick={() => setDays(value)}><CalendarDays size={14} aria-hidden="true"/>آخر {name}</FilterChip>)}</div>} />
    {report.isLoading ? <LoadingBlock variant="tiles"/> : report.isError ? <ErrorBlock retry={() => report.refetch()}/> : r && <div className={`rp transition-opacity ${report.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={report.isPlaceholderData || undefined}>
      <TileGrid cols={4}>
        <Tile label="طلبات جديدة" value={formatNumber(r.created)} note={`خلال آخر ${period}`} icon={<BarChart3 size={15}/>} tone="accent"/>
        <Tile label="طلبات أُنجزت" value={formatNumber(r.completed)} icon={<BarChart3 size={15}/>}
          trend={completionRate != null ? { direction: completionRate >= 100 ? 'up' : completionRate >= 50 ? 'flat' : 'down', value: `${formatNumber(completionRate)}٪`, label: 'من الجديدة', good: completionRate >= 50 } : undefined}
          note={r.averageCompletionDays != null ? `متوسط الإنجاز ${formatNumber(r.averageCompletionDays)} يوم` : undefined}/>
        <Tile label="رضا العملاء" value={r.ratings.average != null ? `${formatNumber(r.ratings.average)} من 5` : '-'} note={`${formatNumber(r.ratings.count)} تقييم`} icon={<Star size={15}/>}/>
        <Tile long label="المحصّل شامل الضريبة" value={formatMoney(r.revenue.paidTotal)} note={`${formatNumber(r.revenue.paidCount)} فاتورة · ضريبة ${formatMoney(r.revenue.paidVat)}`} icon={<Banknote size={15}/>}/>
      </TileGrid>
      {r.revenue.outstandingCount > 0 && <p className="rp-outstanding"><span><ReceiptText size={16} className="inline-block align-middle" aria-hidden="true"/> فواتير غير مسددة: <strong className="nums">{formatNumber(r.revenue.outstandingCount)}</strong> بإجمالي <strong className="nums">{formatMoney(r.revenue.outstandingTotal)}</strong></span></p>}
      <div className="rp-grid">
        <Reveal as="section" className="surface rp-card" style={stagger(0)} aria-labelledby="rp-throughput">
          <SectionHeader id="rp-throughput" title="الإنجاز مقابل الوارد" description={`ما وصل وما أُنجز خلال آخر ${period}.`} />
          <Columns label="الطلبات الجديدة مقابل المنجزة" groups={[{ key: 'period', label: `آخر ${period}`, values: [r.created, r.completed] }]} seriesList={[{ key: 'created', label: 'جديدة', color: chartSeries[0] }, { key: 'completed', label: 'أُنجزت', color: chartSeries[1] }]} height={200} />
          <ChartTable columns={['البند', 'العدد']} rows={[['طلبات جديدة', formatNumber(r.created)], ['طلبات أُنجزت', formatNumber(r.completed)], ['متوسط أيام الإنجاز', r.averageCompletionDays != null ? formatNumber(r.averageCompletionDays) : '-']]} />
        </Reveal>
        <Reveal as="section" className="surface rp-card" style={stagger(1)} aria-labelledby="rp-status">
          <ReportHead id="rp-status" title="الطلبات الحالية حسب الحالة" description="أين تقف الطلبات الآن؛ عدد كل مرحلة." name={`الطلبات حسب الحالة - آخر ${period}`} columns={countColumns} rows={byStatus}/>
          {byStatus.length ? <><StackedBar segments={byStatus} label="الطلبات حسب الحالة" height={20} /><ChartTable columns={['الحالة', 'العدد']} rows={byStatus.map(row => [row.label, formatNumber(row.value)])} /></> : <p className="oc-empty">لا توجد بيانات في هذه المدة.</p>}
        </Reveal>
        <Reveal as="section" className="surface rp-card" style={stagger(2)} aria-labelledby="rp-category">
          <ReportHead id="rp-category" title="الطلبات الجديدة حسب المجال" name={`الطلبات حسب المجال - آخر ${period}`} columns={countColumns} rows={byCategory}/>
          <BarList label="الطلبات حسب المجال" rows={byCategory} />
          <ChartTable columns={['المجال', 'العدد']} rows={byCategory.map(row => [row.label, formatNumber(row.value)])} />
        </Reveal>
        <Reveal as="section" className="surface rp-card" style={stagger(3)} aria-labelledby="rp-ratings">
          <ReportHead id="rp-ratings" title="توزيع التقييمات" description={r.ratings.count ? `${formatNumber(r.ratings.count)} تقييمًا بمتوسط ${formatNumber(r.ratings.average ?? 0)} من 5.` : undefined} name={`توزيع التقييمات - آخر ${period}`} columns={countColumns} rows={ratingRows.filter(x => x.value > 0)}/>
          {r.ratings.count ? <><BarList label="توزيع التقييمات" rows={ratingRows} emphasis="5" /><ChartTable columns={['التقييم', 'العدد']} rows={ratingRows.map(row => [row.label, formatNumber(row.value)])} /></> : <p className="oc-empty">لا توجد تقييمات في هذه المدة.</p>}
        </Reveal>
      </div>
      <Reveal as="section" className="surface rp-card" style={stagger(4)} aria-labelledby="rp-services">
        <ReportHead id="rp-services" title="أكثر الخدمات طلبًا" description="الخدمات الأكثر ورودًا في المدة، وكم اكتمل منها." name={`أكثر الخدمات طلبًا - آخر ${period}`} columns={[{ key: 'service', label: 'الخدمة' }, { key: 'created', label: 'طلبات', type: 'number' }, { key: 'completed', label: 'مكتملة منها', type: 'number' }]} rows={r.topServices}/>
        <Columns label="أكثر الخدمات طلبًا" groups={r.topServices.map(s => ({ key: s.service, label: s.service, values: [s.created, s.completed] }))} seriesList={[{ key: 'created', label: 'طلبات', color: chartSeries[0] }, { key: 'completed', label: 'مكتملة منها', color: chartSeries[1] }]} />
        <ChartTable columns={['الخدمة', 'طلبات', 'مكتملة منها']} rows={r.topServices.map(s => [s.service, formatNumber(s.created), formatNumber(s.completed)])} />
      </Reveal>
      <Reveal as="section" className="surface rp-card" style={stagger(5)} aria-labelledby="rp-staff">
        <ReportHead id="rp-staff" title="الفريق" description="حمل كل مسؤول الآن، وما أنجزه في المدة، وما تأخر لديه." name={`الفريق - آخر ${period}`} columns={[{ key: 'member', label: 'المسؤول' }, { key: 'active', label: 'نشطة الآن', type: 'number' }, { key: 'completed', label: 'أُنجزت في المدة', type: 'number' }, { key: 'overdue', label: 'متأخرة', type: 'number' }]} rows={staffRows}/>
        {staffRows.length ? <DataTable columns={staffColumns} rows={staffRows} rowKey={s => s.key} caption="الفريق" rowTone={s => s.overdue ? 'danger' : undefined} dense stickyHeader={false} /> : <p className="oc-empty">لا توجد طلبات مسندة بعد.</p>}
      </Reveal>
      <Reveal as="section" className="surface rp-card" style={stagger(6)} aria-labelledby="rp-revenue">
        <SectionHeader id="rp-revenue" title="الإيرادات" description={`الفواتير المسددة وغير المسددة خلال آخر ${period}، شاملة الضريبة.`} />
        <div className="rp-revenue">
          <StackedBar segments={[{ key: 'paid', label: 'مسددة', value: r.revenue.paidTotal }, { key: 'outstanding', label: 'غير مسددة', value: r.revenue.outstandingTotal }]} label="الإيرادات" format={formatMoney} height={20} />
          <div className="rp-revenue-tiles">
            <div className="rp-revenue-tile"><div className="label"><Banknote size={13} aria-hidden="true"/>المحصّل</div><div className="value display nums">{formatMoney(r.revenue.paidTotal)}</div><div className="note nums">{formatNumber(r.revenue.paidCount)} فاتورة · منها ضريبة {formatMoney(r.revenue.paidVat)}</div></div>
            <div className="rp-revenue-tile"><div className="label"><ReceiptText size={13} aria-hidden="true"/>غير المسدد</div><div className="value display nums">{formatMoney(r.revenue.outstandingTotal)}</div><div className="note nums">{formatNumber(r.revenue.outstandingCount)} فاتورة بانتظار السداد</div></div>
          </div>
        </div>
      </Reveal>
    </div>}
  </PortalLayout>;
}
