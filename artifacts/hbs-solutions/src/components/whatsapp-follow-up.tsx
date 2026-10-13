import { MessageCircle } from 'lucide-react';
import {
  getGetWhatsappLinkQueryKey, getListOfficeMessageThreadsQueryKey, useGetWhatsappLink, useListOfficeMessageThreads,
  type Thread, type ThreadType,
} from '@workspace/api-client-react';
import './request-conversation.css';

// The WhatsApp icon shown only inside the portal, on a request or an inquiry:
// customers open the office number with the reference prefilled (so the
// inbound webhook files the reply in the right thread); staff open the
// customer's number, and only when it is verified.

// "966555208213" reads as the number people know, 0555208213.
export const localNumber = (number: string | null | undefined) => number ? number.replace(/^966(?=\d{9}$)/, '0') : '';

export function WhatsappFollowUp({ link, number, verified, scope, className = '' }: { link: string | null; number: string | null; verified: boolean; scope: 'customer' | 'office'; className?: string }) {
  const customer = scope === 'customer';
  const enabled = !!link && (customer || verified);
  const label = customer ? `تابع عبر واتساب ${localNumber(number) || ''}`.trim()
    : enabled ? `راسل العميل عبر واتساب ${localNumber(number)}`.trim() : 'رقم العميل غير موثّق';
  if (!enabled) return <button type="button" className={`wa-btn ${className}`} disabled title={label} aria-label={label}><MessageCircle size={20} aria-hidden="true"/></button>;
  return <a href={link} target="_blank" rel="noopener noreferrer" className={`wa-btn ${className}`} title={label} aria-label={label}><MessageCircle size={20} aria-hidden="true"/></a>;
}

// The customer's link for one of their threads, from the API so the prefilled
// text and the office number stay the server's.
export function CustomerWhatsapp({ thread, className }: { thread: { type: ThreadType; id: number }; className?: string }) {
  const params = { type: thread.type, id: thread.id };
  const q = useGetWhatsappLink(params, { query: { queryKey: getGetWhatsappLinkQueryKey(params), staleTime: 5 * 60_000 } });
  return <WhatsappFollowUp link={q.data?.link ?? null} number={q.data?.number ?? null} verified scope="customer" className={className}/>;
}

// Staff pages that show one request or inquiry have no thread row of their
// own; the office thread list, filtered by the reference, supplies it (and
// with it whether the customer's number is verified).
export function useOfficeThread(type: ThreadType, id: number, reference: string | null | undefined): Thread | undefined {
  const params = { q: reference ?? '', pageSize: 5 };
  const q = useListOfficeMessageThreads(params, { query: { queryKey: getListOfficeMessageThreadsQueryKey(params), enabled: !!reference && id > 0, staleTime: 60_000 } });
  return q.data?.items.find(t => t.type === type && t.id === id);
}
