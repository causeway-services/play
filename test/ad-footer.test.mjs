import { readPublication } from './publication.mjs';
// Verifies the house ad footer slot (live integration with
// @red-cup-engineering/web-advertising-system-engineering-services-section, v0): a contextual-only
// client-fetched slot, no cookies, self-excluding for play-561-group, and
// never a remote script/stylesheet tag (honest-links stays satisfied).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

test('index.html carries a house ad footer slot, contextual-only, no cookies', async () => {
  const html = await readPublication('index.html');
  assert.match(html, /<div id="house-ad-footer" data-slot="footer" data-property="play-561-group"><\/div>/);
  assert.match(html, /base="https:\/\/ads\.561\.group"/);
  assert.match(html, /fetch\(base\+"\/ad\?slot="/);
  assert.match(html, /base\+"\/click\?slot="/);
  assert.ok(!/document\.cookie/.test(html), 'ad footer slot must not set cookies');
});

test('no script tag in index.html carries a remote src (ad footer script stays inline)', async () => {
  const html = await readPublication('index.html');
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of scriptTags) assert.ok(!/src="https?:/.test(tag), `script tag must not load remotely: ${tag}`);
});
