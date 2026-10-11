import assert from 'node:assert/strict';
import test from 'node:test';
import writeXlsxFile from 'write-excel-file/node';
import { readSheet } from 'read-excel-file/node';
import { columns, sheetToRows, toDate, type CellValue } from '../src/lib/excel-rows';

test('dates from cells, serial numbers and common typed formats', () => {
  assert.equal(toDate(new Date(Date.UTC(2027, 2, 15))), '2027-03-15');
  assert.equal(toDate(46461), '2027-03-15');
  assert.equal(toDate('2027/3/15'), '2027-03-15');
  assert.equal(toDate('15/03/2027'), '2027-03-15');
  assert.equal(toDate('١٥-٠٣-٢٠٢٧'), '2027-03-15');
  assert.equal(toDate('31/02/2027'), '31/02/2027', 'an impossible date is passed on for the server to report');
  assert.equal(toDate('1448/09/01'), '1448/09/01');
  assert.equal(toDate(''), null);
});

test('headers are matched by name in any order, in Arabic or English', () => {
  const parsed = sheetToRows([
    [null],
    ['Iqama Number', 'الاسم الكامل', 'تاريخ انتهاء الإقامة', 'الحالة', 'عمود إضافي'],
    [2123456789, 'أحمد', new Date(Date.UTC(2027, 0, 5)), 'غادر', 'x'],
    [null, null, null, null, null],
    ['٢١٢٣٤٥٦٧٨٨', 'سارة', '05/01/2027', '', ''],
  ] as CellValue[][], 'employees');
  assert.deepEqual(parsed.missing, []);
  assert.deepEqual(parsed.unknown, ['عمود إضافي']);
  assert.deepEqual(parsed.sheetRows, [3, 5], 'sheet row numbers skip blank rows');
  assert.deepEqual(parsed.rows[0], { idNumber: '2123456789', fullName: 'أحمد', iqamaExpiresOn: '2027-01-05', status: 'left' });
  assert.deepEqual(parsed.rows[1], { idNumber: '2123456788', fullName: 'سارة', iqamaExpiresOn: '2027-01-05', status: 'active' });
  assert.deepEqual(sheetToRows([['الجنسية'], ['مصر']], 'employees').missing, ['الاسم']);
});

test('license types are read from their Arabic names', () => {
  const parsed = sheetToRows([['النوع', 'الرقم'], ['رخصة البلدية', 43001234], ['السجل التجاري', '1010']], 'licenses');
  assert.deepEqual(parsed.rows, [
    { kind: 'municipal', number: '43001234', title: 'رخصة البلدية' },
    { kind: 'commercial_register', number: '1010', title: 'السجل التجاري' },
  ]);
});

test('the downloadable template reads back into the same columns', async () => {
  const defs = columns.employees;
  const buffer = await writeXlsxFile([defs.map(d => ({ value: d.header })), defs.map(d => ({ value: d.example }))], { rightToLeft: true }).toBuffer();
  const sheet = await readSheet(buffer) as unknown as CellValue[][];
  const parsed = sheetToRows(sheet, 'employees');
  assert.deepEqual(parsed.unknown, []);
  assert.equal(parsed.rows[0].fullName, 'أحمد محمد علي');
  assert.equal(parsed.rows[0].iqamaExpiresOn, '2027-03-15');
});
