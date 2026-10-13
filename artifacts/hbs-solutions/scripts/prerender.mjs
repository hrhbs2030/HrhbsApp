// Post-build step for the static site (called from the Vite plugin in
// vite.config.ts after the bundle is written):
//   1. routes.json      — the public and portal routes the production server
//                         needs to tell a real page (200) from a missing one (404).
//   2. <route>/index.html — the built shell with that route's title, description,
//                         canonical, Open Graph/Twitter tags and JSON-LD, so
//                         crawlers and link previews see the right page without
//                         running JavaScript. The SPA then boots and sets the
//                         same values (see the meta effect in src/App.tsx).
//   3. .br / .gz siblings for every compressible asset, so server.mjs never
//                         compresses at request time.
// The titles and descriptions below mirror src/App.tsx; tests/prerender.test.mjs
// fails when the two drift apart.
import { readdir, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export const siteName = 'HBS حلول الغد';

// Same literals as routeTitles / the description chain in src/App.tsx.
export const publicRouteTitles = {
  '/': 'الرئيسية',
  '/services': 'دليل الخدمات',
  '/trust': 'الخصوصية والأمان',
  '/help': 'المساعدة',
  '/privacy': 'سياسة الخصوصية',
  '/terms': 'شروط الاستخدام',
};

export const publicRouteDescriptions = {
  '/': 'HBS حلول الغد: مكتب يتابع التزام منشأتك ومؤشراتها في المنصات ويعالج الملاحظات، وترى كل طلب بحالته من حسابك.',
  '/services': 'دليل خدمات حلول الغد: التزام المنشأة من إقامات ورخص وعقود، ومؤشرات المنشأة في قوى ومُدد والتأمينات، ومعالجة الملاحظات، وما يفيد أن تكتبه في طلبك.',
  '/privacy': 'تعرّف على بيانات بوابة HBS حلول الغد، بما فيها مرفقات الطلبات، وكيفية حفظها ومشاركتها وحقوقك.',
  '/terms': 'شروط استخدام موقع HBS حلول الغد وبوابة العملاء، والطلبات والمرفقات والمساعدة الآلية.',
  '/help': 'إجابات عن إرسال الملاحظة ومتابعة معالجتها، وتنبيهات الوثائق، وحالات الطلب في بوابة HBS حلول الغد، مع وسائل التواصل مع المكتب.',
  '/trust': 'كيف تحفظ بوابة HBS حلول الغد طلباتك وملاحظاتك ومستندات منشأتك، ومن يطّلع عليها، وما لا يطلبه المكتب منك.',
};

// Prefixes the SPA renders behind sign-in (RoleGate routes in src/App.tsx) and
// the Clerk auth pages. They are never prerendered and never a 404.
export const portalRoutePrefixes = ['/registration', '/dashboard', '/requests', '/inquiries', '/messages', '/documents', '/settings', '/notifications', '/company', '/office'];
export const authRoutePrefixes = ['/sign-in', '/sign-up'];

export const missingPageTitle = 'الصفحة غير موجودة';

// The origin index.html is written against. The build rewrites it to SITE_URL
// (rehost) so a preview or bare-domain build never advertises the wrong host.
export const shellOrigin = 'https://hrhbs.com';

// Lazy page modules in src/App.tsx, by the public routes that render them, so a
// prerendered page can modulepreload its chunk instead of discovering it after
// the entry bundle has run. A trailing slash matches every nested route.
export const routeModules = {
  '/services': 'src/pages/public.tsx',
  '/services/': 'src/pages/public.tsx',
  '/trust': 'src/pages/public.tsx',
  '/help': 'src/pages/public.tsx',
  '/privacy': 'src/pages/legal.tsx',
  '/terms': 'src/pages/legal.tsx',
};

export const precompressedExtensions = new Set(['.js', '.mjs', '.css', '.svg', '.json', '.html', '.txt', '.xml', '.webmanifest', '.wasm']);
export const precompressMinimumBytes = 1024;

export function serviceDescription(service) {
  return `${service.summary} اطلبها من ${siteName} وتابع حالتها من حسابك.`;
}

export function pageTitle(title) {
  return `${title} | ${siteName}`;
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// JSON inside <script type="application/ld+json"> must not be able to close the tag.
export function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function buildRoutes(services) {
  return {
    public: [...Object.keys(publicRouteTitles), ...services.map((service) => `/services/${service.slug}`)],
    portal: portalRoutePrefixes,
    auth: authRoutePrefixes,
  };
}

// One entry per prerendered page: the route, its meta and JSON-LD.
export function buildPages({ services, categoryById, siteUrl, city, provider }) {
  const base = siteUrl.replace(/\/$/, '');
  const url = (route) => (route === '/' ? `${base}/` : `${base}${route}`);
  const crumb = (position, name, route) => ({ '@type': 'ListItem', position, name, item: url(route) });
  const breadcrumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items });
  const pages = [];

  for (const [route, title] of Object.entries(publicRouteTitles)) {
    const structuredData = [];
    if (route === '/') {
      structuredData.push({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        url: url('/'),
        inLanguage: 'ar',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${base}/services?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      });
      structuredData.push(breadcrumbs([crumb(1, title, '/')]));
    } else {
      structuredData.push(breadcrumbs([crumb(1, publicRouteTitles['/'], '/'), crumb(2, title, route)]));
    }
    pages.push({ route, title: pageTitle(title), description: publicRouteDescriptions[route], canonical: url(route), structuredData });
  }

  for (const service of services) {
    const route = `/services/${service.slug}`;
    const category = categoryById?.[service.category];
    pages.push({
      route,
      title: pageTitle(service.name),
      description: serviceDescription(service),
      canonical: url(route),
      structuredData: [
        breadcrumbs([crumb(1, publicRouteTitles['/'], '/'), crumb(2, publicRouteTitles['/services'], '/services'), crumb(3, service.name, route)]),
        {
          '@context': 'https://schema.org',
          '@type': 'Service',
          name: service.name,
          description: service.summary,
          url: url(route),
          // Same shape as useJsonLd in src/pages/public.tsx: the category is the serviceType.
          serviceType: category?.name ?? service.name,
          inLanguage: 'ar',
          areaServed: city ? { '@type': 'City', name: city, containedInPlace: { '@type': 'Country', name: 'SA' } } : 'SA',
          provider,
        },
      ],
    });
  }

  return pages;
}

