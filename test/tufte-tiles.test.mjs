import { readPublication } from './publication.mjs';
import { discoverCatalog } from '../src/discover-catalog.mjs';
const discovered = discoverCatalog();
// Behavioral tests for the storefront's own TUFTE tile shaping -- the pure
// catalog.json/daily-strip -> TUFTE tile functions in js/catalog.mjs and js/today.mjs.
// TUFTE itself (@red-cup-engineering/web-page-tiling-engine) is tested by its own
// package; this file only tests the storefront-owned shaping the package's own README asks
// to stay outside it ("domain vocabularies stay OUTSIDE this package").
//
// Verifies:
//   1. catalogEntryToTile/catalogModel are pure functions of catalog.json's real data.
//   2. The tile projection round-trips through normalizeTufteModel without losing the
//      lifecycle/confidence business rules browserAvailable()/status compute.
//   3. The patch path: mutating one entry in a catalog.json-shaped games array produces a
//      diffTufteProjection patch touching ONLY that entry's tile -- every other tile is
//      untouched, proven by diffing real (not synthetic) catalog data.
//   4. The same three properties for today.html's computeTodayModel().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTufteModel, diffTufteProjection } from '@red-cup-engineering/web-page-tiling-engine';
import {
  catalogEntryToTile,
  catalogModel,
  filterEntries,
  filtersFromSearchParams,
  filtersToSearchParams,
  shelfValues,
} from '../js/catalog.mjs';
import { computeTodayModel } from '../js/today.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

async function loadCatalogEntries() {
  return (await discovered).catalog.games;
}

test('catalogEntryToTile is a pure function: same entry in, structurally identical tile out, entry left untouched', async () => {
  const entries = await loadCatalogEntries();
  const entry = entries[0];
  const before = JSON.stringify(entry);

  const first = catalogEntryToTile(entry);
  const second = catalogEntryToTile(entry);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(entry), before, 'catalogEntryToTile must never mutate its input entry');
});

test('catalogEntryToTile encodes the real business rules, not new inference', async () => {
  const entries = await loadCatalogEntries();
  for (const entry of entries) {
    const tile = catalogEntryToTile(entry);
    assert.equal(tile.id, entry.id);
    assert.equal(tile.title, entry.displayName);
    assert.equal(tile.eyebrow, entry.shelf);
    assert.equal(tile.lifecycle, entry.status === 'in-development' ? 'imminent' : 'present');
    // Every live entry today is status:"playable", so this also exercises the
    // confidence:"low" path for any real-but-unrouted subdomain in the actual catalog.
    assert.ok(tile.confidence === 'high' || tile.confidence === 'low');
    assert.ok(typeof tile.html === 'string' && tile.html.length > 0);
    // role/span/side are deliberately left unset -- catalog cards are peers, not a
    // hero/aside/rail layout (see js/catalog.mjs's own catalogEntryToTile doc comment).
    assert.equal(tile.role, undefined);
    assert.equal(tile.span, undefined);
    assert.equal(tile.side, undefined);
  }
});

test('catalogModel -> normalizeTufteModel produces one uniquely-identified tile per catalog entry, in catalog order', async () => {
  const entries = await loadCatalogEntries();
  const projection = normalizeTufteModel(catalogModel(entries));
  assert.equal(projection.tiles.length, entries.length);
  assert.deepEqual(projection.tiles.map((tile) => tile.id), entries.map((entry) => entry.id));
});

test('catalog shelf filtering uses only the catalog shelf field and combines with status/search', async () => {
  const entries = await loadCatalogEntries();
  const shelf = shelfValues(entries)[0];
  assert.ok(shelf, 'the real catalog has at least one shelf');
  const filtered = filterEntries(entries, { shelf, status: 'playable' });
  assert.ok(filtered.length > 0, 'the chosen real shelf has a playable game');
  assert.ok(filtered.every((entry) => entry.shelf === shelf && entry.status === 'playable'));
});

test('catalog filter query state is shareable, normalized against real shelves, and omits inactive filters', async () => {
  const entries = await loadCatalogEntries();
  const shelf = shelfValues(entries)[0];
  const restored = filtersFromSearchParams(
    new URLSearchParams(`q=card%20table&status=playable&shelf=${encodeURIComponent(shelf)}`),
    entries,
  );
  assert.deepEqual(restored, { term: 'card table', status: 'playable', shelf });
  assert.equal(
    filtersToSearchParams(restored).toString(),
    `q=card+table&status=playable&${new URLSearchParams({ shelf }).toString()}`,
  );
  assert.deepEqual(
    filtersFromSearchParams(new URLSearchParams('q=%20&status=unknown&shelf=not-a-shelf'), entries),
    { term: '', status: 'all', shelf: 'all' },
  );
  assert.equal(filtersToSearchParams({ term: '', status: 'all', shelf: 'all' }).toString(), '');
});

