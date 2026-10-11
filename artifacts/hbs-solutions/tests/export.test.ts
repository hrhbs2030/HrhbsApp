import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellKind, displayValue, employeeColumns, employeeRows, licenseRows, requestColumns, requestRows, shapeSheet, tableHtml, toSheetCell,
  type ExportColumn,
} from '../src/lib/export';

const text: ExportColumn = { key: 'x', label: 'نص' };

test('cells keep numbers and dates typed, and text otherwise', () => {
  assert.equal(toSheetCell(null, text), null);
  assert.equal(toSheetCell('', text), null);
  assert.deepEqual(toSheetCell(12, text), { value: 12, type: Number });
  assert.deepEqual(toSheetCell('2027-03-15', text), { value: new Date(Date.UTC(2027, 2, 15)), type: Date, format: 'yyyy-mm-dd' });
  // Timestamps are written in Riyadh time, since Excel has no zone of its own.
  assert.deepEqual(toSheetCell('2026-09-20T12:00:00.000Z', text), { value: new Date('2026-09-20T15:00:00.000Z'), type: Date, format: 'yyyy-mm-dd hh:mm' });
  assert.deepEqual(toSheetCell('REQ-1', text), { value: 'REQ-1', type: String });
  // A declared text column never turns a digit string into a number or date.
  assert.equal(cellKind('2027-03-15', { key: 'x', label: 'x', type: 'text' }), 'text');
  assert.equal(cellKind('0500000000', { key: 'x', label: 'x', type: 'text' }), 'text');
  assert.deepEqual(toSheetCell('not a date', { key: 'x', label: 'x', type: 'datetime' }), { value: 'not a date', type: String });
});

test('the sheet starts with a bold header row and follows column order', () => {
  const sheet = shapeSheet([{ key: 'b', label: 'ب' }, { key: 'a', label: 'أ', type: 'number' }], [{ a: 1, b: 'x' }, { a: null, b: 'y' }]);
  assert.equal(sheet.length, 3);
  assert.deepEqual(sheet[0].map(c => [c?.value, c?.fontWeight]), [['ب', 'bold'], ['أ', 'bold']]);
  assert.deepEqual(sheet[1], [{ value: 'x', type: String }, { value: 1, type: Number }]);
  assert.deepEqual(sheet[2], [{ value: 'y', type: String }, null]);
});

test('the printed page shows values as on screen, escaped, with numbers left-to-right', () => {
  assert.equal(displayValue(null, text), '-');
  assert.equal(displayValue(1500, text), '1,500');
  assert.equal(displayValue('2027-03-15', text), '15 مارس 2027');
  const html = tableHtml('قائمة <x>', [text, { key: 'n', label: 'عدد', type: 'number' }], [{ x: 'a & b', n: 3 }], new Date('2026-09-20T12:00:00Z'));
  assert.match(html, /<title>قائمة &lt;x&gt;<\/title>/);
  assert.match(html, /<td>a &amp; b<\/td><td dir="ltr">3<\/td>/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /1 صفًا/);
  assert.match(tableHtml('x', [text], []), /لا توجد بيانات/);
});

test('employee rows carry the masked ID only and Arabic status names', () => {
  const rows = employeeRows([{
    id: 1, fullName: 'أحمد', nationality: 'مصر', occupation: 'محاسب', idNumberMasked: '••••6789', passportNumberMasked: 'A••••',
    iqamaExpiresOn: '2027-03-15T00:00:00.000Z', passportExpiresOn: null, workPermitExpiresOn: '2027-01-01', phone: null, status: 'left', notes: null,
    addedBy: 'customer', createdAt: '', updatedAt: '',
  } as never]);
  assert.deepEqual(rows[0], { fullName: 'أحمد', nationality: 'مصر', occupation: 'محاسب', idNumber: '••••6789', iqamaExpiresOn: '2027-03-15', passportExpiresOn: null, workPermitExpiresOn: '2027-01-01', status: 'غادر المنشأة' });
  assert.ok(!JSON.stringify(rows).includes('passportNumber'), 'passport numbers are not exported');
  assert.deepEqual(employeeColumns.map(c => c.key), Object.keys(rows[0]));
  assert.equal(employeeColumns.find(c => c.key === 'idNumber')?.type, 'text', 'a masked number is never a number cell');
});

test('license and request rows resolve names through the given lookups', () => {
  const licenses = licenseRows([{ id: 1, kind: 'municipal', title: 'رخصة المحل', number: '43001234', issuedOn: '2025-04-01', expiresOn: null, notes: null, addedBy: 'office', createdAt: '', updatedAt: '' }], { municipal: 'رخصة البلدية' });
  assert.deepEqual(licenses[0], { kind: 'رخصة البلدية', title: 'رخصة المحل', number: '43001234', issuedOn: '2025-04-01', expiresOn: null, notes: null });
  const requests = requestRows([{
    id: 1, reference: 'REQ-1', category: 'labor', service: 'خدمة', description: '', contactPhone: '0500000000', status: 'received', customerMessage: null,
    createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z', attachments: [], customer: { fullName: 'سارة', email: 's@x.test' },
    assignedTo: 'u1', dueAt: null, rating: null, ratingComment: null, ratedAt: null, subject: null, lastMessage: null, userId: 'c1',
  }], { statusNames: { received: 'جديد' }, categoryNames: { labor: 'عمل' }, memberName: id => id === 'u1' ? 'staff@x.test' : null });
  assert.deepEqual(requests[0], { reference: 'REQ-1', service: 'خدمة', category: 'عمل', status: 'جديد', customer: 'سارة', contactPhone: '0500000000', createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z', dueAt: null, assignee: 'staff@x.test' });
  assert.deepEqual(requestColumns.map(c => c.key), Object.keys(requests[0]));
  assert.equal(requestColumns.find(c => c.key === 'contactPhone')?.type, 'text', 'phone numbers keep their leading zero');
});
