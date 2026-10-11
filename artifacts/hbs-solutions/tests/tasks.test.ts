import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { SUBSCRIPTION_LINK, customerTasks, documentLink, pendingQuote } from '../src/lib/tasks';

const realNow = Date.now;
afterEach(() => { Date.now = realNow; });
// 2026-03-11 in Riyadh.
const freeze = () => { Date.now = () => new Date('2026-03-10T22:30:00Z').getTime(); };

const date = '2026-03-01T12:00:00.000Z';
const request = (id: number, extra: Record<string, unknown> = {}) => ({
  id, reference: `REQ-${id}`, category: 'labor', service: `خدمة ${id}`, description: 'تفاصيل', contactPhone: '0500000000',
  status: 'reviewing', customerMessage: null, clientRequestId: null, createdAt: date, updatedAt: date, attachments: [],
  rating: null, ratingComment: null, ratedAt: null, subject: null, lastMessage: null, ...extra,
}) as never;
const reminder = (id: number, expiresOn: string, source = 'manual') => ({
  id, kind: 'iqama', label: `وثيقة ${id}`, expiresOn, note: null, addedBy: 'customer', createdAt: date, source, sourceId: source === 'manual' ? null : 9,
}) as never;
const summary = (extra: Record<string, unknown> = {}) => ({
  unpaidInvoices: 0, unpaidTotal: 0, expiringSoon: [], employeesCount: 0, licensesCount: 0, hasCompany: true,
  totalRequests: 0, activeRequests: 0, completedRequests: 0, openInquiries: 0, recentRequests: [], recentInquiries: [], ...extra,
}) as never;

test('nothing to do gives an empty list', () => {
  freeze();
  assert.deepEqual(customerTasks({}), []);
  assert.deepEqual(customerTasks({ requests: [request(1)], summary: summary() }), []);
});

test('requests waiting on the customer link to the conversation and carry the office message', () => {
  freeze();
  const tasks = customerTasks({ requests: [request(1, { status: 'waiting_on_customer', customerMessage: 'صورة الجواز' }), request(2, { status: 'waiting_on_customer' })] });
  assert.deepEqual(tasks.map(t => [t.kind, t.href]), [['request', '/requests/1#messages'], ['request', '/requests/2#messages']]);
  assert.match(tasks[0].reason, /المكتب يحتاج منك: صورة الجواز/);
  assert.match(tasks[1].reason, /REQ-2/);
});

test('unpaid invoices: loaded invoices first, then requests awaiting payment, then the summary count', () => {
  freeze();
  const invoice = { id: 7, requestId: 3, requestReference: 'REQ-3', description: 'أتعاب', total: 11500, status: 'issued' } as never;
  const paid = { id: 8, requestId: 4, requestReference: 'REQ-4', description: 'أتعاب', total: 100, status: 'paid' } as never;
  const tasks = customerTasks({
    requests: [request(3, { status: 'awaiting_payment' }), request(5, { status: 'awaiting_payment' })],
    invoices: [invoice, paid], summary: summary({ unpaidInvoices: 3, unpaidTotal: 40000 }),
  });
  assert.deepEqual(tasks.map(t => [t.key, t.href]), [
    ['invoice-7', '/requests/3?invoice=7#invoices'],
    ['pay-5', '/requests/5#invoices'],
    ['invoices', '/requests?status=awaiting_payment'],
  ], 'request 3 is covered by its invoice; the third unpaid invoice is only known by count');
  assert.match(tasks[0].title, /115\.00/);
  assert.match(tasks[2].reason, /400\.00/);
  assert.equal(customerTasks({ summary: summary({ unpaidInvoices: 1, unpaidTotal: 500 }) })[0].title, 'سدّد فاتورة غير مسددة');
});

test('documents within 30 days (or already expired) are listed, later ones are not', () => {
  freeze();
  const tasks = customerTasks({ summary: summary({ expiringSoon: [reminder(1, '2026-03-09'), reminder(2, '2026-03-11'), reminder(3, '2026-03-12', 'employee'), reminder(4, '2026-04-10'), reminder(5, '2026-04-11')] }) });
  assert.deepEqual(tasks.map(t => [t.key, t.href]), [['document-1', '/documents'], ['document-2', '/documents'], ['document-3', '/company'], ['document-4', '/documents']]);
  assert.equal(tasks[0].reason, 'انتهت صلاحيتها؛ اطلب التجديد الآن.');
  assert.equal(tasks[1].reason, 'تنتهي اليوم.');
  assert.equal(tasks[2].reason, 'تنتهي خلال يوم واحد.');
  assert.equal(tasks[3].reason, 'تنتهي خلال 30 يومًا.');
  assert.equal(documentLink(reminder(9, '2026-05-01', 'license')), '/company');
});

test('a pending quote comes first and a pending registration last', () => {
  freeze();
  const quoted = request(1, { quote: { amount: 1000, vat: 150, total: 1150, acceptedAt: null, declinedAt: null } });
  assert.equal(pendingQuote(quoted), true);
  assert.equal(pendingQuote(request(2, { quote: { acceptedAt: date, declinedAt: null } })), false);
  assert.equal(pendingQuote(request(3)), false);
  const tasks = customerTasks({ requests: [request(4, { status: 'waiting_on_customer' }), quoted], registrationStatus: 'pending' });
  assert.deepEqual(tasks.map(t => [t.kind, t.href]), [['quote', '/requests/1#quote'], ['request', '/requests/4#messages'], ['registration', '/registration']]);
  assert.equal(tasks[0].title, 'راجع عرض السعر');
});

const subscription = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 3, status, startsAt: date, renewsAt: '2026-04-01T12:00:00.000Z', cancelledAt: null, autoRenewRequests: true, latestInvoice: null,
  plan: { id: 1, slug: 'basic', name: 'الأساسية', description: '', price: 10000, vat: 1500, total: 11500, employeeCap: 10, requestsPerMonth: 5, autoRenewals: true, active: true, sort: 0 },
  ...extra,
}) as never;

test('a past-due subscription is a task on the company page; an active or cancelled one is not', () => {
  freeze();
  const invoice = { id: 9, requestId: null, subscriptionId: 3, requestReference: null, description: 'اشتراك شهر 3', total: 11500, status: 'issued' };
  const tasks = customerTasks({ requests: [request(1, { status: 'waiting_on_customer' })], subscription: subscription('past_due', { latestInvoice: invoice }), summary: summary({ expiringSoon: [reminder(1, '2026-03-12')] }) });
  assert.deepEqual(tasks.map(t => [t.kind, t.href]), [['request', '/requests/1#messages'], ['subscription', SUBSCRIPTION_LINK], ['document', '/documents']], 'after invoices, before documents');
  assert.equal(tasks[1].title, 'سدّد فاتورة الاشتراك');
  assert.match(tasks[1].reason, /الأساسية/); assert.match(tasks[1].reason, /115\.00/);
  assert.deepEqual(customerTasks({ subscription: subscription('active') }), []);
  assert.deepEqual(customerTasks({ subscription: subscription('cancelled') }), []);
  assert.deepEqual(customerTasks({ subscription: null }), []);
  // A loaded subscription invoice has no request page to go to.
  const [task] = customerTasks({ invoices: [invoice as never] });
  assert.equal(task.href, SUBSCRIPTION_LINK);
  assert.match(task.reason, /اشتراك شهر 3 \(اشتراك\)/);
});
