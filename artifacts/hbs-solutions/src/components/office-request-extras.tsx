import { useEffect, useState, type FormEvent } from 'react';
import { FileSignature, ListChecks, Plus, Save, ScanText, Trash2, UsersRound } from 'lucide-react';
import {
  getListOfficeServiceRequestMessagesQueryKey, linkOfficeAttachmentToChecklist, useCreateOfficeReminder, useExtractOfficeAttachmentDocument,
  useListOfficeServiceRequestMessages, useSaveOfficeChecklist, useSendOfficeQuote, useUpdateOfficeRequestEmployee,
  type ChecklistItem, type RequestEmployee, type RequestEmployeeStatus, type RequestQuote, type ServiceAttachment,
} from '@workspace/api-client-react';
import { ReminderForm, emptyDraft, type Draft } from '@/components/reminder-ui';
import { formatDateTime, formatMoney, formatNumber, parseRiyals } from '@/lib/format';
import './office-request-extras.css';

// Office: read a customer's document with AI, check the result, then save it
// as a renewal reminder on the customer's account. Nothing is saved until
// staff confirm, and every reading is recorded in the audit log.
export function ExtractReminder({ requestId, file, onClose }: { requestId: number; file: ServiceAttachment | null; onClose: () => void }) {
  const extract = useExtractOfficeAttachmentDocument();
  const create = useCreateOfficeReminder();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileId = file?.id ?? null;
  useEffect(() => {
    if (fileId === null) return;
    let current = true;
    setDraft(null); setHint(null); setError(null); setSaved(false);
    extract.mutateAsync({ attachmentId: fileId }).then(result => {
      if (!current) return;
      setDraft({ kind: result.kind ?? 'other', label: result.label ?? '', expiresOn: typeof result.expiresOn === 'string' ? result.expiresOn.slice(0, 10) : '', note: '' });
      setHint([result.expiresOnText && `التاريخ كما في المستند: ${result.expiresOnText}`, result.notes].filter(Boolean).join(' · ') || null);
    }).catch(() => {
      if (!current) return;
      setDraft({ ...emptyDraft });
      setHint('تعذّرت القراءة الآلية. أدخل البيانات يدويًا من المستند.');
    });
    return () => { current = false; };
  }, [fileId]);
  if (!file) return null;
  async function save(value: Draft) {
    setError(null);
    try {
      await create.mutateAsync({ id: requestId, data: { kind: value.kind, label: value.label, expiresOn: value.expiresOn, note: value.note || null } });
      setSaved(true);
    } catch { setError('تعذّر حفظ التنبيه. تحقق من البيانات.'); }
  }
  return <section className="rounded-xl border border-sage-2 bg-paper p-4" aria-label="إضافة تنبيه انتهاء من مستند">
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ScanText size={16} aria-hidden="true"/>تنبيه انتهاء من «{file.name}»</h3>
    {saved ? <div className="space-y-3"><p role="status" className="text-sm font-semibold text-ok">حُفظ التنبيه، ويصل للعميل قبل الانتهاء.</p><button type="button" className="btn btn-outline btn-sm" onClick={onClose}>إغلاق</button></div>
      : !draft ? <p className="text-sm text-subtle" aria-live="polite">جارٍ قراءة المستند…</p>
      : <>{hint && <p className="mb-3 rounded-lg bg-sunk p-3 text-xs leading-6 text-quiet">{hint}</p>}
        <p className="mb-3 text-xs text-subtle">راجع البيانات مع المستند قبل الحفظ.</p>
        <ReminderForm key={file.id} initial={draft} busy={create.isPending} error={error} submitLabel="حفظ التنبيه للعميل" onSubmit={save} onCancel={onClose}/></>}
  </section>;
}

// ---- price quote -------------------------------------------------------------------

// What the quote is waiting on; the customer's reason for declining arrives
// as their message in the conversation, so it is read from the same cached list.
export function quoteState(quote: RequestQuote | null): 'none' | 'sent' | 'accepted' | 'declined' {
  if (!quote) return 'none';
  return quote.acceptedAt ? 'accepted' : quote.declinedAt ? 'declined' : 'sent';
}
export function declineNote(quote: RequestQuote | null, messages: { authorRole: string; body: string; createdAt: string }[] | undefined): string | null {
  if (!quote?.declinedAt || !messages) return null;
  const since = new Date(quote.declinedAt).getTime() - 60_000;
  return messages.find(m => m.authorRole === 'customer' && new Date(m.createdAt).getTime() >= since)?.body ?? null;
}

