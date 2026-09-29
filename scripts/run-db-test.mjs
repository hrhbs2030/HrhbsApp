import { spawnSync } from 'node:child_process';
import { testDbEnv } from './test-db-env.mjs';

const [testFile, ...extra] = process.argv.slice(2);
if (!testFile || extra.length || !/^tests\/[\w-]+\.test\.ts$/.test(testFile)) {
  console.error('Usage: node ../../scripts/run-db-test.mjs tests/<name>.test.ts');
  process.exit(2);
}

let env;
try {
  env = await testDbEnv({ storage: testFile === 'tests/request-attachment-storage.test.ts' });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const result = spawnSync('tsx', ['--test', testFile], {
  stdio: 'inherit',
  env: { ...process.env, ...env },
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);