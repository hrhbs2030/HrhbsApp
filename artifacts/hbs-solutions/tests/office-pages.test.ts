// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// Load the real page modules, replacing only their API and shared presentation
// boundary. This keeps state, effects, form submission and list rendering real.
const apiNames = [
  'useGetOfficeSummary', 'useListOfficeServiceRequests', 'useGetOfficeServiceRequest', 'useUpdateOfficeServiceRequest',
  'useListOfficeInquiries', 'useAnswerOfficeInquiry', 'useListOfficeStaff',
  'useAddOfficeStaff', 'useRemoveOfficeStaff', 'useListOfficeAuditLog', 'useListOfficeAssignees', 'useListOfficeServiceRequestInvoices',
  'useListOfficePlans', 'useCreateOfficePlan', 'useUpdateOfficePlan', 'useListOfficeSubscriptions', 'useUpdateOfficeSubscription',
];
const keys = [
  'getGetOfficeSummaryQueryKey', 'getListOfficeServiceRequestsQueryKey', 'getGetOfficeServiceRequestQueryKey', 'getListOfficeServiceRequestInvoicesQueryKey',
  'getListOfficeInquiriesQueryKey', 'getListOfficeStaffQueryKey', 'getListOfficeAuditLogQueryKey', 'getListOfficeAssigneesQueryKey',
  'getListOfficePlansQueryKey', 'getListOfficeSubscriptionsQueryKey',
];
const uiNames = [
  'PortalLayout', 'PageHeading', 'LoadingBlock', 'ErrorBlock', 'EmptyBlock',
  'Pager', 'StaleBadge', 'Status', 'dateText', 'isStale', 'useDebouncedValue',
];
const server = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  resolve: { alias: { '@': new URL('../src', import.meta.url).pathname }, dedupe: ['react'] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@workspace/api-client-react', '@tanstack/react-query', 'wouter'] },
  plugins: [{
    name: 'office-page-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@workspace/api-client-react') return '\0office-api';
      if (id === '@/components/portal-ui' || id.endsWith('/src/components/portal-ui')) return '\0office-ui';
      if (id === '@tanstack/react-query') return '\0office-query';
      // Invoices and document reading have their own API suites.
      if (/(^@|\/src)\/components\/(request-billing|office-request-extras|request-conversation|conversation|whatsapp-follow-up)(\.tsx)?$/.test(id)) return '\0office-extras';
      if (id === 'wouter') return '\0office-router';
      if (/\.css$/.test(id)) return '\0office-css';
    },
    load(id) {
      if (id === '\0office-api') return [
        ...apiNames.map(name => `export const ${name} = (...args) => globalThis.__office.hooks.${name}(...args);`),
        ...keys.map(name => `export const ${name} = (...args) => ['${name}', ...args];`),
      ].join('\n');
      if (id === '\0office-ui') return [
        ...uiNames.map(name => `export const ${name} = (...args) => globalThis.__office.ui.${name}(...args);`),
        'export const categoryNames = { labor: "عمل", passports: "جوازات", business: "أعمال", other: "أخرى" };',
        'export const statusOptions = ["received", "reviewing", "waiting_on_customer", "completed"];',
        'export const statusNames = { received: "جديد", reviewing: "مراجعة", waiting_on_customer: "بانتظار العميل", completed: "مكتمل" };',
      ].join('\n');
      if (id === '\0office-extras') return [
        'export const OfficeInvoices = () => null; export const ExtractReminder = () => null; export const QuotePanel = () => null; export const ChecklistEditor = () => null; export const RequestConversation = () => null; export const ReplyBadge = () => null; export const SubjectChip = () => null;',
        'export const RequestEmployees = () => null; export const employeeProgress = list => `${list.filter(e => e.itemStatus === "done").length}/${list.length} مكتمل`;',
        // The confirmation dialog, reduced to its confirm button while open.
        'import React from "react"; export const ConfirmDialog = ({ open, confirmLabel, onConfirm }) => open ? React.createElement("button", { "data-confirm": true, onClick: onConfirm }, confirmLabel) : null;',
        // The conversation shows which thread it was given; the WhatsApp lookup finds no thread here.
        'export const Conversation = props => React.createElement("div", { "data-thread": JSON.stringify(props.thread), "data-scope": props.scope }); export const WhatsappFollowUp = () => null; export const useOfficeThread = () => undefined;',
      ].join('\n');
      if (id === '\0office-query') return 'export const useQueryClient = () => globalThis.__office.qc;';
      if (id === '\0office-router') return 'export const useSearch = () => globalThis.__office.search; export const Link = ({children}) => children; export const useParams = () => globalThis.__office.params; export const useLocation = () => [globalThis.__office.location, to => globalThis.__office.navigations.push(to)];';
      if (id === '\0office-css') return '';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { OfficeRequests, OfficeInquiries } = await server.ssrLoadModule('/src/pages/office.tsx');
const { OfficeStaff, OfficeAuditLog, OfficePlans, OfficeSubscriptions, planInput } = await server.ssrLoadModule('/src/pages/office-admin.tsx');
const { OfficeRequestPage, siblingIds, neighbours, shortcutOf } = await server.ssrLoadModule('/src/pages/office-request.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The request page's shortcuts listen on the window; tests press keys by calling the listeners.
const keyListeners = new Set();
globalThis.window = { matchMedia: () => ({ matches: true }), addEventListener: (_type, fn) => keyListeners.add(fn), removeEventListener: (_type, fn) => keyListeners.delete(fn) };
const press = async key => act(async () => { for (const fn of [...keyListeners]) fn({ ...key, target: key.target ?? null, preventDefault() {} }); });

const date = '2026-09-20T12:00:00.000Z';
const request = (id, updatedAt = date) => ({
  id, reference: `REQ-${id}`, category: 'labor', service: `خدمة ${id}`,
  description: `تفاصيل ${id}`, contactPhone: '0500000000', status: 'received',
  officeNote: null, customerMessage: null, createdAt: date, updatedAt, attachments: [],
});
const inquiry = (id) => ({
  id, subject: `سؤال ${id}`, message: `رسالة ${id}`, status: 'open', answer: null,
  linkedServiceRequestReference: null, linkedServiceRequest: null, createdAt: date, answeredAt: null,
});
function setup() {
  const calls = { requests: [], request: [], inquiries: [], updates: [], answers: [], add: [], remove: [], invalidated: [], plans: [], planUpdates: [], subscriptions: [], subscriptionUpdates: [], navigations: [] };
  const state = {
    invoices: [],
    plans: [],
    subscriptions: params => ({ items: [], total: 0, page: params.page }),
    cachedPages: [],
    requests: params => ({ items: [request(params.page)], total: params.q || params.status || params.category ? 1 : 41, page: params.page, pageSize: 20 }),
    request: id => query(request(id)),
    inquiries: params => ({ items: [inquiry(params.page)], total: params.q ? 1 : 41, page: params.page, pageSize: 20 }),
    staff: [
      { userId: 'owner', email: 'owner@example.test', role: 'owner', createdAt: date },
      { userId: 'staff', email: 'staff@example.test', role: 'staff', createdAt: date },
    ],
    audit: [
      { id: 1, action: 'staff.add', actorId: 'owner', actorEmail: 'owner@example.test', targetId: 'staff', details: { email: 'staff@example.test' }, createdAt: date },
      { id: 2, action: 'staff.remove', actorId: 'owner', actorEmail: null, targetId: 'removed', details: {}, createdAt: date },
    ],
  };
  const query = data => ({ data, isLoading: false, isError: false, refetch() {} });
  const mutation = fn => ({ isPending: false, isError: false, mutateAsync: fn, reset() {} });
  const ui = {
    PortalLayout: ({ children }) => children,
    PageHeading: ({ title, action }) => React.createElement('div', null, React.createElement('h1', null, title), action ?? null),
    LoadingBlock: () => 'loading',
    ErrorBlock: () => 'error',
    EmptyBlock: ({ title }) => title,
    Pager: ({ page, pageSize, total, onPage }) => total > pageSize && React.createElement('nav', null,
      React.createElement('button', { disabled: page <= 1, onClick: () => onPage(page - 1) }, 'السابقة'),
      React.createElement('button', { disabled: page * pageSize >= total, onClick: () => onPage(page + 1) }, 'التالية')),
    StaleBadge: () => null,
    Status: ({ value }) => value,
    dateText: value => value ?? '',
    categoryNames: { labor: 'عمل', passports: 'جوازات', business: 'أعمال', other: 'أخرى' },
    isStale: () => false,
    statusOptions: ['received', 'reviewing', 'waiting_on_customer', 'completed'],
    statusNames: { received: 'جديد', reviewing: 'مراجعة', waiting_on_customer: 'بانتظار العميل', completed: 'مكتمل' },
    useDebouncedValue: value => value,
  };
  globalThis.__office = {
    search: '', params: { id: '1' }, location: '/office/requests/1', navigations: calls.navigations, ui,
    qc: { invalidateQueries: async value => { calls.invalidated.push(value.queryKey); }, getQueryCache: () => ({ findAll: () => state.cachedPages }) },
    hooks: {
      useGetOfficeSummary: () => query({ totalRequests: 0, newRequests: 0, activeRequests: 0, staleRequests: 0, openInquiries: 0 }),
      useListOfficeServiceRequests: params => { calls.requests.push(params); return query(state.requests(params)); },
      useGetOfficeServiceRequest: id => { calls.request.push(id); return state.request(id); },
      useListOfficeInquiries: params => { calls.inquiries.push(params); return query(state.inquiries(params)); },
      useUpdateOfficeServiceRequest: () => mutation(async input => { calls.updates.push(input); return { ...request(input.id), updatedAt: '2026-09-21T12:00:00.000Z' }; }),
      useAnswerOfficeInquiry: () => mutation(async input => { calls.answers.push(input); return inquiry(input.id); }),
      useListOfficeStaff: () => query(state.staff),
      useAddOfficeStaff: () => mutation(async input => { calls.add.push(input); return { email: input.data.email }; }),
      useRemoveOfficeStaff: () => mutation(async input => { calls.remove.push(input); }),
      useListOfficeAuditLog: () => query(state.audit),
      useListOfficeAssignees: () => query(state.staff.map(({ userId, email, role }) => ({ userId, email, role }))),
      useListOfficeServiceRequestInvoices: () => query(state.invoices),
      useListOfficePlans: () => query(state.plans),
      useCreateOfficePlan: () => mutation(async input => { calls.plans.push(input); return { id: 9, ...input.data }; }),
      useUpdateOfficePlan: () => mutation(async input => { calls.planUpdates.push(input); return { id: input.id, ...input.data }; }),
      useListOfficeSubscriptions: params => { calls.subscriptions.push(params); return query(state.subscriptions(params)); },
      useUpdateOfficeSubscription: () => mutation(async input => { calls.subscriptionUpdates.push(input); return {}; }),
    },
  };
  return { calls, state };
}
const nodes = (tree, type) => tree.root.findAllByType(type);
const within = (node, type) => node.findAllByType(type);
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
const click = async button => act(async () => button.props.onClick());
const change = async (field, value) => act(async () => field.props.onChange({ target: { value } }));
const submit = async form => act(async () => form.props.onSubmit({ preventDefault() {} }));
async function mount(component) {
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(component)); });
  return tree;
}

