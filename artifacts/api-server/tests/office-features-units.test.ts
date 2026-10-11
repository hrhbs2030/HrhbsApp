import assert from "node:assert/strict";
import test from "node:test";
import { dueThreshold } from "../src/lib/document-reminders";
import { parseExtraction } from "../src/lib/document-extraction";
import { vatFor } from "../src/lib/money";
import { saudiMobile, whatsappText } from "../src/lib/whatsapp";
import { planEmployees, planLicenses } from "../src/lib/company-import";

test("Saudi mobile numbers are normalised for WhatsApp", () => {
  for (const input of ["0551234567", "551234567", "+966551234567", "00966 55 123 4567", "966-55-123-4567"]) {
    assert.equal(saudiMobile(input), "966551234567", input);
  }
  for (const input of ["0112345678", "12345", "+1 555 123 4567", "05512345678", "abc"]) {
    assert.equal(saudiMobile(input), null, input);
  }
});

test("WhatsApp text has no line breaks and fits a template variable", () => {
  const text = whatsappText({ to: "x", subject: "s", heading: "عنوان", lines: ["سطر\nثانٍ", "x".repeat(2000)], action: { label: "افتح", path: "/requests/1" } }, "https://hrhbs.com");
  assert.ok(!/[\n\t]/.test(text));
  assert.ok(text.length <= 1024);
  assert.ok(text.startsWith("عنوان · سطر ثانٍ"));
});

test("reminder thresholds", () => {
  assert.equal(dueThreshold(45), null);
  assert.equal(dueThreshold(30), 30);
  assert.equal(dueThreshold(8), 30);
  assert.equal(dueThreshold(7), 7);
  assert.equal(dueThreshold(1), 1);
  assert.equal(dueThreshold(0), 1);
  assert.equal(dueThreshold(-1), null);
});

test("VAT is 15% rounded to the halala", () => {
  assert.equal(vatFor(10_000), 1_500);
  assert.equal(vatFor(333), 50);
});

test("document extraction keeps only the expected shape", () => {
  assert.deepEqual(parseExtraction('```json\n{"kind":"iqama","label":"  Ali ","expiresOn":"2030-01-31","expiresOnText":"1451/09/27","notes":null,"idNumber":"2"}\n```'), {
    kind: "iqama", label: "Ali", expiresOn: "2030-01-31", expiresOnText: "1451/09/27", notes: null,
  });
  assert.deepEqual(parseExtraction('{"kind":"visa","label":"","expiresOn":"2030-02-30"}'), {
    kind: null, label: null, expiresOn: null, expiresOnText: null, notes: null,
  });
  assert.throws(() => parseExtraction("no json here"));
});

test("import planning matches by ID number, then by a unique name", () => {
  const base = { userId: "u", nationality: null, occupation: null, passportNumber: null, iqamaExpiresOn: null, passportExpiresOn: null,
    workPermitExpiresOn: null, phone: null, status: "active", notes: null, createdBy: "u", createdAt: new Date(), updatedAt: new Date() };
  const existing = [
    { ...base, id: 1, fullName: "Ali Hassan", idNumber: "2111111111" },
    { ...base, id: 2, fullName: "Omar", idNumber: null },
    { ...base, id: 3, fullName: "Twin", idNumber: null },
    { ...base, id: 4, fullName: "twin", idNumber: null },
  ];
  const plan = planEmployees([
    { fullName: "Renamed", idNumber: "2111111111" },
    { fullName: " omar ", iqamaExpiresOn: "2030-01-01" },
    { fullName: "Twin" },
    { fullName: "New", iqamaExpiresOn: "01/01/2030" },
  ], existing as never);
  assert.deepEqual(plan.update.map(u => u.id), [1, 2]);
  assert.deepEqual(plan.update[1].values, { fullName: "omar", iqamaExpiresOn: "2030-01-01" });
  assert.equal(plan.create.length, 1, "an ambiguous name adds a new employee");
  assert.deepEqual(plan.problems.map(p => p.row), [4]);
  assert.match(plan.problems[0].message, /انتهاء الإقامة/);
});

test("license import keys on type and number, or type and name", () => {
  const plan = planLicenses([
    { kind: "municipal", title: "Shop A", number: "1" },
    { kind: "municipal", title: "Shop B", number: "1" },
    { kind: "visa", title: "Visa C" },
  ], []);
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.problems.map(p => p.row), [2, 3]);
});
