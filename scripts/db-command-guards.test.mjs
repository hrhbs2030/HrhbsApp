import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { testDbEnv } from './test-db-env.mjs';

const apiDir = new URL('../artifacts/api-server/', import.meta.url);
const { scripts } = JSON.parse(readFileSync(new URL('package.json', apiDir), 'utf8'));

// Keep the expected command names explicit: removing or rewiring a script must
// not make it disappear from the guard checks unnoticed.
const dbCommands = [
  'test:db',
  'test:portal-isolation',
  'test:service-requests',
  'test:attachment-cleanup',
  'test:attachment-access',
  'test:attachment-storage',
  'test:assistant-citations',
  'test:approved-information-history',
  'test:office-staff-management',
  'test:office-revocation',
];
const discovered = Object.entries(scripts)
  .filter(([name, command]) => name === 'test:db' || /run-db-test\.mjs|run-tests\.mjs api-db/.test(command))
  .map(([name]) => name);

test('all DB commands are covered by the guard regression', () => {
  assert.deepEqual(discovered.sort(), [...dbCommands].sort());
});

const appUrl = 'postgresql://127.0.0.1:1/app';
const testUrl = 'postgresql://127.0.0.1:1/disposable';

test('DB guard compares normalized targets and physical identities without exposing connection strings', async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    TEST_PRIVATE_OBJECT_DIR: process.env.TEST_PRIVATE_OBJECT_DIR,
    PRIVATE_OBJECT_DIR: process.env.PRIVATE_OBJECT_DIR,
  };
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.TEST_PRIVATE_OBJECT_DIR;
    delete process.env.PRIVATE_OBJECT_DIR;
    process.env.DATABASE_URL = 'postgresql://app:secret@DB.EXAMPLE.invalid:5432/%61pp?sslmode=require';
    for (const equivalent of [
      'postgres://tester:other@db.example.invalid/app',
      'postgresql://db.example.invalid.:5432/app?application_name=tests',
      'postgresql://db.example.invalid/%61pp',
    ]) {
      process.env.TEST_DATABASE_URL = equivalent;
      await assert.rejects(testDbEnv(), (error) =>
        /Refusing DB tests/.test(error.message) &&
        !error.message.includes('secret') &&
        !error.message.includes('other'));
    }
    process.env.DATABASE_URL = 'postgresql://db.example.invalid/app%2Fone';
    process.env.TEST_DATABASE_URL = 'postgresql://db.example.invalid/app%252Fone';
    await assert.rejects(testDbEnv(), /Refusing DB tests/);
    process.env.DATABASE_URL = 'postgresql://app:secret@DB.EXAMPLE.invalid:5432/%61pp?sslmode=require';
    for (const redirect of [
      'postgresql://db.example.invalid/disposable?host=other.example.invalid',
      'postgresql://other.example.invalid/disposable?dbname=app',
      'postgresql://other.example.invalid/disposable?port=5432',
      'postgresql://other.example.invalid/',
    ]) {
      process.env.TEST_DATABASE_URL = redirect;
      await assert.rejects(testDbEnv(), /Refusing DB tests/);
    }
    process.env.TEST_DATABASE_URL = 'postgresql://db.example.invalid/disposable';
    await assert.rejects(testDbEnv({ readIdentity: async () => null }), /identities are missing/);
    await assert.rejects(testDbEnv({ readIdentity: async () => { throw new Error('secret connection details'); } }),
      (error) => /could not verify/.test(error.message) && !error.message.includes('secret'));
    await assert.rejects(testDbEnv({ readIdentity: async () => 'same-cluster:same-database' }),
      /identities are missing or identical/);
    assert.deepEqual(await testDbEnv({
      readIdentity: async (url) => url === process.env.DATABASE_URL ? 'cluster:app' : 'cluster:test',
    }), {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: 'test',
      HBS_TEST_DB_IDENTITY: 'cluster:test',
    });
    delete process.env.DATABASE_URL;
    await assert.rejects(testDbEnv({ readIdentity: async () => { throw Error('should not connect'); } }),
      /Refusing DB tests/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

for (const commandName of dbCommands) {
  for (const [scenario, changes, message] of [
    ['missing test URL', { TEST_DATABASE_URL: '' }, /TEST_DATABASE_URL is required/],
    ['missing app URL', { DATABASE_URL: '' }, /Refusing DB tests/],
    ['same URL as the app', { TEST_DATABASE_URL: appUrl }, /Refusing DB tests/],
    ['equivalent URL with a differently written host', {
      DATABASE_URL: 'postgresql://DB.EXAMPLE.invalid:5432/%61pp',
      TEST_DATABASE_URL: 'postgres://db.example.invalid/app',
    }, /Refusing DB tests/],
    ['equivalent encoded database name', {
      DATABASE_URL: 'postgresql://db.example.invalid/app%2Fone',
      TEST_DATABASE_URL: 'postgresql://db.example.invalid/app%252Fone',
    }, /Refusing DB tests/],
    ['production environment', { NODE_ENV: 'production' }, /Refusing DB tests/],
    ['unreachable identity evidence', {}, /could not verify both database identities/],
    ...(commandName === 'test:attachment-storage'
      ? [
          ['missing test storage directory', { TEST_PRIVATE_OBJECT_DIR: '' }, /TEST_PRIVATE_OBJECT_DIR is required/],
          ['test storage directory matches app storage', {
            TEST_PRIVATE_OBJECT_DIR: 'same-isolated-storage',
            PRIVATE_OBJECT_DIR: 'same-isolated-storage',
          }, /Refusing storage test/],
          ['missing app storage directory with test storage set', {
            PRIVATE_OBJECT_DIR: '',
          }, /Refusing storage test/],
        ]
      : []),
  ]) {
    test(`${commandName} rejects ${scenario} before launching tests`, () => {
      const temp = mkdtempSync(join(tmpdir(), 'hbs-db-guard-'));
      const marker = join(temp, 'launched');
      try {
        // Any child test runner reaching either executable records an unsafe
        // launch. Neither the synthetic URLs nor these commands use a real DB.
        for (const executable of ['tsx', 'pnpm']) {
          writeFileSync(join(temp, executable), `#!/bin/sh\nprintf '%s\\n' "${executable}" >> "$GUARD_LAUNCH_MARKER"\nexit 0\n`, { mode: 0o755 });
        }
        const env = {
          PATH: `${temp}${delimiter}${process.env.PATH}`,
          HOME: temp,
          GUARD_LAUNCH_MARKER: marker,
          DATABASE_URL: appUrl,
          TEST_DATABASE_URL: testUrl,
          NODE_ENV: 'test',
          PRIVATE_OBJECT_DIR: join(temp, 'app-storage'),
          TEST_PRIVATE_OBJECT_DIR: join(temp, 'test-storage'),
          ...changes,
        };
        const result = spawnSync('sh', ['-c', scripts[commandName]], {
          cwd: apiDir,
          env,
          encoding: 'utf8',
          timeout: 10000,
        });
        assert.ifError(result.error);
        assert.notEqual(result.status, 0, `${commandName} (${scenario}) unexpectedly succeeded`);
        assert.match(result.stdout + result.stderr, message);
        assert.throws(() => readFileSync(marker), { code: 'ENOENT' }, 'a test runner launched before the guard rejected it');
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}