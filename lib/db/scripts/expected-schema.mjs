// Writes (or, with --check, verifies) expected-schema.json: the schema that
// the migrations in ../migrations produce. Run it against a database that was
// just migrated from empty (CI does this on every change).
//
//   DATABASE_URL=<fresh migrated db> node scripts/expected-schema.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readSchemaShape } from "./schema-shape.mjs";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "expected-schema.json");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const shape = await readSchemaShape(client);
  const text = `${JSON.stringify(shape, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== text) {
      console.error("expected-schema.json does not match the migrations. Run: pnpm --filter @workspace/db run expected-schema");
      process.exitCode = 1;
    } else {
      console.log("expected-schema.json matches the migrations.");
    }
  } else {
    writeFileSync(file, text);
    console.log(`Wrote ${path.basename(file)}.`);
  }
} finally {
  await client.end();
}
