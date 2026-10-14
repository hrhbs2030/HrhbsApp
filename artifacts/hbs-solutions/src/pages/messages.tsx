import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { ArrowRight, ArrowUpLeft, Link2, MessagesSquare, Search, X } from 'lucide-react';
import {
  getListInquiriesQueryKey, getListMessageThreadsQueryKey, getListOfficeMessageThreadsQueryKey,
  useListInquiries, useListMessageThreads, useListOfficeMessageThreads, type Thread, type ThreadType,
} from '@workspace/api-client-react';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Pager, PortalLayout, Status, dateText, useDebouncedValue } from '@/components/portal-ui';
import { EmptyState } from '@/components/portal-kit';
import { ChannelBadge, Conversation } from '@/components/conversation';
import { CustomerWhatsapp, WhatsappFollowUp } from '@/components/whatsapp-follow-up';
import { formatNumber, formatRelative } from '@/lib/format';
import { setMessagesUnread, useNotificationStream } from '@/lib/use-notifications';
import '@/components/request-conversation.css';

// «الرسائل»: every conversation the person is part of, requests and inquiries
// together, newest activity first, with unread counts and the WhatsApp
// follow-up button per row. Customers and staff share the page; only the
// query, the filters and where a row leads differ.

const pageSize = 20;
export const threadHref = ({ type, id }: { type: ThreadType; id: number }, staff: boolean) => staff
  ? (type === 'request' ? `/office/requests/${id}?tab=conversation` : `/office/inquiries?open=${id}`)
  : (type === 'request' ? `/requests/${id}#messages` : `/inquiries/${id}`);
const typeNames: Record<ThreadType, string> = { request: 'طلب', inquiry: 'استفسار' };

// On desktop a row opens its conversation beside the list; the link still
// targets the full page for keyboard users, new tabs and phones.
function ThreadRow({ thread, staff, selected, onSelect }: { thread: Thread; staff: boolean; selected: boolean; onSelect?: (thread: Thread) => void }) {
  const last = thread.lastMessage;
  const author = !last ? null : last.authorRole === 'office' ? 'المكتب' : staff ? (thread.customer?.fullName ?? 'العميل') : 'أنت';
  const at = last?.createdAt ?? thread.updatedAt;
  const open = (event: MouseEvent) => { if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onSelect(thread); };
  return <li className={`inbox-row ${thread.unread > 0 ? 'is-unread' : ''} ${selected ? 'is-selected' : ''}`}>
    <Link href={threadHref(thread, staff)} onClick={open} aria-current={selected ? 'true' : undefined}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
        <span className={`inbox-type is-${thread.type}`}>{typeNames[thread.type]}</span>
        <span dir="ltr" className="nums">{thread.reference}</span>
        {staff && thread.customer && <span className="truncate">{thread.customer.fullName}</span>}
        <Status value={thread.status}/>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="inbox-title min-w-0 truncate">{thread.title}</span>
        {thread.unread > 0 && <span className="inbox-unread" aria-label={`${formatNumber(thread.unread)} غير مقروءة`}>{formatNumber(thread.unread)}</span>}
      </div>
      <div className="mt-1 flex items-start justify-between gap-3 text-xs">
        <span className="inbox-preview leading-6 text-quiet">{last ? <><b>{author}:</b> {last.preview}<ChannelBadge channel={last.channel}/></> : 'لا توجد رسائل بعد'}</span>
        <time className="shrink-0 whitespace-nowrap text-subtle" dateTime={at}>{formatRelative(at)}</time>
      </div>
    </Link>
    <WhatsappFollowUp link={thread.whatsapp?.link ?? null} number={thread.whatsapp?.number ?? null} verified={!!thread.whatsapp?.verified} scope={staff ? 'office' : 'customer'}/>
  </li>;
}

const chip = (active: boolean) => `min-h-11 rounded-full border px-4 text-xs font-semibold transition-colors ${active ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`;

// The split view opens from 1024px; below that a row navigates to its page.
function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1024px)');
    if (!media?.addEventListener) return;
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}

