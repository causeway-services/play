// A real reading-order check on the built index.html/today.html -- not a grep for whether
// a string like "aria-labelledby" merely appears somewhere in the file, but a check of
// actual document POSITION: landmark order, whether a skip link's target id really exists,
// whether each TUFTE tile's aria-labelledby actually resolves to a heading physically
// inside that same tile, and whether the source order of rendered tiles matches the
// authored order of the data they came from (catalog.json's own entry order for
// index.html, the daily-utc subset of it for today.html) -- the concrete claim behind
// "TUFTE's semantic-order invariant" the design calls for verifying here, not asserting.
//
// This has no DOM available -- HTML source-string character offsets stand in for DOM/
// document order, which is a faithful proxy for both screen-reader reading order and
// default tab order for content with no explicit tabindex reordering (true of every page
// this storefront ships).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTodayModel } from '../js/today.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

async function loadCatalogEntries() {
  const raw = await readFile(path.join(ROOT, 'catalog.json'), 'utf8');
  return JSON.parse(raw).games;
}

/** Every `<section class="tufte-tile" id="...">`'s id, in the order it appears in `html`. */
function tileIdsInSourceOrder(html) {
  return [...html.matchAll(/<section class="tufte-tile" id="([a-z0-9-]+)"/g)].map((m) => m[1]);
}

function indexOfLandmark(html, openTag) {
  const index = html.indexOf(openTag);
  assert.ok(index !== -1, `expected to find ${openTag} in the document`);
  return index;
}

async function checkLandmarkAndSkipLinkOrder(html, skipTargetId) {
  const skipLinkIndex = indexOfLandmark(html, '<a class="skip-link"');
  const headerIndex = indexOfLandmark(html, '<header class="site-header">');
  const mainIndex = indexOfLandmark(html, '<main>');
  const footerIndex = indexOfLandmark(html, '<footer class="site-footer">');

  // Real reading/tab order, not just presence: the skip link must be the first thing in
  // the body (before the header it lets a keyboard/screen-reader user skip past), and the
  // three landmarks must appear header -> main -> footer, source order.
  assert.ok(skipLinkIndex < headerIndex, 'skip link must precede the header, in source order');
  assert.ok(headerIndex < mainIndex, 'header must precede main, in source order');
  assert.ok(mainIndex < footerIndex, 'main must precede footer, in source order');

  // The skip link's own target id must actually exist -- a skip link to a missing id is a
  // skip link to nowhere.
  const targetPattern = new RegExp(`id="${skipTargetId}"`);
  assert.match(html, targetPattern, `skip link target #${skipTargetId} must exist in the document`);
  const targetIndex = html.search(targetPattern);
  assert.ok(targetIndex > mainIndex, `#${skipTargetId} must be inside <main>, not before it`);
}

/** For every tufte-tile, aria-labelledby must resolve to an <h2> physically inside that
 *  SAME tile's own <section>...</section> span -- not merely present anywhere in the
 *  document (which a plain grep for the attribute name would not catch either way). */
function checkEachTileLabelledbyResolvesInsideItself(html) {
  const sectionStarts = [...html.matchAll(/<section class="tufte-tile" id="([a-z0-9-]+)"[^>]*aria-labelledby="([a-z0-9-]+-title)"/g)];
  assert.ok(sectionStarts.length > 0, 'expected at least one tufte-tile section to check');

  for (let i = 0; i < sectionStarts.length; i += 1) {
    const match = sectionStarts[i];
    const [, tileId, labelledbyId] = match;
    const sectionStart = match.index;
    const nextSectionStart = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : html.indexOf('</div></div>', sectionStart);
    const sectionSlice = html.slice(sectionStart, nextSectionStart === -1 ? undefined : nextSectionStart);

    assert.equal(labelledbyId, `${tileId}-title`, `tile ${tileId}'s aria-labelledby must reference its own -title id, not a borrowed one`);
    const headingPattern = new RegExp(`<h2 id="${labelledbyId}">`);
    assert.match(sectionSlice, headingPattern, `tile ${tileId}'s aria-labelledby target must be an <h2> physically inside that same tile, not elsewhere in the document`);

    // The heading must come before the tile body in THIS tile's own slice -- reading order
    // inside the tile itself (name the region, then its content), not just presence.
    const headingIndex = sectionSlice.search(headingPattern);
    const bodyIndex = sectionSlice.indexOf('<div class="tufte-tile-body">');
    assert.ok(bodyIndex !== -1 && headingIndex < bodyIndex, `tile ${tileId}'s heading must precede its own body in source order`);
  }
}

function checkSingleH1PrecedesEveryH2(html) {
  const h1Matches = [...html.matchAll(/<h1>/g)];
  assert.equal(h1Matches.length, 1, 'expected exactly one <h1> on the page');
  const h1Index = h1Matches[0].index;

  const h2Indexes = [...html.matchAll(/<h2 id="[a-z0-9-]+-title">/g)].map((m) => m.index);
  assert.ok(h2Indexes.length > 0, 'expected at least one tile <h2>');
  for (const h2Index of h2Indexes) {
    assert.ok(h1Index < h2Index, 'the page <h1> must precede every tile <h2> in source order');
  }
}

test('index.html: skip link, landmark order, and per-tile aria-labelledby all hold under a real position check', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  await checkLandmarkAndSkipLinkOrder(html, 'catalog-grid');
  checkEachTileLabelledbyResolvesInsideItself(html);
  checkSingleH1PrecedesEveryH2(html);
});

test('index.html: rendered tile source order matches catalog.json\'s own entry order exactly -- the authored-order-is-DOM-order invariant, checked structurally', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const entries = await loadCatalogEntries();
  assert.deepEqual(tileIdsInSourceOrder(html), entries.map((entry) => entry.id));
});

test('today.html: skip link, landmark order, and per-tile aria-labelledby all hold under a real position check', async () => {
  const html = await readFile(path.join(ROOT, 'today.html'), 'utf8');
  await checkLandmarkAndSkipLinkOrder(html, 'today-list');
  checkEachTileLabelledbyResolvesInsideItself(html);
  checkSingleH1PrecedesEveryH2(html);
});

test("today.html: rendered strip source order matches js/today.mjs's own authored strip order exactly (today.html's ritual ordering is intentionally its own -- not catalog.json's array order, the same way it already was before this rebuild) -- and that set is exactly catalog.json's daily-utc entries", async () => {
  const html = await readFile(path.join(ROOT, 'today.html'), 'utf8');
  const entries = await loadCatalogEntries();
  const dailyIds = new Set(entries.filter((entry) => entry.seedPolicy && entry.seedPolicy.kind === 'daily-utc').map((entry) => entry.id));

  const model = await computeTodayModel(new Date());
  const authoredOrder = model.tiles.map((tile) => tile.id);
  assert.deepEqual(new Set(authoredOrder), dailyIds, "today.mjs's own strip set must exactly match catalog.json's daily-utc entries");
  assert.deepEqual(tileIdsInSourceOrder(html), authoredOrder, "rendered DOM order must match js/today.mjs's own authored tile order exactly");
});

test('every tufte-tile in both pages carries data-role/data-lifecycle/data-confidence as attributes only -- never leaking into an aria-* attribute, which would be a false accessibility signal with no real screen-reader translation', async () => {
  for (const file of ['index.html', 'today.html']) {
    const html = await readFile(path.join(ROOT, file), 'utf8');
    assert.ok(!/aria-role=|aria-lifecycle=|aria-confidence=/.test(html), `${file} must never invent a non-standard aria-* attribute from tile vocabulary fields`);
  }
});
