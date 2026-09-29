import type pg from "pg";

const refusal = "Refusing DB tests: test connection identity changed or could not be verified.";

// pg-pool calls verify on a newly opened client before handing it to either
// pool.query or pool.connect. The identity read and subsequent test queries
// use that same PostgreSQL session (provided the proxy is session-sticky).
export async function verifyTestConnection(
  client: pg.PoolClient,
  expected: string,
  done: (error?: Error) => void,
): Promise<void> {
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(`
      SELECT (pg_control_system()).system_identifier::text AS cluster_id,
             oid::text AS database_id
      FROM pg_database WHERE datname = current_database()
    `);
    if (rows.length !== 1 ||
        !rows[0].cluster_id ||
        !rows[0].database_id ||
        `${rows[0].cluster_id}:${rows[0].database_id}` !== expected) {
      throw new Error(refusal);
    }
    await client.query("ROLLBACK");
    done();
  } catch {
    // On error pg-pool destroys the client. Never return an unverified session
    // to the test, and never expose driver errors containing connection URLs.
    await client.query("ROLLBACK").catch(() => {});
    done(new Error(refusal));
  }
}