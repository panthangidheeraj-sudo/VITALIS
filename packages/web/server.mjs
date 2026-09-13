/**
 * Production static file server for the built SPA.
 *
 * NOT `vite preview` — that's documented by Vite itself as a dev-only tool,
 * not meant for production traffic. NOT an added `serve`/`sirv` dependency
 * either — a correct static server with SPA history fallback is about thirty
 * lines of `node:http` and `node:fs`, and pulling in a package for it would
 * be the "unnecessary dependency" the brief explicitly says to avoid.
 *
 * SPA FALLBACK, explained: this is a client-side-routed app (react-router).
 * A request for `/emergency` has no matching file in `dist/` — only
 * `index.html` exists, and react-router reads the URL client-side after that
 * loads. Serving a real static host as-is would 404 on every refresh of any
 * route but `/`. The fix is the same one every SPA host (Netlify, Vercel,
 * Render's own static-site product) applies: any GET that doesn't match a
 * real file falls back to `index.html`, status 200, and the client router
 * takes it from there.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
// Render sets PORT; same convention the backend (packages/server) uses.
const PORT = Number(process.env.PORT ?? 4173);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  // Strip query/hash and reject any attempt to escape DIST_DIR via `..` —
  // `normalize` collapses traversal segments before the join, and the
  // startsWith check below is the actual guard (normalize alone doesn't stop
  // an absolute-looking path on its own).
  const cleaned = normalize(decodeURIComponent(urlPath.split('?')[0].split('#')[0]));
  const candidate = join(DIST_DIR, cleaned);
  if (!candidate.startsWith(DIST_DIR)) return undefined;
  try {
    const info = await stat(candidate);
    return info.isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

const server = createServer(async (req, res) => {
  try {
    const filePath = req.method === 'GET' ? await resolveFile(req.url ?? '/') : undefined;
    const servePath = filePath ?? join(DIST_DIR, 'index.html');
    const body = await readFile(servePath);
    const type = MIME_TYPES[extname(servePath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      // The hashed asset filenames Vite produces (main-abc123.js) are safe to
      // cache forever; index.html is not — it's the one file that changes
      // without changing its own name, so it must always be revalidated or a
      // returning visitor never sees a new deploy.
      'cache-control': filePath !== undefined && servePath !== join(DIST_DIR, 'index.html')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal server error');
    console.error('[vitalis-web] request failed:', err);
  }
});

// Explicit '0.0.0.0', same reasoning as packages/server/src/index.ts: most
// PaaS hosts (Render included) route external traffic to all interfaces.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  VITALIS web — serving ${DIST_DIR}`);
  console.log(`  listening on 0.0.0.0:${PORT}\n`);
});