// The conversation pane beside the list: header with the reference, the
// status and the full-page link, then the shared conversation.
function ThreadPane({ thread, staff, onClose }: { thread: Thread; staff: boolean; onClose: () => void }) {
  return <section className="inbox-pane" aria-label={`محادثة ${thread.reference}`}>
    <div className="inbox-pane-head">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle"><span className={`inbox-type is-${thread.type}`}>{typeNames[thread.type]}</span><span dir="ltr" className="nums">{thread.reference}</span>{staff && thread.customer && <span className="truncate">{thread.customer.fullName}</span>}<Status value={thread.status}/></div>
        <h2 className="inbox-pane-title display">{thread.title}</h2>
      </div>
      <div className="flex flex-none items-center gap-1">
        <WhatsappFollowUp link={thread.whatsapp?.link ?? null} number={thread.whatsapp?.number ?? null} verified={!!thread.whatsapp?.verified} scope={staff ? 'office' : 'customer'}/>
        <Link href={threadHref(thread, staff)} className="btn btn-outline btn-sm">{thread.type === 'request' ? 'صفحة الطلب' : 'صفحة الاستفسار'}<ArrowUpLeft size={15} aria-hidden="true"/></Link>
        <button type="button" className="rf-btn" onClick={onClose} aria-label="إغلاق المحادثة"><X size={18} aria-hidden="true"/></button>
      </div>
    </div>
    <div className="inbox-pane-body">
      <Conversation key={`${thread.type}-${thread.id}`} thread={{ type: thread.type, id: thread.id }} scope={staff ? 'office' : 'customer'} closed={thread.status === 'completed'} whatsapp={thread.whatsapp ?? null}/>
    </div>
  </section>;
}

