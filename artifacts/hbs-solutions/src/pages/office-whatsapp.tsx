import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send } from 'lucide-react';
import {
  getListWhatsappInboxQueryKey, useListWhatsappInbox, useReplyWhatsappInbox,
  type ListWhatsappInboxHandled, type MessageIntentIntent, type WhatsappInboxItem,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock } from '@/components/portal-ui';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';

// The office's WhatsApp inbox: inbound messages with the intent the system
// read from them (a keyword classifier inside the server, no external AI),
// the drafts it suggests, and a reply box.

export const intentLabels: Record<MessageIntentIntent, string> = {
  status_question: 'سؤال عن الحالة', payment: 'سداد', document: 'مستند', complaint: 'شكوى',
  new_request: 'طلب جديد', thanks: 'شكر', greeting: 'تحية', other: 'أخرى',
};
const handledLabels: Record<WhatsappInboxItem['handled'], string> = { request_message: 'أُضيفت إلى الطلب', inquiry: 'سُجّلت كاستفسار', unmatched: 'رقم غير معروف', ignored: 'مُتجاهَلة' };

export function replyError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 409) return 'انتهت نافذة الـ24 ساعة ولا يوجد قالب مهيأ. لا يمكن الرد عبر واتساب الآن؛ تواصل مع العميل بوسيلة أخرى.';
  if (status === 503) return 'رسائل واتساب غير مفعّلة حاليًا.';
  if (status === 404) return 'لم تعد هذه الرسالة موجودة.';
  return 'تعذّر إرسال الرد. حاول مرة أخرى.';
}

const filters: [ListWhatsappInboxHandled, string][] = [['unmatched', 'أرقام غير معروفة'], ['all', 'كل الوارد']];
export default function OfficeWhatsappInbox() {
  const [handled, setHandled] = useState<ListWhatsappInboxHandled>('unmatched');
  const params = { handled, limit: 50 };
  const inbox = useListWhatsappInbox(params, { query: { queryKey: getListWhatsappInboxQueryKey(params), refetchInterval: 60_000 } });
  return <PortalLayout staff>
    <PageHeading eyebrow="قنوات التواصل" title="واتساب الوارد" subtitle="رسائل العملاء الواردة عبر واتساب. يقرأ النظام مقصد كل رسالة ويقترح ردًا جاهزًا، وتُرسل ردودك من رقم المكتب."/>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="التصفية">{filters.map(([value, label]) => <button key={value} type="button" aria-pressed={handled === value} onClick={() => setHandled(value)} className={`min-h-11 rounded-full border px-4 text-xs font-bold ${handled === value ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>{label}</button>)}</div>
    <p className="muted mb-4 text-xs leading-6">تصنيف المقصد والردود المقترحة تُحسب داخل النظام بقواعد لغوية عربية، دون أي خدمة ذكاء اصطناعي خارجية.</p>
    {inbox.isLoading ? <LoadingBlock/> : inbox.isError ? <ErrorBlock retry={() => inbox.refetch()}/> : !inbox.data?.length
      ? <EmptyBlock title={handled === 'unmatched' ? 'لا توجد رسائل من أرقام غير معروفة' : 'لا توجد رسائل واردة'} text="تظهر هنا رسائل واتساب فور وصولها، مع مقصدها وردود مقترحة."/>
      : <div className="space-y-4">{inbox.data.map((item) => <InboxCard key={item.waMessageId} item={item} params={params}/>)}</div>}
  </PortalLayout>;
}

export function InboxCard({ item, params }: { item: WhatsappInboxItem; params: { handled: ListWhatsappInboxHandled; limit: number } }) {
  const qc = useQueryClient();
  const reply = useReplyWhatsappInbox();
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const confidence = Math.round(Math.max(0, Math.min(1, item.intent.confidence)) * 100);
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setNotice(null);
    try {
      const result = await reply.mutateAsync({ waMessageId: item.waMessageId, data: { text: body } });
      setText('');
      setNotice({ kind: 'ok', text: result.sentAs === 'template' ? 'أُرسل الرد كقالب معتمد.' : 'أُرسل الرد.' });
      await qc.invalidateQueries({ queryKey: getListWhatsappInboxQueryKey(params) });
    } catch (error) {
      setNotice({ kind: 'error', text: replyError(error) });
    }
  }
  return <article className="surface p-5 sm:p-6" aria-label={`رسالة من ${item.customerName ?? 'رقم غير معروف'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><MessageCircle size={17} className="text-ok" aria-hidden="true"/><strong>{item.customerName ?? 'رقم غير معروف'}</strong><span className="text-xs text-subtle" dir="ltr">{item.fromPhoneMasked}</span></div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-subtle"><time dateTime={item.receivedAt} title={formatDateTime(item.receivedAt)}>{formatRelative(item.receivedAt)}</time><span>{handledLabels[item.handled]}</span>{item.requestId && <Link href={`/office/requests/${item.requestId}`}>الطلب {item.intent.reference ?? `#${formatNumber(item.requestId)}`}</Link>}{item.userId && !item.requestId && <Link href={`/office/customers/${item.userId}`}>ملف العميل</Link>}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-sage px-2 py-0.5 text-xs font-bold text-teal" data-intent={item.intent.intent}>{intentLabels[item.intent.intent]}</span>
        {item.intent.urgent && <span className="inline-flex items-center rounded-md bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">عاجل</span>}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-subtle" aria-label={`درجة الثقة ${formatNumber(confidence)}٪`}><span className="h-1 w-14 overflow-hidden rounded-full bg-sunk" aria-hidden="true"><span className="block h-full rounded-full bg-teal" style={{ width: `${confidence}%` }}/></span>{formatNumber(confidence)}٪</span>
      </div>
    </div>
    <p className="mt-3 whitespace-pre-wrap rounded-xl bg-paper px-4 py-3 text-sm leading-7">{item.body}</p>
    {item.suggestedReplies.length > 0 && <div className="mt-3"><span className="mb-2 block text-xs font-bold text-subtle">ردود مقترحة</span><div className="flex flex-wrap gap-2">{item.suggestedReplies.map((suggestion, index) => <button key={index} type="button" className="max-w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-right text-xs leading-6 text-ink hover:bg-sage" onClick={() => { setNotice(null); setText(suggestion); }}>{suggestion}</button>)}</div></div>}
    <form onSubmit={send} className="mt-3 space-y-2">
      {!item.canReplyFreeText && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs leading-6 text-warn">خارج نافذة 24 ساعة: سيُرسل كقالب.</p>}
      <label className="form-field">الرد<textarea className="form-control !min-h-[96px]" value={text} maxLength={1024} onChange={(event) => { setNotice(null); setText(event.target.value); }} placeholder="اكتب ردك أو اختر ردًا مقترحًا"/></label>
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-danger' : 'font-bold text-ok'}`}>{notice.text}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={reply.isPending || !text.trim()}><Send size={15} aria-hidden="true"/>{reply.isPending ? 'جارٍ الإرسال…' : 'إرسال'}</button>
    </form>
  </article>;
}