test('built index.html exposes one accessible shelf option for every catalog shelf', async () => {
  const [entries, html] = await Promise.all([
    loadCatalogEntries(),
    readPublication('index.html'),
  ]);
  assert.match(html, /<label for="shelf-filter">Shelf<\/label>/);
  assert.match(html, /<select id="shelf-filter" name="shelf">/);
  assert.match(html, /<option value="all">All shelves<\/option>/);
  for (const shelf of shelfValues(entries)) {
    assert.ok(html.includes(`<option value="${shelf}">${shelf}</option>`), `missing ${shelf} shelf option`);
  }
});

test('patch path: mutating one catalog entry changes only that entry\'s tile in the diff -- every other tile produces zero patch', async () => {
  const entries = await loadCatalogEntries();
  assert.ok(entries.length >= 2, 'need at least two catalog entries for this to be a meaningful test');

  const previous = normalizeTufteModel(catalogModel(entries));

  const targetIndex = entries.findIndex((entry) => entry.status === 'playable');
  assert.ok(targetIndex !== -1, 'expected at least one playable entry to mutate');
  const mutated = entries.map((entry, index) => (
    index === targetIndex ? { ...entry, description: `${entry.description} (mutated for this test)` } : entry
  ));
  const next = normalizeTufteModel(catalogModel(mutated));

  const patches = diffTufteProjection(previous, next);
  assert.equal(patches.length, 1, `expected exactly one patch, got ${patches.length}: ${JSON.stringify(patches)}`);
  assert.equal(patches[0].op, 'update');
  assert.equal(patches[0].id, entries[targetIndex].id);
  // TUFTE 0.4.x explicitly clears the mutually-exclusive plain-content field when trusted
  // html changes. The body replacement still touches only this tile, never a sibling.
  assert.equal(typeof patches[0].changed.html, 'string');
  assert.equal(patches[0].changed.content, undefined);
  assert.deepEqual(Object.keys(patches[0].changed).sort(), ['content', 'html']);
});

test('patch path: an entry\'s status flip from playable to in-development changes lifecycle AND confidence on exactly that tile', async () => {
  const entries = (await loadCatalogEntries()).map((entry) => ({ ...entry, availability: { state: 'reachable' } }));
  const targetIndex = entries.findIndex((entry) => entry.status === 'playable');
  assert.ok(targetIndex !== -1);

  const previous = normalizeTufteModel(catalogModel(entries));
  const mutated = entries.map((entry, index) => (
    index === targetIndex ? { ...entry, status: 'in-development' } : entry
  ));
  const next = normalizeTufteModel(catalogModel(mutated));
  const patches = diffTufteProjection(previous, next);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, entries[targetIndex].id);
  assert.equal(patches[0].changed.lifecycle, 'imminent');
  // status also gates confidence via browserAvailable() (status === 'playable' is one of its
  // three ANDed conditions), so flipping status away from playable must also drop
  // confidence to "low" in the same single patch, on the same single tile.
  assert.equal(patches[0].changed.confidence, 'low');
});

test('an untouched catalog produces an empty patch (no phantom diffs from re-deriving the same model twice)', async () => {
  const entries = await loadCatalogEntries();
  const previous = normalizeTufteModel(catalogModel(entries));
  const next = normalizeTufteModel(catalogModel(entries.map((entry) => ({ ...entry }))));
  assert.deepEqual(diffTufteProjection(previous, next), []);
});

test('computeTodayModel is a pure, deterministic function of the date: same UTC day in, byte-identical model out', async () => {
  const date = new Date('2026-08-20T09:00:00Z');
  const first = await computeTodayModel(date, (await discovered).catalog.games);
  const second = await computeTodayModel(new Date('2026-08-20T23:59:59Z'), (await discovered).catalog.games); // same UTC calendar day
  assert.deepEqual(first, second);
});

test('computeTodayModel: a different UTC day changes every seed-bearing tile, proven via a real diff, not a snapshot', async () => {
  const day1 = await computeTodayModel(new Date('2026-08-20T00:00:00Z'), (await discovered).catalog.games);
  const day2 = await computeTodayModel(new Date('2026-08-21T00:00:00Z'), (await discovered).catalog.games);
  const patches = diffTufteProjection(normalizeTufteModel(day1), normalizeTufteModel(day2));
  const dailyTileCount = day1.tiles.length;
  assert.equal(patches.length, dailyTileCount, 'every daily strip carries a date-derived seed, so every tile must show up in the diff across a real day change');
  assert.ok(patches.every((patch) => patch.op === 'update'));
});

test('today patch path: today.html always renders exactly the catalog\'s own daily-utc entries, gated the same way catalog.mjs gates confidence', async () => {
  const entries = await loadCatalogEntries();
  const dailyIds = new Set(entries.filter((entry) => entry.seedPolicy && entry.seedPolicy.kind === 'daily-utc').map((entry) => entry.id));
  const model = await computeTodayModel(new Date(), (await discovered).catalog.games);
  assert.deepEqual(new Set(model.tiles.map((tile) => tile.id)), dailyIds);
  for (const tile of model.tiles) {
    assert.equal(tile.role, 'rail');
    assert.equal(tile.lifecycle, 'present');
    assert.ok(tile.confidence === 'high' || tile.confidence === 'low');
  }
});
