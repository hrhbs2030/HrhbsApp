import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { Bell, CheckCheck, X } from 'lucide-react';
import type { Notification, NotificationPriority } from '@workspace/api-client-react';
import { dismissToast, useNotificationFeed, useNotificationToasts } from '@/lib/use-notifications';
import { formatRelative } from '@/lib/format';

// The bell in the portal header (customer and office) with its unread badge,
// the panel of the latest notifications, and the small toasts shown when a
// notification arrives over the stream while the user works.

export const priorityLabels: Partial<Record<NotificationPriority, string>> = { urgent: 'عاجل', high: 'مهم' };
export function PriorityChip({ priority }: { priority: NotificationPriority }) {
  const label = priorityLabels[priority];
  if (!label) return null;
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${priority === 'urgent' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>{label}</span>;
}
export const badgeText = (count: number) => count > 99 ? '99+' : String(count);

const PANEL_SIZE = 8;
// Lucide stroke mirrors --icon-stroke (index.css).
const ICON = 1.75;
export function NotificationBell({ staff = false }: { staff?: boolean }) {
  const [, navigate] = useLocation();
  const feed = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const allHref = staff ? '/office/notifications' : '/notifications';
  // Escape and clicks outside close the panel; focus returns to the bell so
  // keyboard users land where they left.
  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) button.current?.focus(); };
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onPointer = (event: MouseEvent | TouchEvent) => { const target = event.target as Node | null; if (target && !panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('touchstart', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>('button, a')?.focus(); }, [open]);
  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const openItem = async (item: Notification) => {
    close(false);
    try { await feed.markRead(item.id); } catch { /* the row stays unread; opening the page still works */ }
    if (item.path) navigate(item.path);
  };
  const latest = feed.items.slice(0, PANEL_SIZE);
  const unread = feed.unreadCount;
  return <div className="notif-bell">
    <button ref={button} type="button" className="notif-bell-btn" aria-label={unread > 0 ? `الإشعارات، ${badgeText(unread)} غير مقروءة` : 'الإشعارات'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={22} strokeWidth={ICON} aria-hidden="true"/>
      {unread > 0 && <span className="notif-badge" aria-hidden="true">{badgeText(unread)}</span>}
    </button>
    {open && <div ref={panel} role="dialog" aria-labelledby={titleId} className="notif-panel" dir="rtl" onKeyDown={onPanelKey}>
      <div className="notif-panel-head">
        <h2 id={titleId} className="m-0 text-sm font-semibold">الإشعارات{unread > 0 && <span className="notif-panel-count">{badgeText(unread)} جديدة</span>}</h2>
        <button type="button" className="notif-panel-close" onClick={() => close()} aria-label="إغلاق الإشعارات"><X size={20} strokeWidth={ICON} aria-hidden="true"/></button>
      </div>
      {feed.isLoading ? <p className="notif-panel-empty">جارٍ التحميل…</p> : !latest.length ? <p className="notif-panel-empty">لا توجد إشعارات بعد.</p> : <ul className="notif-list">{latest.map((item) => <li key={item.id}>
        <button type="button" className={`notif-item ${item.readAt ? '' : 'notif-item--unread'}`} onClick={() => void openItem(item)}>
          <span className="notif-item-top"><span className="notif-item-title">{item.title}</span><PriorityChip priority={item.priority}/></span>
          <span className="notif-item-body">{item.body}</span>
          <span className="notif-item-meta"><time dateTime={item.createdAt}>{formatRelative(item.createdAt)}</time>{item.count > 1 && <span>· {item.count} أحداث</span>}</span>
        </button>
      </li>)}</ul>}
      <div className="notif-panel-foot">
        <Link href={allHref} className="notif-panel-link" onClick={() => close(false)}>كل الإشعارات</Link>
        <button type="button" className="notif-panel-link" disabled={unread === 0 || feed.marking} onClick={() => { void feed.markAllRead().catch(() => {}); }}><CheckCheck size={16} strokeWidth={ICON} aria-hidden="true"/>تعليم الكل كمقروء</button>
      </div>
    </div>}
  </div>;
}

export function NotificationToasts() {
  const toasts = useNotificationToasts();
  const [, navigate] = useLocation();
  if (!toasts.length) return null;
  return <div className="notif-toasts" dir="rtl" role="status" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className="notif-toast">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><strong className="truncate text-sm">{toast.title}</strong><PriorityChip priority={toast.priority}/></div>
      <p className="m-0 mt-1 line-clamp-2 text-xs leading-6 text-quiet">{toast.body}</p>
      {toast.path && <button type="button" className="mt-1 text-xs font-semibold text-teal-bright" onClick={() => { dismissToast(toast.id); navigate(toast.path!); }}>فتح</button>}
    </div>
    <button type="button" className="notif-panel-close" onClick={() => dismissToast(toast.id)} aria-label="إغلاق التنبيه"><X size={18} strokeWidth={ICON} aria-hidden="true"/></button>
  </div>)}</div>;
}