// Office: price the work before it starts. The customer accepts (an invoice is
// issued for the amount) or declines with a reason; a new quote can be sent
// after either, so the form stays available.
export function QuotePanel({ requestId, quote, onChanged }: { requestId: number; quote: RequestQuote | null; onChanged: () => void | Promise<unknown> }) {
  const send = useSendOfficeQuote();
  const messages = useListOfficeServiceRequestMessages(requestId, { query: { queryKey: getListOfficeServiceRequestMessagesQueryKey(requestId), enabled: !!quote?.declinedAt } });
  const state = quoteState(quote);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [markWaiting, setMarkWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { setOpen(false); setAmount(''); setNote(''); setMarkWaiting(true); setError(null); setSent(false); }, [requestId]);
  const halalas = parseRiyals(amount);
  const valid = halalas !== null && halalas >= 100;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) { setError('اكتب مبلغًا لا يقل عن ريال واحد.'); return; }
    setError(null); setSent(false);
    try {
      await send.mutateAsync({ id: requestId, data: { amount: halalas, ...(note.trim() ? { note: note.trim() } : {}), markWaiting } });
      setOpen(false); setAmount(''); setNote('');
      await onChanged();
      setSent(true);
    } catch (err) {
      setError((err as { status?: number })?.status === 409 ? 'لا يمكن إرسال عرض سعر على هذا الطلب في حالته الحالية.' : 'تعذّر إرسال عرض السعر. حاول مجددًا.');
    }
  }
  const reason = declineNote(quote, messages.data);
  return <section className="oq" aria-labelledby={`oq-${requestId}`}>
    <div className="rf-head">
      <h2 id={`oq-${requestId}`} className="rf-title"><FileSignature size={16} aria-hidden="true"/>عرض السعر</h2>
      {!open && state !== 'accepted' && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setOpen(true); setSent(false); }}>{quote ? 'عرض سعر جديد' : 'عرض سعر'}</button>}
    </div>
    {quote && <div className={`oq-state oq-${state}`}>
      <div className="oq-amounts"><strong>{formatMoney(quote.total)}</strong><span className="text-subtle">شامل الضريبة · قبلها {formatMoney(quote.amount)}</span></div>
      {quote.note && <p className="oq-note">«{quote.note}»</p>}
      <p className="oq-status">{state === 'accepted' ? `قبله العميل في ${formatDateTime(quote.acceptedAt)} وصدرت فاتورته.` : state === 'declined' ? `رفضه العميل في ${formatDateTime(quote.declinedAt)}.` : `أُرسل في ${formatDateTime(quote.quotedAt)} بانتظار رد العميل.`}</p>
      {state === 'declined' && (reason ? <p className="oq-reason">سبب العميل: «{reason}»</p> : <p className="oq-reason text-subtle">سبب الرفض، إن كتبه العميل، في المحادثة أدناه.</p>)}
    </div>}
    {open && <form onSubmit={submit} className="rb-form">
      <label className="form-field">أتعاب المكتب قبل الضريبة (ر.س)<input className="form-control" dir="ltr" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus/>
        {valid && <small className="muted font-normal">الإجمالي شامل ضريبة 15%: {formatMoney(halalas + Math.round(halalas * 0.15))}</small>}</label>
      <label className="form-field">ملاحظة للعميل (اختياري)<textarea className="form-control !min-h-20" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="ما يشمله السعر، الرسوم الحكومية خارجه..."/></label>
      <label className="rb-check"><input type="checkbox" checked={markWaiting} onChange={e => setMarkWaiting(e.target.checked)}/>ضع الطلب بانتظار موافقة العميل</label>
      <div className="flex gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={send.isPending}>{send.isPending ? 'جارٍ الإرسال…' : 'إرسال عرض السعر'}</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>إلغاء</button></div>
    </form>}
    {!quote && !open && <p className="rf-empty">لم يُرسل عرض سعر. يصل العرض للعميل بالبريد ويقبله أو يرفضه من طلبه.</p>}
    {error && <p role="alert" className="rf-errors">{error}</p>}
    {sent && <p role="status" className="text-xs font-semibold text-ok">أُرسل عرض السعر للعميل.</p>}
  </section>;
}

// ---- document checklist --------------------------------------------------------------

export const MAX_CHECKLIST = 20;
type DraftItem = { key?: string; label: string };
// Items as the API wants them: trimmed labels, blanks dropped, keys kept so
// existing attachment links survive a rename.
export function checklistInput(items: DraftItem[]): DraftItem[] {
  return items.map(i => ({ ...(i.key ? { key: i.key } : {}), label: i.label.trim() })).filter(i => i.label.length > 0);
}

