import { useEffect, useState, type FormEvent } from 'react';
import { FileSignature, ListChecks, Plus, ScanText, Trash2 } from 'lucide-react';
import {
  getListOfficeServiceRequestMessagesQueryKey, linkOfficeAttachmentToChecklist, useCreateOfficeReminder, useExtractOfficeAttachmentDocument,
  useListOfficeServiceRequestMessages, useSaveOfficeChecklist, useSendOfficeQuote,
  type ChecklistItem, type RequestQuote, type ServiceAttachment,
} from '@workspace/api-client-react';
import { ReminderForm, emptyDraft, type Draft } from '@/components/reminder-ui';
import { formatDateTime, formatMoney, parseRiyals } from '@/lib/format';
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
    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><ScanText size={16} aria-hidden="true"/>تنبيه انتهاء من «{file.name}»</h3>
    {saved ? <div className="space-y-3"><p role="status" className="text-sm font-bold text-ok">حُفظ التنبيه، ويصل للعميل قبل الانتهاء.</p><button type="button" className="btn btn-outline btn-sm" onClick={onClose}>إغلاق</button></div>
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
    {sent && <p role="status" className="text-xs font-bold text-ok">أُرسل عرض السعر للعميل.</p>}
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
    {saved && <p role="status" className="text-xs font-bold text-ok">حُفظت القائمة وتظهر للعميل.</p>}
  </section>;
}
