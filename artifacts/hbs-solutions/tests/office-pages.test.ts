// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// Load the real page modules, replacing only their API and shared presentation
// boundary. This keeps state, effects, form submission and list rendering real.
const apiNames = [
  'useGetOfficeSummary', 'useListOfficeServiceRequests', 'useUpdateOfficeServiceRequest',
  'useListOfficeInquiries', 'useAnswerOfficeInquiry', 'useListOfficeStaff',
  'useAddOfficeStaff', 'useRemoveOfficeStaff', 'useListOfficeAuditLog', 'useListOfficeAssignees', 'useListOfficeServiceRequestInvoices',
];
const keys = [
  'getGetOfficeSummaryQueryKey', 'getListOfficeServiceRequestsQueryKey', 'getListOfficeServiceRequestInvoicesQueryKey',
  'getListOfficeInquiriesQueryKey', 'getListOfficeStaffQueryKey', 'getListOfficeAuditLogQueryKey', 'getListOfficeAssigneesQueryKey',
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
      if (/(^@|\/src)\/components\/(request-billing|office-request-extras|request-conversation)(\.tsx)?$/.test(id)) return '\0office-extras';
      if (id === 'wouter') return '\0office-router';
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
        // The confirmation dialog, reduced to its confirm button while open.
        'import React from "react"; export const ConfirmDialog = ({ open, confirmLabel, onConfirm }) => open ? React.createElement("button", { "data-confirm": true, onClick: onConfirm }, confirmLabel) : null;',
      ].join('\n');
      if (id === '\0office-query') return 'export const useQueryClient = () => globalThis.__office.qc;';
      if (id === '\0office-router') return 'export const useSearch = () => globalThis.__office.search; export const Link = ({children}) => children;';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { OfficeRequests, OfficeInquiries } = await server.ssrLoadModule('/src/pages/office.tsx');
const { OfficeStaff, OfficeAuditLog } = await server.ssrLoadModule('/src/pages/office-admin.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { matchMedia: () => ({ matches: true }) };

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
  const calls = { requests: [], inquiries: [], updates: [], answers: [], add: [], remove: [], invalidated: [] };
  const state = {
    invoices: [],
    requests: params => ({ items: [request(params.page)], total: params.q || params.status || params.category ? 1 : 41, page: params.page, pageSize: 20 }),
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
    PageHeading: ({ title }) => React.createElement('h1', null, title),
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
    search: '', ui, qc: { invalidateQueries: async value => { calls.invalidated.push(value.queryKey); } },
    hooks: {
      useGetOfficeSummary: () => query({ totalRequests: 0, newRequests: 0, activeRequests: 0, staleRequests: 0, openInquiries: 0 }),
      useListOfficeServiceRequests: params => { calls.requests.push(params); return query(state.requests(params)); },
      useListOfficeInquiries: params => { calls.inquiries.push(params); return query(state.inquiries(params)); },
      useUpdateOfficeServiceRequest: () => mutation(async input => { calls.updates.push(input); return { ...request(input.id), updatedAt: '2026-09-21T12:00:00.000Z' }; }),
      useAnswerOfficeInquiry: () => mutation(async input => { calls.answers.push(input); return inquiry(input.id); }),
      useListOfficeStaff: () => query(state.staff),
      useAddOfficeStaff: () => mutation(async input => { calls.add.push(input); return { email: input.data.email }; }),
      useRemoveOfficeStaff: () => mutation(async input => { calls.remove.push(input); }),
      useListOfficeAuditLog: () => query(state.audit),
      useListOfficeAssignees: () => query(state.staff.map(({ userId, email, role }) => ({ userId, email, role }))),
      useListOfficeServiceRequestInvoices: () => query(state.invoices),
    },
  };
  return { calls, state };
}
const nodes = (tree, type) => tree.root.findAllByType(type);
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

test('inquiries filter and paginate the API items, then submit a trimmed reply', async () => {
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
  await click(nodes(tree, 'button').find(n => text(n).includes('سؤال 1')));
  await change(nodes(tree, 'textarea')[0], '  تم الرد  ');
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(calls.answers, [{ id: 1, data: { answer: 'تم الرد' } }]);
  assert.ok(calls.invalidated.some(key => key[0] === 'getListOfficeInquiriesQueryKey'));
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