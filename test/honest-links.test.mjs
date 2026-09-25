// Regression coverage for two real bugs: (1) playUrl(entry) used to hardcode the bare origin,
// ignoring entryPoints.browser; (2) a live play link used to render for ANY playable entry
// with a browser entry point regardless of whether that subdomain is actually routed. The fix
// is a `LIVE_SUBDOMAINS` set gating the live-link path in `js/catalog.mjs`; this file checks it
// never drifts from the
// router, the real, single source of truth for what resolves at *.561.group.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { LIVE_SUBDOMAINS } from '../js/live-subdomains.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REPO_ROOT = execFileSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const ROUTER_ROOT = path.join(
  REPO_ROOT,
  'lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/cloud-services-section/services/cloudflare-services-section/services/cloudflare-router',
);

/** The shared router's own routes (pre-2026-08-31-migration shape): every hostname the
 *  Cloudflare worker still forwards to a Cloud Run origin, per its own source. Kept as one of
 *  two sources -- see `liveHostnames` below -- because not every game has migrated off the
 *  router yet. */
async function routerHostnames() {
  const src = await readFile(path.join(ROUTER_ROOT, 'src', 'index.mjs'), 'utf8');
  // Matches ORIGIN_BY_HOST as either a plain object literal ({"host": origin, ...}) or a
  // Map ([["host", origin], ...]) -- only the hostnames on the left of each entry matter here.
  const match = src.match(/ORIGIN_BY_HOST\s*=\s*(?:new Map\()?[[{]([\s\S]*?)\n[\]}]\)?;/);
  assert.ok(match, 'expected an ORIGIN_BY_HOST object or Map literal in the router source');
  const hosts = [...(match[1]).matchAll(/"([a-z0-9.-]+\.561\.group)"/g)].map((m) => m[1]);
  return new Set(hosts);
}

/** 2026-08-31 free-tier pivot: a migrated game gets its OWN `wrangler.jsonc` with its own
 *  `custom_domain` route and is deliberately REMOVED from the shared router (the router shrinks
 *  toward deletion as properties migrate -- see the router's own module doc). So "routed" can no
 *  longer mean "present in the router's ORIGIN_BY_HOST" alone; a repo-wide scan for any OTHER
 *  `wrangler.jsonc` declaring a `*.561.group` custom_domain route is the other half of the real,
 *  live routing table. Excludes the router's own wrangler.jsonc (already covered above) and
 *  node_modules/.wrangler (never a source of truth).
 * @returns {Promise<Set<string>>}
 */
async function dedicatedWorkerHostnames() {
  const { readdir } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const repoRoot = execFileSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const found = new Set();

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.wrangler')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name === 'wrangler.jsonc' && full !== path.join(ROUTER_ROOT, 'wrangler.jsonc')) {
        try {
          const text = await readFile(full, 'utf8');
          for (const m of text.matchAll(/"pattern"\s*:\s*"([a-z0-9.-]+\.561\.group)"[\s\S]{0,80}?"custom_domain"\s*:\s*true/g)) {
            found.add(m[1]);
          }
        } catch {
          // unreadable/malformed wrangler.jsonc -- not this test's concern, skip
        }
      }
    }
  }

  await walk(repoRoot);
  return found;
}

/** The real, live routing table this catalog cares about: the union of the shared router's
 *  remaining routes and every migrated game's own dedicated-Worker route.
 * @returns {Promise<Set<string>>}
 */
async function liveHostnames() {
  const [routed, dedicated] = await Promise.all([routerHostnames(), dedicatedWorkerHostnames()]);
  const hosts = new Set([...routed, ...dedicated]);
  assert.ok(hosts.size > 0, 'expected at least one routed hostname');
  return hosts;
}

/** Every `subdomain` this catalog actually claims a game lives at, per `catalog.json` itself
 *  (not hand-copied -- read live from the same file `catalog.mjs`/`today.mjs` render from). A
 *  hostname the router routes but that isn't one of THESE is some other, unrelated house
 *  service riding the same shared Worker -- correctly ignored by the LIVE_SUBDOMAINS checks
 *  below, which only care about this catalog's own games. */