// The chunk, its static imports and its CSS for a route, from Vite's manifest
// (build.manifest). Returns [] when the route has no lazy module or the manifest
// no longer lists it (the page went back into the entry chunk).
export function chunkPreloads(route, manifest, basePath = '/') {
  const key = routeModules[route] ?? Object.entries(routeModules).find(([prefix]) => prefix.endsWith('/') && route.startsWith(prefix))?.[1];
  if (!key || !manifest?.[key]) return [];
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const scripts = new Set();
  const styles = new Set();
  const visit = (name) => {
    const chunk = manifest[name];
    if (!chunk || chunk.isEntry || scripts.has(chunk.file)) return;
    scripts.add(chunk.file);
    for (const css of chunk.css ?? []) styles.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  };
  visit(key);
  return [
    ...[...scripts].map((file) => ({ rel: 'modulepreload', href: `${base}${file}` })),
    ...[...styles].map((file) => ({ rel: 'preload', as: 'style', href: `${base}${file}` })),
  ];
}

function replaceOnce(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`prerender: could not find ${label} in the built index.html`);
  return html.replace(pattern, replacement);
}

// Rewrites only the head's text nodes/attributes; the body (React mount) is untouched.
export function renderPage(shell, page) {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  let html = shell;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`, '<title>');
  html = replaceOnce(html, /(<meta name="description" content=")[^"]*(")/, `$1${description}$2`, 'meta description');
  html = replaceOnce(html, /(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`, 'og:title');
  html = replaceOnce(html, /(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`, 'og:description');
  html = replaceOnce(html, /(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`, 'twitter:title');
  html = replaceOnce(html, /(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`, 'twitter:description');
  if (page.canonical) {
    html = replaceOnce(html, /(<link rel="canonical" href=")[^"]*(")/, `$1${escapeHtml(page.canonical)}$2`, 'canonical');
    html = replaceOnce(html, /(<meta property="og:url" content=")[^"]*(")/, `$1${escapeHtml(page.canonical)}$2`, 'og:url');
  } else {
    // Mirrors the SPA for non-public pages: no canonical, empty og:url.
    html = html.replace(/\s*<link rel="canonical" href="[^"]*" \/>/, '');
    html = replaceOnce(html, /<meta property="og:url" content="[^"]*" \/>/, '<meta property="og:url" />', 'og:url');
  }
  if (page.robots) {
    html = replaceOnce(html, /(<meta name="robots" content=")[^"]*(")/, `$1${escapeHtml(page.robots)}$2`, 'meta robots');
  }
  const preloads = (page.preloads ?? []).map((link) => {
    const attributes = Object.entries(link).map(([name, value]) => `${name}="${escapeHtml(value)}"`).join(' ');
    return `    <link ${attributes} crossorigin>\n`;
  });
  const scripts = (page.structuredData ?? []).map((data) => `    ${jsonLd(data)}\n`);
  if (preloads.length || scripts.length) {
    html = replaceOnce(html, /[ \t]*<\/head>/, `${[...preloads, ...scripts].join('')}  </head>`, '</head>');
  }
  return html;
}

// Points every absolute site URL in the head (canonical, og:url, og:image,
// twitter:image, JSON-LD url/logo/image) at the build's site URL. Body untouched.
export function rehost(shell, siteUrl) {
  const base = siteUrl.replace(/\/$/, '');
  if (base === shellOrigin) return shell;
  const end = shell.indexOf('</head>');
  if (end === -1) throw new Error('prerender: built index.html has no </head>');
  return shell.slice(0, end).replaceAll(`${shellOrigin}/`, `${base}/`).replaceAll(`"${shellOrigin}"`, `"${base}"`) + shell.slice(end);
}

// Reads the ProfessionalService block from the shell so Service pages name the
// same provider as the home page (one source: index.html).
export function readProvider(shell) {
  for (const match of shell.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(match[1]);
      if (data['@type'] === 'ProfessionalService') {
        const { '@context': _context, ...provider } = data;
        return provider;
      }
    } catch {
      // Not JSON we own; keep looking.
    }
  }
  return { '@type': 'ProfessionalService', name: siteName };
}

export function compressFile(contents) {
  return {
    br: brotliCompressSync(contents, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: contents.byteLength,
      },
    }),
    gz: gzipSync(contents, { level: 9 }),
  };
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name.startsWith('.')) continue; // .vite/manifest.json is never served
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

export async function precompress(outDir) {
  let written = 0;
  for await (const file of walk(outDir)) {
    const extension = extname(file).toLowerCase();
    if (!precompressedExtensions.has(extension)) continue;
    const info = await stat(file);
    if (info.size < precompressMinimumBytes) continue;
    const contents = await readFile(file);
    const { br, gz } = compressFile(contents);
    // A sibling that is not smaller is useless; the server then serves identity.
    if (br.byteLength < contents.byteLength) { await writeFile(`${file}.br`, br); written++; }
    if (gz.byteLength < contents.byteLength) { await writeFile(`${file}.gz`, gz); written++; }
  }
  return written;
}

export async function postBuild({ outDir, basePath = '/', siteUrl, services, categoryById, city, log = () => {} }) {
  const shellFile = join(outDir, 'index.html');
  const shell = rehost(await readFile(shellFile, 'utf8'), siteUrl);
  if (!/<div id="root"><\/div>/.test(shell)) throw new Error('prerender: built index.html has no #root mount');
  const provider = readProvider(shell);
  const manifest = await readFile(join(outDir, '.vite', 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!manifest) log('no .vite/manifest.json; pages get no modulepreload hints');

  const routes = buildRoutes(services);
  await writeFile(join(outDir, 'routes.json'), `${JSON.stringify(routes)}\n`);

  // The untouched shell serves portal/auth routes; the 404 shell adds noindex.
  await writeFile(join(outDir, 'app.html'), shell);
  await writeFile(
    join(outDir, '404.html'),
    renderPage(shell, { title: pageTitle(missingPageTitle), description: `${missingPageTitle} في بوابة ${siteName}.`, canonical: null, robots: 'noindex, nofollow' }),
  );

  const pages = buildPages({ services, categoryById, siteUrl, city, provider });
  let preloaded = 0;
  for (const page of pages) {
    page.preloads = chunkPreloads(page.route, manifest, basePath);
    if (page.preloads.length) preloaded++;
    const target = page.route === '/' ? shellFile : join(outDir, ...page.route.split('/').filter(Boolean), 'index.html');
    if (relative(outDir, target).startsWith('..')) throw new Error(`prerender: route escapes the output directory: ${page.route}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, renderPage(shell, page));
  }

  const siblings = await precompress(outDir);
  log(`prerendered ${pages.length} pages (${routes.public.length} public routes, ${preloaded} with chunk preloads) and wrote ${siblings} precompressed siblings to ${posix.normalize(relative(process.cwd(), outDir))}`);
  return { pages: pages.length, siblings };
}
