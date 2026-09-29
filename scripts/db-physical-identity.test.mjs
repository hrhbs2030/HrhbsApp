import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { testDbEnv } from './test-db-env.mjs';

function run(command, args, env) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
}

async function freeLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('physical DB guard rejects a localhost alias of the app DB but accepts another DB', { timeout: 90000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'hbs-identity-'));
  const data = join(temp, 'cluster');
  const port = await freeLocalPort();
  // Do not pass workspace DB or PG connection settings to PostgreSQL tools.
  const toolEnv = { PATH: process.env.PATH, HOME: temp, LANG: 'C' };
  const original = {
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'guard_test', '--no-instructions'], toolEnv);
    const log = join(temp, 'postgres.log');
    try {
      run('pg_ctl', ['-D', data, '-l', log, '-o',
        `-h 127.0.0.1 -p ${port} -k ${temp}`, '-w', 'start'], toolEnv);
      started = true;
    } catch (error) {
      throw new Error(`${error.message}\n${readFileSync(log, 'utf8')}`);
    }

    const admin = new pg.Client({
      host: '127.0.0.1', port, user: 'guard_test', database: 'postgres',
      connectionTimeoutMillis: 5000,
    });
    try {
      await admin.connect();
      await admin.query('CREATE DATABASE guard_app');
      await admin.query('CREATE DATABASE guard_disposable');
    } finally {
      await admin.end().catch(() => {});
    }

    const appUrl = `postgresql://guard_test@127.0.0.1:${port}/guard_app`;
    const aliasUrl = `postgresql://guard_test@localhost:${port}/guard_app`;
    const distinctUrl = `postgresql://guard_test@localhost:${port}/guard_disposable`;
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = appUrl;
    process.env.TEST_DATABASE_URL = aliasUrl;
    await assert.rejects(testDbEnv(), /app and test database identities are missing or identical/);

    process.env.TEST_DATABASE_URL = distinctUrl;
    const verified = await testDbEnv();
    assert.equal(verified.DATABASE_URL, distinctUrl);
    assert.equal(verified.NODE_ENV, 'test');
    assert.match(verified.HBS_TEST_DB_IDENTITY, /^\d+:\d+$/);
    // The same pool used by API suites must refuse a new connection when a
    // proxy (simulated here by a changed destination) sends it to the app DB.
    const probe = new URL('./db-session-identity-probe.ts', import.meta.url).pathname;
    run('tsx', [probe], {
      ...process.env, DATABASE_URL: distinctUrl, TEST_DATABASE_URL: distinctUrl,
      HBS_TEST_DB_IDENTITY: verified.HBS_TEST_DB_IDENTITY,
      HBS_PROBE_SWITCH_URL: appUrl,
    });
    const swapped = spawnSync('tsx', [probe], {
      encoding: 'utf8', timeout: 30000,
      env: {
        ...process.env, DATABASE_URL: appUrl, TEST_DATABASE_URL: appUrl,
        HBS_TEST_DB_IDENTITY: verified.HBS_TEST_DB_IDENTITY,
      },
    });
    assert.ifError(swapped.error);
    assert.notEqual(swapped.status, 0);
    assert.match(swapped.stderr, /Refusing DB tests: test connection identity changed/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], toolEnv);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});