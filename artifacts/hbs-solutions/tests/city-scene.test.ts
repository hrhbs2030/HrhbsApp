// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let reduced = false;
const listeners = new Set<() => void>();
const onlineListeners = new Set<() => void>();
globalThis.window = {
  location: { search: '' },
  innerHeight: 900,
  scrollY: 0,
  setTimeout,
  clearTimeout,
  matchMedia: () => ({
    get matches() { return reduced; },
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  }),
  addEventListener(event, listener) { if (event === 'online') onlineListeners.add(listener); },
  removeEventListener(event, listener) { if (event === 'online') onlineListeners.delete(listener); },
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };

function configure({ pin = '', motion = false, width = 1440 } = {}) {
  reduced = motion;
  window.location.search = pin ? `?city=${pin}` : '';
  window.innerWidth = width;
}

async function loadModules(failure = { city: '', offline: false }) {
  const server = await createServer({
    configFile: false,
    root: new URL('../', import.meta.url).pathname,
    resolve: { alias: { '@': new URL('../src', import.meta.url).pathname }, dedupe: ['react'] },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { noExternal: ['wouter'] },
    plugins: [{
      name: 'city-scene-test-boundaries',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'wouter') return '\0test-router';
        if (id === '@/components/site-chrome') return '\0test-chrome';
        if (id === '@/components/service-discovery') return '\0test-discovery';
      },
      load(id) {
        // The import itself rejects just as it would for a missing network chunk.
        if (failure.offline && id.includes(`/city-scenes/${failure.city}.tsx`)) return `throw new Error("${failure.city} chunk unavailable");`;
        if (id === '\0test-router') return `
          import React from 'react';
          export const useSearch = () => globalThis.window.location.search.slice(1);
          export const useLocation = () => ['/services', () => {}];
          export const useParams = () => ({});
          export const Link = ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);
        `;
        if (id === '\0test-chrome') return "import React from 'react'; export const PublicPage = ({ intro, children }) => React.createElement('main', null, intro, children);";
        if (id === '\0test-discovery') return 'export const ServiceDiscovery = () => null;';
      },
    }],
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { CityScene } = await server.ssrLoadModule('/src/components/city-scene.tsx');
    const { ServicesDirectory } = await server.ssrLoadModule('/src/pages/public.tsx');
    return { server, CityScene, ServicesDirectory };
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function mount(Component, props) {
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(Component, props)); });
  return tree;
}
async function settleScene(ready) {
  // SSR module transforms resolve asynchronously after React first suspends.
  for (let attempt = 0; attempt < 40 && !ready(); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  }
  assert.ok(ready(), 'city scene did not finish loading');
}
const scene = tree => tree.root.findAllByType('div').find(node => node.props.className?.split(' ').includes('cs'));
const active = tree => scene(tree).findAllByProps({ 'data-active': true })[0].props['data-city'];
const content = node => typeof node === 'string' ? node : (node.children ?? []).map(content).join('');

