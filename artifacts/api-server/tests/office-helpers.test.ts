import assert from "node:assert/strict";
import test from "node:test";
import { emptyLegacyGroup, groupLegacyIds } from "../src/lib/legacy-backup";

// portal.ts imports the database client, which only needs a URL to be set.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
const { verifiedEmailOf } = await import("../src/routes/portal");

test("groups legacy archive IDs per import with sorted IDs and counts", () => {
  const grouped = groupLegacyIds([
    { importId: 2, kind: "clients", legacyId: "c2" },
    { importId: 1, kind: "transactions", legacyId: "t9" },
    { importId: 2, kind: "clients", legacyId: "c1" },
    { importId: 1, kind: "transactions", legacyId: "t1" },
    { importId: 1, kind: "unknown", legacyId: "x" },
    { importId: 2, kind: "notes", legacyId: "n1" },
  ]);

  assert.deepEqual([...grouped.keys()].sort(), [1, 2]);
  assert.deepEqual(grouped.get(1), {
    ids: { clients: [], transactions: ["t1", "t9"], tasks: [], notes: [] },
    counts: { clients: 0, transactions: 2, tasks: 0, notes: 0 },
  });
  assert.deepEqual(grouped.get(2), {
    ids: { clients: ["c1", "c2"], transactions: [], tasks: [], notes: ["n1"] },
    counts: { clients: 2, transactions: 0, tasks: 0, notes: 1 },
  });
  assert.equal(grouped.get(3), undefined);
});

test("empty legacy groups are independent copies", () => {
  const first = emptyLegacyGroup();
  first.ids.clients.push("c1");
  assert.deepEqual(emptyLegacyGroup().ids.clients, []);
});

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
