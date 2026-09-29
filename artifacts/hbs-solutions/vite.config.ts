import path from 'path';
import { readFileSync } from 'fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { reactQueryBuildCheck } from './react-query-build-check';
import { reactBuildCheck } from './react-build-check';

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
function sitemap(siteUrl: string): Plugin {
  return {
    name: 'hbs-sitemap',
    apply: 'build',
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
      const base = siteUrl.replace(/\/$/, '');
      const paths = ['/', '/services', '/trust', '/help', '/privacy', '/terms', ...slugs.map((slug) => `/services/${slug}`)];
      const body = paths.map((route) => `  <url><loc>${base}${route}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    reactQueryBuildCheck(),
    reactBuildCheck(),
    sitemap(process.env.SITE_URL ?? 'https://hrhbs.com'),
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
