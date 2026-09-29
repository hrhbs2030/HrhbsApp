import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { brotliDecompressSync } from 'node:zlib';
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

  for (const path of ['/privacy', '/terms', '/services/sample-service']) {
    const response = await fetchRaw(port, path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers['content-type'], /^text\/html/, path);
    assert.match(response.body.toString(), /<html/, path);
  }
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
  assert.match((await fetchRaw(port, '/robots.txt')).headers['content-type'], /^text\/plain/);

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
    assert.equal(response.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  }
});