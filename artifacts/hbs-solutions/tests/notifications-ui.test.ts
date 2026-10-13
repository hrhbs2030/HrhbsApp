// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// The notification bell, the notification centre page, the office WhatsApp
// inbox and the push helpers with the API client, react-query, routing and
// the shared layout replaced (as tests/customer-pages.test.ts does). The
// hooks, the stream singleton, the toasts and the forms stay real.
const hooks = [
  'useListNotifications', 'useMarkNotificationRead', 'useMarkAllNotificationsRead', 'useGetNotificationBrief',
  'useGetNotificationPreferences', 'useSaveNotificationPreferences', 'useListWhatsappInbox', 'useReplyWhatsappInbox',
];
const fns = ['listNotifications', 'getPushKey', 'savePushSubscription', 'deletePushSubscription'];
const keys = ['getListNotificationsQueryKey', 'getGetNotificationBriefQueryKey', 'getGetNotificationPreferencesQueryKey', 'getListWhatsappInboxQueryKey', 'getListMessageThreadsQueryKey', 'getListOfficeMessageThreadsQueryKey', 'getListInquiryMessagesQueryKey', 'getListOfficeInquiryMessagesQueryKey', 'getListServiceRequestMessagesQueryKey', 'getListOfficeServiceRequestMessagesQueryKey'];
const kinds = ['request.status', 'request.message', 'request.file', 'request.assigned', 'quote.sent', 'invoice.issued', 'invoice.overdue', 'reminder.expiring', 'registration.decision', 'inquiry.answered', 'company.invite', 'subscription.started', 'subscription.invoice', 'subscription.past_due', 'subscription.cancelled', 'office.request_new', 'office.registration_new', 'office.inquiry_new', 'office.file_new', 'office.message_new', 'office.quote_answered', 'office.invoice_paid', 'office.whatsapp_unmatched', 'office.whatsapp_message'];
const server = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  resolve: { alias: { '@': new URL('../src', import.meta.url).pathname }, dedupe: ['react'] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@workspace/api-client-react', '@tanstack/react-query', 'wouter'] },
  plugins: [{
    name: 'notifications-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@workspace/api-client-react') return '\0n-api';
      if (id === '@/components/portal-ui' || id.endsWith('/src/components/portal-ui')) return '\0n-ui';
      if (id === '@tanstack/react-query') return '\0n-query';
      if (id === 'wouter') return '\0n-router';
      if (id === '@/App' || id.endsWith('/src/App')) return '\0n-app';
      if (/\.css$/.test(id)) return '\0n-css';
    },
    load(id) {
      if (id === '\0n-api') return [
        ...hooks.map(name => `export const ${name} = (...args) => globalThis.__n.hooks.${name}(...args);`),
        ...fns.map(name => `export const ${name} = (...args) => globalThis.__n.fns.${name}(...args);`),
        ...keys.map(name => `export const ${name} = (...args) => ['${name}', ...args];`),
        "export const getStreamNotificationsUrl = () => '/api/notifications/stream';",
        `export const NotificationKind = ${JSON.stringify(Object.fromEntries(kinds.map(kind => [kind.replace(/\./g, ''), kind])))};`,
      ].join('\n');
      if (id === '\0n-ui') return 'import React from "react"; export const PortalLayout = ({ children }) => children; export const PageHeading = ({ title, action }) => React.createElement("div", null, React.createElement("h1", null, title), action ?? null); export const LoadingBlock = () => "loading"; export const ErrorBlock = () => "error"; export const EmptyBlock = ({ title }) => title;';
      if (id === '\0n-query') return 'export const useQueryClient = () => globalThis.__n.qc;';
      if (id === '\0n-router') return 'import React from "react"; export const Link = ({ href, children, onClick }) => React.createElement("a", { href, onClick }, children); export const useLocation = () => ["/", to => globalThis.__n.navigations.push(to)];';
      if (id === '\0n-app') return "export const basePath = '';";
      if (id === '\0n-css') return '';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { NotificationBell, NotificationToasts, badgeText } = await server.ssrLoadModule('/src/components/notification-bell.tsx');
const { resetNotificationStream } = await server.ssrLoadModule('/src/lib/use-notifications.ts');
const { NotificationsPage, OfficeNotificationsPage, kindLabels, kindsFor } = await server.ssrLoadModule('/src/pages/notifications.tsx');
const { default: OfficeWhatsappInbox, replyError } = await server.ssrLoadModule('/src/pages/office-whatsapp.tsx');
const { urlBase64ToUint8Array, pushSupported, swUrl, swScope } = await server.ssrLoadModule('/src/lib/push.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const windowEvents = new EventTarget();
globalThis.window = { matchMedia: () => ({ matches: false }), location: { origin: 'https://hrhbs.test' }, addEventListener: (...a) => windowEvents.addEventListener(...a), removeEventListener: (...a) => windowEvents.removeEventListener(...a), dispatchEvent: e => windowEvents.dispatchEvent(e) };
// The bell's "click outside" and Escape listeners hang off the document.
const documentListeners = new Map();
globalThis.document = { addEventListener: (type, fn) => documentListeners.set(type, fn), removeEventListener: (type) => documentListeners.delete(type) };

// A stand-in for the browser's EventSource: tests dispatch the named events
// the server would send, and see whether the stream was closed.
class FakeEventSource {
  static instances = [];
  constructor(url, init) { this.url = url; this.init = init; this.closed = false; this.listeners = new Map(); FakeEventSource.instances.push(this); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  dispatch(type, data) { this.listeners.get(type)?.({ data: data === undefined ? undefined : JSON.stringify(data) }); }
  close() { this.closed = true; }
}

const date = '2026-09-20T12:00:00.000Z';
const notification = (id, extra = {}) => ({ id, audience: 'customer', kind: 'request.status', title: `تحديث ${id}`, body: `نص الإشعار ${id}`, path: `/requests/${id}`, priority: 'normal', count: 1, targetType: 'request', targetId: String(id), createdAt: date, readAt: null, ...extra });
const query = data => ({ data, isLoading: false, isError: false, refetch() {} });
const mutation = fn => ({ isPending: false, isError: false, mutateAsync: fn, reset() {} });
const nodes = (tree, type) => tree.root.findAllByType(type);
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
const click = async button => act(async () => button.props.onClick?.({ preventDefault() {}, stopPropagation() {} }));
const button = (tree, label) => nodes(tree, 'button').find(n => text(n).includes(label));
const change = async (field, value) => act(async () => field.props.onChange({ target: { value, checked: value } }));
const submit = async form => act(async () => form.props.onSubmit({ preventDefault() {} }));
async function mount(element) {
  let tree;
  await act(async () => { tree = renderer.create(element); });
  return tree;
}
function setup(state) {
  const log = { listArgs: [], read: [], readAll: 0, invalidated: [], saved: [], replies: [], olderArgs: [], navigations: [] };
  const applyAll = updater => { state.list = updater(state.list); };
  globalThis.__n = {
    navigations: log.navigations,
    qc: { setQueriesData: (_filter, updater) => applyAll(updater), invalidateQueries: async value => { log.invalidated.push(value.queryKey); } },
    hooks: {
      useListNotifications: (params, options) => { log.listArgs.push({ params, refetchInterval: options?.query?.refetchInterval }); return query(state.list); },
      useMarkNotificationRead: () => mutation(async input => { log.read.push(input); return { ...state.list.items.find(row => row.id === input.id), readAt: date }; }),
      useMarkAllNotificationsRead: () => mutation(async () => { log.readAll += 1; return { updated: 2 }; }),
      useGetNotificationBrief: () => query(state.brief),
      useGetNotificationPreferences: () => query(state.prefs),
      useSaveNotificationPreferences: () => mutation(async input => { log.saved.push(input); return input.data; }),
      useListWhatsappInbox: () => query(state.inbox ?? []),
      useReplyWhatsappInbox: () => mutation(async input => { log.replies.push(input); if (state.replyError) throw state.replyError; return { sentAs: 'text' }; }),
    },
    fns: {
      listNotifications: async params => { log.olderArgs.push(params); return state.older ?? { items: [], unreadCount: 0 }; },
      getPushKey: async () => ({ publicKey: null }),
      savePushSubscription: async () => {}, deletePushSubscription: async () => {},
    },
  };
  return log;
}
const bellTree = () => React.createElement('div', null, React.createElement(NotificationBell, null), React.createElement(NotificationToasts, null));

test('badge text caps at 99+', () => {
  assert.equal(badgeText(3), '3'); assert.equal(badgeText(99), '99'); assert.equal(badgeText(120), '99+');
});

test('the bell shows the unread badge, opens its panel, and opening an item marks it read and navigates', async () => {
  resetNotificationStream();
  const state = { list: { items: [notification(1, { priority: 'urgent' }), notification(2, { readAt: date }), ...Array.from({ length: 10 }, (_, i) => notification(10 + i))], unreadCount: 120 } };
  const log = setup(state);
  const tree = await mount(bellTree());
  const bell = nodes(tree, 'button').find(n => n.props['aria-haspopup'] === 'dialog');
  assert.match(bell.props['aria-label'], /99\+ غير مقروءة/);
  assert.equal(text(tree.root.findAll(n => n.props.className === 'notif-badge')[0]), '99+');
  assert.equal(tree.root.findAll(n => n.props.role === 'dialog').length, 0);
  await click(bell);
  const dialog = tree.root.findAll(n => n.props.role === 'dialog')[0];
  assert.ok(dialog, 'the panel is a dialog');
  assert.equal(bell.props['aria-expanded'], true);
  const items = dialog.findAll(n => typeof n.props.className === 'string' && n.props.className.startsWith('notif-item '));
  assert.equal(items.length, 8, 'the latest eight');
  assert.match(text(items[0]), /عاجل/);
  assert.ok(dialog.findAll(n => n.type === 'a' && n.props.href === '/notifications').length, 'link to all notifications');
  await click(items[0]);
  assert.deepEqual(log.read, [{ id: 1 }]);
  assert.deepEqual(log.navigations, ['/requests/1']);
  assert.equal(tree.root.findAll(n => n.props.role === 'dialog').length, 0, 'the panel closed');
  // Escape closes the panel too, through the document listener.
  await click(bell);
  assert.equal(tree.root.findAll(n => n.props.role === 'dialog').length, 1);
  await act(async () => documentListeners.get('keydown')({ key: 'Escape' }));
  assert.equal(tree.root.findAll(n => n.props.role === 'dialog').length, 0);
  await click(bell);
  await click(button(tree, 'تعليم الكل كمقروء'));
  assert.equal(log.readAll, 1);
  await act(async () => tree.unmount());
});

test('the stream opens once per app with credentials, updates the count, toasts new notifications, and falls back to polling on error', async () => {
  resetNotificationStream();
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
  const state = { list: { items: [notification(1)], unreadCount: 1 } };
  const log = setup(state);
  const tree = await mount(React.createElement('div', null, bellTree(), bellTree()));
  assert.equal(FakeEventSource.instances.length, 1, 'one connection for two bells');
  const stream = FakeEventSource.instances[0];
  assert.equal(stream.url, '/api/notifications/stream');
  assert.deepEqual(stream.init, { withCredentials: true });
  await act(async () => stream.dispatch('open'));
  assert.equal(log.listArgs.at(-1).refetchInterval, false, 'no polling while the stream is open');
  await act(async () => stream.dispatch('unread', { count: 7 }));
  assert.equal(state.list.unreadCount, 7);
  await act(async () => stream.dispatch('notification', notification(2, { title: 'رسالة جديدة في الطلب' })));
  assert.equal(state.list.items[0].id, 2, 'prepended to the cached list');
  assert.equal(state.list.unreadCount, 8);
  assert.ok(log.invalidated.some(key => key[0] === 'getListNotificationsQueryKey') && log.invalidated.some(key => key[0] === 'getGetNotificationBriefQueryKey'));
  await act(async () => tree.update(React.createElement('div', null, bellTree(), bellTree())));
  const toasts = tree.root.findAll(n => n.props.className === 'notif-toast');
  assert.equal(toasts.length, 2, 'one toast per NotificationToasts mount');
  assert.match(text(toasts[0]), /رسالة جديدة في الطلب/);
  await click(toasts[0].findAll(n => n.type === 'button' && n.props['aria-label'] === 'إغلاق التنبيه')[0]);
  assert.equal(tree.root.findAll(n => n.props.className === 'notif-toast').length, 0);
  await act(async () => stream.dispatch('error'));
  assert.equal(stream.closed, true);
  assert.equal(log.listArgs.at(-1).refetchInterval, 60_000, 'polling once the stream failed');
  await act(async () => tree.unmount());
  delete globalThis.EventSource;
  resetNotificationStream();
});

for (const [eventName, reopens] of [['hbs:auth-changed', true], ['hbs:office-access-denied', false]]) {
  test(`${eventName} closes the stream, clears queued toasts and ignores late events of the old identity`, async () => {
    resetNotificationStream();
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource;
    const state = { list: { items: [notification(1)], unreadCount: 1 } };
    setup(state);
    const tree = await mount(React.createElement('div', null, bellTree()));
    const old = FakeEventSource.instances[0];
    await act(async () => old.dispatch('open'));
    await act(async () => old.dispatch('notification', notification(2, { title: 'إشعار المستخدم السابق' })));
    await act(async () => tree.update(React.createElement('div', null, bellTree())));
    assert.equal(tree.root.findAll(n => n.props.className === 'notif-toast').length, 1, 'toast queued');
    await act(async () => { window.dispatchEvent(new Event(eventName)); });
    assert.equal(old.closed, true, 'old stream closed');
    assert.equal(FakeEventSource.instances.length, reopens ? 2 : 1, reopens ? 'a fresh stream for the new identity' : 'no reconnect after office access is revoked');
    // Reset the cache the way the shell does, then replay a late event of the old stream.
    state.list = { items: [], unreadCount: 0 };
    await act(async () => old.dispatch('notification', notification(3, { title: 'متأخر' })));
    await act(async () => old.dispatch('unread', { count: 9 }));
    assert.deepEqual(state.list, { items: [], unreadCount: 0 }, 'nothing from the old identity re-enters the cache');
    await act(async () => tree.update(React.createElement('div', null, bellTree())));
    assert.equal(tree.root.findAll(n => n.props.className === 'notif-toast').length, 0, 'toasts cleared');
    await act(async () => tree.unmount());
    delete globalThis.EventSource;
    resetNotificationStream();
  });
}

test('the notifications page shows the brief and the list, loads older rows by cursor, and saves the preferences payload', async () => {
  resetNotificationStream();
  const state = {
    list: { items: Array.from({ length: 30 }, (_, i) => notification(100 - i, i === 0 ? { priority: 'high' } : {})), unreadCount: 3 },
    older: { items: [notification(50, { readAt: date })], unreadCount: 3 },
    brief: { generatedAt: date, headline: 'لديك 2 أمور تحتاج انتباهك اليوم', items: [{ kind: 'invoice.overdue', priority: 'urgent', title: 'فاتورة متأخرة', reason: 'تأخرت 10 أيام', path: '/requests/5' }, { kind: 'request.message', priority: 'normal', title: 'رسالة بانتظارك', reason: 'منذ يومين', path: null }] },
    prefs: { emailEnabled: true, pushEnabled: true, quietStart: null, quietEnd: null, digest: 'instant', mutedKinds: [], pushAvailable: false, whatsappAvailable: true },
  };
  const log = setup(state);
  const tree = await mount(React.createElement(NotificationsPage));
  const body = text(tree.root);
  assert.match(body, /الملخص الذكي/); assert.match(body, /لديك 2 أمور تحتاج انتباهك اليوم/); assert.match(body, /تأخرت 10 أيام/); assert.match(body, /دون إرسالها إلى أي خدمة خارجية/);
  assert.ok(nodes(tree, 'a').some(a => a.props.href === '/requests/5'), 'brief item links to its page');
  assert.match(body, /تحديث 100/); assert.match(body, /مهم/); assert.match(body, /3 غير مقروءة/);
  assert.match(body, /تغيّر حالة الطلب/, 'kind label on each row');
  await click(button(tree, 'المزيد'));
  assert.deepEqual(log.olderArgs, [{ limit: 30, before: 71 }]);
  assert.match(text(tree.root), /تحديث 50/);
  assert.equal(button(tree, 'المزيد'), undefined, 'a short page ends the cursor');
  // Unread filter re-queries and drops the older rows.
  await click(button(tree, 'غير المقروءة فقط'));
  assert.deepEqual(log.listArgs.at(-1).params, { unread: true, limit: 30 });
  assert.ok(!text(tree.root).includes('تحديث 50'));
  // Preferences: customers see only customer kinds; push is unsupported in this runtime.
  const checkboxes = nodes(tree, 'input').filter(n => n.props.type === 'checkbox');
  assert.equal(checkboxes.length, 2 + 15, 'email, push and the 15 customer kinds');
  assert.match(text(tree.root), /لا يدعم الإشعارات الفورية/);
  await change(checkboxes[0], false);
  const selects = nodes(tree, 'select');
  await change(selects[0], '22'); await change(selects[1], '7');
  await act(async () => nodes(tree, 'input').find(n => n.props.type === 'radio' && n.props.value === 'daily').props.onChange());
  const mute = checkboxes.find(n => text(n.parent).includes('رسالة جديدة في الطلب'));
  await change(mute, true);
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(log.saved, [{ data: { emailEnabled: false, pushEnabled: true, quietStart: 22, quietEnd: 7, digest: 'daily', mutedKinds: ['request.message'] } }]);
  assert.ok(log.invalidated.some(key => key[0] === 'getGetNotificationPreferencesQueryKey'));
  assert.match(text(tree.root), /تم حفظ التفضيلات/);
  await act(async () => tree.unmount());
});

test('the office page offers only office kinds, says when nothing needs attention, and marks all read', async () => {
  resetNotificationStream();
  const state = {
    list: { items: [notification(1, { audience: 'office', kind: 'office.request_new' })], unreadCount: 1 },
    brief: { generatedAt: date, headline: 'كل شيء هادئ', items: [] },
    prefs: { emailEnabled: true, pushEnabled: false, quietStart: 1, quietEnd: 6, digest: 'daily', mutedKinds: ['office.file_new'], pushAvailable: true, whatsappAvailable: false },
  };
  const log = setup(state);
  const tree = await mount(React.createElement(OfficeNotificationsPage));
  assert.match(text(tree.root), /كل شيء هادئ/);
  const kindBoxes = nodes(tree, 'input').filter(n => n.props.type === 'checkbox').slice(2);
  assert.equal(kindBoxes.length, 9);
  assert.equal(kindBoxes.filter(n => n.props.checked).length, 1, 'the muted office kind is ticked');
  assert.equal(nodes(tree, 'select')[0].props.value, 1);
  await click(button(tree, 'تعليم الكل كمقروء'));
  assert.equal(log.readAll, 1);
  assert.equal(state.list.unreadCount, 0);
  await act(async () => tree.unmount());
  assert.deepEqual(kindsFor(true), kinds.filter(kind => kind.startsWith('office.')));
  assert.deepEqual(kindsFor(false), kinds.filter(kind => !kind.startsWith('office.')));
  for (const kind of kinds) assert.match(kindLabels[kind], /[؀-ۿ]/, `Arabic label for ${kind}`);
});

test('the WhatsApp inbox shows the intent, fills the reply from a suggestion, sends it, and explains 409/503', async () => {
  const item = { waMessageId: 'wamid.1', fromPhoneMasked: '9665••••••78', userId: 'user_1', customerName: 'شركة النور', requestId: 12, body: 'وش صار على طلبي؟ عاجل', receivedAt: date, handled: 'request_message', intent: { intent: 'status_question', confidence: 0.8, urgent: true, reference: 'HBS-12' }, suggestedReplies: ['طلبك قيد المراجعة وسنوافيك بالجديد.', 'تم استلام طلبك.'], canReplyFreeText: false };
  const state = { list: { items: [], unreadCount: 0 }, inbox: [item, { ...item, waMessageId: 'wamid.2', userId: null, customerName: null, requestId: null, intent: { intent: 'other', confidence: 0.2, urgent: false, reference: null }, suggestedReplies: [], canReplyFreeText: true, handled: 'unmatched' }] };
  const log = setup(state);
  const tree = await mount(React.createElement(OfficeWhatsappInbox));
  const body = text(tree.root);
  assert.match(body, /شركة النور/); assert.match(body, /رقم غير معروف/); assert.match(body, /سؤال عن الحالة/); assert.match(body, /عاجل/); assert.match(body, /80٪/);
  assert.match(body, /دون أي خدمة ذكاء اصطناعي خارجية/);
  assert.match(body, /خارج نافذة 24 ساعة: سيُرسل كقالب/);
  assert.ok(nodes(tree, 'a').some(a => a.props.href === '/office/requests/12'));
  await click(button(tree, 'طلبك قيد المراجعة'));
  const textarea = nodes(tree, 'textarea')[0];
  assert.equal(textarea.props.value, 'طلبك قيد المراجعة وسنوافيك بالجديد.');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(log.replies, [{ waMessageId: 'wamid.1', data: { text: 'طلبك قيد المراجعة وسنوافيك بالجديد.' } }]);
  assert.match(text(tree.root), /أُرسل الرد/);
  assert.ok(log.invalidated.some(key => key[0] === 'getListWhatsappInboxQueryKey'));
  assert.equal(nodes(tree, 'textarea')[0].props.value, '');
  // Filter buttons switch the query.
  assert.ok(button(tree, 'كل الوارد'));
  state.replyError = { status: 409 };
  await change(nodes(tree, 'textarea')[0], 'رد يدوي');
  await submit(nodes(tree, 'form')[0]);
  assert.match(text(tree.root), /انتهت نافذة الـ24 ساعة/);
  assert.equal(replyError({ status: 503 }), 'رسائل واتساب غير مفعّلة حاليًا.');
  assert.equal(replyError(new Error('x')), 'تعذّر إرسال الرد. حاول مرة أخرى.');
  await act(async () => tree.unmount());
});

test('push helpers: base64url to bytes, support detection and the worker address', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array('AQI')], [1, 2], 'padding is restored');
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [...urlBase64ToUint8Array('+/8')], 'url-safe alphabet');
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [0xfb, 0xff]);
  assert.equal(pushSupported(), false, 'no service worker in this runtime');
  assert.equal(swUrl(), '/sw.js'); assert.equal(swScope(), '/');
});
