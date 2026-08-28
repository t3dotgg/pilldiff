import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ViteDevServer } from 'vite';
import { CatalogStore } from './catalog-store.js';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT_DIR, 'dist');
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '127.0.0.1';
const PRODUCTION = process.env.NODE_ENV === 'production';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const store = new CatalogStore({
  seedPath: resolve(ROOT_DIR, 'data/catalog.json'),
  cachePath: resolve(ROOT_DIR, '.cache/catalog.json'),
});

function applyHeaders(response: ServerResponse): void {
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  applyHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(value)}\n`);
}

function requestOrigin(request: IncomingMessage): string {
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol.split(',')[0].trim() : 'http';
  return `${protocol}://${request.headers.host ?? `${HOST}:${PORT}`}`;
}

function isCrossOrigin(request: IncomingMessage): boolean {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return true;
  const origin = request.headers.origin;
  return typeof origin === 'string' && origin !== requestOrigin(request);
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, { status: 'ok', source: 'billdifferen.blogspot.com' });
    return true;
  }
  if (pathname === '/api/catalog' && request.method === 'GET') {
    sendJson(response, 200, await store.get());
    return true;
  }
  if (pathname === '/api/catalog/refresh' && request.method === 'POST') {
    if (isCrossOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin refresh requests are not allowed.' });
      return true;
    }
    sendJson(response, 200, await store.refresh());
    return true;
  }
  sendJson(response, 404, { error: 'API route not found.' });
  return true;
}

function safeStaticPath(pathname: string): string | undefined {
  try {
    const decodedPath = decodeURIComponent(pathname);
    const candidate = resolve(DIST_DIR, `.${decodedPath}`);
    if (candidate !== DIST_DIR && !candidate.startsWith(`${DIST_DIR}${sep}`)) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

async function serveFile(response: ServerResponse, path: string): Promise<boolean> {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) return false;
    applyHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream');
    createReadStream(path).on('error', () => response.destroy()).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function serveProduction(response: ServerResponse, pathname: string): Promise<void> {
  const staticPath = safeStaticPath(pathname);
  if (!staticPath) {
    sendJson(response, 400, { error: 'Invalid path.' });
    return;
  }
  if (pathname !== '/' && await serveFile(response, staticPath)) return;
  if (pathname.startsWith('/assets/') || extname(pathname) !== '') {
    sendJson(response, 404, { error: 'Static asset not found.' });
    return;
  }
  if (await serveFile(response, resolve(DIST_DIR, 'index.html'))) return;
  sendJson(response, 503, { error: 'Frontend build is unavailable. Run npm run build first.' });
}

function serveDevelopment(vite: ViteDevServer, request: IncomingMessage, response: ServerResponse, pathname: string): void {
  vite.middlewares(request, response, async (error: unknown) => {
    if (error) {
      sendJson(response, 500, { error: 'Development server error.' });
      return;
    }
    if (pathname.startsWith('/assets/') || extname(pathname) !== '') {
      sendJson(response, 404, { error: 'Static asset not found.' });
      return;
    }
    try {
      const source = await readFile(resolve(ROOT_DIR, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(pathname, source);
      applyHeaders(response);
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    } catch {
      sendJson(response, 500, { error: 'Development frontend is unavailable.' });
    }
  });
}

export async function startServer(): Promise<void> {
  let vite: ViteDevServer | undefined;
  if (!PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      root: ROOT_DIR,
      server: { middlewareMode: true },
      appType: 'custom',
    });
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', requestOrigin(request));
      if (await handleApi(request, response, url.pathname)) return;
      applyHeaders(response);
      if (vite) {
        serveDevelopment(vite, request, response, url.pathname);
        return;
      }
      await serveProduction(response, url.pathname);
    } catch (error) {
      if (!response.headersSent) {
        const message = error instanceof Error ? error.message : 'Unexpected server error';
        sendJson(response, 500, { error: message });
      } else {
        response.destroy();
      }
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`pilldiff listening on http://${HOST}:${PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
