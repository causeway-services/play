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

test('observed redirects preserve local game entrances without reaching unrelated hosts', async () => {
  const games = ['same', 'foreign', 'loop', 'response', 'query']
    .map(id => ({ ...browserGame, id, hostname: id + '.561.group' }));
  const called = [];
  let closed = 0;
  const reply = (url, status, location, actualUrl = url) => ({
    ok: status >= 200 && status < 300, status, url: actualUrl,
    headers: { get: field => field === 'location' ? location
      : field === 'content-type' ? 'text/html' : null },
    body: { cancel: async () => { closed++; } },
  });
  const result = await observeBrowserPages(games, {
    checkedAt: '2026-10-23T22:00:00Z',
    fetchImpl: async (url, options) => {
      called.push(url);
      assert.equal(options.redirect, 'manual');
      if (url === 'https://same.561.group/')
        return reply(url, 302, '/web/index.html');
      if (url === 'https://same.561.group/web/index.html')
        return reply(url, 200);
      if (url === 'https://foreign.561.group/')
        return reply(url, 302, 'https://elsewhere.invalid/landing?opaque=private-fixture');
      if (url.startsWith('https://loop.561.group/'))
        return reply(url, 302, '/loop');
      if (url === 'https://response.561.group/')
        return reply(url, 200, null, 'https://elsewhere.invalid/landing?opaque=private-fixture');
      if (url === 'https://query.561.group/')
        return reply(url, 302, '/web/index.html?auth_code=synthetic-private-code');
      if (url === 'https://query.561.group/web/index.html?auth_code=synthetic-private-code')
        return reply(url, 200);
      throw new Error('unexpected redirect attempt');
    },
  });
  assert.equal(result[0].availability.state, 'reachable');
  assert.equal(result[0].availability.finalUrl, 'https://same.561.group/web/index.html');
  assert.equal(result[1].availability.state, 'unavailable');
  assert.equal(result[1].availability.reason, 'off-origin-redirect');
  assert.equal(result[1].availability.finalUrl, undefined);
  assert.equal(result[2].availability.reason, 'redirect-limit');
  assert.equal(result[3].availability.reason, 'off-origin-redirect');
  assert.equal(result[3].availability.finalUrl, undefined);
  assert.equal(result[4].availability.state, 'reachable',
    'a same-origin query redirect can still produce an HTML reachability witness');
  assert.equal(result[4].availability.finalUrl, undefined,
    'potentially private redirected query never becomes public catalog metadata');
  assert.equal(called.length, 10, '2 local + 1 foreign refusal + 4 loop limit + 1 final refusal + 2 query hops');
  assert.ok(called.every(url => new URL(url).hostname.endsWith('.561.group')));
  assert.ok(!JSON.stringify(result).includes('private-fixture'));
  assert.ok(!JSON.stringify(result).includes('synthetic-private-code'));

  assert.equal(closed, called.length);
});
