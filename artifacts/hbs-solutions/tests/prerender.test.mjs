import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  authRoutePrefixes,
  buildPages,
  chunkPreloads,
  buildRoutes,
  compressFile,
  missingPageTitle,
  portalRoutePrefixes,
  publicRouteDescriptions,
  publicRouteTitles,
  readProvider,
  renderPage,
  routeModules,
  serviceDescription,
  siteName,
} from '../scripts/prerender.mjs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const services = [
  { slug: 'iqama-renewal', category: 'passports', name: 'تجديد الإقامة', summary: 'تجديد إقامتك، أو إقامة عامل في منشأتك.' },
  { slug: 'x-y', category: 'other', name: 'A <b> & "c"', summary: '</script><script>alert(1)</script>' },
];
const categoryById = { passports: { name: 'الجوازات والإقامة' }, other: { name: 'دعم الأعمال' } };

test('prerendered titles, descriptions and route prefixes mirror src/App.tsx', () => {
  for (const [route, title] of Object.entries(publicRouteTitles)) {
    assert.ok(app.includes(`'${route}':'${title}'`), `routeTitles in App.tsx has ${route} → ${title}`);
  }
  for (const [route, description] of Object.entries(publicRouteDescriptions)) {
    assert.ok(app.includes(`'${description}'`), `App.tsx description for ${route}`);
  }
  assert.ok(app.includes(`\`${'${service.summary}'} اطلبها من HBS حلول الغد وتابع حالتها من حسابك.\``), 'service description template');
  assert.ok(app.includes(`\`\${title} | ${siteName}\``), 'title suffix');
  assert.ok(app.includes(`:'${missingPageTitle}');`), 'fallback title for unknown routes');
  const portal = app.match(/const isPortalPath = [^\n]*\[([^\]]+)\]/)?.[1];
  assert.deepEqual(portal.match(/'([^']+)'/g).map((p) => p.slice(1, -1)), portalRoutePrefixes);
  for (const prefix of authRoutePrefixes) assert.ok(app.includes(`location.startsWith('${prefix}')`), `App.tsx treats ${prefix} as an auth route`);
  const isPublic = app.match(/const isPublicPath = [^\n]*/)?.[0];
  for (const route of Object.keys(publicRouteTitles)) {
    assert.ok(isPublic.includes(`'${route}'`), `isPublicPath covers ${route}`);
  }
  for (const module of new Set(Object.values(routeModules))) {
    assert.ok(app.includes(`import('@/pages/${module.replace(/^src\/pages\//, '').replace(/\.tsx$/, '')}')`), `App.tsx lazily imports ${module}`);
  }
  // The shell's search action must target a query the directory reads.
  assert.ok(readFileSync(new URL('../src/pages/public.tsx', import.meta.url), 'utf8').includes("params.get('q')"));
});

test('routes.json lists every public page and the portal prefixes', () => {
  const routes = buildRoutes(services);
  assert.deepEqual(routes.public, ['/', '/services', '/trust', '/help', '/privacy', '/terms', '/services/iqama-renewal', '/services/x-y']);
  assert.deepEqual(routes.portal, portalRoutePrefixes);
  assert.deepEqual(routes.auth, authRoutePrefixes);
});

test('pages carry per-route meta and structured data with the shell provider', () => {
  const provider = readProvider(shell);
  assert.equal(provider['@type'], 'ProfessionalService');
  assert.equal(provider['@context'], undefined);
  const pages = buildPages({ services, categoryById, siteUrl: 'https://example.test/', city: 'جدة', provider });
  assert.equal(pages.length, 6 + services.length);
  const home = pages.find((page) => page.route === '/');
  assert.equal(home.title, `الرئيسية | ${siteName}`);
  assert.equal(home.canonical, 'https://example.test/');
  const website = home.structuredData.find((data) => data['@type'] === 'WebSite');
  assert.equal(website.potentialAction.target.urlTemplate, 'https://example.test/services?q={search_term_string}');
  assert.ok(home.structuredData.some((data) => data['@type'] === 'BreadcrumbList'));
  const privacy = pages.find((page) => page.route === '/privacy');
  assert.equal(privacy.description, publicRouteDescriptions['/privacy']);
  assert.equal(privacy.canonical, 'https://example.test/privacy');
  assert.deepEqual(privacy.structuredData.map((data) => data['@type']), ['BreadcrumbList']);
  const service = pages.find((page) => page.route === '/services/iqama-renewal');
  assert.equal(service.title, `تجديد الإقامة | ${siteName}`);
  assert.equal(service.description, serviceDescription(services[0]));
  const schema = service.structuredData.find((data) => data['@type'] === 'Service');
  assert.equal(schema.provider, provider);
  assert.equal(schema.category, 'الجوازات والإقامة');
  assert.equal(schema.areaServed.name, 'جدة');
  const crumbs = service.structuredData.find((data) => data['@type'] === 'BreadcrumbList').itemListElement;
  assert.deepEqual(crumbs.map((item) => item.item), ['https://example.test/', 'https://example.test/services', 'https://example.test/services/iqama-renewal']);
});