// Office: which documents this request needs. The customer sees the list on
// their request and uploads against each item; the files panel shows the
// links and uploads for an item, so only the labels and re-linking live here.
export function ChecklistEditor({ requestId, checklist, attachments, onChanged }: { requestId: number; checklist: ChecklistItem[]; attachments: ServiceAttachment[]; onChanged: () => void | Promise<unknown> }) {
  const save = useSaveOfficeChecklist();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setOpen(false); setError(null); setSaved(false); }, [requestId]);
  function edit() { setItems(checklist.length ? checklist.map(i => ({ key: i.key, label: i.label })) : [{ label: '' }]); setOpen(true); setSaved(false); setError(null); }
  const update = (index: number, label: string) => setItems(items.map((i, n) => n === index ? { ...i, label } : i));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const data = checklistInput(items);
    if (data.length > MAX_CHECKLIST) { setError(`الحد ${MAX_CHECKLIST} مستندًا.`); return; }
    setError(null);
    try {
      await save.mutateAsync({ id: requestId, data: { items: data } });
      setOpen(false);
      await onChanged();
      setSaved(true);
    } catch { setError('تعذّر حفظ القائمة. حاول مجددًا.'); }
  }
  // Point an item at a file the customer (or the office) already uploaded.
  async function link(item: ChecklistItem, attachmentId: number) {
    setLinking(item.key); setError(null);
    try { await linkOfficeAttachmentToChecklist(requestId, attachmentId, { key: item.key }); await onChanged(); }
    catch { setError(`«${item.label}»: تعذّر ربط الملف.`); } finally { setLinking(null); }
  }
  return <section className="oc" aria-labelledby={`oc-${requestId}`}>
    <div className="rf-head">
      <h2 id={`oc-${requestId}`} className="rf-title"><ListChecks size={16} aria-hidden="true"/>المستندات المطلوبة من العميل</h2>
      {!open && <button type="button" className="btn btn-outline btn-sm" onClick={edit}>{checklist.length ? 'تعديل القائمة' : 'تحديد المستندات'}</button>}
    </div>
    {open ? <form onSubmit={submit} className="rb-form">
      <ul className="oc-edit">{items.map((item, index) => <li key={item.key ?? `new-${index}`}>
        <input className="form-control" value={item.label} onChange={e => update(index, e.target.value)} maxLength={120} placeholder="مثال: صورة الإقامة الحالية" aria-label={`المستند ${index + 1}`}/>
        <button type="button" className="rf-btn" onClick={() => setItems(items.filter((_, n) => n !== index))} aria-label={`حذف المستند ${index + 1}`}><Trash2 size={16}/></button>
      </li>)}</ul>
      {items.length < MAX_CHECKLIST && <button type="button" className="btn btn-outline btn-sm" onClick={() => setItems([...items, { label: '' }])}><Plus size={15}/>إضافة مستند</button>}
      <p className="muted text-xs leading-6">يرى العميل القائمة في طلبه ويرفع ملفًا لكل بند. الحذف لا يحذف الملفات المرفوعة.</p>
      <div className="flex gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ القائمة'}</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>إلغاء</button></div>
    </form> : checklist.length ? <ul className="oc-list">{checklist.map(item => <li key={item.key}>
      <span className="oc-main"><strong>{item.label}</strong><small>{item.attachmentName ? `مرتبط بـ «${item.attachmentName}»` : 'لم يُرفع بعد'}</small></span>
      {attachments.length > 0 && <label className="oc-link"><span className="sr-only">اربط «{item.label}» بملف</span>
        <select className="form-control" value={item.attachmentId ?? ''} disabled={linking === item.key} onChange={e => { const id = Number(e.target.value); if (id) link(item, id); }}>
          <option value="">{item.attachmentId ? 'ربط بملف آخر…' : 'ربط بملف مرفوع…'}</option>
          {attachments.filter(a => a.id !== item.attachmentId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          {item.attachmentId && <option value={item.attachmentId} hidden>{item.attachmentName}</option>}
        </select></label>}
    </li>)}</ul> : <p className="rf-empty">لم تُحدَّد مستندات مطلوبة. حدّدها ليعرف العميل ما يرفعه، وتظهر له في طلبه.</p>}
    {error && <p role="alert" className="rf-errors">{error}</p>}
    {saved && <p role="status" className="text-xs font-semibold text-ok">حُفظت القائمة وتظهر للعميل.</p>}
  </section>;
}

// ---- employees on a bulk request ------------------------------------------------------

export const employeeStatusNames: Record<RequestEmployeeStatus, string> = { pending: 'بانتظار البدء', in_progress: 'قيد التنفيذ', done: 'مكتمل', blocked: 'متعثّر' };
const employeeStatuses = Object.keys(employeeStatusNames) as RequestEmployeeStatus[];
export const employeeProgress = (employees: RequestEmployee[]) => `${formatNumber(employees.filter(e => e.itemStatus === 'done').length)}/${formatNumber(employees.length)} مكتمل`;
type EmployeeDraft = { itemStatus?: RequestEmployeeStatus; note?: string };
// The body for one row: the status always, the note only when it was edited
// (omitted means "keep" on the API; an emptied note is sent as null).
export function employeeUpdateBody(employee: RequestEmployee, draft: EmployeeDraft): { itemStatus: RequestEmployeeStatus; note?: string | null } {
  return { itemStatus: draft.itemStatus ?? employee.itemStatus, ...(draft.note !== undefined && draft.note.trim() !== (employee.note ?? '') ? { note: draft.note.trim() || null } : {}) };
}

// Office: one row per employee covered by a bulk request, each with its own
// progress and note, saved row by row. Only rows with unsaved edits differ from
// the request; the rest follow the list as it refreshes. The compact form
// (side editor) keeps the status and shows the note read-only.
export function RequestEmployees({ requestId, employees, compact = false, onChanged }: { requestId: number; employees: RequestEmployee[]; compact?: boolean; onChanged: () => void | Promise<unknown> }) {
  const update = useUpdateOfficeRequestEmployee();
  const [drafts, setDrafts] = useState<Record<number, EmployeeDraft>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<RequestEmployeeStatus | ''>('');
  useEffect(() => { setDrafts({}); setErrors({}); setFilter(''); }, [requestId]);
  const edit = (id: number, change: EmployeeDraft) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...change } }));
  async function save(employee: RequestEmployee) {
    const draft = drafts[employee.employeeId] ?? {};
    setSaving(employee.employeeId); setErrors(({ [employee.employeeId]: _, ...rest }) => rest);
    try {
      await update.mutateAsync({ id: requestId, employeeId: employee.employeeId, data: employeeUpdateBody(employee, draft) });
      setDrafts(({ [employee.employeeId]: _, ...rest }) => rest);
      await onChanged();
    } catch (err) {
      setErrors(e => ({ ...e, [employee.employeeId]: (err as { status?: number })?.status === 404 ? 'لم يعد هذا الموظف على الطلب.' : 'تعذّر الحفظ. حاول مجددًا.' }));
    } finally { setSaving(null); }
  }
  const shown = filter ? employees.filter(e => e.itemStatus === filter) : employees;
  const done = employees.filter(e => e.itemStatus === 'done').length;
  return <section className={`oe ${compact ? 'oe-compact' : ''}`} aria-labelledby={`oe-${requestId}`}>
    <div className="rf-head">
      <h2 id={`oe-${requestId}`} className="rf-title"><UsersRound size={16} aria-hidden="true"/>الموظفون على الطلب<span className="rf-count">{formatNumber(employees.length)}</span></h2>
      <span className="oe-progress nums" role="status">{employeeProgress(employees)}</span>
    </div>
    <div className="oe-bar" aria-hidden="true"><span style={{ width: `${employees.length ? (done / employees.length) * 100 : 0}%` }}/></div>
    {!compact && employees.length > 5 && <label className="oe-filter"><span className="sr-only">تصفية حسب الحالة</span><select className="form-control" value={filter} onChange={e => setFilter(e.target.value as RequestEmployeeStatus | '')}><option value="">كل الحالات</option>{employeeStatuses.map(s => <option key={s} value={s}>{employeeStatusNames[s]}</option>)}</select></label>}
    {employees.length === 0 ? <p className="rf-empty">لا يشمل هذا الطلب موظفين.</p> : <ul className="oe-list">{shown.map(employee => {
      const draft = drafts[employee.employeeId] ?? {};
      const status = draft.itemStatus ?? employee.itemStatus;
      const note = draft.note ?? employee.note ?? '';
      const dirty = status !== employee.itemStatus || (draft.note !== undefined && draft.note.trim() !== (employee.note ?? ''));
      return <li key={employee.employeeId} className={`oe-row oe-${status}`}>
        <span className="oe-name"><strong>{employee.fullName}</strong>{compact && employee.note && <small>{employee.note}</small>}</span>
        <label className="oe-status"><span className="sr-only">حالة {employee.fullName}</span><select className="form-control" value={status} onChange={e => edit(employee.employeeId, { itemStatus: e.target.value as RequestEmployeeStatus })}>{employeeStatuses.map(s => <option key={s} value={s}>{employeeStatusNames[s]}</option>)}</select></label>
        {!compact && <label className="oe-note"><span className="sr-only">ملاحظة عن {employee.fullName}</span><input className="form-control" value={note} maxLength={500} placeholder="ملاحظة (اختياري)" onChange={e => edit(employee.employeeId, { note: e.target.value })}/></label>}
        <button type="button" className={`btn btn-sm ${dirty ? 'btn-primary' : 'btn-outline'}`} disabled={!dirty || saving === employee.employeeId} onClick={() => save(employee)} aria-label={`حفظ ${employee.fullName}`}><Save size={14}/>{saving === employee.employeeId ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        {errors[employee.employeeId] && <p role="alert" className="oe-error">{errors[employee.employeeId]}</p>}
      </li>;
    })}</ul>}
    {filter && shown.length === 0 && <p className="rf-empty">لا يوجد موظفون بهذه الحالة.</p>}
  </section>;
}

