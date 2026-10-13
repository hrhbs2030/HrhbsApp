import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, MessagesSquare, Send } from 'lucide-react';
import {
  getGetNotificationPreferencesQueryKey, getListInquiriesQueryKey, getListInquiryMessagesQueryKey, getListOfficeInquiriesQueryKey,
  getListOfficeInquiryMessagesQueryKey, getListOfficeServiceRequestMessagesQueryKey, getListServiceRequestMessagesQueryKey,
  sendInquiryMessage, sendOfficeInquiryMessage, sendOfficeServiceRequestMessage, sendServiceRequestMessage,
  useGetNotificationPreferences, useListInquiryMessages, useListOfficeInquiryMessages, useListOfficeServiceRequestMessages,
  useListServiceRequestMessages, useMarkOfficeThreadRead, useMarkThreadRead,
  type MessageChannel, type RequestMessage, type ThreadType, type ThreadWhatsapp,
} from '@workspace/api-client-react';
import { formatDateTime } from '@/lib/format';
import { setMessagesUnread, threadListKeys, useNotificationStream } from '@/lib/use-notifications';
import './request-conversation.css';

// One conversation between the customer and the office: on a service request
// or on an inquiry, seen from either side. The four list/send pairs differ
// only by route, so the thread picks its pair and the rest is shared.

export type ThreadRef = { type: ThreadType; id: number };
export type Scope = 'customer' | 'office';

export const threadComposerId = ({ type, id }: ThreadRef) => type === 'request' ? `rc-input-${id}` : `rc-input-inquiry-${id}`;
export const threadMessagesKey = ({ type, id }: ThreadRef, scope: Scope) => scope === 'office'
  ? (type === 'inquiry' ? getListOfficeInquiryMessagesQueryKey(id) : getListOfficeServiceRequestMessagesQueryKey(id))
  : (type === 'inquiry' ? getListInquiryMessagesQueryKey(id) : getListServiceRequestMessagesQueryKey(id));

// Marks a message that also went through WhatsApp (sent by staff with the
// checkbox, or a customer reply routed in by the webhook).
export function ChannelBadge({ channel }: { channel: MessageChannel | undefined }) {
  if (channel !== 'whatsapp') return null;
  return <span className="rc-channel"><MessageCircle size={11} aria-hidden="true"/>واتساب</span>;
}

// What the composer tells the person when a send fails. A 409 carries the
// server's own Arabic reason (unverified number, WhatsApp off).
export function sendError(error: unknown): string {
  const { status, data } = (error ?? {}) as { status?: number; data?: { error?: unknown } | null };
  if (status === 429) return 'أرسلت رسائل كثيرة. انتظر دقائق ثم أعد المحاولة.';
  if (status === 409) return typeof data?.error === 'string' && /[؀-ۿ]/.test(data.error) ? data.error : 'تعذّر الإرسال عبر واتساب: رقم العميل غير موثّق أو واتساب غير مفعّل.';
  return 'تعذّر إرسال الرسالة. حاول مجددًا.';
}

