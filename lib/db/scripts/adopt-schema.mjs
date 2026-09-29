// Brings a database whose schema was changed with `drizzle-kit push` back
// under migrations, without touching its data.
//
//   pnpm --filter @workspace/db run adopt            report only (read-only)
//   pnpm --filter @workspace/db run adopt -- --apply make the changes below
//
// It compares the database with expected-schema.json (what the migrations
// produce). If any expected table or column is missing, or has a different
// type, it stops: that database needs `pnpm run migrate` or manual review.
// Otherwise --apply, in one transaction:
//   1. re-adds CHECK constraints and indexes the migrations define but the
//      database lacks (after checking existing rows satisfy them), and
//   2. records every migration in the journal as applied,
// so later migrations run normally with `pnpm run migrate`.
// Extra tables or columns in the database are reported and left alone.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readSchemaShape } from "./schema-shape.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");
const expected = JSON.parse(readFileSync(path.join(here, "expected-schema.json"), "utf8"));
const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"));
const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const hashOf = (tag) => createHash("sha256").update(readFileSync(path.join(migrationsDir, `${tag}.sql`)).toString()).digest("hex");

try {
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  const actual = await readSchemaShape(client);

  const problems = [];
  const extras = [];
  for (const [table, columns] of Object.entries(expected.tables)) {
    const have = actual.tables[table];
    if (!have) { problems.push(`missing table ${table}`); continue; }
    for (const [column, type] of Object.entries(columns)) {
      if (!(column in have)) problems.push(`missing column ${table}.${column}`);
      else if (have[column] !== type) problems.push(`${table}.${column} is "${have[column]}", expected "${type}"`);
    }
    for (const column of Object.keys(have)) if (!(column in columns)) extras.push(`extra column ${table}.${column}`);
  }
  for (const table of Object.keys(actual.tables)) if (!(table in expected.tables)) extras.push(`extra table ${table}`);

  const missingChecks = Object.entries(expected.checks).filter(([name]) => !actual.checks[name]);
  const missingIndexes = Object.entries(expected.indexes).filter(([name]) => !actual.indexes[name]);

  const { rows: trackedTable } = await client.query(
    "select 1 from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'");
  const recorded = trackedTable.length
    ? new Set((await client.query('select hash from "drizzle"."__drizzle_migrations"')).rows.map((row) => row.hash))
    : new Set();
  const unrecorded = journal.entries.filter((entry) => !recorded.has(hashOf(entry.tag)));

  console.log(`Tables checked: ${Object.keys(expected.tables).length}`);
  for (const line of extras) console.log(`note: ${line} (left unchanged)`);
  for (const [name] of missingChecks) console.log(`missing CHECK constraint: ${name}`);
  for (const [name] of missingIndexes) console.log(`missing index: ${name}`);
  console.log(`Migrations not recorded as applied: ${unrecorded.map((e) => e.tag).join(", ") || "none"}`);

  if (problems.length) {
    for (const line of problems) console.error(`problem: ${line}`);
    console.error("The database is missing parts of the schema. Do not adopt it; review it first.");
    await client.query("ROLLBACK");
    process.exitCode = 1;
  } else if (!apply) {
    await client.query("ROLLBACK");
    console.log(missingChecks.length || missingIndexes.length || unrecorded.length
      ? "Ready to adopt. Re-run with --apply (after a backup)."
      : "Nothing to do: the database already matches the migrations.");
  } else {
    for (const [name, check] of missingChecks) {
      const expr = check.definition.replace(/^CHECK\s*/i, "");
      const { rows } = await client.query(`select count(*)::int as bad from "${check.table}" where not ${expr}`);
      if (rows[0].bad > 0) throw new Error(`${rows[0].bad} row(s) in ${check.table} break ${name}; fix them first.`);
      await client.query(`alter table "${check.table}" add constraint "${name}" ${check.definition}`);
      console.log(`added CHECK constraint ${name}`);
    }
    for (const [name, index] of missingIndexes) {
      await client.query(index.definition);
      console.log(`added index ${name}`);
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    for (const entry of unrecorded) {
      await client.query('insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)', [hashOf(entry.tag), entry.when]);
      console.log(`recorded ${entry.tag} as applied`);
    }
    await client.query("COMMIT");
    console.log("Adopted. From now on use `pnpm --filter @workspace/db run migrate` for schema changes.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
