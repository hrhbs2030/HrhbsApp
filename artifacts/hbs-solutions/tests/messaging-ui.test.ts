// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// The messages inbox (customer and office), the customer's inquiry thread,
// the generalized conversation and the WhatsApp follow-up button, with the
// API client, react-query, routing and the shared layout replaced (as
// tests/notifications-ui.test.ts does). The components, the stream singleton
// and the unread store stay real.
const hooks = [
  'useListMessageThreads', 'useListOfficeMessageThreads', 'useMarkThreadRead', 'useMarkOfficeThreadRead',
  'useListInquiryMessages', 'useListOfficeInquiryMessages', 'useListServiceRequestMessages', 'useListOfficeServiceRequestMessages',
  'useGetWhatsappLink', 'useGetNotificationPreferences', 'useListInquiries', 'useListNotifications', 'useMarkNotificationRead', 'useMarkAllNotificationsRead',
];
const fns = ['sendInquiryMessage', 'sendOfficeInquiryMessage', 'sendServiceRequestMessage', 'sendOfficeServiceRequestMessage'];
const keys = [
  'getListMessageThreadsQueryKey', 'getListOfficeMessageThreadsQueryKey', 'getListInquiryMessagesQueryKey', 'getListOfficeInquiryMessagesQueryKey',
  'getListServiceRequestMessagesQueryKey', 'getListOfficeServiceRequestMessagesQueryKey', 'getGetWhatsappLinkQueryKey', 'getGetNotificationPreferencesQueryKey',
  'getListInquiriesQueryKey', 'getListOfficeInquiriesQueryKey', 'getListNotificationsQueryKey', 'getGetNotificationBriefQueryKey',
];
const server = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  resolve: { alias: { '@': new URL('../src', import.meta.url).pathname }, dedupe: ['react'] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@workspace/api-client-react', '@tanstack/react-query', 'wouter'] },
  plugins: [{
    name: 'messaging-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@workspace/api-client-react') return '\0m-api';
      if (id === '@/components/portal-ui' || id.endsWith('/src/components/portal-ui')) return '\0m-ui';
      if (id === '@tanstack/react-query') return '\0m-query';
      if (id === 'wouter') return '\0m-router';
      if (/\.css$/.test(id)) return '\0m-css';
    },
    load(id) {
      if (id === '\0m-api') return [
        ...hooks.map(name => `export const ${name} = (...args) => globalThis.__m.hooks.${name}(...args);`),
        ...fns.map(name => `export const ${name} = (...args) => globalThis.__m.fns.${name}(...args);`),
        ...keys.map(name => `export const ${name} = (...args) => ['${name}', ...args];`),
        "export const getStreamNotificationsUrl = () => '/api/notifications/stream';",
      ].join('\n');
      if (id === '\0m-ui') return [
        'import React from "react";',
        'export const PortalLayout = ({ children }) => children; export const PageHeading = ({ eyebrow, title, action }) => React.createElement("div", null, React.createElement("span", null, eyebrow), React.createElement("h1", null, title), action ?? null);',
        'export const LoadingBlock = () => "loading"; export const ErrorBlock = () => "error"; export const EmptyBlock = ({ title }) => title; export const Status = ({ value }) => value; export const dateText = v => v ?? ""; export const useDebouncedValue = v => v;',
        'export const Pager = ({ page, pageSize, total, onPage }) => total > pageSize ? React.createElement("button", { onClick: () => onPage(page + 1) }, "التالية") : null;',
      ].join('\n');
      if (id === '\0m-query') return 'export const useQueryClient = () => globalThis.__m.qc; export const keepPreviousData = "keep";';
      if (id === '\0m-router') return 'import React from "react"; export const Link = ({ href, children }) => React.createElement("a", { href }, children); export const useParams = () => globalThis.__m.params; export const useSearch = () => ""; export const useLocation = () => ["/", () => {}];';
      if (id === '\0m-css') return '';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { MessagesInbox, OfficeMessagesInbox, InquiryThread, threadHref } = await server.ssrLoadModule('/src/pages/messages.tsx');
const { Conversation, sendError } = await server.ssrLoadModule('/src/components/conversation.tsx');
const { WhatsappFollowUp, localNumber } = await server.ssrLoadModule('/src/components/whatsapp-follow-up.tsx');
const { useMessagesUnread, setMessagesUnread, resetNotificationStream } = await server.ssrLoadModule('/src/lib/use-notifications.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const windowEvents = new EventTarget();
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener: (...a) => windowEvents.addEventListener(...a), removeEventListener: (...a) => windowEvents.removeEventListener(...a), dispatchEvent: e => windowEvents.dispatchEvent(e) };

// A stand-in for the browser's EventSource: tests dispatch the named events the server would send.
class FakeEventSource {
  static instances = [];
  constructor(url, init) { this.url = url; this.init = init; this.closed = false; this.listeners = new Map(); FakeEventSource.instances.push(this); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  dispatch(type, data) { this.listeners.get(type)?.({ data: data === undefined ? undefined : JSON.stringify(data) }); }
  close() { this.closed = true; }
}

const date = '2026-09-20T12:00:00.000Z';
const officeNumber = '966555208213';
const prefill = reference => `https://wa.me/${officeNumber}?text=${encodeURIComponent(`طلب ${reference} : `)}`;
const thread = (type, id, extra = {}) => {
  const reference = type === 'request' ? `HBS-2026-000${id}` : `استفسار #${id}`;
  return {
    type, id, reference, title: type === 'request' ? `خدمة ${id}` : `موضوع ${id}`, status: type === 'request' ? 'reviewing' : 'open',
    lastMessage: { authorRole: 'office', preview: `آخر رسالة ${id}`, channel: 'portal', createdAt: date }, unread: 0, updatedAt: date,
    whatsapp: { link: prefill(reference), number: officeNumber, verified: true }, customer: null, ...extra,
  };
};
const message = (id, extra = {}) => ({ id, authorRole: 'office', body: `رسالة ${id}`, channel: 'portal', createdAt: date, ...extra });
const query = data => ({ data, isLoading: false, isError: false, isPlaceholderData: false, refetch() {} });
const mutation = fn => ({ isPending: false, isError: false, mutateAsync: fn, mutate: fn, reset() {} });
const nodes = (tree, type) => tree.root.findAllByType(type);
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
const click = async button => act(async () => button.props.onClick?.({ preventDefault() {} }));
const button = (tree, label) => nodes(tree, 'button').find(n => text(n).includes(label));
const change = async (field, value) => act(async () => field.props.onChange({ target: { value, checked: value } }));
const submit = async form => act(async () => form.props.onSubmit({ preventDefault() {} }));
const waLinks = tree => nodes(tree, 'a').filter(a => a.props.rel === 'noopener noreferrer');
async function mount(element) {
  let tree;
  await act(async () => { tree = renderer.create(element); });
  return tree;
}
// Reads the sidebar's unread store the way portal-ui does.
function Probe() { return React.createElement('i', { 'data-unread': useMessagesUnread() }); }
const unreadShown = tree => tree.root.findAll(n => n.type === 'i')[0].props['data-unread'];
function setup(state) {
  const log = { threads: [], officeThreads: [], read: [], officeRead: [], sent: [], officeSent: [], officeInquirySent: [], messages: [], invalidated: [] };
  const send = (bucket) => async (...args) => { log[bucket].push(args); if (state.sendError) throw state.sendError; return message(99, { authorRole: 'office' }); };
  globalThis.__m = {
    params: state.params ?? { id: '7' },
    qc: { invalidateQueries: async value => { log.invalidated.push(value.queryKey); } },
    hooks: {
      useListMessageThreads: (params, options) => { log.threads.push({ params, refetchInterval: options?.query?.refetchInterval }); return query(state.threads); },
      useListOfficeMessageThreads: (params, options) => { log.officeThreads.push({ params, enabled: options?.query?.enabled }); return query(state.officeThreads); },
      useMarkThreadRead: () => mutation(async input => { log.read.push(input); return { unread: 0, unreadTotal: state.unreadAfterRead ?? 0 }; }),
      useMarkOfficeThreadRead: () => mutation(async input => { log.officeRead.push(input); return { unread: 0, unreadTotal: state.unreadAfterRead ?? 0 }; }),
      useListInquiryMessages: () => query(state.messages ?? []),
      useListOfficeInquiryMessages: () => query(state.messages ?? []),
      useListServiceRequestMessages: (id, options) => { log.messages.push({ id, enabled: options?.query?.enabled, refetchInterval: options?.query?.refetchInterval }); return query(state.messages ?? []); },
      useListOfficeServiceRequestMessages: () => query(state.messages ?? []),
      useGetWhatsappLink: params => query({ link: `https://wa.me/${officeNumber}?text=${encodeURIComponent(`استفسار #${params.id}: `)}`, number: officeNumber, text: `استفسار #${params.id}: ` }),
      useGetNotificationPreferences: () => query({ emailEnabled: true, pushEnabled: false, quietStart: null, quietEnd: null, digest: 'instant', mutedKinds: [], pushAvailable: false, whatsappAvailable: state.whatsappAvailable ?? false }),
      useListInquiries: () => query(state.inquiries ?? []),
      useListNotifications: () => query({ items: [], unreadCount: 0 }),
      useMarkNotificationRead: () => mutation(async () => ({})), useMarkAllNotificationsRead: () => mutation(async () => ({})),
    },
    fns: { sendInquiryMessage: send('sent'), sendOfficeInquiryMessage: send('officeInquirySent'), sendServiceRequestMessage: send('sent'), sendOfficeServiceRequestMessage: send('officeSent') },
  };
  return log;
}

test('helpers: the local number, row targets and the composer error texts', () => {
  assert.equal(localNumber(officeNumber), '0555208213');
  assert.equal(localNumber('966500000000'), '0500000000');
  assert.equal(localNumber(null), '');
  assert.equal(threadHref({ type: 'request', id: 5 }, false), '/requests/5#messages');
  assert.equal(threadHref({ type: 'inquiry', id: 7 }, false), '/inquiries/7');
  assert.equal(threadHref({ type: 'request', id: 5 }, true), '/office/requests/5?tab=conversation');
  assert.equal(threadHref({ type: 'inquiry', id: 7 }, true), '/office/inquiries?open=7');
  assert.equal(sendError({ status: 409, data: { error: 'رقم العميل غير موثّق' } }), 'رقم العميل غير موثّق', 'the server reason when it is Arabic');
  assert.match(sendError({ status: 409, data: { error: 'not verified' } }), /واتساب/, 'an Arabic fallback otherwise');
  assert.match(sendError({ status: 429 }), /أرسلت رسائل كثيرة/);
  assert.match(sendError(new Error('x')), /تعذّر إرسال الرسالة/);
});

test('the customer inbox lists threads with unread badges and WhatsApp links, filters unread, and seeds the sidebar count', async () => {
  resetNotificationStream(); setMessagesUnread(0);
  const state = { threads: { items: [thread('request', 12, { unread: 3, lastMessage: { authorRole: 'customer', preview: 'وصلت الأوراق؟', channel: 'whatsapp', createdAt: date } }), thread('inquiry', 7)], unreadTotal: 3, total: 2 } };
  const log = setup(state);
  const tree = await mount(React.createElement('div', null, React.createElement(MessagesInbox), React.createElement(Probe)));
  const rows = nodes(tree, 'li');
  assert.equal(rows.length, 2);
  const first = text(rows[0]);
  assert.match(first, /طلب/); assert.match(first, /HBS-2026-00012/); assert.match(first, /خدمة 12/); assert.match(first, /أنت:/); assert.match(first, /وصلت الأوراق؟/); assert.match(first, /واتساب/, 'channel badge on a WhatsApp message');
  assert.match(text(rows[1]), /استفسار/); assert.match(text(rows[1]), /المكتب:/);
  assert.equal(text(rows[0].findAll(n => n.props.className === 'inbox-unread')[0]), '3');
  assert.equal(rows[1].findAll(n => n.props.className === 'inbox-unread').length, 0);
  const hrefs = nodes(tree, 'a').map(a => a.props.href);
  assert.ok(hrefs.includes('/requests/12#messages') && hrefs.includes('/inquiries/7'), 'rows open the request thread or the inquiry page');
  const wa = waLinks(tree);
  assert.equal(wa.length, 2);
  assert.ok(wa[0].props.href.includes('wa.me/966555208213'), 'the office number');
  assert.ok(wa[0].props.href.includes(encodeURIComponent('طلب HBS-2026-00012 : ')), 'the reference prefilled, URL-encoded');
  assert.equal(wa[0].props.target, '_blank');
  assert.equal(wa[0].props['aria-label'], 'تابع عبر واتساب 0555208213');
  assert.equal(unreadShown(tree), 3, 'the list seeds the sidebar badge');
  assert.equal(log.threads.at(-1).refetchInterval, 20_000, 'polling while no stream is open');
  await click(button(tree, 'غير المقروءة'));
  assert.deepEqual(log.threads.at(-1).params, { page: 1, pageSize: 20, unread: true });
  assert.equal(log.officeThreads.filter(call => call.enabled).length, 0, 'the office query stays off for customers');
  state.threads = { items: [], unreadTotal: 0, total: 0 };
  await act(async () => tree.update(React.createElement('div', null, React.createElement(MessagesInbox), React.createElement(Probe))));
  assert.match(text(tree.root), /لا توجد رسائل غير مقروءة/);
  await act(async () => tree.unmount());
});

test('the office inbox adds type and search filters, links rows to the office pages, and disables WhatsApp for an unverified number', async () => {
  resetNotificationStream(); setMessagesUnread(0);
  const customer = { fullName: 'شركة النور', email: 'noor@example.test' };
  const state = { officeThreads: { items: [
    thread('request', 5, { customer, whatsapp: { link: null, number: null, verified: false } }),
    thread('inquiry', 9, { customer, whatsapp: { link: 'https://wa.me/966500000000', number: '966500000000', verified: true } }),
  ], unreadTotal: 1, total: 2 } };
  const log = setup(state);
  const tree = await mount(React.createElement(OfficeMessagesInbox));
  const hrefs = nodes(tree, 'a').map(a => a.props.href);
  assert.ok(hrefs.includes('/office/requests/5?tab=conversation') && hrefs.includes('/office/inquiries?open=9'));
  assert.match(text(tree.root), /شركة النور/);
  const disabled = nodes(tree, 'button').find(n => n.props.disabled && n.props.title === 'رقم العميل غير موثّق');
  assert.ok(disabled, 'the unverified customer gets a disabled button with the reason');
  const wa = waLinks(tree);
  assert.equal(wa.length, 1);
  assert.equal(wa[0].props.href, 'https://wa.me/966500000000');
  assert.equal(wa[0].props['aria-label'], 'راسل العميل عبر واتساب 0500000000');
  await click(button(tree, 'استفسارات'));
  assert.deepEqual(log.officeThreads.at(-1).params, { page: 1, pageSize: 20, type: 'inquiry' });
  await change(nodes(tree, 'input')[0], ' النور ');
  assert.deepEqual(log.officeThreads.at(-1).params, { page: 1, pageSize: 20, q: 'النور', type: 'inquiry' });
  await click(button(tree, 'استفسارات'));
  assert.deepEqual(log.officeThreads.at(-1).params, { page: 1, pageSize: 20, q: 'النور' }, 'pressing the type again clears it');
  await act(async () => tree.unmount());
});

test('the inquiry thread shows the original message first, marks the thread read, and sends a reply', async () => {
  resetNotificationStream(); setMessagesUnread(9);
  const state = {
    params: { id: '7' }, unreadAfterRead: 2,
    inquiries: [{ id: 7, subject: 'سؤال عن الرخصة', message: 'النص الأصلي', linkedServiceRequestReference: 'HBS-2026-00012', status: 'answered', answer: 'رد المكتب', createdAt: date, answeredAt: date }],
    messages: [message(0, { authorRole: 'customer', body: 'النص الأصلي' }), message(3, { body: 'رد المكتب', channel: 'whatsapp' })],
  };
  const log = setup(state);
  const tree = await mount(React.createElement('div', null, React.createElement(InquiryThread), React.createElement(Probe)));
  const body = text(tree.root);
  assert.match(body, /استفسار #7/); assert.match(body, /سؤال عن الرخصة/); assert.match(body, /HBS-2026-00012/); assert.match(body, /answered/);
  const bubbles = tree.root.findAll(n => typeof n.props.className === 'string' && n.props.className.startsWith('rc-msg'));
  assert.equal(bubbles.length, 2);
  assert.match(text(bubbles[0]), /النص الأصلي/); assert.match(text(bubbles[0]), /أنت/, 'the original question is the customer\'s own first message');
  assert.match(text(bubbles[1]), /رد المكتب/); assert.match(text(bubbles[1]), /المكتب/);
  assert.equal(tree.root.findAll(n => n.props.className === 'rc-channel').length, 1, 'only the WhatsApp message carries the badge');
  assert.deepEqual(log.read, [{ type: 'inquiry', id: 7 }], 'opening marks the thread read');
  assert.equal(unreadShown(tree), 2, 'the read marker\'s total reaches the sidebar');
  assert.ok(log.invalidated.some(key => key[0] === 'getListMessageThreadsQueryKey'));
  const wa = waLinks(tree);
  assert.equal(wa.length, 1);
  assert.equal(wa[0].props.href, `https://wa.me/${officeNumber}?text=${encodeURIComponent('استفسار #7: ')}`);
  assert.equal(wa[0].props['aria-label'], 'تابع عبر واتساب 0555208213');
  assert.equal(nodes(tree, 'input').filter(n => n.props.type === 'checkbox').length, 0, 'customers never see the WhatsApp checkbox');
  await change(nodes(tree, 'textarea')[0], '  شكرًا لكم  ');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(log.sent, [[7, { body: 'شكرًا لكم' }]]);
  assert.equal(nodes(tree, 'textarea')[0].props.value, '');
  const invalidated = log.invalidated.map(key => JSON.stringify(key));
  assert.ok(invalidated.includes(JSON.stringify(['getListInquiryMessagesQueryKey', 7])), 'the thread refetches');
  assert.ok(invalidated.includes(JSON.stringify(['getListInquiriesQueryKey'])), 'the inquiry list refetches (status moves back to open)');
  await act(async () => tree.unmount());
});

test('a missing or invalid inquiry id shows the empty state instead of a thread', async () => {
  resetNotificationStream();
  setup({ params: { id: '42' }, inquiries: [{ id: 7, subject: 'x', message: 'y', linkedServiceRequestReference: null, status: 'open', answer: null, createdAt: date }] });
  const tree = await mount(React.createElement(InquiryThread));
  assert.match(text(tree.root), /الاستفسار غير متاح/);
  assert.equal(nodes(tree, 'textarea').length, 0);
  await act(async () => tree.unmount());
  setup({ params: { id: 'abc' } });
  const invalid = await mount(React.createElement(InquiryThread));
  assert.match(text(invalid.root), /الاستفسار غير متاح/);
  await act(async () => invalid.unmount());
});

test('the office composer offers WhatsApp only for a verified number with WhatsApp on, sends viaWhatsapp, and shows the server reason on 409', async () => {
  resetNotificationStream(); setMessagesUnread(0);
  const state = { whatsappAvailable: true, messages: [message(1, { authorRole: 'customer', body: 'متى تنتهي المعاملة؟' })] };
  const log = setup(state);
  const verified = { link: 'https://wa.me/966500000000', number: '966500000000', verified: true };
  const element = (whatsapp, extra = {}) => React.createElement(Conversation, { thread: { type: 'request', id: 5 }, scope: 'office', whatsapp, ...extra });
  const tree = await mount(element(verified));
  assert.deepEqual(log.officeRead, [{ type: 'request', id: 5 }], 'staff opening the thread marks it read on their side');
  assert.equal(log.read.length, 0);
  const checkbox = () => nodes(tree, 'input').find(n => n.props.type === 'checkbox');
  assert.ok(checkbox(), 'verified number and WhatsApp on: the checkbox shows');
  assert.match(text(checkbox().parent), /أرسل عبر واتساب أيضًا/);
  await change(checkbox(), true);
  await change(nodes(tree, 'textarea')[0], 'سنوافيك غدًا');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(log.officeSent, [[5, { body: 'سنوافيك غدًا', viaWhatsapp: true }]]);
  // Without the box ticked the flag is left out entirely.
  await change(checkbox(), false);
  await change(nodes(tree, 'textarea')[0], 'عبر البوابة فقط');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(log.officeSent.at(-1), [5, { body: 'عبر البوابة فقط' }]);
  // An unverified number, or WhatsApp off at the office, hides the checkbox.
  await act(async () => tree.update(element({ ...verified, verified: false })));
  assert.equal(checkbox(), undefined, 'unverified: no checkbox');
  await act(async () => tree.update(element(verified, { whatsappConfigured: false })));
  assert.equal(checkbox(), undefined, 'WhatsApp off: no checkbox');
  await act(async () => tree.update(element(null)));
  assert.equal(checkbox(), undefined, 'no thread row yet: no checkbox');
  // The server refuses (409) with its own Arabic reason, shown as is.
  await act(async () => tree.update(element(verified)));
  state.sendError = { status: 409, data: { error: 'رقم العميل غير موثّق أو واتساب غير مفعّل.' } };
  await change(checkbox(), true);
  await change(nodes(tree, 'textarea')[0], 'محاولة');
  await submit(nodes(tree, 'form')[0]);
  assert.equal(text(tree.root.findAll(n => n.props.role === 'alert')[0]), 'رقم العميل غير موثّق أو واتساب غير مفعّل.');
  assert.equal(nodes(tree, 'textarea')[0].props.value, 'محاولة', 'the text stays for another try');
  await act(async () => tree.unmount());
  // An office inquiry thread sends through the inquiry route.
  state.sendError = null;
  const inquiryTree = await mount(React.createElement(Conversation, { thread: { type: 'inquiry', id: 9 }, scope: 'office', whatsapp: null }));
  assert.deepEqual(log.officeRead.at(-1), { type: 'inquiry', id: 9 });
  await change(nodes(inquiryTree, 'textarea')[0], 'الرد');
  await submit(nodes(inquiryTree, 'form')[0]);
  assert.deepEqual(log.officeInquirySent, [[9, { body: 'الرد' }]]);
  assert.ok(log.invalidated.some(key => key[0] === 'getListOfficeInquiriesQueryKey'), 'the first office reply marks the inquiry answered in the list');
  await act(async () => inquiryTree.unmount());
});

test('a `thread` stream event refetches that thread and the lists and updates the unread store; polling stops while the stream is open', async () => {
  resetNotificationStream(); setMessagesUnread(0);
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
  const state = { messages: [message(1)] };
  const log = setup(state);
  const element = React.createElement('div', null, React.createElement(Conversation, { thread: { type: 'request', id: 5 }, scope: 'customer' }), React.createElement(Probe));
  const tree = await mount(element);
  assert.equal(FakeEventSource.instances.length, 1, 'the conversation keeps the shared stream open');
  const stream = FakeEventSource.instances[0];
  assert.equal(log.messages.at(-1).refetchInterval, 20_000, 'polling until the stream opens');
  await act(async () => stream.dispatch('open'));
  assert.equal(log.messages.at(-1).refetchInterval, false, 'no polling while the stream is open');
  log.invalidated.length = 0;
  await act(async () => stream.dispatch('thread', { type: 'request', id: 5, unreadTotal: 4 }));
  const invalidated = log.invalidated.map(key => JSON.stringify(key));
  for (const key of [['getListServiceRequestMessagesQueryKey', 5], ['getListOfficeServiceRequestMessagesQueryKey', 5], ['getListMessageThreadsQueryKey'], ['getListOfficeMessageThreadsQueryKey']]) assert.ok(invalidated.includes(JSON.stringify(key)), `invalidates ${key[0]}`);
  assert.equal(unreadShown(tree), 4, 'the event\'s total reaches the sidebar store');
  await act(async () => stream.dispatch('thread', { type: 'inquiry', id: 7 }));
  assert.ok(log.invalidated.map(key => JSON.stringify(key)).includes(JSON.stringify(['getListInquiryMessagesQueryKey', 7])));
  assert.equal(unreadShown(tree), 4, 'an event without a total leaves the store alone');
  await act(async () => stream.dispatch('thread', 'not json'));
  await act(async () => stream.dispatch('error'));
  assert.equal(log.messages.at(-1).refetchInterval, 20_000, 'polling again once the stream failed');
  await act(async () => tree.unmount());
  delete globalThis.EventSource;
  resetNotificationStream();
});

test('the WhatsApp button is a 44px link for customers and a disabled control for staff until the number is verified', async () => {
  const customer = await mount(React.createElement(WhatsappFollowUp, { link: prefill('HBS-2026-00001'), number: officeNumber, verified: true, scope: 'customer' }));
  const link = nodes(customer, 'a')[0];
  assert.equal(link.props.className.trim(), 'wa-btn');
  assert.equal(link.props.rel, 'noopener noreferrer');
  assert.equal(link.props.title, 'تابع عبر واتساب 0555208213');
  const office = await mount(React.createElement(WhatsappFollowUp, { link: 'https://wa.me/966500000000', number: '966500000000', verified: false, scope: 'office' }));
  assert.equal(nodes(office, 'a').length, 0);
  assert.equal(nodes(office, 'button')[0].props.disabled, true);
  assert.equal(nodes(office, 'button')[0].props.title, 'رقم العميل غير موثّق');
  await act(async () => { customer.unmount(); office.unmount(); });
});
