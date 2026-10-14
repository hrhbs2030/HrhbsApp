import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, MessageCircle, Send } from 'lucide-react';
import {
  getListWhatsappInboxQueryKey, useListWhatsappInbox, useReplyWhatsappInbox,
  type ListWhatsappInboxHandled, type MessageIntentIntent, type WhatsappInboxItem,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock } from '@/components/portal-ui';
import { Avatar, Chip, EmptyState, FilterChip, Toolbar } from '@/components/portal-kit';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import './office.css';

// The office's WhatsApp inbox as a two-pane reader: the list of inbound
// messages on the start side, the selected message with the intent the
// system read from it (a keyword classifier inside the server, no external
// AI), the drafts it suggests and the reply box on the end side. On a phone
// the panes stack: the list first, the reader once a message is chosen.

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
  const items = inbox.data ?? [];
  // The selected message; the first one once the list arrives, kept across refreshes while it is still listed.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On a phone, choosing a message opens the reader; the back button returns to the list.
  const [reading, setReading] = useState(false);
  useEffect(() => { if (items.length && !items.some(i => i.waMessageId === selectedId)) setSelectedId(items[0].waMessageId); }, [items, selectedId]);
  useEffect(() => { setReading(false); }, [handled]);
  const selected = items.find(i => i.waMessageId === selectedId) ?? items[0];
  return <PortalLayout staff>
    <PageHeading eyebrow="قنوات التواصل" title="واتساب الوارد" subtitle="رسائل العملاء الواردة عبر واتساب. يقرأ النظام مقصد كل رسالة ويقترح ردًا جاهزًا، وتُرسل ردودك من رقم المكتب."/>
    <Toolbar filters={<div className="flex flex-wrap gap-2" role="group" aria-label="التصفية">{filters.map(([value, label]) => <FilterChip key={value} active={handled === value} onClick={() => setHandled(value)}>{label}</FilterChip>)}</div>} />
    <p className="muted mb-4 text-xs leading-6">تصنيف المقصد والردود المقترحة تُحسب داخل النظام بقواعد لغوية عربية، دون أي خدمة ذكاء اصطناعي خارجية.</p>
    {inbox.isLoading ? <LoadingBlock variant="table"/> : inbox.isError ? <ErrorBlock retry={() => inbox.refetch()}/> : !items.length
      ? <EmptyBlock title={handled === 'unmatched' ? 'لا توجد رسائل من أرقام غير معروفة' : 'لا توجد رسائل واردة'} text="تظهر هنا رسائل واتساب فور وصولها، مع مقصدها وردود مقترحة."/>
      : <div className="wa-split">
        <ul className={`surface wa-list ${reading ? 'is-hidden-phone' : ''}`} aria-label="الرسائل الواردة">{items.map(item => <li key={item.waMessageId}><button type="button" className="wa-item" aria-pressed={selected?.waMessageId === item.waMessageId} onClick={() => { setSelectedId(item.waMessageId); setReading(true); }}>
          <Avatar name={item.customerName ?? '؟'} size={40} />
          <span className="min-w-0">
            <span className="wa-item-top"><span className="wa-item-name">{item.customerName ?? 'رقم غير معروف'}</span><time className="wa-item-time" dateTime={item.receivedAt} title={formatDateTime(item.receivedAt)}>{formatRelative(item.receivedAt)}</time></span>
            <span className="wa-item-preview">{item.body}</span>
            <span className="wa-item-tags"><Chip tone="teal" size="sm" data-intent={item.intent.intent}>{intentLabels[item.intent.intent]}</Chip>{item.intent.urgent && <Chip tone="danger" size="sm" dot>عاجل</Chip>}{item.handled === 'unmatched' && <Chip tone="outline" size="sm">{handledLabels.unmatched}</Chip>}</span>
          </span>
        </button></li>)}</ul>
        <div className={`wa-reader ${reading ? '' : 'is-hidden-phone'}`}>
          <button type="button" className="wa-back" onClick={() => setReading(false)}><ArrowRight size={15} aria-hidden="true"/>كل الرسائل</button>
          {selected ? <InboxCard key={selected.waMessageId} item={selected} params={params}/> : <div className="surface"><EmptyState compact title="اختر رسالة" text="اختر رسالة من القائمة لقراءتها والرد عليها." icon={<MessageCircle size={22} strokeWidth={1.5}/>}/></div>}
        </div>
      </div>}
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
    <div className="wa-reader-head">
      <div className="wa-reader-who">
        <Avatar name={item.customerName ?? '؟'} size={44} />
        <div className="min-w-0">
          <h2 className="display wa-reader-name">{item.customerName ?? 'رقم غير معروف'}</h2>
          <div className="wa-reader-meta"><span dir="ltr" className="nums">{item.fromPhoneMasked}</span><time dateTime={item.receivedAt} title={formatDateTime(item.receivedAt)}>{formatRelative(item.receivedAt)}</time><span>{handledLabels[item.handled]}</span>{item.requestId && <Link href={`/office/requests/${item.requestId}`}>الطلب {item.intent.reference ?? `#${formatNumber(item.requestId)}`}</Link>}{item.userId && !item.requestId && <Link href={`/office/customers/${item.userId}`}>ملف العميل</Link>}</div>
        </div>
      </div>
      <div className="wa-reader-tags">
        <Chip tone="teal" data-intent={item.intent.intent}>{intentLabels[item.intent.intent]}</Chip>
        {item.intent.urgent && <Chip tone="danger" dot>عاجل</Chip>}
        <span className="wa-confidence" aria-label={`درجة الثقة ${formatNumber(confidence)}٪`}><span className="wa-confidence-bar" aria-hidden="true"><span style={{ width: `${confidence}%` }}/></span>{formatNumber(confidence)}٪</span>
      </div>
    </div>
    <p className="wa-bubble">{item.body}</p>
    {item.handled === 'unmatched' && <p className="wa-link-note">هذا الرقم غير مرتبط بأي عميل، فلا يُحفظ الرد في محادثة. لربطه، اطلب من صاحبه توثيق رقمه من «الإعدادات» في بوابته؛ أو ابحث عن العميل في <Link href={`/office/customers?q=${encodeURIComponent(item.customerName ?? '')}`}>ملفات العملاء</Link> وأنشئ الطلب باسمه من ملفه.</p>}
    {item.suggestedReplies.length > 0 && <div className="mt-4"><span className="mb-1 block text-xs font-medium text-subtle">ردود مقترحة</span><div className="wa-suggest">{item.suggestedReplies.map((suggestion, index) => <button key={index} type="button" onClick={() => { setNotice(null); setText(suggestion); }}>{suggestion}</button>)}</div></div>}
    <form onSubmit={send} className="wa-compose">
      {!item.canReplyFreeText && <p className="wa-template">خارج نافذة 24 ساعة: سيُرسل كقالب.</p>}
      <label className="form-field">الرد<textarea className="form-control !min-h-[96px]" value={text} maxLength={1024} onChange={(event) => { setNotice(null); setText(event.target.value); }} placeholder="اكتب ردك أو اختر ردًا مقترحًا"/></label>
      <div className="wa-compose-foot">
        {notice ? <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`m-0 text-sm ${notice.kind === 'error' ? 'text-danger' : 'font-semibold text-ok'}`}>{notice.text}</p> : <span className="text-xs text-subtle nums">{formatNumber(text.length)}/1024</span>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={reply.isPending || !text.trim()} data-loading={reply.isPending || undefined}><Send size={15} aria-hidden="true"/>{reply.isPending ? 'جارٍ الإرسال…' : 'إرسال'}</button>
      </div>
    </form>
  </article>;
}