for (const city of ['jeddah', 'jazan']) test(`${city} returns after a failed chunk without unmounting the services page`, async () => {
  configure({ pin: city });
  const failure = { city, offline: true };
  const { server, CityScene, ServicesDirectory } = await loadModules(failure);
  let tree;
  try {
    // Same sibling arrangement as Routes in App: the backdrop cannot own page errors.
    const Page = () => React.createElement(React.Fragment, null,
      React.createElement(CityScene, { routeKey: '/services', variant: 'band' }),
      React.createElement(ServicesDirectory));
    tree = await mount(Page);
    await settleScene(() => scene(tree).findAllByProps({ className: 'cs-static-fallback' }).length === 1);
    assert.equal(scene(tree).findAllByProps({ className: 'cs-static-fallback' }).length, 1);
    const otherCity = city === 'jeddah' ? 'jazan' : 'jeddah';
    await settleScene(() => scene(tree).findAllByProps({ 'data-city': otherCity })[0]?.findAllByType('svg').length > 0);
    assert.equal(tree.root.findAllByType('button').some(node => node.props['aria-label'] === 'إعادة تحميل مشهد المدينة'), true);
    assert.match(content(tree.root), /دليل الخدمات/);
    assert.match(content(tree.root), /ما الخدمة التي تحتاجها؟/);
    assert.ok(tree.root.findAllByProps({ className: 'pub-service-grid' })[0].findAllByType('li').length > 0);
    const page = tree.root.findByType('main');
    if (city === 'jeddah') {
      const button = tree.root.findAllByType('button').find(node => node.props['aria-label'] === 'إعادة تحميل مشهد المدينة');
      await act(async () => button.props.onClick());
      await settleScene(() => scene(tree).findAllByProps({ className: 'cs-static-fallback' }).length === 1);
      assert.equal(tree.root.findByType('main'), page, 'an unsuccessful retry also leaves the page mounted');
      failure.offline = false;
      await act(async () => onlineListeners.forEach(listener => listener()));
    } else {
      failure.offline = false;
      await act(async () => onlineListeners.forEach(listener => listener()));
    }
    await settleScene(() => scene(tree).findAllByProps({ 'data-city': city })[0]?.findAllByType('svg').length > 0);
    assert.equal(scene(tree).findAllByProps({ className: 'cs-static-fallback' }).length, 0);
    assert.equal(tree.root.findByType('main'), page, 'retry leaves page and any in-progress form mounted');
    assert.match(content(tree.root), /ما الخدمة التي تحتاجها؟/);
    assert.equal(tree.root.findAllByType('button').some(node => node.props['aria-label'] === 'إعادة تحميل مشهد المدينة'), false);
  } finally {
    if (tree) await act(async () => tree.unmount());
    await server.close();
  }
});

test('city pin, navigation, and reduced motion keep their behavior at desktop and phone widths', async () => {
  configure({ pin: 'jazan', width: 1440 });
  const { server, CityScene } = await loadModules();
  let tree;
  try {
    tree = await mount(CityScene, { routeKey: '/services', variant: 'band' });
    await settleScene(() => scene(tree).findAllByProps({ 'data-city': 'jazan' })[0]?.findAllByType('svg').length > 0);
    assert.equal(active(tree), 'jazan');
    assert.equal(scene(tree).props.className.includes('cs--band'), true);
    await act(async () => tree.update(React.createElement(CityScene, { routeKey: '/help', variant: 'band' })));
    assert.equal(active(tree), 'jazan', 'the chosen city stays pinned during navigation');

    configure({ pin: 'jazan', width: 390 });
    await act(async () => tree.update(React.createElement(CityScene, { routeKey: '/trust', variant: 'band' })));
    assert.equal(active(tree), 'jazan');
    // Clearing the pin lets the next route move the scene forward.
    configure({ width: 390 });
    await act(async () => tree.update(React.createElement(CityScene, { routeKey: '/services', variant: 'band' })));
    assert.equal(active(tree), 'riyadh');
    await act(async () => tree.update(React.createElement(CityScene, { routeKey: '/help', variant: 'band' })));
    assert.equal(active(tree), 'jeddah');

    reduced = true;
    await act(async () => listeners.forEach(listener => listener()));
    assert.match(scene(tree).props.className, /cs--paused/);
    assert.equal(scene(tree).findAllByProps({ className: 'cs-progress' }).length, 0);
    await act(async () => tree.update(React.createElement(CityScene, { routeKey: '/sign-in', variant: 'full' })));
    assert.equal(active(tree), 'jeddah', 'reduced motion prevents route-driven cycling');
    assert.match(scene(tree).props.className, /cs--full/);
    await act(async () => tree.update(React.createElement(CityScene, { routeKey: '/dashboard', variant: 'portal' })));
    assert.equal(active(tree), 'jeddah');
    assert.match(scene(tree).props.className, /cs--portal/);
  } finally {
    if (tree) await act(async () => tree.unmount());
    await server.close();
  }
});