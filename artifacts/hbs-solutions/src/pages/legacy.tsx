import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Check, CheckCircle2, CircleAlert, FileJson2, FileSearch, Fingerprint, History, ShieldCheck, UploadCloud } from 'lucide-react';
import { getListLegacyImportsQueryKey, useImportLegacyBackup, useListLegacyImports, usePreviewLegacyBackup, type LegacyBackupSummary, type LegacyImportSummary } from '@workspace/api-client-react';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, PortalLayout } from '@/components/portal-ui';
import { LOCALE } from '@/lib/format';

const LIMIT = 5_000_000;
const groups = [
  { key: 'transactions', label: 'المعاملات' },
  { key: 'clients', label: 'العملاء' },
  { key: 'tasks', label: 'المهام' },
  { key: 'notes', label: 'الملاحظات' },
] as const;

type PreparedFile = { contents: string; name: string; size: number; summary: LegacyBackupSummary };
type CompletedImport = { source: LegacyBackupSummary; stored: LegacyImportSummary };

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'تاريخ غير متاح' : new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function safeError(error: unknown, action: 'preview' | 'import') {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
  if (status === 409) return 'هذه النسخة مستوردة مسبقًا. راجع سجل الأرشيف أدناه قبل اختيار ملف آخر.';
  if (status === 413) return 'حجم النسخة أكبر من الحد المسموح. اختر ملفًا لا يتجاوز 5 ميغابايت.';
  if (status === 400 || status === 422) return action === 'preview'
    ? 'تعذّر التحقق من النسخة. قد يكون الملف غير صالح، أو يحتوي على مراجع بين السجلات غير صحيحة. راجع النسخة الأصلية وصدّرها مجددًا.'
    : 'لم يكتمل الاستيراد. قد تكون هناك مراجع غير صحيحة أو تغيّر في محتوى الملف منذ المعاينة. أعد اختيار الملف وراجعه من جديد.';
  if (status === 401 || status === 403) return 'انتهت صلاحية الوصول أو لا تملك صلاحية الاستيراد. أعد تسجيل الدخول بحساب المكتب.';
  return action === 'preview' ? 'تعذّرت معاينة الملف الآن. لم يُحفظ شيء؛ تحقق من الاتصال وحاول مرة أخرى.' : 'تعذّر تأكيد الاستيراد. تحقق من سجل الأرشيف قبل إعادة المحاولة لتفادي التكرار.';
}

function Counts({ summary, label }: { summary: LegacyBackupSummary; label: string }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={label}>
    {groups.map(({ key, label: name }) => <div key={key} className="rounded-xl border border-sage-2 bg-surface px-4 py-3">
      <div className="text-[11px] font-semibold text-subtle">{name}</div>
      <div className="mt-1 font-mono text-2xl font-semibold leading-none text-teal" data-testid={`count-${key}-${label}`}>{summary.counts[key]}</div>
    </div>)}
  </div>;
}

function Ids({ summary, prefix }: { summary: LegacyBackupSummary; prefix: string }) {
  return <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
    {groups.map(({ key, label }) => <div key={key} className="min-w-0 border-b border-line pb-3">
      <div className="mb-1 text-xs font-bold text-quiet">{label} <span className="font-normal text-subtle">({summary.ids[key].length})</span></div>
      <div dir="ltr" className="max-h-24 overflow-auto break-all rounded-md bg-sunk px-2.5 py-2 text-left font-mono text-[11px] leading-5 text-quiet" data-testid={`ids-${prefix}-${key}`}>
        {summary.ids[key].length ? summary.ids[key].join(' · ') : '-'}
      </div>
    </div>)}
  </div>;
}

function Digest({ value, prefix }: { value: string; prefix: string }) {
  return <div className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-subtle"><Fingerprint size={14}/>بصمة النسخة</span>
    <code dir="ltr" className="block overflow-x-auto rounded-md border border-sage-2 bg-surface px-3 py-2 text-left text-[11px] leading-5 text-info" data-testid={`digest-${prefix}`}>{value}</code>
  </div>;
}

function matches(source: LegacyBackupSummary, stored: LegacyImportSummary) {
  return source.digest === stored.digest && groups.every(({ key }) =>
    source.counts[key] === stored.counts[key] &&
    source.ids[key].length === stored.ids[key].length &&
    JSON.stringify([...source.ids[key]].sort()) === JSON.stringify([...stored.ids[key]].sort())
  );
}

