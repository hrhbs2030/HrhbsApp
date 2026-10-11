// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// The customer dashboard and request page with the API, router and shared
// presentation replaced, as tests/office-pages.test.ts does for the office.
// The task list, the quote card and the document checklist stay real.
const hooks = [
  'useGetPortalSummary', 'useListServiceRequests', 'useGetServiceRequest', 'useListInquiries', 'useCreateInquiry',
  'useGetServiceRequestHistory', 'useAcceptQuote', 'useDeclineQuote', 'useCreateServiceRequest', 'useGetCompanyFile', 'useListServiceOffers',
];
const calls = [
  'attachServiceRequestFiles', 'attachOfficeServiceRequestFiles', 'deleteServiceRequestFile', 'deleteOfficeServiceRequestFile',
  'downloadServiceAttachment', 'downloadOfficeServiceAttachment', 'linkAttachmentToChecklist', 'linkOfficeAttachmentToChecklist',
  'requestServiceAttachmentUpload', 'requestOfficeServiceAttachmentUpload',
];
const keys = [
  'getGetPortalSummaryQueryKey', 'getListServiceRequestsQueryKey', 'getListInquiriesQueryKey', 'getGetServiceRequestQueryKey',
  'getGetServiceRequestHistoryQueryKey', 'getListServiceRequestInvoicesQueryKey', 'getGetCompanyFileQueryKey', 'getListServiceOffersQueryKey',
];
const uiNames = ['PortalLayout', 'PageHeading', 'LoadingBlock', 'ErrorBlock', 'EmptyBlock', 'RequestRow', 'Status', 'StatusTrack', 'dateText'];
const server = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  resolve: { alias: { '@': new URL('../src', import.meta.url).pathname }, dedupe: ['react'] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@workspace/api-client-react', '@tanstack/react-query', 'wouter'] },
  plugins: [{
    name: 'customer-page-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@workspace/api-client-react') return '\0c-api';
      if (id === '@/components/portal-ui' || id.endsWith('/src/components/portal-ui')) return '\0c-ui';
      if (id === '@tanstack/react-query') return '\0c-query';
      if (/(^@|\/src)\/components\/(request-billing|request-conversation|customer-assistant|reminder-ui|service-offer|brand\/print)(\.tsx)?$/.test(id)) return '\0c-extras';
      if (id === 'wouter') return '\0c-router';
    },
    load(id) {
      if (id === '\0c-api') return [
        ...hooks.map(name => `export const ${name} = (...args) => globalThis.__c.hooks.${name}(...args);`),
        ...calls.map(name => `export const ${name} = (...args) => globalThis.__c.calls.${name}(...args);`),
        ...keys.map(name => `export const ${name} = (...args) => ['${name}', ...args];`),
      ].join('\n');
      if (id === '\0c-ui') return [
        ...uiNames.map(name => `export const ${name} = (...args) => globalThis.__c.ui.${name}(...args);`),
        'export const categoryNames = { labor: "عمل", passports: "جوازات", business: "أعمال", other: "أخرى" };',
        'export const statusNames = { received: "جديد", reviewing: "مراجعة", waiting_on_customer: "بانتظار العميل", awaiting_payment: "بانتظار السداد", completed: "مكتمل" };',
      ].join('\n');
      if (id === '\0c-extras') return 'export const CustomerInvoices = () => null; export const RatingPanel = () => null; export const ConfirmDialog = () => null; export const RequestConversation = () => null; export const SubjectChip = () => null; export const focusComposer = () => {}; export const CustomerAssistant = () => null; export const ExpiryBadge = () => null; export const reminderKindNames = {}; export const ServiceOffer = () => null; export const PrintButton = () => null;';
      if (id === '\0c-query') return 'export const useQueryClient = () => globalThis.__c.qc;';
      if (id === '\0c-router') return 'export const useSearch = () => globalThis.__c.search; export const useParams = () => globalThis.__c.params; export const useLocation = () => ["/", () => {}]; export const Link = ({ href, children }) => React.createElement("a", { href }, children); import React from "react";';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { Dashboard, RequestDetail } = await server.ssrLoadModule('/src/pages/customer.tsx');
const { RequestFiles } = await server.ssrLoadModule('/src/components/request-files.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { matchMedia: () => ({ matches: true }), location: { hash: '' } };
globalThis.requestAnimationFrame = fn => fn();

const date = '2026-09-20T12:00:00.000Z';
const request = (id, extra = {}) => ({
  id, reference: `REQ-${id}`, category: 'labor', service: `خدمة ${id}`, description: `تفاصيل ${id}`, contactPhone: '0500000000', status: 'reviewing',
  customerMessage: null, clientRequestId: null, createdAt: date, updatedAt: date, attachments: [], rating: null, ratingComment: null, ratedAt: null,
  subject: null, lastMessage: null, quote: null, checklist: [], ...extra,
});
const summary = (extra = {}) => ({
  unpaidInvoices: 0, unpaidTotal: 0, expiringSoon: [], employeesCount: 0, licensesCount: 0, hasCompany: true,
  totalRequests: 1, activeRequests: 1, completedRequests: 0, openInquiries: 0, recentRequests: [], recentInquiries: [], ...extra,
});
const query = data => ({ data, isLoading: false, isError: false, error: null, refetch() {} });
const mutation = fn => ({ isPending: false, isError: false, mutateAsync: fn, reset() {} });
function setup(state) {
  const log = { accept: [], decline: [], link: [], attach: [], invalidated: [] };
  globalThis.__c = {
    search: '', params: { id: '1' },
    qc: { invalidateQueries: async value => { log.invalidated.push(value.queryKey); } },
    ui: {
      PortalLayout: ({ children }) => children, PageHeading: ({ title }) => React.createElement('h1', null, title),
      LoadingBlock: () => 'loading', ErrorBlock: () => 'error', EmptyBlock: ({ title }) => title,
      RequestRow: ({ request }) => React.createElement('p', null, request.service), Status: ({ value }) => value, StatusTrack: () => null, dateText: v => v ?? '',
    },
    hooks: {
      useGetPortalSummary: () => query(state.summary), useListServiceRequests: () => query(state.requests), useGetServiceRequest: () => query(state.requests[0]),
      useListInquiries: () => query([]), useCreateInquiry: () => mutation(async () => {}), useGetServiceRequestHistory: () => query([]),
      useAcceptQuote: () => mutation(async input => { log.accept.push(input); return state.requests[0]; }),
      useDeclineQuote: () => mutation(async input => { log.decline.push(input); return state.requests[0]; }),
      useCreateServiceRequest: () => mutation(async () => {}), useGetCompanyFile: () => query(null), useListServiceOffers: () => query([]),
    },
    calls: {
      linkAttachmentToChecklist: async (...args) => { log.link.push(args); return state.requests[0]; },
      requestServiceAttachmentUpload: async () => ({ attachmentId: 77, uploadURL: 'https://storage.test/put' }),
      attachServiceRequestFiles: async (...args) => { log.attach.push(args); return state.requests[0]; },
    },
  };
  return log;
}
const nodes = (tree, type) => tree.root.findAllByType(type);
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
const click = async button => act(async () => button.props.onClick());
const button = (tree, label) => nodes(tree, 'button').find(n => text(n).includes(label));
async function mount(element) {
  let tree;
  await act(async () => { tree = renderer.create(element); });
  return tree;
}

test('the dashboard lists what needs the customer, or says nothing does', async () => {
  const quote = { amount: 100000, vat: 15000, total: 115000, note: null, quotedAt: date, acceptedAt: null, declinedAt: null };
  setup({ summary: summary({ unpaidInvoices: 1, unpaidTotal: 50000 }), requests: [request(1, { status: 'waiting_on_customer', customerMessage: 'صورة الإقامة' }), request(2, { quote })] });
  const tree = await mount(React.createElement(Dashboard));
  const links = nodes(tree, 'a').map(a => [a.props.href, text(a)]).filter(([, t]) => t);
  assert.match(text(tree.root), /مطلوب منك الآن/);
  assert.equal(links.find(([h]) => h === '/requests/2#quote')?.[1].includes('راجع عرض السعر'), true, 'the quote comes first');
  assert.match(links.find(([h]) => h === '/requests/1#messages')?.[1], /صورة الإقامة/);
  assert.ok(links.some(([h]) => h === '/requests?status=awaiting_payment'), 'the summary count stands in for the unseen invoice');
  await act(async () => tree.unmount());
  setup({ summary: summary(), requests: [request(1)] });
  const calm = await mount(React.createElement(Dashboard));
  assert.match(text(calm.root), /لا شيء مطلوب منك الآن/);
  assert.ok(!text(calm.root).includes('مطلوب منك الآن ('));
  await act(async () => calm.unmount());
});

test('the quote card accepts, declines with a reason, and refreshes the request, invoices and lists', async () => {
  const quote = { amount: 100000, vat: 15000, total: 115000, note: 'يشمل الرسوم', quotedAt: date, acceptedAt: null, declinedAt: null };
  const state = { summary: summary(), requests: [request(1, { quote })] };
  const log = setup(state);
  const tree = await mount(React.createElement(RequestDetail));
  const body = text(tree.root);
  assert.match(body, /عرض السعر/); assert.match(body, /1,000\.00/); assert.match(body, /150\.00/); assert.match(body, /1,150\.00/); assert.match(body, /يشمل الرسوم/);
  await click(button(tree, 'أوافق وابدأ'));
  assert.deepEqual(log.accept, [{ id: 1 }]);
  const invalidated = log.invalidated.map(k => k[0]);
  for (const key of ['getGetServiceRequestQueryKey', 'getListServiceRequestInvoicesQueryKey', 'getListServiceRequestsQueryKey', 'getGetPortalSummaryQueryKey']) assert.ok(invalidated.includes(key), key);
  await click(button(tree, 'لديّ ملاحظة'));
  await act(async () => nodes(tree, 'textarea')[0].props.onChange({ target: { value: '  هل يشمل رسوم الجهة؟ ' } }));
  await act(async () => nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(log.decline, [{ id: 1, data: { reason: 'هل يشمل رسوم الجهة؟' } }]);
  // Once answered, only a line remains.
  state.requests = [request(1, { quote: { ...quote, acceptedAt: date } })];
  await act(async () => tree.update(React.createElement(RequestDetail)));
  assert.match(text(tree.root), /وافقت على العرض/);
  assert.equal(button(tree, 'أوافق وابدأ'), undefined);
  state.requests = [request(1, { quote: { ...quote, declinedAt: date } })];
  await act(async () => tree.update(React.createElement(RequestDetail)));
  assert.match(text(tree.root), /أرسلت ملاحظتك/);
  await act(async () => tree.unmount());
});

test('the checklist shows linked files, unlinks, and links a new upload to the item it was picked for', async () => {
  const checklist = [
    { key: 'iqama', label: 'صورة الإقامة', attachmentId: 5, attachmentName: 'iqama.pdf' },
    { key: 'passport', label: 'صورة الجواز', attachmentId: null, attachmentName: null },
  ];
  const state = { summary: summary(), requests: [request(1, { checklist })] };
  const log = setup(state);
  globalThis.fetch = async () => ({ ok: true });
  let changed = 0;
  const tree = await mount(React.createElement(RequestFiles, { scope: 'customer', requestId: 1, attachments: [{ id: 5, name: 'iqama.pdf', contentType: 'application/pdf', size: 1000, uploadedBy: 'customer', createdAt: date }], checklist, canUpload: true, onChanged: () => { changed++; } }));
  assert.match(text(tree.root), /المستندات المطلوبة 1\/2/);
  assert.match(text(tree.root), /iqama\.pdf/);
  await click(button(tree, 'فك الربط'));
  assert.deepEqual(log.link, [[1, 5, { key: null }]]);
  assert.equal(changed, 1);
  await click(button(tree, 'ارفع'));
  const input = nodes(tree, 'input').find(i => i.props.multiple);
  await act(async () => input.props.onChange({ target: { files: [{ name: 'passport.jpg', type: 'image/jpeg', size: 2048 }], value: '' } }));
  assert.deepEqual(log.attach, [[1, { attachmentIds: [77], checklist: [{ attachmentId: 77, key: 'passport' }] }]]);
  // A plain pick is not tied to an item.
  await act(async () => input.props.onChange({ target: { files: [{ name: 'extra.pdf', type: 'application/pdf', size: 2048 }], value: '' } }));
  assert.deepEqual(log.attach[1], [1, { attachmentIds: [77] }]);
  await act(async () => tree.unmount());
});