test('requests use the paged API envelope, preserve filter inputs, reset pagination and send status with customer message and version', async () => {
  const { calls, state } = setup();
  const tree = await mount(OfficeRequests);
  assert.ok(nodes(tree, 'button').some(n => text(n).includes('خدمة 1')));
  await click(nodes(tree, 'button').find(n => text(n) === 'التالية'));
  assert.equal(calls.requests.at(-1).page, 2);
  assert.ok(nodes(tree, 'button').some(n => text(n).includes('خدمة 2')));
  await change(nodes(tree, 'select')[0], 'reviewing');
  assert.deepEqual({ page: calls.requests.at(-1).page, status: calls.requests.at(-1).status }, { page: 1, status: 'reviewing' });
  await change(nodes(tree, 'select')[1], 'labor');
  await change(nodes(tree, 'select')[2], 'oldest_update');
  await change(nodes(tree, 'input')[0], '  REQ-1  ');
  assert.deepEqual(calls.requests.at(-1), { page: 1, pageSize: 20, q: 'REQ-1', status: 'reviewing', category: 'labor', sort: 'oldest_update' });
  await click(nodes(tree, 'button').find(n => text(n).includes('خدمة 1')));
  // Filters: status, category, sort, assignee; then the editor's status.
  await change(nodes(tree, 'select')[4], 'waiting_on_customer');
  await change(nodes(tree, 'textarea')[0], '  أحضر المستند  ');
  await change(nodes(tree, 'textarea')[1], '  للفريق  ');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(calls.updates[0], { id: 1, data: {
    expectedUpdatedAt: date, status: 'waiting_on_customer', officeNote: 'للفريق', customerMessage: 'أحضر المستند',
  } }, 'unchanged assignment and due date are not sent');
  assert.ok(calls.invalidated.some(key => key[0] === 'getListOfficeServiceRequestsQueryKey'));
  const latest = { ...request(1, '2026-09-22T12:00:00.000Z'), status: 'waiting_on_customer', customerMessage: 'أحضر المستند' };
  state.requests = params => ({ items: [latest], total: 1, page: params.page, pageSize: 20 });
  await act(async () => tree.update(React.createElement(OfficeRequests)));
  assert.equal(nodes(tree, 'form')[0].findByProps({ type: 'submit' }).props.disabled, true);
  await click(nodes(tree, 'button').find(n => text(n) === 'مراجعة النسخة الجديدة'));
  await submit(nodes(tree, 'form')[0]);
  assert.equal(calls.updates[1].data.expectedUpdatedAt, '2026-09-22T12:00:00.000Z');
  // Assigning sends only the new assignee (the list now has the saved version).
  state.requests = params => ({ items: [{ ...latest, updatedAt: '2026-09-21T12:00:00.000Z' }], total: 1, page: params.page, pageSize: 20 });
  await act(async () => tree.update(React.createElement(OfficeRequests)));
  await change(nodes(tree, 'select')[5], 'staff');
  await submit(nodes(tree, 'form')[0]);
  assert.equal(calls.updates[2].data.assignedTo, 'staff');
  assert.ok(!('dueAt' in calls.updates[2].data));
  await change(nodes(tree, 'select')[3], 'me');
  assert.equal(calls.requests.at(-1).assignee, 'me');
  await act(async () => tree.unmount());
});