test('renderPage rewrites only head metadata and escapes content', () => {
  const [page] = buildPages({ services: [services[1]], categoryById, siteUrl: 'https://example.test', city: 'جدة', provider: readProvider(shell) }).filter((p) => p.route.startsWith('/services/'));
  const html = renderPage(shell, page);
  assert.ok(html.includes('<title>A &lt;b&gt; &amp; &quot;c&quot; | HBS حلول الغد</title>'));
  assert.ok(html.includes('<meta name="description" content="&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; اطلبها من'));
  assert.ok(html.includes('<link rel="canonical" href="https://example.test/services/x-y" />'));
  assert.ok(html.includes('<meta property="og:url" content="https://example.test/services/x-y" />'));
  assert.ok(html.includes('<meta name="twitter:title" content="A &lt;b&gt; &amp; &quot;c&quot; | HBS حلول الغد" />'));
  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'JSON-LD cannot break out of its script tag');
  assert.ok(html.includes('\\u003c/script>'));
  // The body and the markup outside the rewritten tags are untouched.
  const body = (text) => text.slice(text.indexOf('<body>'));
  assert.equal(body(html), body(shell));
  const strip = (text) => text.replace(/<title>[^<]*<\/title>/, '').replace(/<(?:meta|link) (?:name|property|rel)="(?:description|og:[a-z]+|twitter:[a-z]+|canonical)"[^>]*>/g, '').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g, '').replace(/\s+/g, '');
  assert.equal(strip(html), strip(shell));
  assert.throws(() => renderPage('<html><head></head></html>', page), /could not find <title>/);

  const missing = renderPage(shell, { title: 'x', description: 'y', canonical: null, robots: 'noindex, nofollow' });
  assert.ok(!missing.includes('rel="canonical"'));
  assert.ok(missing.includes('<meta property="og:url" />'));
  assert.ok(missing.includes('<meta name="robots" content="noindex, nofollow" />'));
});

test('chunk preloads follow the manifest for lazy page modules only', () => {
  const manifest = {
    'index.html': { file: 'assets/index-abc.js', isEntry: true, css: ['assets/index-abc.css'] },
    'src/pages/public.tsx': { file: 'assets/public-xyz.js', css: ['assets/public-xyz.css'], imports: ['index.html', '_shared-123.js'] },
    '_shared-123.js': { file: 'assets/shared-123.js', imports: ['src/pages/public.tsx'] },
    'src/pages/legal.tsx': { file: 'assets/legal-456.js' },
  };
  assert.deepEqual(chunkPreloads('/services/iqama-renewal', manifest), [
    { rel: 'modulepreload', href: '/assets/public-xyz.js' },
    { rel: 'modulepreload', href: '/assets/shared-123.js' },
    { rel: 'preload', as: 'style', href: '/assets/public-xyz.css' },
  ]);
  assert.deepEqual(chunkPreloads('/terms', manifest, '/app'), [{ rel: 'modulepreload', href: '/app/assets/legal-456.js' }]);
  assert.deepEqual(chunkPreloads('/', manifest), []);
  assert.deepEqual(chunkPreloads('/services', { 'index.html': manifest['index.html'] }), []);
  assert.deepEqual(chunkPreloads('/services', null), []);
  const html = renderPage(shell, { title: 't', description: 'd', canonical: 'https://example.test/terms', preloads: chunkPreloads('/terms', manifest) });
  assert.ok(html.includes('<link rel="modulepreload" href="/assets/legal-456.js" crossorigin>\n  </head>'));
});

test('precompression writes brotli quality 11 and gzip level 9 that round-trip', () => {
  const contents = Buffer.from('const x = 1;\n'.repeat(400));
  const { br, gz } = compressFile(contents);
  assert.ok(br.byteLength < contents.byteLength && gz.byteLength < contents.byteLength);
  assert.ok(brotliDecompressSync(br).equals(contents));
  assert.ok(gunzipSync(gz).equals(contents));
});