export function Conversation({ thread, scope, closed = false, whatsapp = null, whatsappConfigured }: {
  thread: ThreadRef; scope: Scope; closed?: boolean; whatsapp?: ThreadWhatsapp | null; whatsappConfigured?: boolean;
}) {
  const qc = useQueryClient();
  const office = scope === 'office';
  const inquiry = thread.type === 'inquiry';
  const key = threadMessagesKey(thread, scope);
  // Live refetch comes from the `thread` stream event; polling only covers a
  // tab whose stream could not be opened.
  const { live } = useNotificationStream();
  const refetchInterval = live ? false : 20_000;
  const customerRequest = useListServiceRequestMessages(thread.id, { query: { queryKey: getListServiceRequestMessagesQueryKey(thread.id), enabled: !office && !inquiry, refetchInterval } });
  const officeRequest = useListOfficeServiceRequestMessages(thread.id, { query: { queryKey: getListOfficeServiceRequestMessagesQueryKey(thread.id), enabled: office && !inquiry, refetchInterval } });
  const customerInquiry = useListInquiryMessages(thread.id, { query: { queryKey: getListInquiryMessagesQueryKey(thread.id), enabled: !office && inquiry, refetchInterval } });
  const officeInquiry = useListOfficeInquiryMessages(thread.id, { query: { queryKey: getListOfficeInquiryMessagesQueryKey(thread.id), enabled: office && inquiry, refetchInterval } });
  const list = office ? (inquiry ? officeInquiry : officeRequest) : (inquiry ? customerInquiry : customerRequest);
  // Staff may also push the text to the customer's WhatsApp when the number is
  // verified and the office has the Cloud API on (the preferences say so).
  const prefs = useGetNotificationPreferences({ query: { queryKey: getGetNotificationPreferencesQueryKey(), enabled: office && whatsappConfigured === undefined, staleTime: 5 * 60_000 } });
  const canWhatsapp = office && !!whatsapp?.verified && (whatsappConfigured ?? prefs.data?.whatsappAvailable ?? false);
  const [viaWhatsapp, setViaWhatsapp] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEl = useRef<HTMLDivElement>(null);
  // Opening the thread reads it: the read marker clears its unread count and
  // the answer carries the new total for the sidebar badge. The mutation
  // object changes identity per render, so a ref keeps the effect to the thread.
  const markCustomer = useMarkThreadRead();
  const markOffice = useMarkOfficeThreadRead();
  const mark = useRef(office ? markOffice : markCustomer);
  mark.current = office ? markOffice : markCustomer;
  const markRead = () => mark.current.mutateAsync({ type: thread.type, id: thread.id })
    .then((result) => { setMessagesUnread(result.unreadTotal); for (const queryKey of threadListKeys()) void qc.invalidateQueries({ queryKey }); })
    .catch(() => { /* the next open, or the list refetch, marks it */ });
  useEffect(() => { void markRead(); }, [thread.type, thread.id, office]);
  // Scrolling the thread on every refetch would yank the reader away from an
  // older message; only a message they just sent, or new ones while they are
  // already at the bottom, move it. The first load always shows the latest.
  const nearBottom = useRef(true);
  const justSent = useRef(false);
  const seen = useRef<Set<number> | null>(null);
  const [arrived, setArrived] = useState('');
  const count = list.data?.length ?? 0;
  useEffect(() => {
    const messages = list.data;
    if (!messages) return;
    // Announce only messages from the other side that arrived after the first
    // load, and mark them read since the thread is open in front of the person.
    if (seen.current) {
      const fresh = messages.filter(m => !seen.current!.has(m.id) && m.authorRole !== scope);
      if (fresh.length) { setArrived(`${fresh.length === 1 ? 'رسالة جديدة' : 'رسائل جديدة'} من ${office ? 'العميل' : 'المكتب'}: ${fresh[fresh.length - 1].body}`); void markRead(); }
    }
    const first = seen.current === null;
    seen.current = new Set(messages.map(m => m.id));
    const el = threadEl.current;
    if (el && (first || justSent.current || nearBottom.current)) el.scrollTop = el.scrollHeight;
    justSent.current = false;
  }, [count, list.data]);
  function onScroll() {
    const el = threadEl.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      const officeInput = { body: text, ...(canWhatsapp && viaWhatsapp ? { viaWhatsapp: true } : {}) };
      if (office) await (inquiry ? sendOfficeInquiryMessage(thread.id, officeInput) : sendOfficeServiceRequestMessage(thread.id, officeInput));
      else await (inquiry ? sendInquiryMessage(thread.id, { body: text }) : sendServiceRequestMessage(thread.id, { body: text }));
      setBody('');
      justSent.current = true;
      // An inquiry message also moves its status (open/answered) in the lists.
      const stale = [key, ...threadListKeys(), ...(inquiry ? [getListInquiriesQueryKey(), getListOfficeInquiriesQueryKey()] : [])];
      await Promise.all(stale.map(queryKey => qc.invalidateQueries({ queryKey })));
    } catch (err) {
      setError(sendError(err));
    } finally { setBusy(false); }
  }
  const mine = (m: RequestMessage) => m.authorRole === scope;
  const who = (m: RequestMessage) => mine(m) ? 'أنت' : m.authorRole === 'office' ? 'المكتب' : 'العميل';
  const composer = threadComposerId(thread);
  const titleId = `rc-${thread.type}-${thread.id}`;
  return <section id="messages" className="rc" aria-labelledby={titleId}>
    <h2 id={titleId} className="rf-title"><MessagesSquare size={16} aria-hidden="true"/>المحادثة</h2>
    <div ref={threadEl} className="rc-thread" onScroll={onScroll}>
      {list.isLoading ? <p className="rc-empty">جارٍ التحميل…</p>
        : list.isError ? <p className="rc-empty" role="alert">تعذّر تحميل الرسائل. <button type="button" className="underline" onClick={() => void list.refetch()}>إعادة المحاولة</button></p>
        : !count ? <p className="rc-empty">{office ? 'لا توجد رسائل. اكتب للعميل هنا بدل الاتصال، وتبقى المحادثة في سجل الطلب.' : inquiry ? 'لا توجد رسائل بعد.' : 'لا توجد رسائل بعد. اكتب للمكتب سؤالك عن هذا الطلب.'}</p>
        : list.data!.map(m => <div key={m.id} className={`rc-msg ${mine(m) ? 'is-mine' : ''}`}>
          <div className="rc-bubble"><p>{m.body}</p></div>
          <span className="rc-meta">{who(m)} · <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time><ChannelBadge channel={m.channel}/></span>
        </div>)}
    </div>
    <p className="sr-only" role="status" aria-live="polite">{arrived}</p>
    {closed && !office ? <p className="rc-empty">اكتمل الطلب. لسؤال جديد أرسل استفسارًا.</p> : <form onSubmit={submit} className="rc-form">
      <div className="rc-compose">
        <label className="sr-only" htmlFor={composer}>اكتب رسالة</label>
        <textarea id={composer} className="form-control" value={body} onChange={e => setBody(e.target.value)} maxLength={2000} rows={2}
          placeholder={office ? 'اكتب للعميل…' : 'اكتب للمكتب… لا تشارك كلمات المرور أو رموز التحقق.'}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}/>
        {canWhatsapp && <label className="rc-via"><input type="checkbox" checked={viaWhatsapp} onChange={e => setViaWhatsapp(e.target.checked)}/><MessageCircle size={14} aria-hidden="true"/>أرسل عبر واتساب أيضًا</label>}
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy || !body.trim()} aria-label="إرسال"><Send size={16}/><span className="hidden sm:inline">إرسال</span></button>
    </form>}
    {error && <p role="alert" className="rf-errors">{error}</p>}
  </section>;
}