test('the editor offers only allowed next statuses, blocks completion over an unpaid invoice and shows the API refusal', async () => {
  const { calls, state } = setup();
  const current = { ...request(1), status: 'reviewing' };
  state.requests = params => ({ items: [current], total: 1, page: params.page, pageSize: 20 });
  state.invoices = [{ id: 7, status: 'issued' }];
  const tree = await mount(OfficeRequests);
  await click(nodes(tree, 'button').find(n => text(n).includes('خدمة 1')));
  const editorStatus = nodes(tree, 'select')[4];
  assert.deepEqual(editorStatus.findAllByType('option').map(o => o.props.value),
    ['reviewing', 'waiting_on_customer', 'awaiting_payment', 'submitted_to_authority', 'completed'], 'current status first, then its allowed moves');
  await change(editorStatus, 'completed');
  assert.match(text(nodes(tree, 'form')[0]), /توجد فاتورة غير مسددة؛ لا يمكن الإكمال قبل تسويتها\./);
  assert.equal(nodes(tree, 'form')[0].findByProps({ type: 'submit' }).props.disabled, true);
  await submit(nodes(tree, 'form')[0]);
  assert.equal(calls.updates.length, 0, 'the save is not attempted');
  // With invoices settled the API still has the last word; its text is shown as is.
  state.invoices = [{ id: 7, status: 'paid' }];
  const refusal = Object.assign(new Error('refused'), { status: 409, data: { error: 'لا يمكن نقل الطلب من قيد المراجعة إلى مكتملة.' } });
  globalThis.__office.hooks.useUpdateOfficeServiceRequest = () => mutationFailingWith(refusal);
  await act(async () => tree.update(React.createElement(OfficeRequests)));
  assert.equal(nodes(tree, 'form')[0].findByProps({ type: 'submit' }).props.disabled, false);
  await submit(nodes(tree, 'form')[0]);
  assert.match(text(nodes(tree, 'form')[0]), /لا يمكن نقل الطلب من قيد المراجعة إلى مكتملة\./);
  assert.ok(!text(nodes(tree, 'form')[0]).includes('مراجعة النسخة الجديدة'), 'a rule refusal is not a version conflict');
  // The version check's 409 still shows the conflict notice.
  globalThis.__office.hooks.useUpdateOfficeServiceRequest = () => mutationFailingWith(Object.assign(new Error('stale'), { status: 409, data: { error: 'This request changed since you opened it. Refresh and review the latest version.' } }));
  await act(async () => tree.update(React.createElement(OfficeRequests)));
  await submit(nodes(tree, 'form')[0]);
  assert.match(text(nodes(tree, 'form')[0]), /تغيّر هذا الطلب منذ فتحه/);
  await act(async () => tree.unmount());
});
const mutationFailingWith = error => ({ isPending: false, isError: false, mutateAsync: async () => { throw error; }, reset() {} });

