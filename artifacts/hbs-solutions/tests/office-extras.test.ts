// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

// The real components with only the API client, react-query, routing and
// sibling panels replaced; the forms, state and messages are the real ones.
const hooks = ['useSendOfficeQuote', 'useSaveOfficeChecklist', 'useListOfficeServiceRequestMessages', 'useCreateOfficeReminder', 'useExtractOfficeAttachmentDocument'];
const fns = ['linkOfficeAttachmentToChecklist', 'lookupCommercialRegister', 'lookupOfficeCommercialRegister', 'saveCompany', 'createEmployee', 'updateEmployee', 'deleteEmployee', 'getEmployeeNumbers', 'createLicense', 'updateLicense', 'deleteLicense', 'importEmployees', 'importLicenses',
  'createOfficeCustomerEmployee', 'createOfficeCustomerLicense', 'deleteOfficeCustomerEmployee', 'deleteOfficeCustomerLicense', 'getOfficeCustomerEmployeeNumbers', 'saveOfficeCustomerCompany', 'importOfficeCustomerEmployees', 'importOfficeCustomerLicenses', 'updateOfficeCustomerEmployee', 'updateOfficeCustomerLicense'];
const server = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  resolve: { alias: { '@': new URL('../src', import.meta.url).pathname }, dedupe: ['react'] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@workspace/api-client-react', '@tanstack/react-query', 'wouter'] },
  plugins: [{
    name: 'office-extras-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@workspace/api-client-react') return '\0x-api';
      if (id === '@tanstack/react-query') return '\0x-query';
      if (id === 'wouter') return '\0x-router';
      if (/(^@|\/src)\/components\/(reminder-ui|excel-import|request-billing)(\.tsx)?$/.test(id)) return '\0x-siblings';
      if (/\.css$/.test(id)) return '\0x-css';
    },
    load(id) {
      if (id === '\0x-api') return [
        ...hooks.map(name => `export const ${name} = (...args) => globalThis.__x.hooks.${name}(...args);`),
        ...fns.map(name => `export const ${name} = (...args) => globalThis.__x.fns.${name}(...args);`),
        'export const getListOfficeServiceRequestMessagesQueryKey = (...args) => ["messages", ...args];',
      ].join('\n');
      if (id === '\0x-query') return 'export const useQueryClient = () => ({ invalidateQueries: async () => {} });';
      if (id === '\0x-router') return 'export const Link = ({children}) => children;';
      if (id === '\0x-siblings') return 'export const ReminderForm = () => null; export const emptyDraft = {}; export const ExcelImport = () => null; export const ExportButtons = () => null; export const ConfirmDialog = () => null; export const ExpiryBadge = () => null;';
      if (id === '\0x-css') return '';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { QuotePanel, ChecklistEditor, quoteState, declineNote, checklistInput } = await server.ssrLoadModule('/src/components/office-request-extras.tsx');
const { CompanyFileView, customerCompanyApi, officeCompanyApi, applyRegister, asciiDigits, lookupError } = await server.ssrLoadModule('/src/components/company-file.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const query = data => ({ data, isLoading: false, isError: false, refetch() {} });
const mutation = fn => ({ isPending: false, isError: false, mutateAsync: fn, reset() {} });
const nodes = (tree, type) => tree.root.findAllByType(type);
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
const click = async button => act(async () => button.props.onClick());
const change = async (field, value) => act(async () => field.props.onChange({ target: { value } }));
const submit = async form => act(async () => form.props.onSubmit({ preventDefault() {} }));
async function mount(element) {
  let tree;
  await act(async () => { tree = renderer.create(element); });
  return tree;
}
function setup() {
  const calls = { quotes: [], checklists: [], links: [], changed: 0, lookups: [] };
  globalThis.__x = {
    hooks: {
      useSendOfficeQuote: () => mutation(async input => { calls.quotes.push(input); return {}; }),
      useSaveOfficeChecklist: () => mutation(async input => { calls.checklists.push(input); return {}; }),
      useListOfficeServiceRequestMessages: () => query([{ id: 1, authorRole: 'customer', body: 'السعر مرتفع', createdAt: '2026-09-20T12:00:30.000Z' }]),
      useCreateOfficeReminder: () => mutation(async () => {}),
      useExtractOfficeAttachmentDocument: () => mutation(async () => ({})),
    },
    fns: Object.fromEntries(fns.map(name => [name, async (...args) => { if (name === 'linkOfficeAttachmentToChecklist') calls.links.push(args); if (/^lookup/.test(name)) { calls.lookups.push([name, ...args]); return globalThis.__x.lookup(); } return {}; }])),
    lookup: async () => ({ name: 'شركة النور', unifiedNumber: '7001234567', status: 'نشط', activity: 'تجارة', city: 'الرياض', issuedOn: '2020-01-01', expiresOn: '2027-01-01' }),
  };
  return calls;
}

test('quote helpers: state and the decline reason from the conversation', () => {
  const quote = { amount: 10000, vat: 1500, total: 11500, note: null, quotedAt: '2026-09-19T12:00:00.000Z', acceptedAt: null, declinedAt: null };
  assert.equal(quoteState(null), 'none');
  assert.equal(quoteState(quote), 'sent');
  assert.equal(quoteState({ ...quote, acceptedAt: '2026-09-20T12:00:00.000Z' }), 'accepted');
  const declined = { ...quote, declinedAt: '2026-09-20T12:00:00.000Z' };
  assert.equal(quoteState(declined), 'declined');
  const messages = [{ authorRole: 'office', body: 'عرض', createdAt: '2026-09-19T12:00:00.000Z' }, { authorRole: 'customer', body: 'قديم', createdAt: '2026-09-19T13:00:00.000Z' }, { authorRole: 'customer', body: 'السعر مرتفع', createdAt: '2026-09-20T12:00:01.000Z' }];
  assert.equal(declineNote(declined, messages), 'السعر مرتفع', 'only a customer message at or after the decline');
  assert.equal(declineNote(quote, messages), null);
  assert.deepEqual(checklistInput([{ key: 'a', label: ' صورة الإقامة ' }, { label: '  ' }, { label: 'الجواز' }]), [{ key: 'a', label: 'صورة الإقامة' }, { label: 'الجواز' }]);
});

test('the quote panel sends riyals as halalas with the waiting flag, and shows the customer refusal', async () => {
  const calls = setup();
  let changed = 0;
  const tree = await mount(React.createElement(QuotePanel, { requestId: 5, quote: null, onChanged: () => { changed++; } }));
  assert.match(text(tree.root), /لم يُرسل عرض سعر/);
  await click(nodes(tree, 'button').find(n => text(n) === 'عرض سعر'));
  await change(nodes(tree, 'input')[0], '١٥٠٫٥');
  assert.match(text(nodes(tree, 'form')[0]), /173\.08 ر\.س/, 'total with VAT previewed');
  await change(nodes(tree, 'textarea')[0], '  شامل الرسوم  ');
  await act(async () => nodes(tree, 'input')[1].props.onChange({ target: { checked: false } }));
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(calls.quotes, [{ id: 5, data: { amount: 15050, note: 'شامل الرسوم', markWaiting: false } }]);
  assert.equal(changed, 1);
  assert.match(text(tree.root), /أُرسل عرض السعر للعميل/);
  await act(async () => tree.update(React.createElement(QuotePanel, { requestId: 5, onChanged() {}, quote: { amount: 15050, vat: 2258, total: 17308, note: 'شامل الرسوم', quotedAt: '2026-09-19T12:00:00.000Z', acceptedAt: null, declinedAt: '2026-09-20T12:00:00.000Z' } })));
  assert.match(text(tree.root), /رفضه العميل/);
  assert.match(text(tree.root), /سبب العميل: «السعر مرتفع»/);
  assert.ok(nodes(tree, 'button').some(n => text(n) === 'عرض سعر جديد'), 'a new quote can follow a refusal');
  await act(async () => tree.update(React.createElement(QuotePanel, { requestId: 5, onChanged() {}, quote: { amount: 15050, vat: 2258, total: 17308, note: null, quotedAt: '2026-09-19T12:00:00.000Z', acceptedAt: '2026-09-20T12:00:00.000Z', declinedAt: null } })));
  assert.match(text(tree.root), /قبله العميل/);
  assert.ok(!nodes(tree, 'button').some(n => /عرض سعر/.test(text(n))), 'no new quote after acceptance');
  await act(async () => tree.unmount());
});

test('the checklist editor saves labels with their keys and re-links an uploaded file', async () => {
  const calls = setup();
  const checklist = [{ key: 'k1', label: 'صورة الإقامة', attachmentId: 9, attachmentName: 'iqama.pdf' }, { key: 'k2', label: 'الجواز', attachmentId: null, attachmentName: null }];
  const attachments = [{ id: 9, name: 'iqama.pdf' }, { id: 10, name: 'passport.jpg' }];
  const tree = await mount(React.createElement(ChecklistEditor, { requestId: 5, checklist, attachments, onChanged: () => { calls.changed++; } }));
  assert.match(text(tree.root), /مرتبط بـ «iqama.pdf»/);
  assert.match(text(tree.root), /لم يُرفع بعد/);
  await change(nodes(tree, 'select')[1], '10');
  assert.deepEqual(calls.links, [[5, 10, { key: 'k2' }]]);
  await click(nodes(tree, 'button').find(n => text(n) === 'تعديل القائمة'));
  await change(nodes(tree, 'input')[0], 'صورة الإقامة الحالية');
  await click(nodes(tree, 'button').find(n => text(n) === 'إضافة مستند'));
  await change(nodes(tree, 'input')[2], 'عقد الإيجار');
  await click(nodes(tree, 'button').find(n => n.props['aria-label'] === 'حذف المستند 2'));
  await submit(nodes(tree, 'form')[0]);
  assert.deepEqual(calls.checklists, [{ id: 5, data: { items: [{ key: 'k1', label: 'صورة الإقامة الحالية' }, { label: 'عقد الإيجار' }] } }], 'renamed item keeps its key, the removed one is gone, the new one has none');
  assert.equal(calls.changed, 2);
  await act(async () => tree.unmount());
});

test('register lookup: digits normalised, blanks filled, differing values only on request', async () => {
  assert.equal(asciiDigits(' ١٠١٠١٢٣٤٥٦ '), '1010123456');
  const found = { name: 'شركة النور', unifiedNumber: '7001234567', status: null, activity: 'تجارة', city: null, issuedOn: null, expiresOn: null };
  const form = { name: 'النور القديمة', unifiedNumber: '', activity: 'تجارة', city: 'جدة', other: 'x' };
  const soft = applyRegister(form, found, false);
  assert.deepEqual(soft, { form: { ...form, unifiedNumber: '7001234567' }, conflicts: ['name'] }, 'empty filled, equal ignored, null skipped, different reported');
  assert.equal(applyRegister(form, found, true).form.name, 'شركة النور');
  assert.equal(lookupError({ status: 503 }), 'التحقق غير متاح حاليًا.');
  assert.equal(lookupError({ status: 404 }), 'لم يُعثر على السجل.');
  const calls = setup();
  const file = { company: null, employees: [], licenses: [] };
  const tree = await mount(React.createElement(CompanyFileView, { file, api: officeCompanyApi('user-1'), office: true, onChanged() {} }));
  const field = i => nodes(tree, 'input')[i];
  await change(field(1), '١٠١٠١٢٣٤٥٦');
  await click(nodes(tree, 'button').find(n => text(n) === 'تحقق من السجل'));
  assert.deepEqual(calls.lookups, [['lookupOfficeCommercialRegister', 'user-1', { number: '1010123456' }]]);
  assert.equal(field(0).props.value, 'شركة النور');
  assert.equal(field(1).props.value, '1010123456');
  assert.equal(field(2).props.value, '7001234567');
  assert.match(text(tree.root), /نشط/);
  assert.match(text(tree.root), /ينتهي 2027-01-01/);
  // A typed name differs from the register: kept until "use these".
  await change(field(0), 'اسم آخر');
  await click(nodes(tree, 'button').find(n => text(n) === 'تحقق من السجل'));
  assert.equal(field(0).props.value, 'اسم آخر');
  assert.match(text(tree.root), /بيانات السجل تختلف عن المدخلة في: الاسم «شركة النور»/);
  await click(nodes(tree, 'button').find(n => text(n) === 'استخدم هذه البيانات'));
  assert.equal(field(0).props.value, 'شركة النور');
  globalThis.__x.lookup = async () => { throw Object.assign(new Error('off'), { status: 503 }); };
  await click(nodes(tree, 'button').find(n => text(n) === 'تحقق من السجل'));
  assert.match(text(tree.root), /التحقق غير متاح حاليًا/);
  await act(async () => tree.unmount());
  const customer = await mount(React.createElement(CompanyFileView, { file, api: customerCompanyApi, onChanged() {} }));
  globalThis.__x.lookup = async () => { throw Object.assign(new Error('none'), { status: 404 }); };
  await change(nodes(customer, 'input')[1], '1010000000');
  await click(nodes(customer, 'button').find(n => text(n) === 'تحقق من السجل'));
  assert.equal(calls.lookups.at(-1)[0], 'lookupCommercialRegister');
  assert.match(text(customer.root), /لم يُعثر على السجل/);
  await act(async () => customer.unmount());
});
