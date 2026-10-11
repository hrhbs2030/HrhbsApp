import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare, Send } from 'lucide-react';
import {
  getListOfficeServiceRequestMessagesQueryKey, getListServiceRequestMessagesQueryKey,
  sendOfficeServiceRequestMessage, sendServiceRequestMessage,
  useListOfficeServiceRequestMessages, useListServiceRequestMessages, type RequestMessage, type RequestSubject,
} from '@workspace/api-client-react';
import { formatDateTime } from '@/lib/format';
import './request-conversation.css';

// Messages between the customer and the office on one request. Polls while
// open; the other side gets an email that a message arrived (never its text).
export function RequestConversation({ requestId, scope, closed = false }: { requestId: number; scope: 'customer' | 'office'; closed?: boolean }) {
  const qc = useQueryClient();
  const office = scope === 'office';
  const key = office ? getListOfficeServiceRequestMessagesQueryKey(requestId) : getListServiceRequestMessagesQueryKey(requestId);
  const customerList = useListServiceRequestMessages(requestId, { query: { queryKey: getListServiceRequestMessagesQueryKey(requestId), enabled: !office, refetchInterval: 20_000 } });
  const officeList = useListOfficeServiceRequestMessages(requestId, { query: { queryKey: getListOfficeServiceRequestMessagesQueryKey(requestId), enabled: office, refetchInterval: 20_000 } });
  const list = office ? officeList : customerList;
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = list.data?.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [count]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      if (office) await sendOfficeServiceRequestMessage(requestId, { body: text });
      else await sendServiceRequestMessage(requestId, { body: text });
      setBody('');
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError((err as { status?: number })?.status === 429 ? 'أرسلت رسائل كثيرة. انتظر دقائق ثم أعد المحاولة.' : 'تعذّر إرسال الرسالة. حاول مجددًا.');
    } finally { setBusy(false); }
  }
  const mine = (m: RequestMessage) => m.authorRole === scope;
  const who = (m: RequestMessage) => mine(m) ? 'أنت' : m.authorRole === 'office' ? 'المكتب' : 'العميل';
  return <section id="messages" className="rc" aria-labelledby={`rc-${requestId}`}>
    <h2 id={`rc-${requestId}`} className="rf-title"><MessagesSquare size={16} aria-hidden="true"/>المحادثة</h2>
    <div className="rc-thread" aria-live="polite">
      {list.isLoading ? <p className="rc-empty">جارٍ التحميل…</p>
        : !count ? <p className="rc-empty">{office ? 'لا توجد رسائل. اكتب للعميل هنا بدل الاتصال، وتبقى المحادثة في سجل الطلب.' : 'لا توجد رسائل بعد. اكتب للمكتب سؤالك عن هذا الطلب.'}</p>
        : list.data!.map(m => <div key={m.id} className={`rc-msg ${mine(m) ? 'is-mine' : ''}`}>
          <div className="rc-bubble"><p>{m.body}</p></div>
          <span className="rc-meta">{who(m)} · <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time></span>
        </div>)}
      <div ref={end}/>
    </div>
    {closed && !office ? <p className="rc-empty">اكتمل الطلب. لسؤال جديد أرسل استفسارًا.</p> : <form onSubmit={submit} className="rc-form">
      <label className="sr-only" htmlFor={`rc-input-${requestId}`}>اكتب رسالة</label>
      <textarea id={`rc-input-${requestId}`} className="form-control" value={body} onChange={e => setBody(e.target.value)} maxLength={2000} rows={2}
        placeholder={office ? 'اكتب للعميل…' : 'اكتب للمكتب… لا تشارك كلمات المرور أو رموز التحقق.'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}/>
      <button type="submit" className="btn btn-primary" disabled={busy || !body.trim()} aria-label="إرسال"><Send size={16}/><span className="hidden sm:inline">إرسال</span></button>
    </form>}
    {error && <p role="alert" className="rf-errors">{error}</p>}
  </section>;
}

export function SubjectChip({ subject }: { subject: RequestSubject | null | undefined }) {
  if (!subject) return null;
  return <span className="rc-subject">{subject.type === 'employee' ? 'الموظف' : 'الترخيص'}: <b>{subject.label}</b></span>;
}

export function ReplyBadge({ lastMessage, status, viewer }: { lastMessage: { by: string } | null | undefined; status: string; viewer: 'customer' | 'office' }) {
  if (!lastMessage || status === 'completed' || lastMessage.by === viewer) return null;
  return <span className="rc-badge">{viewer === 'office' ? 'ردّ العميل' : 'رسالة من المكتب'}</span>;
}
