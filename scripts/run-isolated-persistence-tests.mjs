import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { testDbEnv } from './test-db-env.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiManifest = JSON.parse(readFileSync(join(root, 'artifacts/api-server/package.json'), 'utf8'));
const optionalSuites = new Set(Object.entries(apiManifest.scripts)
  .filter(([name, command]) => name.startsWith('test:') && command.includes('scripts/run-db-test.mjs'))
  .map(([name]) => name));
const extraSuites = process.argv.slice(2).filter(arg => arg !== '--update-schema');
if (extraSuites.some(suite => !optionalSuites.has(suite))) {
  throw new Error('Unknown isolated persistence suite.');
}
const temp = mkdtempSync(join(tmpdir(), 'hbs-persistence-'));
const data = join(temp, 'cluster');
const toolEnv = { PATH: process.env.PATH, HOME: temp, LANG: 'C' };
let started = false;
let client;
const originalTestUrl = process.env.TEST_DATABASE_URL;

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root, env, stdio: 'inherit', timeout: args.includes('test:db') ? 300000 : 120000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

try {
  if (process.env.NODE_ENV === 'production' || !process.env.DATABASE_URL) {
    throw new Error('A non-production application DATABASE_URL is required for the isolation guard.');
  }
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));

  run('initdb', ['-D', data, '-A', 'trust', '-U', 'persistence_test', '--encoding=UTF8', '--no-instructions'], toolEnv);
  run('pg_ctl', ['-D', data, '-l', join(temp, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -k ${temp}`, '-w', 'start'], toolEnv);
  started = true;
  // Only this fresh loopback cluster receives schema changes. The application
  // connection remains untouched and is read only by the normal guard.
  client = new pg.Client({
    host: '127.0.0.1', port, user: 'persistence_test', database: 'postgres',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  await client.query('CREATE DATABASE hbs_persistence_test');
  await client.end();
  const testUrl = `postgresql://persistence_test@127.0.0.1:${port}/hbs_persistence_test`;
  process.env.TEST_DATABASE_URL = testUrl;
  const verified = await testDbEnv();
  console.log('Verified: temporary test cluster differs from the application database.');
  client = new pg.Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  // Exercise the committed SQL, not a push that can hide incomplete migrations.
  // This database is disposable and has already passed the isolation guard.
  const migrationsDir = join(root, 'lib/db/migrations');
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries) {
    if (!/^\d{4}_[a-zA-Z0-9_-]+$/.test(entry.tag)) throw new Error('Invalid migration tag.');
    const migration = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
    await client.query(`BEGIN;\n${migration}\nCOMMIT;`);
  }
  console.log('Committed SQL migrations applied to the isolated cluster.');
  // Keep the checked-in CI schema shape in sync with the committed migrations.
  // --update-schema is explicit because it writes only a generated schema fixture.
  run('pnpm', ['--filter', '@workspace/db', 'run', 'expected-schema',
    ...(process.argv.includes('--update-schema') ? [] : ['--check'])],
  { ...process.env, ...verified });

  run('pnpm', ['--filter', '@workspace/api-server', 'run', 'test:db-guards']);
  for (const suite of extraSuites) {
    run('pnpm', ['--filter', '@workspace/api-server', 'run', suite]);
  }
  if (!extraSuites.length) {
    run('pnpm', ['--filter', '@workspace/api-server', 'run', 'test:db']);
  }
  console.log('Persistence suites passed on the disposable cluster.');
} finally {
  if (originalTestUrl === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = originalTestUrl;
  await client?.end().catch(() => {});
  if (started) {
    // Retain the directory if stopping fails rather than delete a running DB.
    run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], toolEnv);
  }
  rmSync(temp, { recursive: true, force: true });
}
