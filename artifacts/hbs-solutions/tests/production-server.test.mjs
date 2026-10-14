import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { test } from 'node:test';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

function fetchRaw(port, path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('production server keeps SPA, API, assets, and compressed responses distinct', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetchRaw(port, '/');
      if (response.status === 200) { ready = true; break; }
    } catch {
      if (child.exitCode !== null) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(ready, `production server did not start: ${stderr}`);

  const routes = JSON.parse(readFileSync(new URL('../dist/public/routes.json', import.meta.url), 'utf8'));
  const serviceRoute = routes.public.find((route) => route.startsWith('/services/'));
  assert.ok(serviceRoute, 'routes.json lists service pages');
  for (const path of ['/privacy', '/terms', '/services', serviceRoute]) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers['content-type'], /^text\/html/, path);
    assert.equal(response.headers['cache-control'], 'no-cache', path);
    assert.match(response.body.toString(), /<html/, path);
    assert.match(response.body.toString(), /<div id="root"><\/div>/, path);
    assert.match(response.body.toString(), new RegExp(`<link rel="canonical" href="https://hrhbs.com${path === '/' ? '/' : path}" />`), path);
  }
  // Per-route meta: the service page carries its own title, the shell's home title is gone.
  const servicePage = (await fetchRaw(port, serviceRoute)).body.toString();
  assert.match(servicePage, /<meta property="og:url" content="https:\/\/hrhbs\.com\/services\/[a-z0-9-]+" \/>/);
  assert.match(servicePage, /"@type":"Service"/);
  assert.match(servicePage, /"@type":"BreadcrumbList"/);
  assert.doesNotMatch(servicePage, /<title>الرئيسية \|/);
  // The lazy public-page chunk is announced before the entry bundle runs.
  const preload = servicePage.match(/<link rel="modulepreload" href="(\/assets\/[^"]+\.js)" crossorigin>/)?.[1];
  assert.ok(preload, 'service page has a modulepreload hint');
  assert.equal((await fetchRaw(port, preload)).status, 200);
  // The landing page is lazy as well: its chunk is announced from the shell,
  // and the vendor chunks the entry imports are announced by Vite once only.
  const homePage = (await fetchRaw(port, '/')).body.toString();
  const homePreloads = [...homePage.matchAll(/<link rel="modulepreload"[^>]*href="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  assert.ok(homePreloads.some((href) => /\/assets\/landing-/.test(href)), 'home page preloads the landing chunk');
  assert.ok(homePreloads.some((href) => /\/assets\/vendor-react-/.test(href)), 'home page preloads the React vendor chunk');
  assert.equal(new Set(homePreloads).size, homePreloads.length, 'no chunk is preloaded twice');
  assert.equal((await fetchRaw(port, homePreloads.find((href) => /\/assets\/landing-/.test(href)))).status, 200);
  assert.match(homePage, /"@type":"WebSite"/);
  assert.match(homePage, /services\?q=\{search_term_string\}/);

  // Portal and auth routes are rendered by the SPA behind sign-in: always 200.
  for (const path of ['/dashboard', '/requests/abc123', '/office', '/office/customers/user_1', '/registration', '/sign-in/factor-one', '/company']) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 200, path);
    assert.match(response.body.toString(), /<html/, path);
  }
  // Unknown pages are real 404s that still carry the SPA so it shows its not-found page.
  for (const path of ['/services/sample-service', '/nope', '/assets', '/services/nope/deeper']) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 404, path);
    assert.match(response.headers['content-type'], /^text\/html/, path);
    assert.match(response.body.toString(), /<div id="root"><\/div>/, path);
    assert.match(response.body.toString(), /<meta name="robots" content="noindex, nofollow" \/>/, path);
    assert.doesNotMatch(response.body.toString(), /rel="canonical"/, path);
  }
  // One canonical address per page.
  for (const [path, location] of [['/privacy/', '/privacy'], ['/privacy/?x=1&y=2', '/privacy?x=1&y=2'], ['/services/', '/services'], ['/index.html', '/'], ['/index.html?a=1', '/?a=1'], ['/services/index.html', '/services'], ['/nope/', '/nope']]) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.location, location, path);
  }
  assert.equal((await fetchRaw(port, '/')).status, 200);
  assert.equal((await fetchRaw(port, '/?q=1')).status, 200);
  for (const path of ['/api/healthz', '/%61pi/healthz', '/api%2Fhealthz', '/%2561pi/healthz']) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body.toString(), /<html/, path);
  }
  for (const path of ['/assets%2F..%2Fapi/healthz', '/%2e%2e/%2e%2e/etc/passwd']) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 400, path);
    assert.doesNotMatch(response.body.toString(), /<html/, path);
  }
  assert.equal((await fetchRaw(port, '/assets/missing.js')).status, 404);
  // Build internals are never addressable by name.
  for (const path of ['/app.html', '/404.html', '/index.html.br', '/assets/missing.js.br', '/assets/missing.js.gz', '/.vite/manifest.json', '/.vite', '/assets/.hidden.js']) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body.toString(), /<html/, path);
  }
  assert.match((await fetchRaw(port, '/robots.txt')).headers['content-type'], /^text\/plain/);
  // /.well-known is the one dot-path that is reachable: security.txt (RFC 9116).
  const security = await fetchRaw(port, '/.well-known/security.txt');
  assert.equal(security.status, 200);
  assert.match(security.headers['content-type'], /^text\/plain/);
  const securityText = security.body.toString();
  assert.match(securityText, /^Contact: mailto:hr@hrhbs\.com$/m);
  assert.match(securityText, /^Preferred-Languages: ar, en$/m);
  assert.match(securityText, /^Canonical: https:\/\/hrhbs\.com\/\.well-known\/security\.txt$/m);
  const expires = securityText.match(/^Expires: (\S+)$/m)?.[1];
  assert.ok(expires && Date.parse(expires) > Date.now(), 'security.txt has not expired');
  const home = await fetchRaw(port, '/');
  assert.equal(home.headers['x-frame-options'], 'DENY');
  assert.match(home.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(home.headers['strict-transport-security'], /max-age=/);

  const compressed = await fetchRaw(port, '/', 'GET', { 'Accept-Encoding': 'br' });
  assert.equal(compressed.headers['content-encoding'], 'br');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.match(brotliDecompressSync(compressed.body).toString(), /<html/);
  assert.equal(Number(compressed.headers['content-length']), compressed.body.length);
  const head = await fetchRaw(port, '/', 'HEAD', { 'Accept-Encoding': 'br' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-encoding'], 'br');
  assert.equal(head.headers['content-length'], compressed.headers['content-length']);
  for (const response of [compressed, head]) {
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(response.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=()');
  }

  // Hashed assets come from the .br/.gz siblings written at build time; the
  // compressed body is byte-identical to the sibling and never made per request.
  const indexHtml = readFileSync(new URL('../dist/public/index.html', import.meta.url), 'utf8');
  const entryScript = indexHtml.match(/<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  assert.ok(entryScript, 'built index.html references the entry chunk');
  const assetFile = new URL(`../dist/public${entryScript}`, import.meta.url);
  assert.ok(existsSync(new URL(`${assetFile.href}.br`)) && existsSync(new URL(`${assetFile.href}.gz`)), 'entry chunk has .br and .gz siblings');
  const brotli = await fetchRaw(port, entryScript, 'GET', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(brotli.status, 200);
  assert.equal(brotli.headers['content-encoding'], 'br');
  assert.equal(brotli.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(brotli.headers.vary, 'Accept-Encoding');
  assert.equal(Number(brotli.headers['content-length']), brotli.body.length);
  assert.ok(brotli.body.equals(readFileSync(new URL(`${assetFile.href}.br`))), 'brotli body is the prebuilt sibling');
  assert.ok(brotliDecompressSync(brotli.body).equals(readFileSync(assetFile)), 'sibling decodes to the asset');
  const gzipped = await fetchRaw(port, entryScript, 'GET', { 'Accept-Encoding': 'gzip' });
  assert.equal(gzipped.headers['content-encoding'], 'gzip');
  assert.ok(gzipped.body.equals(readFileSync(new URL(`${assetFile.href}.gz`))), 'gzip body is the prebuilt sibling');
  assert.ok(gunzipSync(gzipped.body).equals(readFileSync(assetFile)));
  const identity = await fetchRaw(port, entryScript, 'GET', { 'Accept-Encoding': 'identity' });
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(Number(identity.headers['content-length']), statSync(assetFile).size);
  assert.ok(identity.body.equals(readFileSync(assetFile)));
  // A compressible file without a sibling (small, or not precompressed) is served as-is.
  const robots = await fetchRaw(port, '/robots.txt', 'GET', { 'Accept-Encoding': 'br' });
  assert.equal(robots.headers['content-encoding'], undefined);
  assert.match(robots.body.toString(), /^User-agent:/m);
  // Precompressed HTML keeps the SPA 404 and portal responses compressed too.
  const missing = await fetchRaw(port, '/nope', 'GET', { 'Accept-Encoding': 'br' });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['content-encoding'], 'br');
  assert.match(brotliDecompressSync(missing.body).toString(), /noindex/);
  const sitemap = await fetchRaw(port, '/sitemap.xml');
  assert.match(sitemap.body.toString(), /<lastmod>\d{4}-\d{2}-\d{2}T/);
  assert.equal((sitemap.body.toString().match(/<url>/g) ?? []).length, routes.public.length);
});