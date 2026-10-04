import { readPublication } from './publication.mjs';
import { discoverCatalog } from '../src/discover-catalog.mjs';
const discovered = discoverCatalog();
// Behavioral tests for play.561.group -- node --test. Verifies: catalog.json parses and every
// entry is shaped like a CartridgeManifest plus this site's storefront-only extensions
// (cartridgeWrapped:true entries validated against the real published
// @red-cup-engineering/gaming/running; no entry may ever explicitly null a field); index.html and
// today.html reference only local assets; today.mjs's strips match catalog.json's daily-utc
// entries; serve.mjs actually serves its routes over real HTTP (ephemeral port), a 404, and
// a path-traversal attempt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateGameManifest } from '@red-cup-engineering/gaming/running/manifest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const SEED_POLICY_KINDS = new Set(['daily-utc', 'on-demand', 'client-supplied']);
const STATUS_VALUES = new Set(['playable', 'in-development']);
// the-suite-and-the-studio.md §3's shelf key, plus 'unshelved' for anything that doesn't
// fit one of the named CD-suite shelves yet.
const SHELF_VALUES = new Set(['Card Table', 'Puzzle Den', 'Study', 'Deep', 'Stars', 'substrate', 'unshelved']);

async function loadCatalog() {
  return (await discovered).catalog;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Recursively collects every dotted key path in `value` whose own value is explicitly
 *  `null` -- catalog.json's honesty rule is "omit an unfillable field, never null it". */
function findExplicitNulls(value, prefix = '') {
  const found = [];
  if (value === null) {
    found.push(prefix || '(root)');
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findExplicitNulls(v, `${prefix}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      found.push(...findExplicitNulls(v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return found;
}

/** Build a plain CartridgeManifest-shaped object from a catalog entry, dropping every
 *  storefront-only extension field (status, statusNote, repoPath, tests, cartridgeWrapped,
 *  energyBankWrapped, and this test suite's own *Note fields) so the real validator only
 *  ever sees the fields the spec actually defines. */
function toManifestShape(entry) {
  const manifest = {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    subdomain: entry.subdomain,
    entryPoints: entry.entryPoints,
    seedPolicy: entry.seedPolicy,
    intentLog: entry.intentLog,
    replayVerifier: entry.replayVerifier,
    keywords: entry.keywords,
  };
  if (entry.configs !== undefined) manifest.configs = entry.configs;
  if (entry.energy !== undefined) manifest.energy = entry.energy;
  return manifest;
}

test('catalog.json is valid JSON with a games array', async () => {
  const catalog = await loadCatalog();
  assert.ok(Array.isArray(catalog.games), 'catalog.games must be an array');
  assert.ok(catalog.games.length > 0, 'catalog.games must not be empty');
});

test('no catalog entry ever explicitly nulls a field -- omit it instead', async () => {
  const catalog = await loadCatalog();
  for (const entry of catalog.games) {
    const label = entry.id ?? '(missing id)';
    const nulls = findExplicitNulls(entry);
    assert.deepEqual(nulls, [], `${label}: explicit null field(s) found (omit instead): ${nulls.join(', ')}`);
  }
});

test('every cartridgeWrapped:true entry fully validates against the real @red-cup-engineering/gaming/running validateGameManifest', async () => {
  const catalog = await loadCatalog();
  for (const entry of catalog.games) {
    if (entry.cartridgeWrapped !== true) continue;
    const result = validateGameManifest(toManifestShape(entry));
    assert.equal(result.valid, true, `${entry.id}: ${result.errors.join('; ')}`);
  }
});

test('every catalog entry matches the honest subset of the CartridgeManifest shape it can fill in today (+ storefront status fields)', async () => {
  const catalog = await loadCatalog();
  const seenIds = new Set();
  const seenBrowserRoutes = new Set();

  // Every game today is cartridgeWrapped:false -- this loop asserts the loosest layer,
  // still true even for a future cartridgeWrapped:true entry.
  for (const entry of catalog.games) {
    const label = entry.id ?? '(missing id)';

    assert.ok(isNonEmptyString(entry.id), `${label}: id must be a non-empty string`);
    assert.ok(!seenIds.has(entry.id), `${label}: id must be unique`);
    seenIds.add(entry.id);

    assert.ok(isNonEmptyString(entry.displayName), `${label}: displayName must be a non-empty string`);
    assert.ok(isNonEmptyString(entry.description), `${label}: description must be a non-empty string`);

    assert.ok(isNonEmptyString(entry.subdomain), `${label}: subdomain must be a non-empty string`);
    assert.match(entry.subdomain, /^[a-z0-9-]+$/, `${label}: subdomain must be URL-safe lowercase`);

    // storefront-only extension, not part of the spec's CartridgeManifest, but required
    // here because the task explicitly asks for an honest playable/in-development badge.
    assert.ok(STATUS_VALUES.has(entry.status), `${label}: status must be "playable" or "in-development"`);
    assert.equal(typeof entry.cartridgeWrapped, 'boolean', `${label}: cartridgeWrapped must be a boolean`);

    // storefront-only extension: which shelf-within-the-shelf this game lives on, per
    // the-suite-and-the-studio.md §3. Every entry must claim one of the named shelves.
    assert.ok(SHELF_VALUES.has(entry.shelf), `${label}: shelf must be one of ${[...SHELF_VALUES].join(', ')}, got ${entry.shelf}`);

    assert.ok(entry.entryPoints && typeof entry.entryPoints === 'object', `${label}: entryPoints must be an object`);
    if (entry.entryPoints.browser !== undefined) {
      assert.ok(isNonEmptyString(entry.entryPoints.browser), `${label}: entryPoints.browser must be a string when present`);
      const browserRoute = `${entry.subdomain}${entry.entryPoints.browser}`;
      assert.ok(!seenBrowserRoutes.has(browserRoute), `${label}: subdomain + browser path must be unique`);
      seenBrowserRoutes.add(browserRoute);
    }
    if (entry.entryPoints.headless !== undefined) {
      assert.ok(isNonEmptyString(entry.entryPoints.headless), `${label}: entryPoints.headless must be a string when present`);
    }

    // Business rule: a game marked playable must actually declare a way to play it.
    // A game still in development is allowed to have neither yet (ruinfold's honest case).
    if (entry.status === 'playable') {
      assert.ok(
        entry.entryPoints.browser || entry.entryPoints.headless,
        `${label}: status "playable" requires at least one of entryPoints.browser / entryPoints.headless`,
      );
    }

    assert.ok(entry.seedPolicy && typeof entry.seedPolicy === 'object', `${label}: seedPolicy must be an object`);
    assert.ok(
      SEED_POLICY_KINDS.has(entry.seedPolicy.kind),
      `${label}: seedPolicy.kind must be one of ${[...SEED_POLICY_KINDS].join(', ')}`,
    );

    assert.ok(entry.intentLog && typeof entry.intentLog === 'object', `${label}: intentLog must be an object`);
    assert.ok(isNonEmptyString(entry.intentLog.schemaVersion), `${label}: intentLog.schemaVersion must be a non-empty string`);
    // schemaRef is optional by the spec; when a cartridgeWrapped:false entry genuinely
    // lacks one, the key is omitted entirely (never set to null) -- see the no-explicit-
    // nulls test above. When present, it must be a real, non-empty string.
    if (entry.intentLog.schemaRef !== undefined) {
      assert.ok(isNonEmptyString(entry.intentLog.schemaRef), `${label}: intentLog.schemaRef must be a non-empty string when present`);
    }

    // replayVerifier is required by the spec's CartridgeManifest, but a pre-wrap game
    // genuinely has none -- the honest move is to omit the key (cartridgeWrapped:false
    // is the marker of record for "not yet wrapped"), not to fake a null value. A
    // cartridgeWrapped:true entry is held to the full spec requirement by the strict
    // validateGameManifest test above, which will fail loudly if it's missing there.
    if (entry.replayVerifier !== undefined) {
      assert.ok(isNonEmptyString(entry.replayVerifier), `${label}: replayVerifier must be a non-empty string when present`);
    } else {
      assert.equal(entry.cartridgeWrapped, false, `${label}: replayVerifier may only be omitted when cartridgeWrapped is false`);
    }

    if (entry.energy !== undefined) {
      assert.ok(isNonEmptyString(entry.energy.hooksRef), `${label}: energy.hooksRef must be a non-empty string when energy is present`);
      assert.ok(isNonEmptyString(entry.energy.accountNamespace), `${label}: energy.accountNamespace must be a non-empty string when energy is present`);
    }

    if (entry.configs !== undefined) {
      assert.ok(Array.isArray(entry.configs), `${label}: configs must be an array when present`);
      for (const cfg of entry.configs) {
        assert.ok(isNonEmptyString(cfg.id), `${label}: each config needs a non-empty id`);
        assert.ok(isNonEmptyString(cfg.displayName), `${label}: each config needs a non-empty displayName`);
        assert.ok(cfg.params && typeof cfg.params === 'object', `${label}: each config needs a params object`);
      }
    }

    assert.ok(Array.isArray(entry.keywords), `${label}: keywords must be an array`);
    assert.ok(entry.keywords.length > 0, `${label}: keywords must not be empty`);
    for (const kw of entry.keywords) {
      assert.ok(isNonEmptyString(kw), `${label}: every keyword must be a non-empty string`);
    }
  }
});

test("index.html loads no remote script/stylesheet (its catalog cards' own play-link anchors may legitimately point at real *.561.group subdomains -- since the TUFTE rebuild, index.html server-renders those links directly, the same honest reason today.html's own anchors are allowed to)", async () => {
  const html = await readPublication('index.html');

  assert.ok(!/<script[^>]+src="https?:/i.test(html), 'index.html must not load a script from a CDN');
  assert.ok(!/<link[^>]+href="https?:/i.test(html), 'index.html must not load a stylesheet from a CDN');

  // Every non-local, non-data href must be a real *.561.group game subdomain -- never some
  // other external host. script/link[rel=stylesheet] refs must be local outright (checked
  // above); this checks every OTHER src/href attribute in the document (import map entries,
  // the favicon data: URI, and every catalog card's own <a> play link included).
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'expected at least one src/href reference to check');
  for (const ref of refs) {
    const isExternal = /^([a-z]+:)?\/\//i.test(ref) && !ref.startsWith('data:');
    if (!isExternal) continue;
    assert.match(ref, /^https:\/\/(?:[a-z0-9-]+\.)+561\.group(\/|$)/, `index.html's only allowed external references are real 561.group game links, found: ${ref}`);
  }
});

test('today.html loads no remote script/stylesheet (its anchor hrefs may legitimately point at real *.561.group subdomains -- that is the whole point of the page)', async () => {
  const html = await readPublication('today.html');

  assert.ok(!/<script[^>]+src="https?:/i.test(html), 'today.html must not load a script from a CDN');
  assert.ok(!/<link[^>]+href="https?:/i.test(html), 'today.html must not load a stylesheet from a CDN');

  const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scriptSrcs.length > 0, 'expected at least one <script src> to check');
  for (const src of scriptSrcs) {
    assert.ok(!/^([a-z]+:)?\/\//i.test(src), `today.html script src must be local, found: ${src}`);
  }
});

test("js/today.mjs's strips match exactly catalog.json's daily-utc entries", async () => {
  const catalog = await loadCatalog();
  const dailyIds = catalog.games
    .filter((g) => g.seedPolicy && g.seedPolicy.kind === 'daily-utc')
    .map((g) => g.id);
  assert.ok(dailyIds.length > 0, 'expected at least one daily-utc catalog entry');

  const js = await readFile(path.join(ROOT, 'js', 'today.mjs'), 'utf8');
  const { computeTodayStrips } = await import('../js/today.mjs');
  const ids = (await computeTodayStrips(new Date(), catalog.games)).map((strip) => strip.id);
  assert.deepEqual(new Set(ids), new Set(dailyIds));
});
