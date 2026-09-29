import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSingleReactInstances, reactBuildCheck } from '../react-build-check.ts';

const root = '/workspace/node_modules/.pnpm/';
const reactA = `${root}react@19.0.0/node_modules/react/index.js`;
const reactB = `${root}react@19.0.0_other-peer/node_modules/react/index.js`;
const domA = `${root}react-dom@19.0.0_react@19.0.0/node_modules/react-dom/client.js`;
const domB = `${root}react-dom@19.0.0_react@19.0.0_other-peer/node_modules/react-dom/client.js`;

test('accepts multiple entry points from one physical React and React DOM package', () => {
  assert.doesNotThrow(() =>
    assertSingleReactInstances([
      reactA,
      reactA.replace('/index.js', '/jsx-runtime.js'),
      `\0${reactA}?commonjs-proxy`,
      domA,
      domA.replace('/client.js', '/cjs/react-dom-client.production.js'),
      '/workspace/node_modules/.pnpm/react-is@19/node_modules/react-is/index.js',
    ]),
  );
});

test('fails the production bundle check for two physical React paths of the same version', () => {
  const hook = reactBuildCheck().generateBundle;
  assert.equal(typeof hook, 'function');
  if (typeof hook !== 'function') return;

  assert.throws(
    () => hook.call({} as never, {} as never, {
      'main.js': { type: 'chunk', modules: { [reactA]: {}, [domA]: {} } },
      'other.js': { type: 'chunk', modules: { [reactB]: {} } },
    } as never, false),
    /2 react instances from different package paths/,
  );
});

test('rejects separate React DOM roots, but permits a bundle without React DOM', () => {
  assert.throws(() => assertSingleReactInstances([reactA, domA, domB]), /2 react-dom instances/);
  assert.doesNotThrow(() => assertSingleReactInstances([reactA]));
});