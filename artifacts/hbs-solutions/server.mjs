import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, posix, resolve, sep } from 'node:path';

const publicRoot = await realpath(
  new URL('./dist/public/', import.meta.url),
);
const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error('PORT environment variable is required but was not provided.');
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Written by the build (scripts/prerender.mjs): the public routes that get a
// 200 and the portal/auth prefixes the SPA renders behind sign-in. Any other
// extension-less path is a real 404 (served with the SPA shell so the app can
// show its not-found page). Without the file every route is a 200, as before.
const routes = await readFile(resolve(publicRoot, 'routes.json'), 'utf8')
  .then((text) => JSON.parse(text))
  .catch((error) => {
    console.warn(`HBS static server: routes.json unavailable (${error.code ?? error.message}); every client route will answer 200.`);
    return null;
  });
const publicRoutes = new Set(routes?.public ?? []);
const portalPrefixes = [...(routes?.portal ?? []), ...(routes?.auth ?? [])];

// Build outputs the server uses internally but never serves under their own name.
const reservedFiles = new Set(['/app.html', '/404.html']);
const precompressedSuffixes = new Set(['.br', '.gz']);
const precompressMinimumBytes = 1024;

const mimeTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const compressibleTypes = new Set([
  'application/json',
  'application/manifest+json',
  'application/javascript',
  'application/wasm',
  'application/xml',
  'image/svg+xml',
]);

function setSecurityHeaders(response) {
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader(
    'Referrer-Policy',
    'strict-origin-when-cross-origin',
  );
  response.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  // Scripts and styles are left to Clerk's needs; these directives only stop
  // framing, plugin content, <base> hijacking and off-site form posts.
  response.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  );
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
}

function respond(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function redirect(response, location) {
  response.statusCode = 301;
  response.setHeader('Location', location);
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(`Moved permanently to ${location}`);
}

function qualityFor(encoding, values, wildcard) {
  const quality = values.get(encoding);
  return quality === undefined ? wildcard : quality;
}

function acceptedCompression(header) {
  const values = new Map();
  let wildcard = 0;

  for (const entry of (header ?? '').split(',')) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';');
    if (!name) continue;

    const qualityParameter = parameters.find((parameter) =>
      parameter.trim().startsWith('q='),
    );
    const parsedQuality = qualityParameter
      ? Number(qualityParameter.trim().slice(2))
      : 1;
    const quality = Number.isFinite(parsedQuality)
      ? Math.max(0, Math.min(1, parsedQuality))
      : 0;

    if (name === '*') wildcard = quality;
    else values.set(name, quality);
  }

  const brotliQuality = qualityFor('br', values, wildcard);
  const gzipQuality = qualityFor('gzip', values, wildcard);
  if (brotliQuality > 0 && brotliQuality >= gzipQuality) return 'br';
  if (gzipQuality > 0) return 'gzip';
  return null;
}

function isCompressible(contentType) {
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  return (
    (mediaType.startsWith('text/') && mediaType !== 'text/plain') ||
    [...compressibleTypes].some(
      (type) => mediaType === type,
    )
  );
}

function isInsideRoot(path) {
  return path === publicRoot || path.startsWith(`${publicRoot}${sep}`);
}

function hasPrefix(prefixes, pathname) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Resolves a path under dist/public to a real file, or null when it does not
// exist (or points outside the root through a symlink).
async function resolveFile(...segments) {
  try {
    const realFile = await realpath(resolve(publicRoot, ...segments));
    if (!isInsideRoot(realFile)) return null;
    const fileInfo = await stat(realFile);
    return fileInfo.isFile() ? { file: realFile, fileInfo } : null;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return null;
  }
}

async function findStaticFile(pathname) {
  // The request pathname is decoded exactly once before API routing. A
  // remaining percent sign can encode a second API or traversal segment.
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.includes('%')) return null;
  const candidate = resolve(publicRoot, `.${pathname}`);
  if (!isInsideRoot(candidate)) return null;
  return resolveFile(candidate);
}

// Extensionless client routes must work even for direct requests without an
// Accept: text/html header (for example, a link checker or curl). Known public
// routes get their prerendered HTML (scripts/prerender.mjs); portal and auth
// routes get the plain shell; anything else gets the shell with a 404 status.
async function findRouteShell(pathname) {
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.includes('%')) return null;
  if (!routes || publicRoutes.has(pathname)) {
    const prerendered = pathname === '/' ? null : await findStaticFile(`${pathname}/index.html`);
    const entry = prerendered ?? (await resolveFile('index.html'));
    return entry && { ...entry, status: 200 };
  }
  if (hasPrefix(portalPrefixes, pathname)) {
    const entry = (await resolveFile('app.html')) ?? (await resolveFile('index.html'));
    return entry && { ...entry, status: 200 };
  }
  const entry = (await resolveFile('404.html')) ?? (await resolveFile('index.html'));
  return entry && { ...entry, status: 404 };
}

