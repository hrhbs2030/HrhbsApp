import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileSpreadsheet, Printer, Upload, X } from 'lucide-react';
import type { ImportResult } from '@workspace/api-client-react';
import { columns, sheetToRows, type CellValue, type ImportKind, type ParsedSheet } from '@/lib/excel-rows';
import { exportRows, printTable, type ExportColumn, type ExportRow } from '@/lib/export';
import { formatNumber } from '@/lib/format';

// "Excel" and "print / PDF" for any table on the site. `rows` is read when
// the button is pressed, so callers pass the list they currently show.
export function ExportButtons({ name, columns: cols, rows, compact = false }: { name: string; columns: ExportColumn[]; rows: () => ExportRow[]; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function excel() {
    setBusy(true); setError(null);
    try { await exportRows(name, cols, rows()); } catch { setError('تعذّر إنشاء ملف Excel.'); } finally { setBusy(false); }
  }
  function print() {
    setError(printTable(name, cols, rows()) ? null : 'اسمح بالنوافذ المنبثقة لفتح صفحة الطباعة.');
  }
  return <span className="inline-flex flex-wrap items-center gap-1">
    {compact
      ? <><button type="button" className="rf-btn" onClick={excel} disabled={busy} aria-label={`تصدير ${name} إلى Excel`} title="تصدير Excel"><FileSpreadsheet size={16}/></button>
        <button type="button" className="rf-btn" onClick={print} aria-label={`طباعة ${name}`} title="طباعة / PDF"><Printer size={16}/></button></>
      : <><button type="button" className="btn btn-outline btn-sm" onClick={excel} disabled={busy}><FileSpreadsheet size={16}/>تصدير Excel</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={print}><Printer size={16}/>طباعة / PDF</button></>}
    {error && <span role="alert" className="text-xs text-danger">{error}</span>}
  </span>;
}

const titles: Record<ImportKind, string> = { employees: 'الموظفين', licenses: 'التراخيص' };
const valueNames: Record<string, string> = {
  active: 'على رأس العمل', left: 'غادر', commercial_register: 'السجل التجاري', municipal: 'رخصة البلدية', civil_defense: 'الدفاع المدني',
  chamber: 'الغرفة التجارية', gosi: 'شهادة التأمينات', zakat_vat: 'شهادة الزكاة والضريبة', other: 'ترخيص آخر',
};

// Spreadsheet header cells (not UI type): write-excel-file only knows 'bold'.
const sheetHeaderWeight = 'bold' as const;

async function downloadTemplate(kind: ImportKind) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const defs = columns[kind];
  const header = defs.map(d => ({ value: d.header, fontWeight: sheetHeaderWeight, backgroundColor: '#E2ECE8' }));
  const example = defs.map(d => ({ value: d.example, type: String }));
  await writeXlsxFile([header, example], {
    sheet: titles[kind], rightToLeft: true, columns: defs.map(d => ({ width: Math.max(14, d.header.length + 6) })),
  }).toFile(`نموذج-${titles[kind]}.xlsx`);
}