function Inbox({ staff }: { staff: boolean }) {
  const desktop = useDesktop();
  const [selected, setSelected] = useState<Thread | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState<ThreadType | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [unreadOnly, type, q]);
  // The `thread` stream event refetches the list; polling only covers a tab
  // whose stream could not be opened.
  const { live } = useNotificationStream();
  const refetchInterval = live ? false : 20_000;
  const customerParams = { page, pageSize, ...(unreadOnly ? { unread: true } : {}) };
  const officeParams = { ...customerParams, ...(q ? { q } : {}), ...(type ? { type } : {}) };
  const customer = useListMessageThreads(customerParams, { query: { queryKey: getListMessageThreadsQueryKey(customerParams), enabled: !staff, refetchInterval, placeholderData: keepPreviousData } });
  const office = useListOfficeMessageThreads(officeParams, { query: { queryKey: getListOfficeMessageThreadsQueryKey(officeParams), enabled: staff, refetchInterval, placeholderData: keepPreviousData } });
  const list = staff ? office : customer;
  const unreadTotal = list.data?.unreadTotal;
  useEffect(() => { if (typeof unreadTotal === 'number') setMessagesUnread(unreadTotal); }, [unreadTotal]);
  const total = list.data?.total ?? 0;
  useEffect(() => { if (list.data && page > 1 && page > Math.max(1, Math.ceil(total / pageSize))) setPage(Math.max(1, Math.ceil(total / pageSize))); }, [list.data, page, total]);
  const rows = list.data?.items ?? [];
  const filtered = unreadOnly || !!q || !!type;
  // The selected row follows the list (unread count, last message) while it is on the page.
  const current = selected ? rows.find(t => t.type === selected.type && t.id === selected.id) ?? selected : null;
  return <PortalLayout staff={staff}>
    <PageHeading eyebrow="صندوق الوارد" title="الرسائل" subtitle={staff ? 'كل محادثات الطلبات والاستفسارات مع العملاء في مكان واحد.' : 'محادثاتك مع المكتب على طلباتك واستفساراتك.'}/>
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية الرسائل">
        <button type="button" aria-pressed={!unreadOnly} className={chip(!unreadOnly)} onClick={() => setUnreadOnly(false)}>الكل</button>
        <button type="button" aria-pressed={unreadOnly} className={chip(unreadOnly)} onClick={() => setUnreadOnly(true)}>غير المقروءة{typeof unreadTotal === 'number' && unreadTotal > 0 && <span className="nums"> ({formatNumber(unreadTotal)})</span>}</button>
        {staff && <>
          <span className="hidden w-px self-stretch bg-line lg:block" aria-hidden="true"/>
          <button type="button" aria-pressed={type === 'request'} className={chip(type === 'request')} onClick={() => setType(type === 'request' ? '' : 'request')}>طلبات</button>
          <button type="button" aria-pressed={type === 'inquiry'} className={chip(type === 'inquiry')} onClick={() => setType(type === 'inquiry' ? '' : 'inquiry')}>استفسارات</button>
        </>}
      </div>
      {staff && <label className="relative flex-1"><span className="sr-only">بحث في الرسائل</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17} aria-hidden="true"/><input className="form-control !pr-10" placeholder="ابحث بالمرجع أو الموضوع أو اسم العميل أو نص الرسالة" value={search} onChange={e => setSearch(e.target.value)} maxLength={200}/></label>}
    </div>
    <div className={`inbox-split ${desktop && current ? 'has-pane' : ''}`}>
      <div className="inbox-list">
        {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/>
          : !rows.length ? <EmptyBlock title={unreadOnly ? 'لا توجد رسائل غير مقروءة' : filtered ? 'لا توجد محادثات مطابقة' : 'لا توجد محادثات بعد'}
            text={unreadOnly ? 'قرأت كل شيء. تظهر الرسائل الجديدة هنا فور وصولها.' : filtered ? 'جرّب كلمة بحث أخرى أو أزل التصفية.' : staff ? 'تبدأ المحادثات عندما يكتب عميل في طلب أو يرسل استفسارًا.' : 'تظهر هنا محادثاتك مع المكتب على كل طلب أو استفسار ترسله.'}
            {...(!staff && !filtered ? { action: 'استفسار جديد', href: '/inquiries' } : {})}/>
          : <ul className={`surface m-0 list-none overflow-hidden p-0 transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.map(t => <ThreadRow key={`${t.type}-${t.id}`} thread={t} staff={staff} selected={!!current && current.type === t.type && current.id === t.id} onSelect={desktop ? setSelected : undefined}/>)}</ul>}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage}/>
      </div>
      {desktop && (current ? <ThreadPane thread={current} staff={staff} onClose={() => setSelected(null)}/>
        : rows.length > 0 && <div className="inbox-pane inbox-pane--empty" aria-hidden="true"><EmptyState compact icon={<MessagesSquare size={22} strokeWidth={1.5}/>} title="اختر محادثة" text="تُفتح هنا بجانب القائمة، وتبقى كل رسالة في سجل طلبها."/></div>)}
    </div>
  </PortalLayout>;
}
export function MessagesInbox() { return <Inbox staff={false}/>; }
export function OfficeMessagesInbox() { return <Inbox staff/>; }

// One inquiry as a conversation (customer side). The list already holds every
// inquiry of the account, so no second request is needed for the header.
export function InquiryThread() {
  const { id } = useParams<{ id: string }>();
  const parsed = Number(id);
  const valid = Number.isInteger(parsed) && parsed > 0;
  const list = useListInquiries({ query: { queryKey: getListInquiriesQueryKey(), enabled: valid } });
  const inquiry = list.data?.find(i => i.id === parsed);
  return <PortalLayout><div className="max-w-[860px]">
    <Link href="/inquiries" className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-subtle no-underline hover:text-ink"><ArrowRight size={16}/>استفساراتي</Link>
    {!valid ? <EmptyBlock title="الاستفسار غير متاح" text="تحقق من الرابط وحاول مرة أخرى."/>
      : list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/>
      : !inquiry ? <EmptyBlock title="الاستفسار غير متاح" text="هذا الاستفسار غير موجود في حسابك." action="استفساراتي" href="/inquiries"/>
      : <>
        <PageHeading eyebrow={`استفسار #${inquiry.id}`} title={inquiry.subject} action={<div className="flex flex-wrap items-center gap-3"><Status value={inquiry.status}/><CustomerWhatsapp thread={{ type: 'inquiry', id: inquiry.id }}/></div>}/>
        <div className="surface p-5 sm:p-8">
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span>أُرسل في {dateText(inquiry.createdAt)}</span>
            {inquiry.linkedServiceRequestReference && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-sunk px-2 py-0.5 text-quiet"><Link2 size={12} aria-hidden="true"/>الطلب <span dir="ltr" className="nums font-semibold">{inquiry.linkedServiceRequestReference}</span></span>}
          </div>
          <Conversation thread={{ type: 'inquiry', id: inquiry.id }} scope="customer"/>
        </div>
      </>}
  </div></PortalLayout>;
}
