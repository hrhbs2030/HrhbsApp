import assert from "node:assert/strict";
import test from "node:test";
import { dueThreshold } from "../src/lib/document-reminders";
import { parseExtraction } from "../src/lib/document-extraction";
import { vatFor } from "../src/lib/money";
import { saudiMobile, whatsappText } from "../src/lib/whatsapp";
import { normalizePhone, phoneSearchDigits } from "../src/lib/phone";
import { allowedNext, canTransition, needsInvoicesSettled, transitionError } from "../src/lib/request-status";
import { planEmployees, planLicenses } from "../src/lib/company-import";

test("Saudi mobile numbers are normalised for WhatsApp", () => {
  for (const input of ["0551234567", "551234567", "+966551234567", "00966 55 123 4567", "966-55-123-4567"]) {
    assert.equal(saudiMobile(input), "966551234567", input);
  }
  for (const input of ["0112345678", "12345", "+1 555 123 4567", "05512345678", "abc"]) {
    assert.equal(saudiMobile(input), null, input);
  }
});

test("phone numbers are stored in one spelling", () => {
  for (const input of ["0551234567", "551234567", "9665 5123 4567", "+966 55 123 4567", "00966-55-123-4567", "(055) 123-4567", "٠٥٥١٢٣٤٥٦٧", "۰۵۵۱۲۳۴۵۶۷", "+٩٦٦٥٥١٢٣٤٥٦٧"]) {
    assert.equal(normalizePhone(input), "0551234567", input);
  }
  assert.equal(normalizePhone("+1 (555) 123-4567"), "+15551234567");
  assert.equal(normalizePhone("0044 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("+٢٠١٠٠١٢٣٤٥٦٧"), "+201001234567");
  for (const input of ["", "abc", "12345", "0112345678", "05512345678", "+0551234567", "+1234567", "+1234567890123456", "055-123-45x7"]) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
  // Search compares digits in the local form, whole numbers or a typed prefix.
  assert.equal(phoneSearchDigits("+966 55 123 4567"), "0551234567");
  assert.equal(phoneSearchDigits("٠٥٥١٢"), "05512");
  assert.equal(phoneSearchDigits("+96655"), "055");
  assert.equal(phoneSearchDigits("abc"), null);
  assert.equal(phoneSearchDigits("50%"), null);
  assert.equal(phoneSearchDigits("HBS-2026-00041"), null);
  assert.equal(phoneSearchDigits("055"), null);
});

test("request status transitions", () => {
  assert.deepEqual(allowedNext("received"), ["reviewing", "waiting_on_customer", "awaiting_payment"]);
  assert.deepEqual(allowedNext("completed"), ["reviewing"]);
  assert.deepEqual(allowedNext("unknown"), []);
  assert.ok(canTransition("reviewing", "reviewing"), "same status is a no-op");
  assert.ok(canTransition("awaiting_payment", "submitted_to_authority"));
  assert.ok(!canTransition("received", "completed"));
  assert.ok(!canTransition("completed", "received"));
  assert.ok(needsInvoicesSettled("reviewing", "completed"));
  assert.ok(needsInvoicesSettled("awaiting_payment", "reviewing"));
  assert.ok(!needsInvoicesSettled("awaiting_payment", "awaiting_payment"));
  assert.ok(!needsInvoicesSettled("submitted_to_authority", "reviewing"));
  assert.equal(transitionError("completed", "received"), "لا يمكن نقل الطلب من مكتملة إلى تم الاستلام.");
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

test("imports apply the same length limits as the forms", () => {
  const employees = planEmployees([
    { fullName: "A".repeat(121) },
    { fullName: "Valid Name", notes: "x".repeat(501) },
    { fullName: "Valid Name", status: "y".repeat(5000) },
    { fullName: "Fine Name", notes: "short" },
  ], []);
  assert.deepEqual(employees.problems.map(p => p.row), [1, 2, 3]);
  assert.match(employees.problems[0].message, /الاسم أطول/);
  assert.equal(employees.create.length, 1);
  const licenses = planLicenses([{ kind: "municipal", title: "T".repeat(121) }], []);
  assert.deepEqual(licenses.problems.map(p => p.row), [1]);
});
