import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCardBodyHtml, catalogEntryToTile } from '../js/catalog.mjs';

const browserGame = Object.freeze({
  id: 'ruinfold', displayName: 'Ruinfold', shelf: 'Worlds',
  description: 'A browsable game.', status: 'playable',
  hostname: 'ruinfold.561.group', entryPoints: { browser: '/' },
  keywords: [],
});

test('a source-reported playable game with an unavailable page is visibly unavailable, not a verified launch', () => {
  const game = { ...browserGame, availability: {
    state: 'unavailable', httpStatus: 404, checkedAt: '2026-10-23T14:53:00Z',
  }};
  const html = catalogCardBodyHtml(game);
  assert.match(html, /Reported playable/);
  assert.match(html, /class="badge availability-unavailable">Page unavailable<\/span>/);
  assert.match(html, /Page unavailable at 2026-10-23 14:53 UTC/);
  assert.match(html, /Visit Ruinfold/);
  assert.doesNotMatch(html, /Open Ruinfold/);
  assert.equal(catalogEntryToTile(game).confidence, 'low');
});

test('an unchecked browser page is visibly unknown even without checkedAt', () => {
  const html = catalogCardBodyHtml(browserGame);
  assert.match(html, /class="badge availability-unchecked">Page not checked<\/span>/);
  assert.match(html, /Visit Ruinfold/);
  assert.doesNotMatch(html, /Open Ruinfold|Page reached/);
  assert.equal(catalogEntryToTile(browserGame).confidence, 'low');
});

test('a reachable HTTP page does not prove game operation or customer acceptance', () => {
  const game = { ...browserGame, availability: {
    state: 'reachable', httpStatus: 200, checkedAt: '2026-10-23T14:53:00Z',
  }};
  const html = catalogCardBodyHtml(game);
  assert.match(html, /class="badge availability-reachable">Page reached<\/span>/);
  assert.match(html, /Open Ruinfold/);
  assert.equal(catalogEntryToTile(game).confidence, 'high');
  // This is page confidence only; no claim of tested controls, completion or playability.
  assert.doesNotMatch(html, /gameplay verified|user accepted|game completed/i);
});

test('an API-only or authored non-browser game has no fictitious page-status badge', () => {
  const game = { ...browserGame, entryPoints: { headless: '/api' },
    availability: { state: 'unavailable', checkedAt: '2026-10-23T14:53:00Z' }};
  const html = catalogCardBodyHtml(game);
  assert.match(html, /No browser entry/);
  assert.doesNotMatch(html, /availability-unavailable|availability-unchecked|availability-reachable/);
  assert.equal(catalogEntryToTile(game).confidence, 'low');
});
