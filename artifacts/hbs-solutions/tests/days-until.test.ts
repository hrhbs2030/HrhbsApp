import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { daysUntil, riyadhToday } from '../src/lib/format';

const realNow = Date.now;
afterEach(() => { Date.now = realNow; });
const freeze = (iso: string) => { Date.now = () => new Date(iso).getTime(); };

test('today is Riyadh\'s calendar day, not the device\'s', () => {
  // 22:30 UTC is already the next day in Riyadh (UTC+3, no DST).
  freeze('2026-03-10T22:30:00Z');
  assert.equal(riyadhToday(), '2026-03-11');
  freeze('2026-03-10T20:59:00Z');
  assert.equal(riyadhToday(), '2026-03-10');
});

test('daysUntil counts whole calendar days from Riyadh\'s today', () => {
  freeze('2026-03-10T22:30:00Z'); // 2026-03-11 in Riyadh
  assert.equal(daysUntil('2026-03-11'), 0);
  assert.equal(daysUntil('2026-03-12'), 1);
  assert.equal(daysUntil('2026-03-10'), -1);
  assert.equal(daysUntil('2026-05-10'), 60);
  assert.equal(daysUntil('2026-03-12T00:00:00.000Z'), 1, 'timestamps are read as their date part');
});

test('daysUntil is stable across month and year boundaries', () => {
  freeze('2026-12-31T21:30:00Z'); // 2027-01-01 in Riyadh
  assert.equal(daysUntil('2027-01-01'), 0);
  assert.equal(daysUntil('2026-12-31'), -1);
  assert.equal(daysUntil('2027-03-01'), 59);
});