test('inquiries filter and paginate the API items, and open the selected thread', async () => {
  const { calls } = setup();
  const tree = await mount(OfficeInquiries);
  assert.equal(calls.inquiries.at(-1).status, 'open');
  await click(nodes(tree, 'button').find(n => text(n) === 'التالية'));
  assert.equal(calls.inquiries.at(-1).page, 2);
  assert.ok(nodes(tree, 'button').some(n => text(n).includes('سؤال 2')));
  await click(nodes(tree, 'button').find(n => text(n) === 'المجاب عنها'));
  assert.deepEqual(calls.inquiries.at(-1), { page: 1, pageSize: 20, status: 'answered' });
  await change(nodes(tree, 'input')[0], '  سؤال  ');
  assert.deepEqual(calls.inquiries.at(-1), { page: 1, pageSize: 20, q: 'سؤال', status: 'answered' });
  assert.equal(tree.root.findAll(n => n.props['data-thread']).length, 0, 'nothing selected yet');
  await click(nodes(tree, 'button').find(n => text(n).includes('سؤال 1')));
  const panel = tree.root.findAll(n => n.props['data-thread'])[0];
  assert.deepEqual(JSON.parse(panel.props['data-thread']), { type: 'inquiry', id: 1 });
  assert.equal(panel.props['data-scope'], 'office');
  assert.match(text(tree.root), /سؤال 1/);
  await act(async () => tree.unmount());
});

