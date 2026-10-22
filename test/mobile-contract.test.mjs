import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublication } from './publication.mjs';
import { catalogCardBodyHtml } from '../js/catalog.mjs';
import { computeTodayModel } from '../js/today.mjs';

test('shelf and daily pages receive the source-owned TUFTE mobile stylesheet', async () => {
  const [index, today, touchStyles, ownStyles] = await Promise.all([
    readPublication('index.html'),
    readPublication('today.html'),
    readPublication('css/tufte-touch.css'),
    readPublication('css/style.css'),
  ]);
  for (const html of [index, today]) {
    assert.match(html, /content="width=device-width,initial-scale=1,viewport-fit=cover"/);
    assert.match(html, /href="css\/tufte-touch\.css"/);
    assert.ok(html.indexOf('css/tufte-touch.css') < html.indexOf('css/style.css'), 'consumer theme follows supplier geometry');
    assert.match(html, /class="tufte-grid"/);
    assert.match(html, /data-tufte-control href=/);
  }
  assert.match(touchStyles, /min-height:44px/);
  assert.match(touchStyles, /touch-action:manipulation/);
  assert.match(ownStyles, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(touchStyles + ownStyles, /user-scalable=no|touch-action:none/);
});

test('catalog touch action is a native link to the authored browser entry', () => {
  const entry = {
    id: 'test-game', displayName: 'Demo', status: 'playable', subdomain: 'demo',
    entryPoints: { browser: '/play' }, description: 'A sample', keywords: [],
    availability: { state: 'reachable' },
  };
  assert.match(catalogCardBodyHtml(entry), /<a class="play-link" data-tufte-control href="https:\/\/demo\.561\.group\/play"/);
});

test('daily strips keep a native touch action instead of click-only custom elements', async () => {
  const entries = [{ id: 'pig', displayName: 'Pig', status: 'playable', subdomain: 'parlor', entryPoints: { browser: '/pig/' }, seedPolicy: { kind: 'daily-utc' } }];
  const model = await computeTodayModel(new Date('2026-10-20T00:00:00Z'), entries);
  assert.equal(model.tiles.length, 1);
  assert.match(model.tiles[0].html, /<a class="play-link" data-tufte-control href=/);
});
