import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, Printer, ReceiptText, Star } from 'lucide-react';
import {
  getGetServiceRequestQueryKey, getListOfficeServiceRequestInvoicesQueryKey, getListServiceRequestInvoicesQueryKey, getListServiceRequestsQueryKey,
  useIssueOfficeInvoice, useListOfficeServiceRequestInvoices, useListServiceRequestInvoices,
  useRateServiceRequest, useRefreshInvoicePayment, useStartInvoicePayment, useUpdateOfficeInvoice,
  type Invoice,
} from '@workspace/api-client-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDate, formatMoney, formatNumber, parseRiyals } from '@/lib/format';
import { createInvoiceIssueKeyManager } from '@/lib/invoice-idempotency';
import { BulkInvoiceFields, bulkInvoiceBody, emptyBulkInvoice, type BulkInvoiceDraft } from '@/components/office-request-extras';
import { contact } from '@/content/contact';
import './request-billing.css';

const methodNames: Record<string, string> = { manual: 'سداد لدى المكتب', online: 'دفع إلكتروني' };

// In-page confirmation instead of window.confirm: browsers may suppress native
// dialogs, they ignore the page's direction and fonts, and they block polling.
// Shared with the company file and reminders, which have the same deletes.
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, danger = false, busy = false, onConfirm, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; confirmLabel: string;
  danger?: boolean; busy?: boolean; onConfirm: () => void; children?: ReactNode;
}) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent dir="rtl" className="rb-dialog">
      <AlertDialogHeader className="text-right sm:text-right">
        <AlertDialogTitle className="display text-lg font-semibold text-ink">{title}</AlertDialogTitle>
        {description ? <AlertDialogDescription className="text-sm leading-7 text-quiet">{description}</AlertDialogDescription> : <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>}
      </AlertDialogHeader>
      {children}
      <AlertDialogFooter className="gap-2 sm:justify-start sm:space-x-0">
        {/* The project's own button shapes; the primitives' default classes are reset by `rb-dialog`. */}
        <AlertDialogAction className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={e => { e.preventDefault(); onConfirm(); }}>{confirmLabel}</AlertDialogAction>
        <AlertDialogCancel className="btn btn-outline" disabled={busy}>إلغاء</AlertDialogCancel>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function InvoiceStatus({ status }: { status: Invoice['status'] }) {
  const names = { issued: 'غير مسددة', paid: 'مسددة', cancelled: 'ملغاة' } as const;
  return <span className={`pill pill-${status}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{names[status]}</span>;
}

// A simplified tax invoice that prints on its own page.
export function printInvoice(invoice: Invoice) {
  const win = window.open('', '_blank');
  if (!win) return;
  const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const rate = formatNumber(invoice.vatRateBasisPoints / 100);
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(invoice.reference)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;margin:40px;color:#173e42}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #d9d4c5;padding:10px;text-align:right}th{background:#f6f4ed}.muted{color:#5d706a;font-size:13px}.total td{font-weight:bold}</style></head><body>
<h1>فاتورة ضريبية مبسطة</h1><div class="muted">${esc(invoice.seller.name)}${invoice.seller.vatNumber ? ` · الرقم الضريبي ${esc(invoice.seller.vatNumber)}` : ''}</div>
<p>رقم الفاتورة: <b dir="ltr">${esc(invoice.reference)}</b><br>تاريخ الإصدار: ${esc(formatDate(invoice.issuedAt))}<br>${invoice.requestReference === null ? 'اشتراك' : `الطلب: <span dir="ltr">${esc(invoice.requestReference)}</span>`}${invoice.quantity > 1 && invoice.unitAmount !== null ? `<br>الكمية: ${esc(formatNumber(invoice.quantity))} × ${esc(formatMoney(invoice.unitAmount))}` : ''}</p>
<table><tr><th>البيان</th><th>المبلغ</th></tr><tr><td>${esc(invoice.description)}</td><td>${esc(formatMoney(invoice.amount))}</td></tr>
<tr><td>ضريبة القيمة المضافة (${rate}%)</td><td>${esc(formatMoney(invoice.vat))}</td></tr>
<tr class="total"><td>الإجمالي شامل الضريبة</td><td>${esc(formatMoney(invoice.total))}</td></tr></table>
<p class="muted">الحالة: ${invoice.status === 'paid' ? `مسددة في ${esc(formatDate(invoice.paidAt))}` : invoice.status === 'cancelled' ? 'ملغاة' : 'غير مسددة'}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

export function InvoiceRow({ invoice, children }: { invoice: Invoice; children?: ReactNode }) {
  return <li className="rb-row">
    <div className="rb-main">
      <div className="rb-line"><strong>{invoice.description}</strong><InvoiceStatus status={invoice.status}/></div>
      <div className="rb-meta"><span dir="ltr" className="nums">{invoice.reference}</span><span>{formatDate(invoice.issuedAt)}</span>
        {invoice.paymentMethod && invoice.status === 'paid' && <span>{methodNames[invoice.paymentMethod]}{invoice.paymentReference ? ` · ${invoice.paymentReference}` : ''}</span>}</div>
      <div className="rb-amounts">{invoice.quantity > 1 && invoice.unitAmount !== null && <span>{formatNumber(invoice.quantity)} × {formatMoney(invoice.unitAmount)}</span>}<span>المبلغ {formatMoney(invoice.amount)}</span><span>الضريبة {formatMoney(invoice.vat)}</span><strong>الإجمالي {formatMoney(invoice.total)}</strong></div>
    </div>
    <div className="rb-actions">
      <button type="button" className="rf-btn" onClick={() => printInvoice(invoice)} aria-label={`طباعة ${invoice.reference}`} title="طباعة الفاتورة"><Printer size={17}/></button>
      {children}
    </div>
  </li>;
}

// Back from the gateway's payment page (`?invoice=N` on the request page or
// the company page): ask the server to confirm with the gateway once, then
// let the caller refresh whatever lists show the invoice.
export function useRefreshReturnedInvoice(returnedInvoiceId: number | null, onDone: () => Promise<unknown> | void) {
  const refresh = useRefreshInvoicePayment();
  const checked = useRef(false);
  useEffect(() => {
    if (!returnedInvoiceId || checked.current) return;
    checked.current = true;
    refresh.mutateAsync({ id: returnedInvoiceId }).then(() => onDone()).catch(() => { /* the list still shows the stored status */ });
  }, [returnedInvoiceId]);
  return refresh.isPending;
}

// "Pay now" for any payable invoice, on a request or on a subscription. The
// gateway is the only place the site ever sends the person to; on failure the
// caller refetches (`onChanged`) because the invoice may have changed meanwhile.
export function PayInvoiceButton({ invoice, onChanged }: { invoice: Invoice; onChanged?: () => Promise<unknown> | void }) {
  const pay = useStartInvoicePayment();
  const [error, setError] = useState<string | null>(null);
  if (!invoice.canPayOnline) return null;
  async function startPayment() {
    setError(null);
    try {
      const { url } = await pay.mutateAsync({ id: invoice.id });
      // Only ever leave the site for a secure payment page.
      if (!/^https:\/\//i.test(url)) throw new Error('unexpected payment URL');
      window.location.assign(url);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      setError(status === 409 ? 'هذه الفاتورة مسددة أو ملغاة.' : status === 503 ? 'الدفع الإلكتروني غير متاح حاليًا. تواصل مع المكتب للسداد.' : 'تعذّر فتح صفحة الدفع. حاول بعد قليل.');
      await onChanged?.();
    }
  }
  return <>
    <button type="button" className="btn btn-primary btn-sm" disabled={pay.isPending} onClick={startPayment}><CreditCard size={15}/>{pay.isPending ? 'جارٍ الفتح…' : 'ادفع الآن'}</button>
    {error && <span role="alert" className="rb-pay-error">{error}</span>}
  </>;
}

export function CustomerInvoices({ requestId, returnedInvoiceId }: { requestId: number; returnedInvoiceId: number | null }) {
  const qc = useQueryClient();
  const list = useListServiceRequestInvoices(requestId, { query: { queryKey: getListServiceRequestInvoicesQueryKey(requestId), refetchInterval: 30_000 } });
  const refresh = () => qc.invalidateQueries({ queryKey: getListServiceRequestInvoicesQueryKey(requestId) });
  const checking = useRefreshReturnedInvoice(returnedInvoiceId, refresh);
  if (!list.data?.length) return null;
  return <section className="rb" aria-labelledby={`rb-${requestId}`}>
    <h2 id={`rb-${requestId}`} className="rf-title"><ReceiptText size={16} aria-hidden="true"/>الفواتير</h2>
    <ul className="rb-list">{list.data.map(invoice => <InvoiceRow key={invoice.id} invoice={invoice}><PayInvoiceButton invoice={invoice} onChanged={refresh}/></InvoiceRow>)}</ul>
    {checking && <p role="status" className="rb-note">جارٍ التحقق من الدفع…</p>}
    {list.data.some(i => i.status === 'issued' && !i.canPayOnline) && <p className="rb-note">للسداد تواصل مع المكتب، ويظهر السداد هنا عند تسجيله.</p>}
  </section>;
}

export function OfficeInvoices({ requestId, onChanged, employeesCount = 0 }: { requestId: number; onChanged: () => void; employeesCount?: number }) {
  const qc = useQueryClient();
  const key = getListOfficeServiceRequestInvoicesQueryKey(requestId);
  const list = useListOfficeServiceRequestInvoices(requestId, { query: { queryKey: key } });
  const issue = useIssueOfficeInvoice();
  const update = useUpdateOfficeInvoice();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [awaiting, setAwaiting] = useState(true);
  const [bulk, setBulk] = useState<BulkInvoiceDraft>(emptyBulkInvoice);
  const [error, setError] = useState<string | null>(null);
  const issueInFlight = useRef(false);
  const halalas = parseRiyals(amount) ?? 0;
  // A bulk invoice (quantity × unit price) replaces the single amount field.
  const extra = bulkInvoiceBody(bulk);
  const isBulk = extra !== null && 'quantity' in extra;
  const draftSignature = JSON.stringify({ requestId, description, amount, awaiting, bulk });
  const [issueKeyManager] = useState(() => createInvoiceIssueKeyManager(draftSignature));
  const idempotencyKey = issueKeyManager.forSignature(draftSignature);
  const valid = description.trim().length >= 2 && (isBulk || halalas >= 100);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (issueInFlight.current || issue.isPending) return;
    if (extra === null) { setError('اكتب كمية صحيحة وسعر وحدة لا يقل عن ريال واحد.'); return; }
    if (!valid) { setError('اكتب البيان ومبلغًا لا يقل عن ريال واحد.'); return; }
    setError(null);
    issueInFlight.current = true;
    try {
      const amountHalalas = isBulk ? extra.quantity * extra.unitAmount : halalas;
      await issue.mutateAsync({ id: requestId, data: { description: description.trim(), amount: amountHalalas, ...extra, markAwaitingPayment: awaiting, idempotencyKey } });
      setOpen(false); setDescription(''); setAmount(''); setBulk(emptyBulkInvoice);
      await qc.invalidateQueries({ queryKey: key });
      onChanged();
    } catch { setError('تعذّر إصدار الفاتورة. حاول مجددًا؛ إذا تعذّر التأكد، أعد المحاولة بالمسودة نفسها لتجنب إصدار مكرر.'); }
    finally { issueInFlight.current = false; }
  }
  // The confirmation dialog in progress: which invoice, which action, and the
  // optional payment reference typed for "mark paid".
  const [pending, setPending] = useState<{ invoice: Invoice; action: 'mark_paid' | 'cancel' } | null>(null);
  const [reference, setReference] = useState('');
  function ask(invoice: Invoice, action: 'mark_paid' | 'cancel') { setReference(''); setPending({ invoice, action }); }
  async function act(invoice: Invoice, action: 'mark_paid' | 'cancel') {
    setPending(null);
    setError(null);
    try {
      await update.mutateAsync({ id: invoice.id, data: { action, paymentReference: action === 'mark_paid' ? reference.trim() || null : null } });
      await qc.invalidateQueries({ queryKey: key });
      // A paid or cancelled invoice changes the request's standing in the office lists and summary.
      onChanged();
    } catch (e) {
      setError((e as { status?: number })?.status === 409 ? 'الفاتورة مسددة أو ملغاة، وقد تكون سُددت إلكترونيًا.' : (e as { status?: number })?.status === 502 ? 'تعذّر التأكد من بوابة الدفع أن الفاتورة غير مسددة. حاول بعد قليل.' : 'تعذّر تحديث الفاتورة.');
      await qc.invalidateQueries({ queryKey: key });
    }
  }
  return <section className="rb" aria-labelledby={`rbo-${requestId}`}>
    <div className="rf-head">
      <h2 id={`rbo-${requestId}`} className="rf-title"><ReceiptText size={16} aria-hidden="true"/>الفواتير</h2>
      {!open && <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>إصدار فاتورة</button>}
    </div>
    {open && <form onSubmit={submit} className="rb-form">
      <label className="form-field">البيان<input className="form-control" value={description} onChange={e => setDescription(e.target.value)} maxLength={300} placeholder="مثال: أتعاب تجديد الإقامة"/></label>
      {!isBulk && <label className="form-field">المبلغ قبل الضريبة (ر.س)<input className="form-control" dir="ltr" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"/>
        {valid && <small className="muted font-normal">الإجمالي شامل ضريبة 15%: {formatMoney(halalas + Math.round(halalas * 0.15))}</small>}</label>}
      {employeesCount > 1 && <BulkInvoiceFields value={bulk} onChange={setBulk} defaultQuantity={employeesCount}/>}
      <label className="rb-check"><input type="checkbox" checked={awaiting} onChange={e => setAwaiting(e.target.checked)}/>غيّر حالة الطلب إلى «بانتظار السداد»</label>
        <div className="flex gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={issue.isPending}>{issue.isPending ? 'جارٍ الإصدار…' : 'إصدار وإرسال للعميل'}</button><button type="button" className="btn btn-outline btn-sm" disabled={issue.isPending} onClick={() => setOpen(false)}>إلغاء</button></div>
    </form>}
    {list.data?.length ? <ul className="rb-list">{list.data.map(invoice => <InvoiceRow key={invoice.id} invoice={invoice}>
      {invoice.status === 'issued' && <>
        <button type="button" className="btn btn-outline btn-sm" disabled={update.isPending} onClick={() => ask(invoice, 'mark_paid')}>تسجيل السداد</button>
        <button type="button" className="rf-btn rf-btn--danger" disabled={update.isPending} onClick={() => ask(invoice, 'cancel')}>إلغاء</button>
      </>}
    </InvoiceRow>)}</ul> : !open && <p className="rf-empty">لا توجد فواتير على هذا الطلب.</p>}
    {error && <p role="alert" className="rf-errors">{error}</p>}
    <ConfirmDialog open={pending?.action === 'mark_paid'} onOpenChange={o => { if (!o) setPending(null); }} busy={update.isPending}
      title={`تسجيل سداد الفاتورة ${pending?.invoice.reference ?? ''}`} description={pending ? `الإجمالي ${formatMoney(pending.invoice.total)}. يظهر السداد للعميل فورًا.` : undefined}
      confirmLabel="تسجيل السداد" onConfirm={() => pending && act(pending.invoice, 'mark_paid')}>
      <label className="form-field">رقم المرجع (اختياري)<input className="form-control" dir="ltr" value={reference} onChange={e => setReference(e.target.value)} maxLength={120} placeholder="رقم التحويل أو الإيصال" autoFocus/></label>
    </ConfirmDialog>
    <ConfirmDialog open={pending?.action === 'cancel'} onOpenChange={o => { if (!o) setPending(null); }} busy={update.isPending} danger
      title={`إلغاء الفاتورة ${pending?.invoice.reference ?? ''}؟`} description="تظهر الفاتورة للعميل بحالة «ملغاة» ولا يمكن سدادها بعد ذلك."
      confirmLabel="إلغاء الفاتورة" onConfirm={() => pending && act(pending.invoice, 'cancel')}/>
  </section>;
}

export function RatingPanel({ requestId, rating, comment, onRated }: { requestId: number; rating: number | null; comment: string | null; onRated: () => void }) {
  const qc = useQueryClient();
  const mutation = useRateServiceRequest();
  const [value, setValue] = useState(0);
  const [text, setText] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value) return;
    try {
      await mutation.mutateAsync({ id: requestId, data: { rating: value, comment: text.trim() || null } });
      // The detail page shows the stored rating; the list rows carry it too.
      await Promise.all([qc.invalidateQueries({ queryKey: getGetServiceRequestQueryKey(requestId) }), qc.invalidateQueries({ queryKey: getListServiceRequestsQueryKey() })]);
      onRated();
    } catch { /* error shown below */ }
  }
  const stars = (current: number, interactive: boolean) => <div className="rb-stars" role={interactive ? 'radiogroup' : undefined} aria-label="التقييم">
    {[1, 2, 3, 4, 5].map(n => interactive
      ? <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} من 5`} onClick={() => setValue(n)}><Star size={26} fill={n <= value ? 'currentColor' : 'none'}/></button>
      : <Star key={n} size={20} fill={n <= current ? 'currentColor' : 'none'} aria-hidden="true"/>)}
  </div>;
  if (rating) return <section className="rb rb-rated" aria-label="تقييمك">
    <h2 className="rf-title">تقييمك للخدمة</h2>{stars(rating, false)}{comment && <p className="rb-note">«{comment}»</p>}
    {/* Happy customers are asked for a public review; others hear that the office follows up. */}
    {rating <= 3 ? <p className="rb-note">شكرًا، سيتواصل معك المكتب لتحسين التجربة.</p>
      : contact.reviewUrl ? <p className="rb-note">شكرًا! يسعدنا تقييمك على Google: <a href={contact.reviewUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-copper">اكتب تقييمك</a></p>
      : <p className="rb-note">شكرًا لك، يصل تقييمك إلى إدارة المكتب.</p>}
  </section>;
  return <form onSubmit={submit} className="rb" aria-label="قيّم الخدمة">
    <h2 className="rf-title">كيف كانت تجربتك؟</h2>
    {stars(value, true)}
    <label className="form-field">ملاحظة (اختياري)<textarea className="form-control !min-h-20" value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder="ما الذي أعجبك أو يمكن تحسينه؟"/></label>
    {mutation.isError && <p role="alert" className="rf-errors">تعذّر حفظ التقييم. حاول مجددًا.</p>}
    <button type="submit" className="btn btn-primary btn-sm" disabled={!value || mutation.isPending}>{mutation.isPending ? 'جارٍ الإرسال…' : 'إرسال التقييم'}</button>
  </form>;
}
