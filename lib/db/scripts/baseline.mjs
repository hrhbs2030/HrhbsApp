// Marks the 0000_baseline migration as applied on a database that was created
// earlier with `drizzle-kit push`, so `pnpm run migrate` applies only the
// migrations that come after it. Safe to run more than once.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASELINE_TABLES = [
  "conversations",
  "messages",
  "hbs_service_requests",
  "hbs_inquiries",
  "hbs_office_staff",
  "hbs_registration_requests",
  "hbs_legacy_imports",
  "hbs_legacy_records",
];

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"));
const baseline = journal.entries.find((entry) => entry.tag === "0000_baseline");
if (!baseline) throw new Error("0000_baseline is missing from the migration journal.");
const hash = createHash("sha256")
  .update(readFileSync(path.join(migrationsDir, `${baseline.tag}.sql`)).toString())
  .digest("hex");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  const { rows: existing } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)",
    [BASELINE_TABLES],
  );
  const found = new Set(existing.map((row) => row.table_name));
  if (found.size === 0) {
    throw new Error("No existing tables found. This is a new database: run `pnpm run migrate` instead.");
  }
  const missing = BASELINE_TABLES.filter((table) => !found.has(table));
  if (missing.length) {
    throw new Error(`The database does not match the baseline; missing tables: ${missing.join(", ")}.`);
  }

  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  const { rows: applied } = await client.query('select 1 from "drizzle"."__drizzle_migrations" limit 1');
  if (applied.length) {
    await client.query("ROLLBACK");
    console.log("Migrations are already tracked on this database; nothing to do.");
  } else {
    await client.query(
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      [hash, baseline.when],
    );
    await client.query("COMMIT");
    console.log("Marked 0000_baseline as applied. Run `pnpm run migrate` next.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
