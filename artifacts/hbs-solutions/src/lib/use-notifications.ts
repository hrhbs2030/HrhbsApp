import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  getGetNotificationBriefQueryKey, getListInquiryMessagesQueryKey, getListMessageThreadsQueryKey, getListNotificationsQueryKey,
  getListOfficeInquiryMessagesQueryKey, getListOfficeMessageThreadsQueryKey, getListOfficeServiceRequestMessagesQueryKey,
  getListServiceRequestMessagesQueryKey, getStreamNotificationsUrl,
  useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead,
  type ListNotificationsParams, type Notification, type NotificationList, type ThreadType,
} from '@workspace/api-client-react';

// The in-app notification centre: one list query shared by the bell and the
// notifications page, kept fresh by a server-sent event stream (one
// connection per tab, however many components listen) with 60 s polling
// while the stream is down.

// ---- stream: a module-level singleton, reference counted ---------------------

// `reconnecting`: the stream dropped and a retry is scheduled (polling covers
// the gap); `failed`: nothing will be retried (no EventSource, office access
// revoked) until an auth change or a reset.
type StreamState = 'closed' | 'open' | 'reconnecting' | 'failed';
let source: EventSource | null = null;
let refs = 0;
let state: StreamState = 'closed';
let qcForRetry: QueryClient | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
// Exponential backoff from 1 s to 30 s with ±25 % jitter, so many tabs do not
// hit a restarted server in the same second.
export function reconnectDelay(attempt: number, random: number = Math.random()): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random * 0.5));
}
function clearRetry() { if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; } }
function scheduleRetry() {
  clearRetry();
  if (!qcForRetry || refs === 0) return;
  const timer = setTimeout(() => { retryTimer = null; if (refs > 0 && !source && state === 'reconnecting' && qcForRetry) open(qcForRetry); }, reconnectDelay(attempts));
  (timer as unknown as { unref?: () => void }).unref?.();
  retryTimer = timer;
  attempts += 1;
}
// Back online or the tab shown again: retry at once instead of waiting out the backoff.
function retryNow() { if (state === 'reconnecting' && !source && refs > 0 && qcForRetry) { clearRetry(); open(qcForRetry); } }
const stateListeners = new Set<() => void>();
function setState(next: StreamState) { state = next; for (const fn of stateListeners) fn(); }
const subscribeState = (fn: () => void) => { stateListeners.add(fn); return () => { stateListeners.delete(fn); }; };
const getState = () => state;

// The stream lives at the same root-relative address the generated client
// uses for every call (`/api/...`, no base path: see custom-fetch.ts, which
// only prefixes a base URL when setBaseUrl() was called, and it never is here).
export const streamUrl = () => getStreamNotificationsUrl();

const listKey = () => getListNotificationsQueryKey();
const isList = (value: unknown): value is NotificationList => !!value && typeof value === 'object' && Array.isArray((value as NotificationList).items);

// Every cached variant of the list (unread-only, paged) gets the new row where
// it belongs; the count is the server's, so it is set rather than incremented.
function applyIncoming(qc: QueryClient, item: Notification) {
  qc.setQueriesData<NotificationList>({ queryKey: listKey() }, (current) => {
    if (!isList(current)) return current;
    if (current.items.some((row) => row.id === item.id)) return current;
    return { ...current, items: [item, ...current.items], unreadCount: current.unreadCount + (item.readAt ? 0 : 1) };
  });
  void qc.invalidateQueries({ queryKey: listKey() });
  void qc.invalidateQueries({ queryKey: getGetNotificationBriefQueryKey() });
}
function applyUnread(qc: QueryClient, count: number) {
  qc.setQueriesData<NotificationList>({ queryKey: listKey() }, (current) => isList(current) && current.unreadCount !== count ? { ...current, unreadCount: count } : current);
}

