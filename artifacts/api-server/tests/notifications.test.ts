import assert from "node:assert/strict";
import { test } from "node:test";
import { statusHistory } from "../src/lib/request-history";
import {
  inquiryAnsweredMail,
  mailConfigured,
  notify,
  officeInbox,
  officeNewRequestMail,
  registrationDecisionMail,
  renderMail,
  sendMailNow,
  statusChangedMail,
} from "../src/lib/notify";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 9, minutes));

test("status history starts at received and keeps real changes in order", () => {
  const events = statusHistory(at(0), [
    { createdAt: at(30), details: { fromStatus: "reviewing", toStatus: "waiting_on_customer" } },
    { createdAt: at(10), details: { fromStatus: "received", toStatus: "reviewing" } },
    { createdAt: at(20), details: { fromStatus: "reviewing", toStatus: "reviewing", noteChanged: true } },
    { createdAt: at(40), details: { toStatus: "not-a-status" } },
    { createdAt: at(50), details: null },
    { createdAt: at(55), details: { fromStatus: "waiting_on_customer", toStatus: "completed" } },
  ]);
  assert.deepEqual(events.map((e) => e.status), ["received", "reviewing", "waiting_on_customer", "completed"]);
  assert.deepEqual(events.map((e) => e.at.getUTCMinutes()), [0, 10, 30, 55]);
});

test("a new request with no updates has one event", () => {
  assert.deepEqual(statusHistory(at(5), []), [{ status: "received", at: at(5) }]);
});

test("customer messages carry reference and status only, and link to the request", () => {
  const mail = statusChangedMail("client@example.test", { id: 41, reference: "HBS-2026-00041", service: "تجديد إقامة" }, "waiting_on_customer");
  assert.ok(mail);
  assert.equal(mail.to, "client@example.test");
  assert.match(mail.subject, /HBS-2026-00041/);
  assert.equal(mail.action?.path, "/requests/41");
  assert.equal(statusChangedMail(null, { id: 1, reference: "x", service: "y" }, "completed"), null);
  assert.equal(statusChangedMail("a@b.test", { id: 1, reference: "x", service: "y" }, "unknown"), null);
  assert.equal(inquiryAnsweredMail(null, "s"), null);
  assert.equal(registrationDecisionMail("a@b.test", true)?.action?.path, "/dashboard");
  assert.equal(registrationDecisionMail("a@b.test", false)?.action?.path, "/registration");
});

test("rendered mail is right-to-left and escapes user text", () => {
  const { html, text } = renderMail({
    to: "a@b.test", subject: "s", heading: "عنوان", lines: ['<script>alert("x")</script>'],
    action: { label: "افتح", path: "/requests/1" },
  });
  assert.match(html, /dir="rtl"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /https:\/\/hrhbs\.com\/requests\/1/);
  assert.match(text, /افتح: https:\/\/hrhbs\.com\/requests\/1/);
});

test("office inbox falls back to the owner email, and nothing is sent without SMTP", () => {
  const saved = { notify: process.env.HBS_NOTIFY_EMAIL, office: process.env.HBS_OFFICE_EMAIL, host: process.env.SMTP_HOST };
  delete process.env.HBS_NOTIFY_EMAIL;
  process.env.HBS_OFFICE_EMAIL = "owner@example.test";
  assert.equal(officeInbox(), "owner@example.test");
  process.env.HBS_NOTIFY_EMAIL = "inbox@example.test";
  assert.equal(officeNewRequestMail({ id: 1, reference: "HBS-2026-00001", service: "تجديد إقامة", category: "passports" })?.to, "inbox@example.test");
  delete process.env.SMTP_HOST;
  assert.equal(mailConfigured(), false);
  assert.doesNotThrow(() => notify(officeNewRequestMail({ id: 1, reference: "r", service: "s" })));
  if (saved.notify === undefined) delete process.env.HBS_NOTIFY_EMAIL; else process.env.HBS_NOTIFY_EMAIL = saved.notify;
  if (saved.office === undefined) delete process.env.HBS_OFFICE_EMAIL; else process.env.HBS_OFFICE_EMAIL = saved.office;
  if (saved.host !== undefined) process.env.SMTP_HOST = saved.host;
});

test("sendMailNow reports an SMTP failure to its caller and skips quietly when mail is off", async () => {
  const saved = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  const mail = { to: "a@b.test", subject: "s", heading: "h", lines: ["l"] };
  try {
    process.env.SMTP_HOST = "smtp.example.invalid"; process.env.SMTP_USER = "u"; process.env.SMTP_PASS = "p";
    const sent: unknown[] = [];
    await sendMailNow(mail, async options => { sent.push(options); });
    assert.equal(sent.length, 1);
    await assert.rejects(sendMailNow(mail, async () => { throw Object.assign(new Error("secret@host refused"), { code: "ECONNECTION" }); }),
      (error: Error) => /ECONNECTION/.test(error.message) && !/secret@host/.test(error.message));
    delete process.env.SMTP_HOST;
    await sendMailNow(mail, async () => { throw new Error("must not be called"); });
  } finally {
    for (const [key, value] of [["SMTP_HOST", saved.host], ["SMTP_USER", saved.user], ["SMTP_PASS", saved.pass]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
