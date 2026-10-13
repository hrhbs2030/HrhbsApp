import { type RequestSubject, type ThreadWhatsapp } from '@workspace/api-client-react';
import { Conversation, threadComposerId } from './conversation';
import './request-conversation.css';

// The request pages' view of the conversation: a thin wrapper over
// components/conversation.tsx, kept so the request detail pages and their
// "reply to the office" call to action need not know about thread types.

export const composerId = (requestId: number) => threadComposerId({ type: 'request', id: requestId });
// Brings the conversation into view and puts the cursor in the composer. Used
// by the request page's "reply to the office" call to action.
export function focusComposer(requestId: number) {
  document.getElementById('messages')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const input = document.getElementById(composerId(requestId));
  if (input) input.focus({ preventScroll: true });
}

export function RequestConversation({ requestId, scope, closed = false, whatsapp = null }: { requestId: number; scope: 'customer' | 'office'; closed?: boolean; whatsapp?: ThreadWhatsapp | null }) {
  return <Conversation thread={{ type: 'request', id: requestId }} scope={scope} closed={closed} whatsapp={whatsapp}/>;
}

export function SubjectChip({ subject }: { subject: RequestSubject | null | undefined }) {
  if (!subject) return null;
  return <span className="rc-subject">{subject.type === 'employee' ? 'الموظف' : 'الترخيص'}: <b>{subject.label}</b></span>;
}

export function ReplyBadge({ lastMessage, status, viewer }: { lastMessage: { by: string } | null | undefined; status: string; viewer: 'customer' | 'office' }) {
  if (!lastMessage || status === 'completed' || lastMessage.by === viewer) return null;
  return <span className="rc-badge">{viewer === 'office' ? 'ردّ العميل' : 'رسالة من المكتب'}</span>;
}
