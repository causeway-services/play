// Guards play.561.group's Cloudflare wiring after the 2026-08-31 GCP exit: play.561.group is
// its own tiny Workers-static-assets site (own wrangler.jsonc, own custom_domain route), never
// proxied through the shared cloudflare-router's Cloud Run map -- that router carries no
// Cloud Run origin for play.561.group any more (removed outright, not shimmed). This does not
// test deployment (see the root session's deploy record); it only proves the source is
// internally consistent before anyone runs `wrangler deploy`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(HERE, '..');

test('play.561.group has its own custom_domain route with a static assets binding', async () => {
  const wrangler = JSON.parse(await readFile(path.join(SITE_ROOT, 'wrangler.jsonc'), 'utf8'));
  const route = wrangler.routes.find((r) => r.pattern === 'play.561.group');
  assert.ok(route, 'expected a { pattern: "play.561.group", custom_domain: true } route');
  assert.equal(route.custom_domain, true);
  assert.ok(wrangler.assets && typeof wrangler.assets.directory === 'string', 'expected an assets.directory binding');
});