// ---- messages: the unread total and `thread` events --------------------------
// One number for the sidebar badge, set by whichever source knew it last: the
// thread list (seeded on mount), a read marker's answer, or a `thread` stream
// event. Not derived from the react-query cache because the list may never
// have been loaded on the page that shows the badge.
let messagesUnread = 0;
const unreadListeners = new Set<() => void>();
export function setMessagesUnread(count: number) {
  if (!Number.isFinite(count) || count === messagesUnread) return;
  messagesUnread = Math.max(0, count);
  for (const fn of unreadListeners) fn();
}
const subscribeUnread = (fn: () => void) => { unreadListeners.add(fn); return () => { unreadListeners.delete(fn); }; };
const getUnread = () => messagesUnread;
export function useMessagesUnread(): number { return useSyncExternalStore(subscribeUnread, getUnread, getUnread); }

export type ThreadEvent = { type: ThreadType; id: number; unreadTotal?: number };
// Both roles' keys are invalidated: only the ones in this tab's cache refetch.
export const threadMessageKeys = ({ type, id }: ThreadEvent) => type === 'inquiry'
  ? [getListInquiryMessagesQueryKey(id), getListOfficeInquiryMessagesQueryKey(id)]
  : [getListServiceRequestMessagesQueryKey(id), getListOfficeServiceRequestMessagesQueryKey(id)];
export const threadListKeys = () => [getListMessageThreadsQueryKey(), getListOfficeMessageThreadsQueryKey()];
export function applyThreadEvent(qc: QueryClient, event: ThreadEvent) {
  if ((event.type !== 'request' && event.type !== 'inquiry') || typeof event.id !== 'number') return;
  for (const queryKey of [...threadMessageKeys(event), ...threadListKeys()]) void qc.invalidateQueries({ queryKey });
  if (typeof event.unreadTotal === 'number') setMessagesUnread(event.unreadTotal);
}

function open(qc: QueryClient) {
  qcForRetry = qc;
  if (source || typeof EventSource === 'undefined') { if (!source) setState('failed'); return; }
  const stream = new EventSource(streamUrl(), { withCredentials: true });
  source = stream;
  stream.addEventListener('open', () => { if (source === stream) { attempts = 0; setState('open'); } });
  stream.addEventListener('unread', (event) => {
    if (source !== stream) return;
    try { const { count } = JSON.parse((event as MessageEvent).data) as { count: number }; if (typeof count === 'number') applyUnread(qc, count); } catch { /* malformed event: the next poll corrects it */ }
  });
  stream.addEventListener('thread', (event) => {
    if (source !== stream) return;
    try { applyThreadEvent(qc, JSON.parse((event as MessageEvent).data) as ThreadEvent); } catch { /* malformed event: the fallback poll corrects it */ }
  });
  stream.addEventListener('notification', (event) => {
    if (source !== stream) return; // a closed stream of a previous identity
    try { const item = JSON.parse((event as MessageEvent).data) as Notification; if (typeof item?.id === 'number') { applyIncoming(qc, item); pushToast(item); } } catch { /* ignored */ }
  });
  // Any error (network switch, proxy idle timeout, server restart) drops the
  // stream; the list polls meanwhile and a fresh connection is tried after a
  // growing delay. The browser's own retry is not used because a 401/403 after
  // sign-out would make it hammer the server forever.
  stream.addEventListener('error', () => { if (source === stream) { stream.close(); source = null; setState('reconnecting'); scheduleRetry(); } });
}
function close() {
  clearRetry();
  attempts = 0;
  source?.close();
  source = null;
  if (state === 'open' || state === 'reconnecting') setState('closed');
}

