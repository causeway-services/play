import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCardBodyHtml, catalogEntryToTile } from '../js/catalog.mjs';
import { observeBrowserPages } from '../src/discover-catalog.mjs';

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


test('publication observations distinguish reached HTML, HTTP refusals, wrong media, off-origin redirect, and transport failure', async () => {
  const checkedAt = '2026-10-23T16:53:00Z';
  const probes = [
    ['onestone', 200, 'text/html; charset=utf-8', 'reachable'],
    ['ruinfold', 404, 'text/html', 'unavailable'],
    ['durante', 404, 'text/html', 'unavailable'],
    ['casino', 503, 'text/html', 'unavailable'],
    ['tidepool', 409, 'text/html', 'unavailable'],
    ['json-only', 200, 'application/json', 'unavailable'],
    ['foreign-landing', 200, 'text/html', 'unavailable'],
    ['network-error', null, null, 'unavailable'],
  ];
  const inputs = probes.map(([id]) => ({
    ...browserGame, id, displayName: id, hostname: id + '.561.group',
  }));
  inputs.push({ ...browserGame, id: 'headless-only', entryPoints: { headless: '/api' } });
  const called = [];
  const responses = new Map(probes.map(([id, status, media]) => [
    'https://' + id + '.561.group/',
    { status, media, url: id === 'foreign-landing' ? 'https://external.example/landing' : 'https://' + id + '.561.group/' },
  ]));
  const actual = await observeBrowserPages(inputs, {
    checkedAt,
    fetchImpl: async (url, options) => {
      called.push(url);
      assert.equal(options.headers.accept, 'text/html');
      assert.equal(options.redirect, 'manual', 'availability observer must refuse automatic redirect egress');
      const observation = responses.get(url);
      assert.ok(observation, 'only authored browser entrances can be requested');
      if (observation.status === null) throw new Error('synthetic network refusal');
      return {
        ok: observation.status >= 200 && observation.status < 300,
        status: observation.status,
        url: observation.url,
        headers: { get: (key) => key === 'content-type' ? observation.media : null },
        body: { cancel: async () => {} },
      };
    },
  });
  assert.equal(called.length, probes.length);
  assert.deepEqual(actual.map((entry) => entry.id), inputs.map((entry) => entry.id));
  for (let index = 0; index < probes.length; index++) {
    const [id, , , expected] = probes[index];
    assert.equal(actual[index].availability.state, expected, id);
    assert.equal(actual[index].availability.checkedAt, checkedAt);
    const html = catalogCardBodyHtml(actual[index]);
    assert.match(html, new RegExp(expected === 'reachable' ? 'Page reached' : 'Page unavailable'));
    assert.equal(catalogEntryToTile(actual[index]).confidence, expected === 'reachable' ? 'high' : 'low');
  }
  assert.equal(actual[6].availability.reason, 'off-origin-redirect');
  assert.equal(actual[6].availability.finalUrl, undefined, 'public projections must not expose unrelated redirect destinations');
  assert.equal(actual[7].availability.reason, 'request-failed');
  assert.equal(actual[8].availability, undefined);
});