test('arriving from the messages inbox (?open=id) opens that inquiry thread with the status filter widened', async () => {
  const { calls } = setup();
  globalThis.__office.search = 'open=2';
  const tree = await mount(OfficeInquiries);
  assert.deepEqual(calls.inquiries.at(-1), { page: 1, pageSize: 20 }, 'no status filter, so an answered inquiry is listed too');
  const panel = tree.root.findAll(n => n.props['data-thread'])[0];
  assert.deepEqual(JSON.parse(panel.props['data-thread']), { type: 'inquiry', id: 2 }, 'opened even though this page does not list it');
  assert.match(text(tree.root), /استفسار #2/, 'the panel header names the inquiry by number');
  await act(async () => tree.unmount());
});

test('staff and audit render direct API arrays, showing actions and actor fallback', async () => {
  const { calls } = setup();
  const staff = await mount(OfficeStaff);
  assert.match(text(staff.root), /owner@example.test/);
  assert.match(text(staff.root), /staff@example.test/);
  assert.equal(nodes(staff, 'button').filter(n => text(n) === 'إزالة الصلاحية').length, 1);
  await change(nodes(staff, 'input')[0], ' new@example.test ');
  await submit(nodes(staff, 'form')[0]);
  assert.deepEqual(calls.add, [{ data: { email: 'new@example.test' } }]);
  await click(nodes(staff, 'button').find(n => text(n) === 'إزالة الصلاحية'));
  assert.equal(calls.remove.length, 0, 'nothing is removed before the in-page confirmation');
  await click(nodes(staff, 'button').find(n => n.props['data-confirm']));
  assert.deepEqual(calls.remove, [{ userId: 'staff' }]);
  assert.ok(calls.invalidated.some(key => key[0] === 'getListOfficeAuditLogQueryKey'));
  await act(async () => staff.unmount());
  const audit = await mount(OfficeAuditLog);
  assert.match(text(audit.root), /إضافة موظف/);
  assert.match(text(audit.root), /إزالة موظف/);
  assert.match(text(audit.root), /staff@example.test/);
  assert.match(text(audit.root), /removed/);
  assert.match(text(audit.root), /owner/);
  await act(async () => audit.unmount());
});
test('the request list links each row to the full page with the rows in order, and shows a bulk request\'s employee progress', async () => {
  const { state } = setup();
  state.requests = params => ({ items: [request(3), { ...request(4), employees: [{ employeeId: 1, fullName: 'أ', itemStatus: 'done', note: null }, { employeeId: 2, fullName: 'ب', itemStatus: 'pending', note: null }] }], total: 2, page: params.page, pageSize: 20 });
  const tree = await mount(OfficeRequests);
  const links = tree.root.findAll(n => n.props.href && /^\/office\/requests\/\d/.test(n.props.href)).map(n => n.props.href);
  assert.deepEqual(links, ['/office/requests/3?list=3,4', '/office/requests/4?list=3,4']);
  assert.match(text(tree.root), /1\/2 موظف/);
  await act(async () => tree.unmount());
});

test('request page helpers: list order from the address or the cached inbox page, neighbours, physical-key shortcuts', () => {
  const qc = { getQueryCache: () => ({ findAll: () => [
    { queryKey: ['k', { page: 1 }], state: { data: { items: [{ id: 5 }, { id: 6 }] }, dataUpdatedAt: 1 } },
    { queryKey: ['k', { q: '00006' }], state: { data: { items: [{ id: 6 }] }, dataUpdatedAt: 3 } },
    { queryKey: ['k', { page: 2 }], state: { data: { items: [{ id: 6 }, { id: 7 }] }, dataUpdatedAt: 2 } },
  ] }) };
  assert.deepEqual(siblingIds(6, 'list=9,6,8', qc), [9, 6, 8], 'the address wins');
  assert.deepEqual(siblingIds(6, 'list=9,8', qc), [6, 7], 'an address without this request falls back to the newest inbox page holding it, never the reference lookup');
  assert.deepEqual(siblingIds(1, '', qc), []);
  assert.deepEqual(neighbours([9, 6, 8], 6), { prev: 9, next: 8, index: 1, total: 3 });
  assert.deepEqual(neighbours([9, 6, 8], 8), { prev: 6, next: null, index: 2, total: 3 });
  assert.deepEqual(neighbours([], 8), { prev: null, next: null, index: -1, total: 0 });
  assert.equal(shortcutOf({ code: 'KeyJ', key: 'ت' }), 'next', 'Arabic layout: the key position counts');
  assert.equal(shortcutOf({ code: 'KeyK', key: 'ن' }), 'prev');
  assert.equal(shortcutOf({ code: 'KeyS', key: 'س' }), 'save');
  assert.equal(shortcutOf({ key: 'Escape' }), 'close');
  assert.equal(shortcutOf({ key: 'x' }), null);
});

test('the request page shows the header, tabs and update bar; J/K move through the list, S saves, Esc closes the drawer', async () => {
  const { calls, state } = setup();
  globalThis.__office.search = 'list=3,1,2';
  const current = { ...request(1), customer: { fullName: 'سارة', email: 's@example.test' }, assignedTo: 'staff', employees: [{ employeeId: 1, fullName: 'أ', itemStatus: 'done', note: null }, { employeeId: 2, fullName: 'ب', itemStatus: 'pending', note: null }] };
  const loaded = data => ({ data, isLoading: false, isError: false, refetch() {} });
  state.request = () => loaded(current);
  const tree = await mount(OfficeRequestPage);
  assert.deepEqual(calls.request.at(-1), 1, 'the request is fetched by id');
  assert.equal(calls.requests.length, 0, 'no inbox search');
  const header = tree.root.findByType('header');
  assert.match(text(header), /REQ-1/);
  assert.match(text(header), /خدمة 1/);
  assert.match(text(header), /سارة/);
  assert.match(text(header), /0500000000/);
  assert.match(text(header), /staff@example.test/, 'assignee');
  assert.match(text(header), /2 من 3/, 'position in the list');
  const tabs = tree.root.findAll(n => n.props.role === 'tab');
  assert.deepEqual(tabs.map(t => text(t)), ['الطلب', 'المحادثة', 'المستندات', 'الفواتير', 'الموظفون1/2 مكتمل']);
  assert.equal(tabs[0].props['aria-selected'], true);
  await click(tabs[1]);
  assert.equal(tree.root.findAll(n => n.props.role === 'tab')[1].props['aria-selected'], true);
  assert.equal(tree.root.findByProps({ role: 'tabpanel' }).props.id, 'orq-panel-conversation');
  const bar = nodes(tree, 'form')[0];
  assert.equal(bar.props['aria-label'], 'تحديث الطلب');
  assert.deepEqual(within(bar, 'select')[0].findAllByType('option').map(o => o.props.value), ['received', 'reviewing', 'waiting_on_customer', 'awaiting_payment'], 'current status first, then the allowed moves');
  assert.equal(within(bar, 'textarea').length, 0, 'the drawer starts closed');
  assert.match(text(bar), /J.*التالي.*K.*السابق.*S.*حفظ/s, 'the shortcuts hint');
  // J / K follow the list order from the address, keeping it for the next page.
  await press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(calls.navigations, ['/office/requests/2?list=3,1,2']);
  await press({ code: 'KeyK', key: 'ن' });
  assert.equal(calls.navigations.at(-1), '/office/requests/3?list=3,1,2');
  await press({ code: 'KeyJ', key: 'j', target: { tagName: 'INPUT' } });
  assert.equal(calls.navigations.length, 2, 'typing in a field is not a shortcut');
  // The drawer holds the note fields; Esc closes it.
  await click(within(bar, 'button').find(n => n.props['aria-expanded'] !== undefined));
  assert.equal(within(nodes(tree, 'form')[0], 'textarea').length, 1, 'internal note');
  await change(within(nodes(tree, 'form')[0], 'textarea')[0], '  للفريق  ');
  await press({ key: 'Escape' });
  assert.equal(within(nodes(tree, 'form')[0], 'textarea').length, 0);
  // S saves the draft: status plus the trimmed note; unchanged assignment and due date are not sent.
  await change(within(nodes(tree, 'form')[0], 'select')[0], 'reviewing');
  await press({ code: 'KeyS', key: 's' });
  assert.deepEqual(calls.updates, [{ id: 1, data: { expectedUpdatedAt: date, status: 'reviewing', officeNote: 'للفريق', customerMessage: null } }]);
  assert.ok(calls.invalidated.some(key => key[0] === 'getGetOfficeSummaryQueryKey'));
  // The refreshed list carries the saved version, so the page is not "changed since opened".
  assert.ok(calls.invalidated.some(key => key[0] === 'getGetOfficeServiceRequestQueryKey' && key[1] === 1), 'the request itself is refetched');
  state.request = () => loaded({ ...current, status: 'reviewing', officeNote: 'للفريق', updatedAt: '2026-09-21T12:00:00.000Z' });
  await act(async () => tree.update(React.createElement(OfficeRequestPage)));
  assert.match(text(nodes(tree, 'form')[0]), /حُفظ التحديث/);
  // Waiting on the customer needs their message: the drawer opens on it instead of saving.
  await change(within(nodes(tree, 'form')[0], 'select')[0], 'waiting_on_customer');
  await press({ key: 'Escape' });
  await press({ code: 'KeyS', key: 's' });
  assert.equal(calls.updates.length, 1);
  assert.equal(within(nodes(tree, 'form')[0], 'textarea').length, 2, 'customer message and note');
  assert.match(text(nodes(tree, 'form')[0]), /اكتب للعميل ما يحتاجه المكتب/);
  await act(async () => tree.unmount());
  // Without a list in the address or the cache, J/K are off.
  globalThis.__office.search = '';
  const alone = await mount(OfficeRequestPage);
  const navButtons = alone.root.findByProps({ 'aria-label': 'التنقل بين الطلبات' }).findAllByType('button');
  assert.deepEqual(navButtons.map(b => b.props.disabled), [true, true]);
  await press({ code: 'KeyJ', key: 'j' });
  assert.equal(calls.navigations.length, 2);
  await act(async () => alone.unmount());
  // A bad address or an unknown id says so instead of spinning.
  globalThis.__office.params = { id: 'x' };
  const bad = await mount(OfficeRequestPage);
  assert.match(text(bad.root), /الطلب غير متاح/);
  await act(async () => bad.unmount());
  globalThis.__office.params = { id: '77' };
  state.request = () => ({ data: undefined, isLoading: false, isError: true, error: { status: 404 }, refetch() {} });
  const missing = await mount(OfficeRequestPage);
  assert.match(text(missing.root), /الطلب غير موجود/);
  await act(async () => missing.unmount());
  // Any other failure offers a retry; a cached inbox row still shows meanwhile.
  state.request = () => ({ data: undefined, isLoading: false, isError: true, error: { status: 500 }, refetch() {} });
  const broken = await mount(OfficeRequestPage);
  assert.match(text(broken.root), /error/);
  await act(async () => broken.unmount());
  state.cachedPages = [{ queryKey: ['getListOfficeServiceRequestsQueryKey', { page: 1 }], state: { data: { items: [{ ...current, id: 77, reference: 'REQ-77' }] }, dataUpdatedAt: 1 } }];
  const fromCache = await mount(OfficeRequestPage);
  assert.match(text(fromCache.root.findByType('header')), /REQ-77/);
  await act(async () => fromCache.unmount());
});

test('plan form: validation messages, riyals to halalas, blanks as unlimited; the page creates and edits plans', async () => {
  assert.deepEqual(planInput({ name: 'أساسية', slug: 'basic-1', description: ' للمنشآت الصغيرة ', price: '١٥٠٫٥', employeeCap: '', requestsPerMonth: '10', autoRenewals: true, active: false, sort: '2' }),
    { data: { name: 'أساسية', slug: 'basic-1', description: 'للمنشآت الصغيرة', price: 15050, employeeCap: null, requestsPerMonth: 10, autoRenewals: true, active: false, sort: 2 }, errors: {} });
  const bad = planInput({ name: 'أ', slug: 'Basic Plan', description: '', price: 'abc', employeeCap: '0', requestsPerMonth: '1e3', autoRenewals: true, active: true, sort: '5000' });
  assert.equal(bad.data, null);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['employeeCap', 'name', 'price', 'requestsPerMonth', 'slug', 'sort']);
  assert.deepEqual(planInput({ name: 'مجانية', slug: 'free', description: '', price: '0', employeeCap: '', requestsPerMonth: '', autoRenewals: false, active: true, sort: '' }).data, { name: 'مجانية', slug: 'free', description: '', price: 0, employeeCap: null, requestsPerMonth: null, autoRenewals: false, active: true, sort: 0 }, 'a free plan with a blank sort');
  const { calls, state } = setup();
  state.plans = [{ id: 1, slug: 'pro', name: 'احترافية', description: '', price: 50000, vat: 7500, total: 57500, employeeCap: 50, requestsPerMonth: null, autoRenewals: true, active: true, sort: 1 }];
  const tree = await mount(OfficePlans);
  assert.match(text(tree.root), /احترافية/);
  assert.match(text(tree.root), /500\.00 ر\.س شهريًا قبل الضريبة/);
  await click(nodes(tree, 'button').find(n => text(n) === 'باقة جديدة'));
  await submit(nodes(tree, 'form')[0]);
  assert.equal(calls.plans.length, 0, 'an empty form is not sent');
  assert.match(text(nodes(tree, 'form')[0]), /اكتب اسمًا من حرفين/);
  const inputs = () => within(nodes(tree, 'form')[0], 'input');
  await change(inputs()[0], 'أساسية');
  await change(inputs()[1], 'basic');
  await change(within(nodes(tree, 'form')[0], 'textarea')[0], 'للمنشآت الصغيرة');
  await change(inputs()[2], '199.99');
  assert.match(text(nodes(tree, 'form')[0]), /229\.99 ر\.س شهريًا/, 'the total with VAT is previewed');
  await change(inputs()[4], '20');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(calls.plans, [{ data: { name: 'أساسية', slug: 'basic', description: 'للمنشآت الصغيرة', price: 19999, employeeCap: 20, requestsPerMonth: null, autoRenewals: true, active: true, sort: 0 } }]);
  assert.ok(calls.invalidated.some(key => key[0] === 'getListOfficePlansQueryKey'));
  assert.match(text(tree.root), /أُنشئت الباقة/);
  assert.equal(nodes(tree, 'form').length, 0, 'the form closes after saving');
  await click(nodes(tree, 'button').find(n => text(n) === 'تعديل'));
  assert.equal(within(nodes(tree, 'form')[0], 'input')[1].props.disabled, true, 'the slug is fixed once created');
  assert.equal(within(nodes(tree, 'form')[0], 'input')[2].props.value, '500');
  await change(within(nodes(tree, 'form')[0], 'input')[2], '450');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(calls.planUpdates, [{ id: 1, data: { name: 'احترافية', slug: 'pro', description: '', price: 45000, employeeCap: 50, requestsPerMonth: null, autoRenewals: true, active: true, sort: 1 } }]);
  await act(async () => tree.unmount());
});