export default function Legacy() {
  const queryClient = useQueryClient();
  const previewMutation = usePreviewLegacyBackup({ mutation: { gcTime: 0 } });
  const importMutation = useImportLegacyBackup({ mutation: { gcTime: 0 } });
  const imports = useListLegacyImports();
  const generation = useRef(0);
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const [completed, setCompleted] = useState<CompletedImport | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const current = ++generation.current;
    setPrepared(null);
    setCompleted(null);
    setConfirmed(false);
    setNotice('');
    previewMutation.reset();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setNotice('اختر ملف نسخة احتياطية غير مشفّر بصيغة JSON فقط.');
      return;
    }
    if (file.size === 0 || file.size > LIMIT) {
      setNotice('يجب أن يكون حجم ملف JSON أكبر من صفر ولا يتجاوز 5 ميغابايت.');
      return;
    }
    try {
      const contents = await file.text();
      if (current !== generation.current) return;
      if (!contents.trim() || contents.length > LIMIT) {
        setNotice('الملف فارغ أو يتجاوز حد المحتوى المسموح. اختر ملفًا أصغر.');
        return;
      }
      try { JSON.parse(contents); } catch {
        setNotice('الملف ليس JSON صالحًا. لا يمكن رفع نسخة مشفّرة هنا؛ صدّر نسخة غير مشفّرة محليًا أولًا.');
        return;
      }
      const summary = await previewMutation.mutateAsync({ data: { contents } });
      if (current === generation.current) setPrepared({ contents, summary, name: file.name, size: file.size });
    } catch (error) {
      if (current === generation.current) setNotice(safeError(error, 'preview'));
    } finally {
      previewMutation.reset();
    }
  }

  async function importFile() {
    if (!prepared || !confirmed || importMutation.isPending) return;
    const { contents, summary } = prepared;
    const current = generation.current;
    setNotice('');
    try {
      const stored = await importMutation.mutateAsync({ data: { contents, digest: summary.digest, confirmed: true } });
      if (current === generation.current) {
        setCompleted({ source: summary, stored });
        setPrepared(null);
        setConfirmed(false);
        queryClient.invalidateQueries({ queryKey: getListLegacyImportsQueryKey() });
      }
    } catch (error) {
      if (current === generation.current) setNotice(safeError(error, 'import'));
    } finally {
      importMutation.reset();
    }
  }

  const consistent = completed ? matches(completed.source, completed.stored) : false;
  return <PortalLayout staff>
    <div className="rise">
      <PageHeading eyebrow="" title="الأرشيف القديم" subtitle="استيراد سجلات التطبيق القديم إلى أرشيف خاص بالمكتب، منفصل عن بوابة العملاء."/>
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warn-line bg-warn-soft px-5 py-4 text-sm leading-7 text-warn">
        <ShieldCheck size={18} className="mt-1 shrink-0"/>
        <p><strong>النسخ المشفّرة غير مدعومة.</strong> صدّر نسخة من التطبيق القديم: <strong>الإعدادات ← تصدير نسخة احتياطية ← اترك كلمة المرور فارغة</strong>، ثم احذف الملف بأمان بعد التحقق من الاستيراد.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,.7fr)]">
        <div className="min-w-0 space-y-6">
          <section className="surface overflow-hidden" aria-labelledby="upload-title">
            <div className="flex items-center gap-3 border-b border-line px-5 py-5 sm:px-7"><span className="grid h-8 w-8 place-items-center rounded-full bg-teal font-mono text-sm text-on-dark">01</span><div><h2 id="upload-title" className="display text-lg font-semibold">اختيار النسخة ومعاينتها</h2><p className="mt-0.5 text-xs text-subtle">ملف JSON غير مشفّر، حتى 5 ميغابايت</p></div></div>
            <div className="p-5 sm:p-7">
              <label className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-surface px-5 py-9 text-center transition-colors hover:bg-sage ${importMutation.isPending ? 'pointer-events-none opacity-50' : ''}`}>
                <UploadCloud size={31} strokeWidth={1.5} className="text-teal-bright"/>
                <span className="mt-3 text-sm font-bold text-info">اختر ملف النسخة من جهازك</span>
                <span className="mt-1 text-xs text-subtle">يُفحص الملف فقط، ولا يُحفظ قبل تأكيدك</span>
                <input data-testid="input-legacy-json" type="file" accept=".json,application/json" className="sr-only" onChange={chooseFile} disabled={importMutation.isPending} aria-label="اختيار ملف نسخة احتياطية JSON"/>
              </label>
              {previewMutation.isPending && <div className="mt-5" role="status"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-info"><FileSearch size={17}/>جارٍ فحص الملف والمراجع…</div><div className="skeleton h-14 w-full"/><div className="skeleton mt-2 h-14 w-4/5"/></div>}
              {notice && <div role="alert" data-testid="status-legacy-error" className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-danger-soft px-4 py-3 text-sm leading-6 text-danger"><CircleAlert size={17} className="mt-1 shrink-0"/>{notice}</div>}
              {prepared && <div className="mt-6 space-y-5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-info"><FileJson2 size={18}/><span className="max-w-full break-all" data-testid="text-legacy-filename">{prepared.name}</span><span className="text-xs font-normal text-subtle">({new Intl.NumberFormat(LOCALE).format(prepared.size)} بايت)</span><span className="mr-auto inline-flex items-center gap-1 rounded-full bg-info-soft px-2.5 py-1 text-xs text-ok"><Check size={13}/>اجتازت المعاينة</span></div>
                <div className="border-y border-line py-3 text-sm"><span className="text-subtle">تاريخ التصدير <strong className="mr-2 text-teal" data-testid="text-legacy-exported-at">{readableDate(prepared.summary.exportedAt)}</strong></span></div>
                <Counts summary={prepared.summary} label="source"/>
                <Digest value={prepared.summary.digest} prefix="source"/>
                <details className="rounded-lg border border-line bg-surface p-4"><summary className="cursor-pointer text-sm font-bold text-info" data-testid="toggle-source-ids">معرّفات السجلات</summary><div className="mt-4"><Ids summary={prepared.summary} prefix="source"/></div></details>
              </div>}
            </div>
          </section>

          <section className="surface overflow-hidden" aria-labelledby="confirm-title">
            <div className="flex items-center gap-3 border-b border-line px-5 py-5 sm:px-7"><span className="grid h-8 w-8 place-items-center rounded-full bg-sage-2 font-mono text-sm text-teal">02</span><div><h2 id="confirm-title" className="display text-lg font-semibold">التأكيد والحفظ</h2><p className="mt-0.5 text-xs text-subtle">يُحفظ الملف نفسه الذي عاينته</p></div></div>
            <div className="p-5 sm:p-7">
              <label className={`flex items-start gap-3 rounded-xl border px-4 py-4 text-sm leading-7 ${prepared ? 'border-line-strong bg-surface text-info' : 'border-line bg-surface text-subtle'}`}>
                <input type="checkbox" data-testid="checkbox-confirm-legacy" className="mt-1.5 h-4 w-4 shrink-0 accent-teal" checked={confirmed} disabled={!prepared || importMutation.isPending} onChange={event => setConfirmed(event.target.checked)}/>
                <span>راجعت تاريخ التصدير والأعداد والمعرّفات وبصمة النسخة، وأوافق على حفظ هذه السجلات في أرشيف المكتب.</span>
              </label>
              <div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" data-testid="button-import-legacy" className="btn btn-primary" disabled={!prepared || !confirmed || previewMutation.isPending || importMutation.isPending} onClick={importFile}><Archive size={17}/>{importMutation.isPending ? 'جارٍ حفظ النسخة…' : 'تأكيد الاستيراد'}</button><span className="text-xs text-subtle">لا يمكن التراجع عن الاستيراد بعد اكتماله.</span></div>
              {importMutation.isPending && <div className="mt-5 space-y-2" role="status" aria-label="جارٍ حفظ السجلات"><div className="skeleton h-4 w-2/3"/><div className="skeleton h-12 w-full"/></div>}
            </div>
          </section>

          {completed && <section className="surface overflow-hidden" aria-labelledby="result-title" data-testid="section-import-result">
            <div className={`flex items-start gap-3 border-b px-5 py-5 sm:px-7 ${consistent ? 'border-sage-2 bg-sage' : 'border-warn-line bg-warn-soft'}`}><CheckCircle2 size={24} className={consistent ? 'text-ok' : 'text-copper'}/><div><h2 id="result-title" className="display text-lg font-semibold">تم حفظ النسخة في الأرشيف</h2><p className="mt-1 text-sm leading-6">{consistent ? 'تطابقت البصمة والأعداد والمعرّفات مع المعاينة.' : 'اكتمل الحفظ، لكن النتيجة لا تطابق المعاينة بالكامل. راجع الأرشيف مع مسؤول النظام قبل الاعتماد عليه.'}</p></div></div>
            <div className="space-y-5 p-5 sm:p-7">
              <div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="block text-xs text-subtle">رقم عملية الاستيراد</span><strong data-testid="text-import-id" dir="ltr" className="mt-1 block font-mono">#{completed.stored.id}</strong></div><div><span className="block text-xs text-subtle">وقت الحفظ</span><strong className="mt-1 block">{readableDate(completed.stored.importedAt)}</strong></div><div><span className="block text-xs text-subtle">تاريخ النسخة الأصلية</span><strong className="mt-1 block">{readableDate(completed.source.exportedAt)}</strong></div></div>
               <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-right text-sm"><thead className="border-b border-sage-2 text-xs text-subtle"><tr><th className="py-2 font-semibold">نوع السجلات</th><th className="py-2 font-semibold">المصدر</th><th className="py-2 font-semibold">المحفوظ</th><th className="py-2 font-semibold">المقارنة</th></tr></thead><tbody>{groups.map(({ key, label }) => { const same = completed.source.counts[key] === completed.stored.counts[key] && JSON.stringify([...completed.source.ids[key]].sort()) === JSON.stringify([...completed.stored.ids[key]].sort()); return <tr key={key} className="border-b border-line last:border-0"><td className="py-2.5 font-semibold">{label}</td><td className="py-2.5 font-mono">{completed.source.counts[key]}</td><td className="py-2.5 font-mono">{completed.stored.counts[key]}</td><td className={`py-2.5 text-xs font-bold ${same ? 'text-ok' : 'text-copper'}`}>{same ? 'العدد والمعرّفات متطابقة' : 'توجد فروقات'}</td></tr>; })}</tbody></table></div>
              <div className="grid gap-4 sm:grid-cols-2"><Digest value={completed.source.digest} prefix="completed-source"/><Digest value={completed.stored.digest} prefix="completed-stored"/></div>
              <div className="grid gap-3 sm:grid-cols-2"><details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-xs font-bold text-info">معرّفات المصدر</summary><div className="mt-3"><Ids summary={completed.source} prefix="completed-source"/></div></details><details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-xs font-bold text-info">معرّفات الأرشيف المحفوظة</summary><div className="mt-3"><Ids summary={completed.stored} prefix="completed-stored"/></div></details></div>
              <p className="border-t border-line pt-4 text-xs leading-6 text-subtle">احذف ملف JSON غير المشفّر من جهازك بطريقة آمنة.</p>
            </div>
          </section>}
        </div>

        <aside className="min-w-0 space-y-4">
          <div><div className="flex items-center gap-2 text-ink"><History size={18}/><h2 className="display text-lg font-semibold">عمليات الاستيراد</h2></div><p className="mt-1 text-xs leading-6 text-subtle">قارن البصمة قبل استيراد نسخة جديدة.</p></div>
          {imports.isLoading ? <LoadingBlock/> : imports.isError ? <ErrorBlock retry={() => { void imports.refetch(); }}/> : !imports.data?.length ? <EmptyBlock title="لا توجد عمليات بعد" text="تظهر هنا كل عملية استيراد ناجحة مع بصمتها وأعدادها."/> : <div className="space-y-3">
            {imports.data.map(item => <article key={item.id} className="surface overflow-hidden" data-testid={`card-legacy-import-${item.id}`}>
              <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-4"><div><div className="text-sm font-bold text-teal">عملية #{item.id}</div><div className="mt-1 text-xs text-subtle">{readableDate(item.importedAt)}</div></div><span className="rounded-full bg-ok-soft px-2 py-1 text-[11px] font-bold text-ok">محفوظة</span></div>
              <div className="space-y-3 p-4"><div className="text-xs text-subtle">تاريخ التصدير: <strong className="text-info">{readableDate(item.exportedAt)}</strong></div>
                <div className="grid grid-cols-2 gap-2">{groups.map(({ key, label }) => <div key={key} className="flex justify-between rounded-md bg-paper px-2 py-1.5 text-xs"><span className="text-subtle">{label}</span><strong className="font-mono text-info">{item.counts[key]}</strong></div>)}</div>
                <Digest value={item.digest} prefix={`history-${item.id}`}/>
                <details className="border-t border-line pt-3"><summary className="cursor-pointer text-xs font-bold text-teal-bright" data-testid={`toggle-history-ids-${item.id}`}>معرّفات السجلات المحفوظة</summary><div className="mt-3"><Ids summary={item} prefix={`history-${item.id}`}/></div></details>
              </div>
            </article>)}
          </div>}
        </aside>
      </div>
    </div>
  </PortalLayout>;
}