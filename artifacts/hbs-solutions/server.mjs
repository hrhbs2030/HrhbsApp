import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, posix, resolve, sep } from 'node:path';
import { brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
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
    'camera=(), microphone=(), geolocation=()',
  );
}

function respond(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
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

async function findFile(pathname) {
  // The request pathname is decoded exactly once before API routing. A
  // remaining percent sign can encode a second API or traversal segment.
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.includes('%')) return null;
  const candidate = resolve(publicRoot, `.${pathname}`);
  if (!isInsideRoot(candidate)) return null;

  try {
    let realFile = await realpath(candidate);
    if (!isInsideRoot(realFile)) return null;

    let fileInfo = await stat(realFile);
    if (fileInfo.isDirectory()) {
      realFile = await realpath(resolve(realFile, 'index.html'));
      if (!isInsideRoot(realFile)) return null;
      fileInfo = await stat(realFile);
    }

    if (fileInfo.isFile()) return { file: realFile, fileInfo, isSpaFallback: false };
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }

  // Extensionless client routes must work even for direct requests without
  // an Accept: text/html header (for example, a link checker or curl).
  if (extname(pathname)) return null;
  const indexFile = await realpath(resolve(publicRoot, 'index.html'));
  if (!isInsideRoot(indexFile)) return null;
  return {
    file: indexFile,
    fileInfo: await stat(indexFile),
    isSpaFallback: true,
  };
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    respond(response, 405, 'Method not allowed');
    return;
  }

  let pathname;
  try {
    // Check before WHATWG URL normalization, which otherwise erases encoded
    // dot segments and could turn a traversal request into an SPA route.
    const rawPath = decodeURIComponent(request.url.split('?')[0]);
    if (rawPath.split('/').includes('..')) {
      respond(response, 400, 'Bad request');
      return;
    }
    pathname = posix.normalize(
      decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
    );
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
    const entry = await findFile(pathname);
    if (!entry) {
      respond(response, 404, 'Not found');
      return;
    }

    const extension = extname(entry.file).toLowerCase();
    const contentType =
      mimeTypes.get(extension) ?? 'application/octet-stream';
    const canCompress =
      isCompressible(contentType) && entry.fileInfo.size >= 512;
    const encoding = canCompress
      ? acceptedCompression(request.headers['accept-encoding'])
      : null;

    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Vary', 'Accept-Encoding');
    response.setHeader(
      'Cache-Control',
      entry.isSpaFallback || extension === '.html'
        ? 'no-cache'
        : /[.-][a-f0-9]{8,}[.-]/i.test(entry.file)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    );

    if (encoding) {
      const contents = await readFile(entry.file);
      const body =
        encoding === 'br'
          ? await compressBrotli(contents)
          : await compressGzip(contents);
      response.setHeader('Content-Encoding', encoding);
      response.setHeader('Content-Length', body.byteLength);
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }

    response.setHeader('Content-Length', entry.fileInfo.size);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(entry.file)
      .on('error', (error) => {
        if (!response.headersSent) {
          setSecurityHeaders(response);
          respond(response, 500, 'Unable to read static asset');
        } else {
          response.destroy(error);
        }
      })
      .pipe(response);
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