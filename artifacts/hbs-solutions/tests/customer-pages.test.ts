// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// The customer dashboard, request page, company page and new-request form
// with the API, router and shared presentation replaced, as
// tests/office-pages.test.ts does for the office. The task list, the quote
// card, the document checklist, the members and subscription sections and the
// bulk employee picker stay real.
const hooks = [
  'useGetPortalSummary', 'useListServiceRequests', 'useGetServiceRequest', 'useListInquiries', 'useCreateInquiry',
  'useGetServiceRequestHistory', 'useAcceptQuote', 'useDeclineQuote', 'useCreateServiceRequest', 'useGetCompanyFile', 'useListServiceOffers',
  'useGetCompanyMembership', 'useListCompanyMembers', 'useInviteCompanyMember', 'useUpdateCompanyMember', 'useRemoveCompanyMember',
  'useListPlans', 'useGetCompanySubscription', 'useStartCompanySubscription', 'useUpdateCompanySubscription', 'useListCompanyInvoices',
  'useGetOfficeCustomerFile', 'useListOfficeCustomers',
];
const calls = [
  'attachServiceRequestFiles', 'attachOfficeServiceRequestFiles', 'deleteServiceRequestFile', 'deleteOfficeServiceRequestFile',
  'downloadServiceAttachment', 'downloadOfficeServiceAttachment', 'linkAttachmentToChecklist', 'linkOfficeAttachmentToChecklist',
  'requestServiceAttachmentUpload', 'requestOfficeServiceAttachmentUpload',
];
const keys = [
  'getGetPortalSummaryQueryKey', 'getListServiceRequestsQueryKey', 'getListInquiriesQueryKey', 'getGetServiceRequestQueryKey',
  'getGetServiceRequestHistoryQueryKey', 'getListServiceRequestInvoicesQueryKey', 'getGetCompanyFileQueryKey', 'getListServiceOffersQueryKey',
  'getGetCompanyMembershipQueryKey', 'getListCompanyMembersQueryKey', 'getListPlansQueryKey', 'getGetCompanySubscriptionQueryKey', 'getListCompanyInvoicesQueryKey',
  'getGetOfficeCustomerFileQueryKey', 'getListOfficeCustomersQueryKey',
];
const uiNames = ['PortalLayout', 'PageHeading', 'LoadingBlock', 'ErrorBlock', 'EmptyBlock', 'RequestRow', 'Status', 'StatusTrack', 'dateText', 'useDebouncedValue'];
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
      if (/(^@|\/src)\/components\/(request-billing|request-conversation|customer-assistant|reminder-ui|service-offer|excel-import|brand\/print)(\.tsx)?$/.test(id)) return '\0c-extras';
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
      // The confirmation dialog is reduced to its confirm button so deletes and cancellations can be driven; the pay button to its label.
      if (id === '\0c-extras') return 'import React from "react"; export const CustomerInvoices = () => null; export const RatingPanel = () => null; export const ConfirmDialog = ({ open, confirmLabel, onConfirm }) => open ? React.createElement("button", { onClick: onConfirm, "data-dialog": true }, confirmLabel) : null; export const RequestConversation = () => null; export const SubjectChip = () => null; export const focusComposer = () => {}; export const CustomerAssistant = () => null; export const ExpiryBadge = () => null; export const reminderKindNames = {}; export const ServiceOffer = () => null; export const PrintButton = () => null; export const ExcelImport = () => null; export const ExportButtons = () => null; export const InvoiceRow = ({ invoice, children }) => React.createElement("li", null, invoice.reference, children); export const PayInvoiceButton = ({ invoice }) => invoice.canPayOnline ? React.createElement("button", null, "ادفع الآن") : null; export const useRefreshReturnedInvoice = () => false;';
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
const { CompanyPage } = await server.ssrLoadModule('/src/pages/company.tsx');
const { NewRequest, employeeLink } = await server.ssrLoadModule('/src/pages/new-request.tsx');
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
const failed = (status = 501) => ({ data: undefined, isLoading: false, isError: true, error: { status }, refetch() {} });
const mutation = fn => ({ isPending: false, isError: false, mutateAsync: fn, reset() {} });
const plan = (id, extra = {}) => ({ id, slug: `plan-${id}`, name: `باقة ${id}`, description: `وصف الباقة ${id}`, price: 100000, vat: 15000, total: 115000, employeeCap: 25, requestsPerMonth: null, autoRenewals: id === 1, active: true, sort: id, ...extra });
const employee = (id, extra = {}) => ({ id, fullName: `موظف ${id}`, nationality: null, occupation: null, idNumberMasked: null, passportNumberMasked: null, iqamaExpiresOn: null, passportExpiresOn: null, workPermitExpiresOn: null, phone: null, status: 'active', notes: null, addedBy: 'customer', createdAt: date, updatedAt: date, ...extra });
function setup(state) {
  const log = { accept: [], decline: [], link: [], attach: [], invalidated: [], invite: [], updateMember: [], removeMember: [], start: [], updateSub: [], create: [] };
  globalThis.__c = {
    search: state.search ?? '', params: { id: '1' },
    qc: { invalidateQueries: async value => { log.invalidated.push(value.queryKey); } },
    ui: {
      PortalLayout: ({ children }) => children, PageHeading: ({ title }) => React.createElement('h1', null, title),
      LoadingBlock: () => 'loading', ErrorBlock: () => 'error', EmptyBlock: ({ title }) => title,
      RequestRow: ({ request }) => React.createElement('p', null, request.service), Status: ({ value }) => value, StatusTrack: () => null, dateText: v => v ?? '', useDebouncedValue: v => v,
    },
    hooks: {
      useGetPortalSummary: () => query(state.summary), useListServiceRequests: () => query(state.requests), useGetServiceRequest: () => query(state.requests[0]),
      useListInquiries: () => query([]), useCreateInquiry: () => mutation(async () => {}), useGetServiceRequestHistory: () => query([]),
      useAcceptQuote: () => mutation(async input => { log.accept.push(input); return state.requests[0]; }),
      useDeclineQuote: () => mutation(async input => { log.decline.push(input); return state.requests[0]; }),
      useCreateServiceRequest: () => mutation(async input => { log.create.push(input); return { id: 9 }; }), useGetCompanyFile: () => query(state.company ?? null), useListServiceOffers: () => query([]),
      // The company page: membership and members, the subscription, plans and invoices. Each fails like the server does until it exists.
      useGetCompanyMembership: () => state.membership === undefined ? failed() : query(state.membership),
      useListCompanyMembers: () => query(state.members ?? []),
      useInviteCompanyMember: () => mutation(async input => { log.invite.push(input); return { id: 99, ...input.data, memberUserId: null, invitedAt: date, acceptedAt: null }; }),
      useUpdateCompanyMember: () => mutation(async input => { log.updateMember.push(input); return {}; }),
      useRemoveCompanyMember: () => mutation(async input => { log.removeMember.push(input); }),
      useGetCompanySubscription: () => state.subscription === undefined ? failed() : query({ subscription: state.subscription }),
      useListPlans: () => query(state.plans ?? []),
      useStartCompanySubscription: () => mutation(async input => { log.start.push(input); return state.subscription; }),
      useUpdateCompanySubscription: () => mutation(async input => { log.updateSub.push(input); return state.subscription; }),
      useListCompanyInvoices: () => query(state.invoices ?? []),
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
const buttons = (tree, label) => nodes(tree, 'button').filter(n => text(n).includes(label));
const tabs = tree => nodes(tree, 'button').filter(n => n.props.role === 'tab').map(text);
const submit = async form => act(async () => form.props.onSubmit({ preventDefault() {} }));
const member = (id, role, extra = {}) => ({ id, email: `user${id}@example.com`, role, memberUserId: null, invitedAt: date, acceptedAt: null, ...extra });
const subscription = (status, extra = {}) => ({ id: 3, plan: plan(1), status, startsAt: date, renewsAt: '2026-10-20T12:00:00.000Z', cancelledAt: null, autoRenewRequests: true, latestInvoice: null, ...extra });
const invoice = (id, extra = {}) => ({ id, reference: `INV-${id}`, requestId: null, requestReference: null, subscriptionId: 3, description: 'اشتراك', quantity: 1, unitAmount: null, amount: 100000, vatRateBasisPoints: 1500, vat: 15000, total: 115000, status: 'issued', paymentMethod: null, paymentReference: null, issuedAt: date, paidAt: null, cancelledAt: null, canPayOnline: true, seller: { name: 'المكتب', vatNumber: null }, ...extra });
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

test('the dashboard asks the owner to pay a past-due subscription, and ignores a failing subscription call', async () => {
  setup({ summary: summary(), requests: [request(1)], subscription: subscription('past_due', { latestInvoice: invoice(5) }) });
  const tree = await mount(React.createElement(Dashboard));
  const link = nodes(tree, 'a').find(a => a.props.href === '/company?tab=subscription');
  assert.match(text(link), /سدّد فاتورة الاشتراك/); assert.match(text(link), /باقة 1/);
  await act(async () => tree.unmount());
  // No company, or a server without subscriptions yet: nothing is asked.
  setup({ summary: summary({ hasCompany: false }), requests: [request(1)] });
  const calm = await mount(React.createElement(Dashboard));
  assert.match(text(calm.root), /لا شيء مطلوب منك الآن/);
  await act(async () => calm.unmount());
});

test('the request page lists the employees of a bulk request with their progress', async () => {
  setup({ summary: summary(), requests: [request(1, { employees: [
    { employeeId: 1, fullName: 'أحمد', itemStatus: 'done', note: null }, { employeeId: 2, fullName: 'سعيد', itemStatus: 'blocked', note: 'الجواز منتهٍ' }, { employeeId: 3, fullName: 'خالد', itemStatus: 'pending', note: null },
  ] })] });
  const tree = await mount(React.createElement(RequestDetail));
  const body = text(tree.root);
  assert.match(body, /الموظفون في هذا الطلب \(1\/3 مكتمل\)/);
  for (const piece of ['أحمد', 'مكتمل', 'سعيد', 'متوقف', 'الجواز منتهٍ', 'خالد', 'قيد الانتظار']) assert.ok(body.includes(piece), piece);
  await act(async () => tree.unmount());
  setup({ summary: summary(), requests: [request(1)] });
  const single = await mount(React.createElement(RequestDetail));
  assert.ok(!text(single.root).includes('الموظفون في هذا الطلب'), 'a request without employees has no list');
  await act(async () => single.unmount());
});

const companyFile = () => ({ company: { name: 'شركة الاختبار', crNumber: null, unifiedNumber: null, vatNumber: null, city: null, address: null, activity: null, contactName: null, contactPhone: null, notes: null, updatedAt: date }, employees: [employee(1), employee(2), employee(3), employee(4, { status: 'left' })], licenses: [], reminders: [] });

test('the owner invites members, changes their role, and removes them; the owner row comes first', async () => {
  const state = { summary: summary(), requests: [], company: companyFile(), membership: { role: 'owner', companyUserId: 'u1', companyName: 'شركة الاختبار' }, members: [member(2, 'hr', { acceptedAt: date, memberUserId: 'u2' }), member(0, 'owner', { email: 'owner@example.com', acceptedAt: date, memberUserId: 'u1' }), member(3, 'viewer')] };
  const log = setup(state);
  const tree = await mount(React.createElement(CompanyPage));
  assert.deepEqual(tabs(tree), ['المنشأة والموظفون', 'أعضاء المنشأة', 'الاشتراك والفواتير']);
  assert.ok(!text(tree.root).includes('أنت عضو بصلاحية'));
  await click(button(tree, 'أعضاء المنشأة'));
  const rows = nodes(tree, 'li').map(text);
  assert.match(rows[0], /owner@example\.com/); assert.match(rows[0], /مالك/);
  assert.match(rows[1], /موارد بشرية/); assert.match(rows[1], /انضم/);
  assert.match(rows[2], /قراءة/); assert.match(rows[2], /بانتظار القبول/);
  // Invite.
  const form = nodes(tree, 'form').find(f => f.props['aria-label'] === 'دعوة عضو');
  await act(async () => form.findByType('input').props.onChange({ target: { value: ' new@example.com ' } }));
  await act(async () => form.findByType('select').props.onChange({ target: { value: 'finance' } }));
  assert.match(text(form), /يرى الاشتراك والفواتير/, 'the role is explained in one line');
  await submit(form);
  assert.deepEqual(log.invite, [{ data: { email: 'new@example.com', role: 'finance' } }]);
  assert.ok(log.invalidated.some(k => k[0] === 'getListCompanyMembersQueryKey'));
  // Change a role.
  const select = nodes(tree, 'select').find(s => s.props.id === 'cp-role-2');
  await act(async () => select.props.onChange({ target: { value: 'finance' } }));
  assert.deepEqual(log.updateMember, [{ id: 2, data: { role: 'finance' } }]);
  assert.equal(nodes(tree, 'select').find(s => s.props.id === 'cp-role-0'), undefined, 'the owner has no role control');
  // Remove, through the confirmation.
  await click(nodes(tree, 'button').find(b => b.props['aria-label'] === 'إزالة user3@example.com'));
  await click(nodes(tree, 'button').find(b => b.props['data-dialog']));
  assert.deepEqual(log.removeMember, [{ id: 3 }]);
  await act(async () => tree.unmount());
});

test('members see the company file per their role, and no tabs they cannot use', async () => {
  const open = async role => {
    setup({ summary: summary(), requests: [], company: companyFile(), membership: role && { role, companyUserId: 'u1', companyName: 'شركة الاختبار' }, members: [], subscription: null, plans: [plan(1)] });
    const tree = await mount(React.createElement(CompanyPage));
    const body = text(tree.root);
    const result = { tabs: tabs(tree), roleLine: /أنت عضو بصلاحية: (مالك|موارد بشرية|مالية|قراءة)/.exec(body)?.[1] ?? null, canAddEmployee: !!button(tree, 'إضافة موظف'), canAddLicense: !!button(tree, 'إضافة ترخيص'), canEditCompany: !!button(tree, 'تعديل') };
    await act(async () => tree.unmount());
    return result;
  };
  assert.deepEqual(await open('viewer'), { tabs: [], roleLine: 'قراءة', canAddEmployee: false, canAddLicense: false, canEditCompany: false });
  assert.deepEqual(await open('finance'), { tabs: ['المنشأة والموظفون', 'الاشتراك والفواتير'], roleLine: 'مالية', canAddEmployee: false, canAddLicense: false, canEditCompany: false });
  assert.deepEqual(await open('hr'), { tabs: [], roleLine: 'موارد بشرية', canAddEmployee: true, canAddLicense: true, canEditCompany: true });
  assert.deepEqual(await open('owner'), { tabs: ['المنشأة والموظفون', 'أعضاء المنشأة', 'الاشتراك والفواتير'], roleLine: null, canAddEmployee: true, canAddLicense: true, canEditCompany: true });
  // Until the server answers about membership, the page behaves as the owner's own file.
  assert.deepEqual((await open(undefined)).tabs, ['المنشأة والموظفون', 'أعضاء المنشأة', 'الاشتراك والفواتير']);
});

test('without a subscription the plans are offered; subscribing refreshes the subscription and invoices', async () => {
  const state = { summary: summary(), requests: [], company: companyFile(), membership: { role: 'owner', companyUserId: 'u1', companyName: null }, subscription: null, plans: [plan(2), plan(1), plan(3, { active: false })], invoices: [], search: 'tab=subscription' };
  const log = setup(state);
  const tree = await mount(React.createElement(CompanyPage));
  const cards = nodes(tree, 'li').filter(li => li.props.className === 'cp-plan').map(text);
  assert.equal(cards.length, 2, 'inactive plans are not offered');
  assert.match(cards[0], /باقة 1/); assert.match(cards[0], /تجديد تلقائي/); assert.match(cards[0], /1,000\.00/); assert.match(cards[0], /1,150\.00/); assert.match(cards[0], /25 موظف/); assert.match(cards[0], /طلب بلا حد/);
  assert.ok(!cards[1].includes('تجديد تلقائي'));
  assert.match(text(tree.root), /لا توجد فواتير اشتراك بعد/);
  await click(buttons(tree, 'اشترك')[1]);
  assert.deepEqual(log.start, [{ data: { planId: 2, autoRenewRequests: false } }]);
  for (const key of ['getGetCompanySubscriptionQueryKey', 'getListCompanyInvoicesQueryKey', 'getGetPortalSummaryQueryKey']) assert.ok(log.invalidated.some(k => k[0] === key), key);
  // Once subscribed: the plan, its status, the renewal date, the latest invoice to pay, the toggle and the cancellation.
  state.subscription = subscription('past_due', { latestInvoice: invoice(5) }); state.invoices = [invoice(5), invoice(4, { status: 'paid', canPayOnline: false }), invoice(1, { subscriptionId: null, requestId: 7, requestReference: 'REQ-7' })];
  await act(async () => tree.update(React.createElement(CompanyPage)));
  const body = text(tree.root);
  assert.match(body, /باقة 1/); assert.match(body, /متأخر السداد/); assert.match(body, /التجديد القادم/); assert.match(body, /20 أكتوبر 2026/);
  assert.equal(buttons(tree, 'ادفع الآن').length, 2, 'the latest invoice and the list row');
  assert.ok(body.includes('INV-4') && !body.includes('INV-1'), 'request invoices stay on their request page');
  await act(async () => nodes(tree, 'input').find(i => i.props.type === 'checkbox').props.onChange({ target: { checked: false } }));
  assert.deepEqual(log.updateSub, [{ data: { autoRenewRequests: false } }]);
  await click(button(tree, 'إلغاء الاشتراك'));
  await click(nodes(tree, 'button').find(b => b.props['data-dialog']));
  assert.deepEqual(log.updateSub[1], { data: { cancel: true } });
  await act(async () => tree.unmount());
  // No plans published.
  setup({ ...state, subscription: null, plans: [] });
  const empty = await mount(React.createElement(CompanyPage));
  assert.match(text(empty.root), /لا توجد باقات منشورة حاليًا/);
  await act(async () => empty.unmount());
});

test('a labour or passport request picks several employees and sends employeeIds, one employee stays employeeId', async () => {
  assert.deepEqual(employeeLink([]), {}); assert.deepEqual(employeeLink([4]), { employeeId: 4 }); assert.deepEqual(employeeLink([4, 5, 4]), { employeeIds: [4, 5] });
  assert.equal(employeeLink(Array.from({ length: 60 }, (_, i) => i + 1)).employeeIds.length, 50);
  const state = { summary: summary(), requests: [], company: companyFile(), search: 'service=iqama-renewal' };
  const log = setup(state);
  const tree = await mount(React.createElement(NewRequest));
  const form = () => nodes(tree, 'form')[0];
  await submit(form());
  const boxes = () => nodes(tree, 'input').filter(i => i.props.type === 'checkbox');
  assert.equal(boxes().length, 3, 'only employees still in the company');
  assert.equal(nodes(tree, 'select').find(s => s.props.id === 'field-subject'), undefined, 'the single picker is replaced');
  await act(async () => boxes()[0].props.onChange({ target: { checked: true } }));
  await act(async () => boxes()[1].props.onChange({ target: { checked: true } }));
  assert.match(text(tree.root), /2\/50/);
  await act(async () => nodes(tree, 'textarea')[0].props.onChange({ target: { value: 'تجديد إقامات الموظفين المذكورين' } }));
  await act(async () => nodes(tree, 'input').find(i => i.props.id === 'field-contactPhone').props.onChange({ target: { value: '0501234567' } }));
  await submit(form());
  assert.match(text(tree.root), /موظفان: موظف 1، موظف 2/);
  await submit(form());
  assert.deepEqual(log.create[0].data.employeeIds, [1, 2]); assert.equal('employeeId' in log.create[0].data, false);
  // Back to one employee: a plain subject link.
  await click(nodes(tree, 'button').find(b => b.props['aria-label'] === 'تعديل ما يخصه الطلب'));
  await act(async () => boxes()[1].props.onChange({ target: { checked: false } }));
  await submit(form()); await submit(form());
  assert.deepEqual(log.create[1].data.employeeId, 1); assert.equal('employeeIds' in log.create[1].data, false);
  // Select all, filtered by the search.
  await click(nodes(tree, 'button').find(b => b.props['aria-label'] === 'تعديل ما يخصه الطلب'));
  await act(async () => nodes(tree, 'input').find(i => i.props['aria-label'] === 'بحث في الموظفين').props.onChange({ target: { value: 'موظف 3' } }));
  assert.equal(boxes().length, 1);
  await click(button(tree, 'تحديد الكل'));
  assert.match(text(tree.root), /2\/50/);
  await act(async () => tree.unmount());
  // A business request keeps the single employee-or-license picker.
  setup({ ...state, search: 'category=business' });
  const single = await mount(React.createElement(NewRequest));
  await act(async () => nodes(single, 'input').find(i => i.props.id === 'field-service').props.onChange({ target: { value: 'تعديل سجل' } }));
  await submit(nodes(single, 'form')[0]);
  assert.ok(nodes(single, 'select').find(s => s.props.id === 'field-subject'));
  assert.equal(nodes(single, 'input').filter(i => i.props.type === 'checkbox').length, 0);
  await act(async () => single.unmount());
});
