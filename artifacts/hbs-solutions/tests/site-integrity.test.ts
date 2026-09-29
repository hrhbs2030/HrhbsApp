import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ServiceRequestInputCategory } from '@workspace/api-client-react';
import { categories, categoryById, platforms, searchServices, serviceBySlug, services } from '../src/content/services';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertPublicFile(url: string) {
  assert.match(url, /^\/[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/, `invalid public asset URL: ${url}`);
  assert.ok(!url.split('/').includes('..'), `asset escapes public/: ${url}`);
  const file = fileURLToPath(new URL(`../public/${url.slice(1)}`, import.meta.url));
  assert.ok(file.startsWith(`${publicDir}/`), `asset escapes public/: ${url}`);
  assert.ok(existsSync(file) && statSync(file).isFile() && statSync(file).size > 0, `missing or empty public asset: ${url}`);
}

test('service catalogue has unique, routable slugs and complete usable entries', () => {
  assert.ok(categories.length > 0 && services.length > 0);
  assert.equal(new Set(categories.map(c => c.id)).size, categories.length, 'duplicate category ID');
  assert.equal(new Set(categories.map(c => c.slug)).size, categories.length, 'duplicate category slug');
  assert.equal(new Set(services.map(s => s.slug)).size, services.length, 'duplicate service slug silently overwrites serviceBySlug');
  assert.equal(Object.keys(serviceBySlug).length, services.length);

  for (const category of categories) {
    assert.match(category.slug, slugPattern);
    assert.equal(categoryById[category.id], category);
    for (const field of [category.name, category.description]) assert.ok(field.trim(), `incomplete category: ${category.id}`);
  }
  for (const service of services) {
    assert.match(service.slug, slugPattern);
    assert.ok(categoryById[service.category], `unknown category on ${service.slug}`);
    assert.equal(serviceBySlug[service.slug], service);
    for (const field of [service.name, service.summary]) assert.ok(field.trim(), `incomplete service: ${service.slug}`);
    for (const [label, values] of [['whatToWrite', service.whatToWrite], ['keywords', service.keywords]] as const) {
      assert.ok(Array.isArray(values) && values.length > 0 && values.every(v => typeof v === 'string' && v.trim()), `invalid ${label} on ${service.slug}`);
    }
    assert.ok(searchServices(service.name).some(result => result.slug === service.slug), `service not discoverable: ${service.slug}`);
  }
  assert.deepEqual(
    platforms,
    [...new Set(services.flatMap(s => s.platform ? [s.platform] : []))].sort((a, b) => a.localeCompare(b, 'ar')),
  );
});

test('catalogue categories match the generated service request API contract', () => {
  assert.deepEqual(
    [...categories.map(c => c.id)].sort(),
    Object.values(ServiceRequestInputCategory).sort(),
    'category choices in the public catalogue and request API must stay in sync',
  );
});

test('public catalogue and service detail routes remain registered', () => {
  const paths = [...routes.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]);
  for (const path of ['/', '/services', '/services/:slug', '/trust', '/help', '/privacy', '/terms']) {
    assert.ok(paths.includes(path), `missing public route ${path}`);
  }
});

test('social images, browser icons and manifest icons exist as real static files', () => {
  const tags = [...indexHtml.matchAll(/<(?:meta|link)\b[^>]*>/g)].map(match => match[0]);
  const selected = tags.filter(tag => /(?:rel="(?:icon|apple-touch-icon|manifest)"|(?:name|property)="(?:og:image|twitter:image)")/.test(tag));
  assert.ok(selected.length >= 5, 'missing icon/social/manifest metadata');
  for (const tag of selected) {
    const reference = tag.match(/(?:href|content)="([^"]+)"/)?.[1];
    assert.ok(reference, `invalid static asset reference: ${tag}`);
    const url = new URL(reference, 'https://hrhbs.com');
    assert.equal(url.origin, 'https://hrhbs.com', `asset must belong to the site: ${tag}`);
    assert.equal(url.search, '', `asset reference must not have query parameters: ${tag}`);
    assert.equal(url.hash, '', `asset reference must not have a fragment: ${tag}`);
    assertPublicFile(url.pathname);
  }
  const manifest = JSON.parse(readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.lang, 'ar');
  assert.equal(manifest.dir, 'rtl');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) assertPublicFile(icon.src);
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /^User-agent:/im, 'robots.txt must be text, not an SPA fallback');
});