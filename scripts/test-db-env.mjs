import pg from 'pg';

// The DB package reads DATABASE_URL. Only test child processes may receive the
// explicitly selected, disposable test connection in its place.
function databaseIdentity(value) {
  let url;
  try {
    url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        !url.hostname || url.hostname === '.' || !url.pathname || url.pathname === '/') return null;
    // Connection-string parsers can use these query parameters in place of
    // URL authority/path. Do not guess which server they ultimately select.
    if ([...url.searchParams.keys()].some((key) =>
      ['host', 'hostaddr', 'port', 'database', 'dbname', 'service'].includes(key.toLowerCase()))) return null;
    return JSON.stringify([
      url.hostname.replace(/\.$/, '').toLowerCase(),
      url.port || '5432',
      // pg-connection-string decodes the pathname with decodeURI, not
      // decodeURIComponent. In particular, %2F remains escaped after parsing.
      decodeURI(url.pathname.slice(1)),
    ]);
  } catch {
    return null;
  }
}

async function readDatabaseIdentity(connectionString) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  try {
    await client.connect();
    // Explicitly read-only even if the connection's default transaction mode
    // is writable. The server must expose pg_control_system() to this role.
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT (pg_control_system()).system_identifier::text AS cluster_id,
             oid::text AS database_id
      FROM pg_database WHERE datname = current_database()
    `);
    if (rows.length !== 1 || !rows[0].cluster_id || !rows[0].database_id) {
      throw new Error('Missing database identity');
    }
    return `${rows[0].cluster_id}:${rows[0].database_id}`;
  } finally {
    // No commit is needed for a read-only transaction.
    await client.end().catch(() => {});
  }
}

export async function testDbEnv({ storage = false, readIdentity = readDatabaseIdentity } = {}) {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is required for DB tests. Use a separate, disposable test database.');
  }
  const testIdentity = databaseIdentity(testUrl);
  const appUrl = process.env.DATABASE_URL;
  const appIdentity = appUrl ? databaseIdentity(appUrl) : undefined;
  if (process.env.NODE_ENV === 'production' ||
      !testIdentity ||
       !appIdentity || testIdentity === appIdentity) {
    throw new Error('Refusing DB tests: use a valid TEST_DATABASE_URL distinct from DATABASE_URL, outside production.');
  }
  if (storage && !process.env.TEST_PRIVATE_OBJECT_DIR) {
    throw new Error('TEST_PRIVATE_OBJECT_DIR is required for the real storage test.');
  }
  if (process.env.TEST_PRIVATE_OBJECT_DIR && !process.env.PRIVATE_OBJECT_DIR) {
    throw new Error('Refusing storage test: PRIVATE_OBJECT_DIR is required when TEST_PRIVATE_OBJECT_DIR is set.');
  }
  if (process.env.TEST_PRIVATE_OBJECT_DIR &&
      process.env.TEST_PRIVATE_OBJECT_DIR === process.env.PRIVATE_OBJECT_DIR) {
    throw new Error('Refusing storage test: TEST_PRIVATE_OBJECT_DIR must differ from PRIVATE_OBJECT_DIR.');
  }
  // Compare physical cluster + database OID, not network addresses. Never
  // expose driver errors: they can include URLs and credentials.
  let identities;
  try {
    identities = await Promise.all([readIdentity(appUrl), readIdentity(testUrl)]);
  } catch {
    throw new Error('Refusing DB tests: could not verify both database identities (read-only pg_control_system access required).');
  }
  if (!identities[0] || !identities[1] || identities[0] === identities[1]) {
    throw new Error('Refusing DB tests: app and test database identities are missing or identical.');
  }
  return {
    DATABASE_URL: testUrl,
    NODE_ENV: 'test',
    // The pool checks this on the actual session it gives to the suite.
    HBS_TEST_DB_IDENTITY: identities[1],
    ...(storage ? { PRIVATE_OBJECT_DIR: process.env.TEST_PRIVATE_OBJECT_DIR } : {}),
  };
}