async function catalogHostnames() {
  const raw = await readFile(path.join(ROOT, 'catalog.json'), 'utf8');
  const catalog = JSON.parse(raw);
  const hostnames = (catalog.games ?? [])
    .map((g) => g.hostname || (g.subdomain ? `${g.subdomain}.561.group` : undefined))
    .filter((h) => Boolean(h));
  assert.ok(hostnames.length > 0, 'expected catalog.json to declare at least one game hostname');
  return new Set(hostnames);
}

/** The subdomains this catalog SHOULD honestly link out to: routed by the real router AND a
 *  real entry in this catalog (excluding the storefront's own hostname and unrelated
 *  non-catalog services the shared router also happens to route) AND not a named
 *  routed-but-not-yet-safe carve-out (see `ROUTED_BUT_NOT_LINK_SAFE` below). */
async function liveCatalogHostnames() {
  const [routed, catalog] = await Promise.all([liveHostnames(), catalogHostnames()]);
  return new Set([...catalog].filter((host) => routed.has(host) && !ROUTED_BUT_NOT_LINK_SAFE.has(host)));
}

// Routed does not always mean safe to link: a hostname can be routed by the worker before its
// backing service is actually safe to send a player to. This set is the mechanism for that
// case: add a hostname here with a comment saying why, and only add it to LIVE_SUBDOMAINS once
// that reason is actually resolved.
// 2026-08-31 free-tier pivot: GCP billing on five-six-one-group-dev is PERMANENTLY off
// (founder-ruled) -- every one of these seven is still ONLY in the shared router, which still
// proxies to a now-dead Cloud Run origin (measured 500 live 2026-08-31). Remove one entry here
// only once that game gets its own dedicated Worker (see the migrated games above it).
const ROUTED_BUT_NOT_LINK_SAFE = new Set([
  'ruinfold.play.561.group', 'farstone.561.group', 'durante.play.561.group',
  'aletheon.561.group', 'equivo.play.561.group', 'casino.play.561.group',
]);

test("Play's LIVE_SUBDOMAINS matches exactly this catalog's own hostnames that the Cloudflare worker actually routes, minus any named routed-but-unsafe carve-out", async () => {
  const expected = await liveCatalogHostnames();
  assert.deepEqual(LIVE_SUBDOMAINS, expected, 'js/live-subdomains.mjs has drifted from the router\'s real routes');
});

test('every ROUTED_BUT_NOT_LINK_SAFE hostname is genuinely routed right now (the carve-out did not go stale)', async () => {
  const live = await liveHostnames();
  for (const h of ROUTED_BUT_NOT_LINK_SAFE) {
    assert.ok(live.has(h), `${h} is in ROUTED_BUT_NOT_LINK_SAFE but the router no longer routes it -- remove it from the carve-out`);
  }
});

test('every catalog entry NOT in the live-routed set is gated behind LIVE_SUBDOMAINS in catalog.mjs, not just status+entryPoints', async () => {
  const catalogSrc = await readFile(path.join(ROOT, 'js', 'catalog.mjs'), 'utf8');
  assert.match(catalogSrc, /import\s*\{\s*LIVE_SUBDOMAINS\s*\}\s*from\s*'\.\/live-subdomains\.mjs'/);
  assert.match(catalogSrc, /function canPlayLive\(entry\)[\s\S]*?LIVE_SUBDOMAINS\.has\(entry\.hostname \|\| entry\.subdomain\)/);
});

test("playUrl(entry) builds its path from the manifest's own entryPoints.browser, not a hardcoded bare origin", async () => {
  const catalogSrc = await readFile(path.join(ROOT, 'js', 'catalog.mjs'), 'utf8');
  const match = catalogSrc.match(/function playUrl\(entry\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'expected a playUrl(entry) function');
  assert.match(match[1], /entry\.entryPoints/, 'playUrl must read entry.entryPoints, not assume "/"');
});

test('the old "Pb" monogram glyph does not appear in index.html, today.html, or chrome/README.md', async () => {
  // The old glyph's two letterform paths, byte-for-byte -- if either string is found anywhere
  // in this tree again, the swap to the cowrie-shell mark regressed.
  const PB_SIGNATURES = ['M14 32V16h6a4 4 0 0 1 0 8h-6', 'M28 24h6a4 4 0 0 1 0 8h-6'];
  for (const file of ['index.html', 'today.html', path.join('chrome', 'README.md')]) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    for (const sig of PB_SIGNATURES) {
      assert.ok(!text.includes(sig), `${file} still contains the old Pb monogram path data: ${sig}`);
    }
  }
});
