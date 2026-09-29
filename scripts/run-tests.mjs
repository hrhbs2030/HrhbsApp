import { spawnSync } from 'node:child_process';
import { testDbEnv } from './test-db-env.mjs';

// Each entry is a suite/check, not a count of individual node:test assertions.
// Run sequentially: the DB suites and Vite checks can share process resources.
const hbs = '@workspace/hbs-solutions';
const api = '@workspace/api-server';
const webChecks = [
  [hbs, 'check:site'],
  [hbs, 'test:office'],
  [hbs, 'test:city'],
  [hbs, 'test:assistant-source'],
  [hbs, 'test:services-contrast'],
  [hbs, 'test:react-build-check'],
  [hbs, 'test:react-query-build-check'],
  [hbs, 'build'],
  [hbs, 'check:server'],
];
const apiChecks = [
  [api, 'test:db-guards'],
  [api, 'test:assistant-retrieval'],
  [api, 'test:notifications'],
  [api, 'test:api-security'],
  [api, 'test:office-access'],
];
const databaseChecks = [
  [api, 'test:portal-isolation'],
  [api, 'test:service-requests'],
  [api, 'test:attachment-cleanup'],
  [api, 'test:attachment-access'],
  [api, 'test:attachment-lifecycle'],
  [api, 'test:assistant-citations'],
  [api, 'test:approved-information-history'],
  [api, 'test:office-staff-management'],
  [api, 'test:office-revocation'],
];
const storageCheck = [api, 'test:attachment-storage'];

const mode = process.argv[2] ?? 'all';
if (!['all', 'hbs', 'api', 'api-db'].includes(mode)) {
  console.error('Usage: node scripts/run-tests.mjs [all|hbs|api|api-db]');
  process.exit(2);
}

const includesWeb = mode === 'all' || mode === 'hbs';
const includesApi = mode === 'all' || mode === 'api' || mode === 'api-db';
const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const hasTestStorage = Boolean(process.env.TEST_PRIVATE_OBJECT_DIR);
const runDb = includesApi && hasTestDb;

// Fail before starting any checks if the requested DB/storage setup is unsafe.
// Each individual DB script performs the same check before launching tsx.
if (includesApi && (hasTestDb || mode === 'api-db')) {
  try {
    await testDbEnv();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function run([pkg, script], env = {}) {
  const label = `${pkg} ${script}`;
  console.log(`\n--- ${label} ---`);
  const result = spawnSync('pnpm', ['--filter', pkg, 'run', script], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status === 0) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    if (result.error) console.error(result.error);
  }
}

if (includesWeb) {
  for (const check of webChecks) {
    run(check, check[1] === 'build' ? { PORT: '21172', BASE_PATH: '/' } : {});
  }
}
if (includesApi && mode !== 'api-db') {
  // Safe suites may import the DB module without querying it. A deliberately
  // unreachable URL makes accidental DB access fail instead of using the
  // workspace's development (or production) connection.
  for (const check of apiChecks) {
    run(check, { DATABASE_URL: 'postgresql://localhost:1/hbs_non_db_tests', NODE_ENV: 'test' });
  }
}
if (includesApi) {
  if (!runDb) {
    skipped += databaseChecks.length + 1;
    console.log(`\nSkipped ${databaseChecks.length + 1} DB/storage suites: set TEST_DATABASE_URL to a separate test database to run them.`);
  } else {
    // Leave DATABASE_URL unchanged here so each child guard can compare it
    // with TEST_DATABASE_URL before substituting the connection for tsx.
    for (const check of databaseChecks) run(check);
    if (hasTestStorage) {
      run(storageCheck);
    } else {
      skipped++;
      console.log('\nSkipped real storage suite: set TEST_PRIVATE_OBJECT_DIR to a separate private test directory.');
    }
  }
}

console.log(`\nCheck summary (suites/build checks, not assertions): ${passed} passed, ${failed} failed, ${skipped} skipped.`);
if (failures.length) console.error(`Failed checks: ${failures.join(', ')}`);
process.exitCode = failed ? 1 : 0;