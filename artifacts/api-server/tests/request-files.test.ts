import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentHeader, cleanFileName, retentionCutoff, sniffFileType } from "../src/lib/request-files";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);

test("file type comes from the file's bytes, not its name", () => {
  assert.equal(sniffFileType(PDF), "application/pdf");
  assert.equal(sniffFileType(PNG), "image/png");
  assert.equal(sniffFileType(JPG), "image/jpeg");
  assert.equal(sniffFileType(EXE), null);
  assert.equal(sniffFileType(Buffer.alloc(0)), null);
});

test("file names are cleaned and given the real extension", () => {
  assert.equal(cleanFileName(encodeURIComponent("صورة الإقامة.pdf"), "application/pdf"), "صورة الإقامة.pdf");
  assert.equal(cleanFileName(encodeURIComponent("../../etc/passwd"), "application/pdf"), "passwd.pdf");
  assert.equal(cleanFileName(encodeURIComponent("invoice.exe"), "image/png"), "invoice.png");
  assert.equal(cleanFileName(encodeURIComponent('a<b>"c'), "image/jpeg"), "abc.jpg");
  assert.equal(cleanFileName(encodeURIComponent(".pdf"), "application/pdf"), "مستند.pdf");
  assert.equal(cleanFileName("%E0%A4%A", "application/pdf"), null);
  assert.equal(cleanFileName(undefined, "application/pdf"), null);
  assert.ok((cleanFileName(encodeURIComponent("x".repeat(300)), "application/pdf") ?? "").length <= 114);
});

test("downloads are attachments with a safe ASCII fallback name", () => {
  const header = attachmentHeader("جواز سفر.pdf");
  assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.match(header, /%D8%AC/);
  assert.equal(retentionCutoff(new Date("2026-12-31T00:00:00Z")).toISOString(), "2026-10-02T00:00:00.000Z");
});