// Vite names bundled assets <name>-<8 url-safe base64 chars>.<ext> under
// assets/; the hex form covers older or hand-hashed files.
const assetsRoot = `${publicRoot}${sep}assets${sep}`;
function isHashed(file) {
  return (
    (file.startsWith(assetsRoot) && /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(file)) ||
    /[.-][a-f0-9]{8,}[.-]/i.test(file)
  );
}

// The push service worker must be re-checked on every load, or a browser could
// keep an old worker for a day after a deploy (it is small and not hashed).
const serviceWorkerFile = `${publicRoot}${sep}sw.js`;
function cacheControlFor(file, extension) {
  if (extension === '.html' || file === serviceWorkerFile) return 'no-cache';
  if (isHashed(file)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

// Serves a file, using the .br/.gz sibling written at build time when the
// client accepts it. Nothing is compressed at request time: brotli on the main
// bundle cost about a second per request.
async function sendFile(request, response, { file, fileInfo, status }) {
  const extension = extname(file).toLowerCase();
  const contentType = mimeTypes.get(extension) ?? 'application/octet-stream';
  const compressible = isCompressible(contentType);
  const encoding =
    compressible && fileInfo.size >= precompressMinimumBytes
      ? acceptedCompression(request.headers['accept-encoding'])
      : null;
  const sibling = encoding ? await resolveFile(`${file}.${encoding === 'br' ? 'br' : 'gz'}`) : null;

  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  if (compressible) response.setHeader('Vary', 'Accept-Encoding');
  response.setHeader('Cache-Control', cacheControlFor(file, extension));

  let source = file;
  let size = fileInfo.size;
  if (sibling) {
    response.setHeader('Content-Encoding', encoding);
    source = sibling.file;
    size = sibling.fileInfo.size;
  }
  response.setHeader('Content-Length', size);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(source)
    .on('error', (error) => {
      if (!response.headersSent) {
        setSecurityHeaders(response);
        respond(response, 500, 'Unable to read static asset');
      } else {
        response.destroy(error);
      }
    })
    .pipe(response);
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    respond(response, 405, 'Method not allowed');
    return;
  }

  let pathname;
  let search = '';
  try {
    // Check before WHATWG URL normalization, which otherwise erases encoded
    // dot segments and could turn a traversal request into an SPA route.
    const rawPath = decodeURIComponent(request.url.split('?')[0]);
    if (rawPath.split('/').includes('..')) {
      respond(response, 400, 'Bad request');
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    pathname = posix.normalize(decodeURIComponent(url.pathname));
    search = url.search;
  } catch {
    respond(response, 400, 'Bad request');
    return;
  }

  // API routes belong to the API artifact and must never receive the HBS SPA.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    respond(response, 404, 'Not found');
    return;
  }

  try {
    // One canonical address per page: /x/ and /x/index.html redirect to /x.
    if (pathname.endsWith('/index.html')) {
      const directory = pathname.slice(0, -'index.html'.length).replace(/\/+$/, '');
      redirect(response, `${directory || '/'}${search}`);
      return;
    }
    if (pathname !== '/' && pathname.endsWith('/')) {
      redirect(response, `${pathname.replace(/\/+$/, '')}${search}`);
      return;
    }

    // Dot-directories (.vite/manifest.json) and build internals stay private.
    const extension = extname(pathname).toLowerCase();
    // Dot paths are build internals (.vite/) except /.well-known, which browsers
    // and verifiers expect to be reachable.
    const hiddenPath = pathname.includes('/.') && !pathname.startsWith('/.well-known/');
    if (hiddenPath || precompressedSuffixes.has(extension) || reservedFiles.has(pathname)) {
      respond(response, 404, 'Not found');
      return;
    }

    const entry = extension
      ? await findStaticFile(pathname).then((found) => found && { ...found, status: 200 })
      : await findRouteShell(pathname);
    if (!entry) {
      respond(response, 404, 'Not found');
      return;
    }

    await sendFile(request, response, entry);
  } catch (error) {
    console.error('HBS static server request failed:', error);
    if (!response.headersSent) {
      respond(response, 500, 'Internal server error');
    } else {
      response.destroy(error);
    }
  }
});

server.listen(port, '0.0.0.0');
