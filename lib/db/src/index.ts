import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { verifyTestConnection } from "./test-connection-identity";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isDbTest = process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL === process.env.TEST_DATABASE_URL;
const expectedTestIdentity = process.env.HBS_TEST_DB_IDENTITY;
// A DB test must be launched by the guarded runner; never silently bypass
// session verification if its evidence is missing.
if (isDbTest && !expectedTestIdentity) {
  throw new Error("Refusing DB tests: missing verified test database identity.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(isDbTest ? {
    verify: (client: pg.PoolClient, done: (error?: Error) => void) =>
      verifyTestConnection(client, expectedTestIdentity!, done),
  } : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