// ---- invoice quantity ---------------------------------------------------------------

// The office invoice form's quantity fields, kept apart from the form itself:
// a bulk request (many employees) is billed per unit, a single one as before.
export type BulkInvoiceDraft = { quantity: string; unitAmount: string };
export const emptyBulkInvoice: BulkInvoiceDraft = { quantity: '', unitAmount: '' };
const parseQuantity = (text: string) => { const n = parseRiyals(text); return n !== null && n % 100 === 0 && n >= 100 && n <= 50_000 ? n / 100 : null; };
// What the issue body gets from the fields: nothing for a single invoice
// (quantity blank or 1, the amount field rules), `quantity` + `unitAmount` for a
// bulk one (the API computes amount = unitAmount × quantity), null when the
// typed values are not usable. The parent spreads the result into the body.
export function bulkInvoiceBody(draft: BulkInvoiceDraft): { quantity: number; unitAmount: number } | Record<string, never> | null {
  if (!draft.quantity.trim() || draft.quantity.trim() === '1') return {};
  const quantity = parseQuantity(draft.quantity);
  const unitAmount = parseRiyals(draft.unitAmount);
  return quantity === null || quantity < 1 || quantity > 500 || unitAmount === null || unitAmount < 100 ? null : { quantity, unitAmount };
}
export function BulkInvoiceFields({ value, onChange, defaultQuantity }: { value: BulkInvoiceDraft; onChange: (value: BulkInvoiceDraft) => void; defaultQuantity?: number }) {
  const body = bulkInvoiceBody(value);
  const bulk = body && 'quantity' in body ? body : null;
  return <div className="obi">
    <div className="obi-grid">
      <label className="form-field">الكمية<input className="form-control" dir="ltr" inputMode="numeric" value={value.quantity} onChange={e => onChange({ ...value, quantity: e.target.value })} placeholder={defaultQuantity && defaultQuantity > 1 ? String(defaultQuantity) : '1'}/>
        {defaultQuantity && defaultQuantity > 1 && !value.quantity.trim() ? <button type="button" className="obi-fill" onClick={() => onChange({ ...value, quantity: String(defaultQuantity) })}>عدد الموظفين على الطلب: {formatNumber(defaultQuantity)}</button> : null}</label>
      <label className="form-field">سعر الوحدة قبل الضريبة (ر.س)<input className="form-control" dir="ltr" inputMode="decimal" value={value.unitAmount} onChange={e => onChange({ ...value, unitAmount: e.target.value })} placeholder="0.00" disabled={!value.quantity.trim() || value.quantity.trim() === '1'}/></label>
    </div>
    {bulk ? <p className="obi-total">{formatNumber(bulk.quantity)} × {formatMoney(bulk.unitAmount)} = <strong>{formatMoney(bulk.quantity * bulk.unitAmount)}</strong> قبل الضريبة · شامل ضريبة 15%: {formatMoney(bulk.quantity * bulk.unitAmount + Math.round(bulk.quantity * bulk.unitAmount * 0.15))}</p>
      : body === null ? <p role="alert" className="obi-error">اكتب كمية صحيحة (1-500) وسعرًا للوحدة لا يقل عن ريال واحد.</p>
      : <p className="muted text-xs">اترك الكمية فارغة لفاتورة بمبلغ واحد؛ لأكثر من وحدة يُحسب المبلغ من سعر الوحدة.</p>}
  </div>;
}