// Keeps the stream open while at least one component is mounted (the bell in
// every portal page), and closes it once the last one unmounts.
export function useNotificationStream(): { live: boolean } {
  const qc = useQueryClient();
  useEffect(() => {
    refs += 1;
    if (refs === 1) open(qc);
    // Sign-in/out or another user: drop the old identity's stream and toasts;
    // a new stream opens only for a still-mounted bell (new cookie identity).
    // Office access revoked: close for good, nothing is reopened.
    const onAuthChanged = () => { close(); setState('closed'); for (const id of getToastIds()) dismissToast(id); if (refs > 0) open(qc); };
    const onOfficeDenied = () => { close(); setState('failed'); for (const id of getToastIds()) dismissToast(id); };
    const doc = typeof document === 'undefined' ? null : document;
    const onVisible = () => { if (doc?.visibilityState !== 'hidden') retryNow(); };
    window.addEventListener('hbs:auth-changed', onAuthChanged);
    window.addEventListener('hbs:office-access-denied', onOfficeDenied);
    window.addEventListener('online', retryNow);
    doc?.addEventListener?.('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('hbs:auth-changed', onAuthChanged); window.removeEventListener('hbs:office-access-denied', onOfficeDenied);
      window.removeEventListener('online', retryNow); doc?.removeEventListener?.('visibilitychange', onVisible);
      refs -= 1; if (refs === 0) close();
    };
  }, [qc]);
  const current = useSyncExternalStore(subscribeState, getState, getState);
  return { live: current === 'open' };
}
// Exposed for tests and the auth reset: forget a failed, dropped or closed stream so the next mount retries.
export function resetNotificationStream() { close(); setState('closed'); }
export const getNotificationStreamState = () => state;

// ---- toasts: new notifications surfaced while the user works ----------------

export type NotificationToast = { id: number; title: string; body: string; path: string | null; priority: Notification['priority'] };
let toasts: NotificationToast[] = [];
const toastListeners = new Set<() => void>();
const TOAST_MS = 7_000;
const emitToasts = () => { for (const fn of toastListeners) fn(); };
export function pushToast(item: Notification) {
  toasts = [...toasts.filter((toast) => toast.id !== item.id), { id: item.id, title: item.title, body: item.body, path: item.path, priority: item.priority }].slice(-3);
  emitToasts();
  setTimeout(() => dismissToast(item.id), TOAST_MS);
}
export function dismissToast(id: number) {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emitToasts();
}
const subscribeToasts = (fn: () => void) => { toastListeners.add(fn); return () => { toastListeners.delete(fn); }; };
const getToasts = () => toasts;
export const getToastIds = () => toasts.map((toast) => toast.id);
export function useNotificationToasts(): NotificationToast[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts);
}

// ---- the feed ----------------------------------------------------------------

export function useNotificationFeed(params: ListNotificationsParams = {}) {
  const qc = useQueryClient();
  const { live } = useNotificationStream();
  // Polling only while the stream is down; hidden tabs do not poll at all.
  const list = useListNotifications(params, { query: { queryKey: getListNotificationsQueryKey(params), refetchInterval: live ? false : 60_000 } });
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useCallback(async (id: number) => {
    const target = list.data?.items.find((row) => row.id === id);
    if (target?.readAt) return;
    const updated = await markOne.mutateAsync({ id });
    qc.setQueriesData<NotificationList>({ queryKey: listKey() }, (current) => {
      if (!isList(current)) return current;
      const wasUnread = current.items.some((row) => row.id === id && !row.readAt);
      return { ...current, items: current.items.map((row) => row.id === id ? { ...row, readAt: updated?.readAt ?? new Date().toISOString() } : row), unreadCount: Math.max(0, current.unreadCount - (wasUnread ? 1 : 0)) };
    });
    void qc.invalidateQueries({ queryKey: listKey() });
  }, [list.data, markOne, qc]);
  const markAllRead = useCallback(async () => {
    await markAll.mutateAsync();
    const now = new Date().toISOString();
    qc.setQueriesData<NotificationList>({ queryKey: listKey() }, (current) => isList(current) ? { ...current, items: current.items.map((row) => row.readAt ? row : { ...row, readAt: now }), unreadCount: 0 } : current);
    void qc.invalidateQueries({ queryKey: listKey() });
    void qc.invalidateQueries({ queryKey: getGetNotificationBriefQueryKey() });
  }, [markAll, qc]);
  return {
    items: list.data?.items ?? [],
    unreadCount: list.data?.unreadCount ?? 0,
    markRead,
    markAllRead,
    marking: markOne.isPending || markAll.isPending,
    live,
    isLoading: list.isLoading,
    isError: list.isError,
    refetch: list.refetch,
  };
}
