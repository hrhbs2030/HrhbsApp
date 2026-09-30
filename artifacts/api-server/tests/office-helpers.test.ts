import assert from "node:assert/strict";
import test from "node:test";

// office-access imports the database client, which only needs a URL to be set.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
const { officeRoleFor, verifiedEmailOf } = await import("../src/lib/office-access");

test("returns only a verified registration email, ignoring case", () => {
  const user = {
    emailAddresses: [
      { emailAddress: "Other@Example.test", verification: { status: "verified" } },
      { emailAddress: "Owner@Example.test", verification: { status: "verified" } },
      { emailAddress: "pending@example.test", verification: { status: "unverified" } },
      { emailAddress: "none@example.test", verification: null },
    ],
  };

  assert.equal(verifiedEmailOf(user, "owner@example.test"), "Owner@Example.test");
  assert.equal(verifiedEmailOf(user, "pending@example.test"), null);
  assert.equal(verifiedEmailOf(user, "none@example.test"), null);
  assert.equal(verifiedEmailOf(user, "missing@example.test"), null);
  assert.equal(verifiedEmailOf(undefined, "owner@example.test"), null);
});

test("derives the office role from verified emails only", () => {
  const account = (...entries: [string, string | null][]) => ({
    emailAddresses: entries.map(([emailAddress, status]) => ({
      emailAddress,
      verification: status ? { status } : null,
    })),
  });
  const owner = "office@example.test";

  assert.equal(officeRoleFor(account(["Office@Example.test", "verified"]), owner, null), "owner");
  assert.equal(officeRoleFor(account(["office@example.test", "verified"]), owner, "staff@example.test"), "owner");
  assert.equal(officeRoleFor(account(["staff@example.test", "verified"]), owner, "staff@example.test"), "staff");
  // An owner row grants nothing once the approved email is gone.
  assert.equal(officeRoleFor(account(["staff@example.test", "verified"]), owner, null), null);
  // A staff row needs its own email to stay verified.
  assert.equal(officeRoleFor(account(["staff@example.test", "unverified"]), owner, "staff@example.test"), null);
  assert.equal(officeRoleFor(account(["other@example.test", "verified"]), owner, "staff@example.test"), null);
  assert.equal(officeRoleFor(account(["office@example.test", "unverified"]), owner, null), null);
});

test("office search treats typed text literally and reads request references", async () => {
  const { containsPattern, requestIdFromReference, officeCustomer } = await import("../src/lib/office-search");
  assert.equal(containsPattern("أحمد"), "%أحمد%");
  assert.equal(containsPattern("50%_off\\"), "%50\\%\\_off\\\\%");

  assert.equal(requestIdFromReference("HBS-2026-00041"), 41);
  assert.equal(requestIdFromReference(" hbs-2025-00007 "), 7);
  assert.equal(requestIdFromReference("41"), 41);
  assert.equal(requestIdFromReference("00000"), null);
  assert.equal(requestIdFromReference("تجديد 41"), null);
  assert.equal(requestIdFromReference("0501234567890"), null);

  assert.deepEqual(officeCustomer("سارة العتيبي", "sara@example.test"), { fullName: "سارة العتيبي", email: "sara@example.test" });
  assert.equal(officeCustomer(null, null), null);
});
