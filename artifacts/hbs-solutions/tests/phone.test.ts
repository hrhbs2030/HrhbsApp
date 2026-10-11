import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone } from '../src/lib/phone';

test('Saudi mobiles in every common spelling become 05XXXXXXXX', () => {
  for (const input of ['0512345678', '512345678', '966512345678', '+966512345678', '00966512345678', '+966 51 234 5678', '05-1234-5678', '(05) 1234 5678']) {
    assert.equal(normalizePhone(input), '0512345678', input);
  }
});

test('Arabic-Indic and Persian digits are read as digits', () => {
  assert.equal(normalizePhone('٠٥١٢٣٤٥٦٧٨'), '0512345678');
  assert.equal(normalizePhone('۰۵۱۲۳۴۵۶۷۸'), '0512345678');
  assert.equal(normalizePhone('+٩٦٦٥١٢٣٤٥٦٧٨'), '0512345678');
});

test('other international numbers keep a + prefix', () => {
  assert.equal(normalizePhone('+971501234567'), '+971501234567');
  assert.equal(normalizePhone('00971 50 123 4567'), '+971501234567');
  assert.equal(normalizePhone('+20 100 123 4567'), '+201001234567');
  assert.equal(normalizePhone('+12345678'), '+12345678', '8 digits is the minimum');
  assert.equal(normalizePhone('+123456789012345'), '+123456789012345', '15 digits is the maximum');
});

test('anything else is rejected', () => {
  for (const input of ['', '   ', '051234567', '05123456789', '1234567', '+1234567', '+1234567890123456', '05x2345678', 'abc', '966512345678x', '0612345678', '0512345678a', '٠٥١٢٣٤٥٦٧', '05 1234 567', '+0512345678', '000512345678']) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
});

test('Saudi landlines are kept in the local form', () => {
  assert.equal(normalizePhone('0112345678'), '0112345678');
  assert.equal(normalizePhone('+966 11 234 5678'), '0112345678');
  assert.equal(normalizePhone('٠١١٢٣٤٥٦٧٨'), '0112345678');
  assert.equal(normalizePhone('0212345678'), null);
});
