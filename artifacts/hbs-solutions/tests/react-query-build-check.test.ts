import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSingleReactQueryContext } from '../react-query-build-check.ts';

const app = '/workspace/artifacts/hbs-solutions/src/App.tsx';
const hooks = '/workspace/lib/api-client-react/src/generated/api.ts';
const queryA = '/workspace/node_modules/.pnpm/@tanstack+react-query@5_react@19/node_modules/@tanstack/react-query/build/modern/index.js';
const queryB = '/workspace/node_modules/.pnpm/@tanstack+react-query@5_react@18/node_modules/@tanstack/react-query/build/modern/index.js';

function check(bundled: string[], appImport = queryA, hooksImport = queryA) {
  assertSingleReactQueryContext(bundled, (id) =>
    id === app ? [appImport] : id === hooks ? [hooksImport] : undefined,
  );
}

test('accepts the provider and generated hooks using one bundled instance', () => {
  check([app, hooks, queryA]);
});

test('rejects a second bundled React Query instance even when versions match', () => {
  assert.throws(() => check([app, hooks, queryA, queryB], queryA, queryB), /2 React Query instances/);
});

test('rejects a generated hook importing a copy absent from the bundle', () => {
  assert.throws(() => check([app, hooks, queryA], queryA, queryB), /missing from the bundle/);
});

test('rejects missing protected-route hooks instead of passing an empty bundle', () => {
  assert.throws(() => check([app, queryA]), /expected exactly one bundled .*generated\/api.ts/);
});