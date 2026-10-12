// Read-only post-merge gate: never synchronize by dropping retained legacy tables.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.");
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const journal = JSON.parse(readFileSync(path.join(directory, "meta/_journal.json"), "utf8"));
const last = journal.entries.at(-1);
const snapshot = JSON.parse(readFileSync(path.join(directory, "meta", `${String(last.idx).padStart(4, "0")}_snapshot.json`), "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const { rows: columns } = await client.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'",
  );
  const present = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
  const { rows: indexes } = await client.query(
    "SELECT c.relname AS name, i.indisunique AS unique FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  );
  const availableIndexes = new Map(indexes.map(row => [row.name, row.unique]));
  const missing = [];
  for (const table of Object.values(snapshot.tables)) {
    for (const column of Object.values(table.columns)) {
      if (!present.has(`${table.name}.${column.name}`)) missing.push(`${table.name}.${column.name}`);
    }
    for (const index of Object.values(table.indexes)) {
      if (!availableIndexes.has(index.name) || (index.isUnique && !availableIndexes.get(index.name))) {
        missing.push(`index:${index.name}`);
      }
    }
  }
  await client.query("ROLLBACK");
  if (missing.length) {
    throw new Error(`Development schema needs reviewed additive migrations; automatic destructive push is disabled. Missing: ${missing.join(", ")}`);
  }
  console.log("Required migration columns/indexes are present; extra legacy tables were retained. No database writes performed.");
} finally {
  await client.end();
}