test('subscriptions: filter by status, toggle automatic renewals, and cancel only after the in-page confirmation', async () => {
  const { calls, state } = setup();
  const plan = { id: 1, slug: 'pro', name: 'احترافية', description: '', price: 50000, vat: 7500, total: 57500, employeeCap: null, requestsPerMonth: null, autoRenewals: true, active: true, sort: 1 };
  const subscription = (id, extra = {}) => ({ id, plan, status: 'active', startsAt: date, renewsAt: '2026-10-20T12:00:00.000Z', cancelledAt: null, autoRenewRequests: true, latestInvoice: { id: 3, reference: 'INV-3', status: 'issued' }, userId: `u${id}`, companyName: `منشأة ${id}`, customerName: `عميل ${id}`, ...extra });
  state.subscriptions = params => ({ items: params.status === 'cancelled' ? [subscription(2, { status: 'cancelled', cancelledAt: date, latestInvoice: null })] : [subscription(1)], total: 1 });
  const tree = await mount(OfficeSubscriptions);
  assert.deepEqual(calls.subscriptions.at(-1), { page: 1, pageSize: 20 });
  assert.match(text(tree.root), /منشأة 1/);
  assert.match(text(tree.root), /غير مسددة/);
  await click(nodes(tree, 'button').find(n => text(n) === 'إيقاف التجديد التلقائي'));
  assert.deepEqual(calls.subscriptionUpdates, [{ id: 1, data: { autoRenewRequests: false } }]);
  assert.ok(calls.invalidated.some(key => key[0] === 'getListOfficeSubscriptionsQueryKey'));
  await click(nodes(tree, 'button').find(n => text(n) === 'إلغاء الاشتراك'));
  assert.equal(calls.subscriptionUpdates.length, 1, 'nothing is cancelled before the in-page confirmation');
  await click(nodes(tree, 'button').find(n => n.props['data-confirm']));
  assert.deepEqual(calls.subscriptionUpdates.at(-1), { id: 1, data: { status: 'cancelled' } });
  assert.match(text(tree.root), /أُلغي الاشتراك/);
  await click(nodes(tree, 'button').find(n => text(n) === 'الملغاة'));
  assert.deepEqual(calls.subscriptions.at(-1), { page: 1, pageSize: 20, status: 'cancelled' });
  assert.match(text(tree.root), /منشأة 2/);
  assert.ok(!nodes(tree, 'button').some(n => text(n) === 'إلغاء الاشتراك'), 'a cancelled subscription has no actions');
  await act(async () => tree.unmount());
});