// Pick an .xlsx file, preview what will be sent, then import. The server
// checks every row and saves nothing if any row has a problem.
export function ExcelImport({ kind, onImport, onDone }: { kind: ImportKind; onImport: (rows: Record<string, unknown>[]) => Promise<ImportResult>; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<(ParsedSheet & { file: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ row: number; message: string }[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const reset = () => { setParsed(null); setError(null); setProblems([]); setResult(null); };

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    reset();
    if (!/\.xlsx$/i.test(file.name)) { setError('اختر ملف Excel بصيغة ‎.xlsx‎. احفظ ملفات ‎.xls‎ القديمة أو CSV بصيغة xlsx أولًا.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('حجم الملف أكبر من 5 ميغابايت.'); return; }
    setBusy(true);
    try {
      const { readSheet } = await import('read-excel-file/browser');
      const sheet = await readSheet(file) as unknown as CellValue[][];
      const result = sheetToRows(sheet, kind);
      if (result.missing.length) setError(`لم نجد عمود «${result.missing.join('، ')}» في الصف الأول. نزّل النموذج واستخدم عناوينه.`);
      else if (!result.rows.length) setError('لا توجد صفوف بيانات تحت العناوين.');
      else if (result.rows.length > 500) setError(`الملف فيه ${formatNumber(result.rows.length)} صفًا، والحد 500 في المرة. قسّمه إلى ملفات.`);
      setParsed({ ...result, file: file.name });
    } catch {
      setError('تعذّرت قراءة الملف. تأكد أنه ملف Excel سليم.');
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!parsed) return;
    setBusy(true); setProblems([]); setError(null);
    try {
      const saved = await onImport(parsed.rows);
      setResult(saved);
      onDone();
    } catch (e) {
      const data = (e as { status?: number; data?: ImportResult })?.status === 422 ? (e as { data?: ImportResult }).data : null;
      if (data?.problems?.length) setProblems(data.problems.map(p => ({ row: p.row ? parsed.sheetRows[p.row - 1] ?? p.row : 0, message: p.message })));
      else setError('تعذّر الاستيراد. حاول مرة أخرى.');
    } finally { setBusy(false); }
  }

  const defs = columns[kind];
  const shownKeys = parsed ? defs.filter(d => parsed.rows.some(r => r[d.key] != null && r[d.key] !== '')).slice(0, 6) : [];
  if (!open) return <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}><FileSpreadsheet size={16}/>استيراد من Excel</button>;
  return <div className="xi" role="region" aria-label={`استيراد ${titles[kind]} من Excel`}>
    <div className="xi-head"><strong><FileSpreadsheet size={17} aria-hidden="true"/>استيراد {titles[kind]} من Excel</strong>
      <button type="button" className="rf-btn" onClick={() => { reset(); setOpen(false); }} aria-label="إغلاق"><X size={16}/></button></div>
    <ol className="xi-steps">
      <li>نزّل النموذج وأدخل بياناتك تحت العناوين (يمكن ترك أي عمود فارغًا عدا {kind === 'employees' ? '«الاسم»' : '«النوع»'}).
        <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadTemplate(kind)}><Download size={15}/>تنزيل النموذج</button></li>
      <li>اختر الملف ثم راجع المعاينة. {kind === 'employees' ? 'الصف الذي يطابق رقم هوية أو اسمًا موجودًا يُحدّثه، والخلية الفارغة تُبقي القيمة المحفوظة.' : 'الصف الذي يطابق نوعًا ورقمًا موجودين يُحدّثه.'}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => input.current?.click()} disabled={busy}><Upload size={15}/>اختيار ملف</button>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pick}/></li>
    </ol>
    <p className="xi-note">التواريخ بالتقويم الميلادي: خلية تاريخ في Excel، أو نص مثل 2027-03-15 أو 15/03/2027.</p>
    {busy && <p role="status" className="xi-note">جارٍ المعالجة…</p>}
    {error && <p role="alert" className="rf-errors">{error}</p>}
    {parsed && !error && !result && <div className="space-y-3">
      <p className="text-sm">الملف <bdi className="font-semibold">{parsed.file}</bdi> فيه {formatNumber(parsed.rows.length)} صفًا جاهزًا للاستيراد.{parsed.unknown.length > 0 && <span className="text-subtle"> أعمدة لن تُستورد: {parsed.unknown.join('، ')}.</span>}</p>
      <div className="xi-table"><table><thead><tr><th>الصف</th>{shownKeys.map(d => <th key={d.key}>{d.header}</th>)}</tr></thead>
        <tbody>{parsed.rows.slice(0, 8).map((row, i) => <tr key={i}><td className="nums">{parsed.sheetRows[i]}</td>{shownKeys.map(d => <td key={d.key} dir={d.type === 'text' || d.type === 'date' ? 'ltr' : undefined}>{d.type === 'status' || d.type === 'kind' ? valueNames[String(row[d.key])] ?? String(row[d.key] ?? '') : String(row[d.key] ?? '')}</td>)}</tr>)}</tbody></table></div>
      {parsed.rows.length > 8 && <p className="xi-note">و{formatNumber(parsed.rows.length - 8)} صفًا آخر.</p>}
      {problems.length > 0 && <div role="alert" className="rf-errors"><strong>لم يُحفظ شيء. صحّح هذه الصفوف في الملف ثم اختره مجددًا:</strong>
        <ul className="mt-2 list-disc pr-5">{problems.map((p, i) => <li key={i}>{p.row ? `الصف ${p.row}: ` : ''}{p.message}</li>)}</ul></div>}
      <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'جارٍ الاستيراد…' : `استيراد ${formatNumber(parsed.rows.length)} صفًا`}</button>
    </div>}
    {result && <p role="status" className="text-sm font-semibold text-ok">تم الاستيراد: أُضيف {formatNumber(result.created)} وحُدّث {formatNumber(result.updated)}.</p>}
  </div>;
}
