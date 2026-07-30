#!/usr/bin/env node
/**
 * Zero-dependency static server for the IsoLab UI.
 *
 * The UI is plain ES modules importing the same engine the CLI and tests use,
 * so it needs to be served over HTTP rather than opened from file:// (module
 * imports are blocked by the file:// origin policy). No build step, no bundler.
 *
 *   npm start          -> http://localhost:8080
 *   npm start -- 3000  -> a different port
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    // Redirect rather than rewrite: serving index.html *at* "/" would leave its
    // relative URLs (styles.css, app.mjs) resolving against the root, where
    // they do not exist. A real redirect keeps the document's base correct.
    if (path === '/' || path === '') {
      res.writeHead(302, { location: '/src/ui/index.html' });
      res.end();
      return;
    }
    if (path === '/src/ui' || path === '/src/ui/') {
      res.writeHead(302, { location: '/src/ui/index.html' });
      res.end();
      return;
    }

    // Contain every request inside ROOT: reject anything that escapes it.
    const target = normalize(join(ROOT, path));
    if (!target.startsWith(ROOT + sep) && target !== ROOT) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || info.isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`Not found: ${path}`);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  IsoLab UI running at \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  serving ${ROOT}`);
  console.log(`  Ctrl-C to stop\n`);
});
