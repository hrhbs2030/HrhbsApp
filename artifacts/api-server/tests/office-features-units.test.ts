import assert from "node:assert/strict";
import test from "node:test";
import { dueThreshold } from "../src/lib/document-reminders";
import { parseExtraction } from "../src/lib/document-extraction";
import { vatFor } from "../src/lib/money";
import { saudiMobile, whatsappText } from "../src/lib/whatsapp";

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
