#!/usr/bin/env node
/**
 * serve.mjs -- local static server for play.561.group.
 * Run: node serve.mjs [port]. Env: PORT (default 8561), HOST (default 127.0.0.1).
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8561);
const HOST = process.env.HOST ?? '127.0.0.1';

const staticFiles = sirv(ROOT, {
  dev: true,
  etag: true,
  onNoMatch(_req, res) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
  },
});

const server = http.createServer(staticFiles);

server.listen(PORT, HOST, () => {
  console.log(`play.561.group serving http://${HOST}:${PORT}/`);
});

export { server };
