import assert from "node:assert/strict";
import test from "node:test";
import { officeRoleFor, verifiedEmailOf, type ClerkEmailOwner } from "../src/lib/office-access-rules";

const ownerEmail = "owner@example.invalid";
const staffEmail = "staff@example.invalid";

function account(...emails: { emailAddress: string; verification: { status: string } | null }[]): ClerkEmailOwner {
  return { id: "test-account", emailAddresses: emails };
}

test("only the verified configured office email is the owner", () => {
  assert.equal(officeRoleFor(account({
    emailAddress: "OWNER@example.invalid", verification: { status: "verified" },
  }), ownerEmail, null), "owner");
  assert.equal(officeRoleFor(account({
    emailAddress: ownerEmail, verification: { status: "unverified" },
  }), ownerEmail, null), null);
});

test("staff access requires a staff-row email that is currently verified", () => {
  const staff = account({ emailAddress: staffEmail, verification: { status: "verified" } });
  assert.equal(officeRoleFor(staff, ownerEmail, staffEmail), "staff");
  assert.equal(officeRoleFor(staff, ownerEmail, null), null);
  assert.equal(officeRoleFor(staff, ownerEmail, "other@example.invalid"), null);
  assert.equal(officeRoleFor(account({
    emailAddress: staffEmail, verification: { status: "unverified" },
  }), ownerEmail, staffEmail), null);
  assert.equal(verifiedEmailOf(undefined, staffEmail), null);
});