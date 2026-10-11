import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { reactQueryBuildCheck } from './react-query-build-check';
import { reactBuildCheck } from './react-build-check';
import { postBuild } from './scripts/prerender.mjs';
import { categoryById, services } from './src/content/services';
import { contact } from './src/content/contact';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Build a crawlable sitemap from the same complete catalogue as the directory.
// The count assertion makes a source-format change or missed slug fail loudly.
// After the bundle is written the same plugin prerenders per-route HTML, emits
// routes.json for the production server and precompresses assets
// (scripts/prerender.mjs).
function sitemap(siteUrl: string): Plugin {
  let outDir = '';
  return {
    name: 'hbs-sitemap',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle() {
      const contentDir = path.resolve(import.meta.dirname, 'src/content');
      const core = readFileSync(path.join(contentDir, 'services.ts'), 'utf8');
      const platform = readFileSync(path.join(contentDir, 'platform-services.ts'), 'utf8');
      const categorySlugs = new Set(['passports', 'labor', 'business', 'other']);
      const coreSlugs = [...core.matchAll(/slug:\s*'([a-z0-9-]+)'/g)]
        .map((match) => match[1])
        .filter((slug) => !categorySlugs.has(slug));
      const platformSlugs = [...platform.matchAll(/request\(\s*'([a-z0-9-]+)'/g)].map((match) => match[1]);
      const slugs = [...coreSlugs, ...platformSlugs];
      const uniqueSlugs = new Set(slugs);
      const expectedServiceCount = 55;
      if (slugs.length !== expectedServiceCount || uniqueSlugs.size !== expectedServiceCount) {
        throw new Error(`HBS sitemap expected ${expectedServiceCount} unique service slugs, extracted ${slugs.length} (${uniqueSlugs.size} unique). Update the extractor or catalogue.`);
      }
      // The catalogue module must agree with the source scan, or the prerendered
      // service pages would not match the sitemap.
      const moduleSlugs = new Set(services.map((service) => service.slug));
      if (moduleSlugs.size !== expectedServiceCount || [...uniqueSlugs].some((slug) => !moduleSlugs.has(slug))) {
        throw new Error(`HBS sitemap: services module exports ${moduleSlugs.size} slugs but the source scan found ${uniqueSlugs.size}.`);
      }
      const base = siteUrl.replace(/\/$/, '');
      // <lastmod> per page: the last commit touching what renders it. A service
      // page changes with its catalogue entry; a static page with its source.
      const coreSet = new Set(coreSlugs);
      const sources = (route: string): string[] => route === '/' ? ['src/pages/landing.tsx']
        : route === '/services' ? ['src/pages/public.tsx', 'src/content/services.ts', 'src/content/platform-services.ts']
        : route === '/privacy' || route === '/terms' ? ['src/pages/legal.tsx']
        : route.startsWith('/services/') ? [coreSet.has(route.slice(10)) ? 'src/content/services.ts' : 'src/content/platform-services.ts']
        : ['src/pages/public.tsx'];
      const paths = ['/', '/services', '/trust', '/help', '/privacy', '/terms', ...slugs.map((slug) => `/services/${slug}`)];
      const body = paths.map((route) => `  <url><loc>${base}${route}</loc><lastmod>${lastModified(sources(route))}</lastmod></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
      });
    },
    async closeBundle() {
      // robots.txt is copied from public/; point its Sitemap line at this build's origin.
      const robotsFile = path.join(outDir, 'robots.txt');
      const robots = readFileSync(robotsFile, 'utf8');
      writeFileSync(robotsFile, robots.replace(/^Sitemap:.*$/m, `Sitemap: ${siteUrl.replace(/\/$/, '')}/sitemap.xml`));
      await postBuild({
        outDir,
        basePath,
        siteUrl,
        services,
        categoryById,
        city: contact.city,
        log: (message: string) => console.log(`[hbs-sitemap] ${message}`),
      });
    },
  };
}

// <lastmod> for a sitemap entry: the newest commit touching any of its source
// files (one git call per distinct file set, memoised), or the build time when
// git history is unavailable (for example on Replit).
const buildTime = new Date().toISOString();
const lastModifiedCache = new Map<string, string>();
function lastModified(files: string[]): string {
  const key = files.join(' ');
  const cached = lastModifiedCache.get(key);
  if (cached) return cached;
  let date = buildTime;
  try {
    const stamp = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...files], {
      cwd: import.meta.dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(stamp)) date = stamp;
  } catch {
    // Keep the build date.
  }
  lastModifiedCache.set(key, date);
  return date;
}

// One public origin for the sitemap, robots.txt, the prerendered meta and the
// SPA's own canonical (import.meta.env.VITE_SITE_URL, see src/App.tsx).
const siteUrl = (process.env.SITE_URL ?? 'https://hrhbs.com').replace(/\/$/, '');

export default defineConfig({
  base: basePath,
  define: { 'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl) },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    reactQueryBuildCheck(),
    reactBuildCheck(),
    sitemap(siteUrl),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // .vite/manifest.json lets the prerender step add modulepreload hints for
    // the lazy public/legal page chunks; server.mjs never serves dot-directories.
    manifest: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
