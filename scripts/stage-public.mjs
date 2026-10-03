#!/usr/bin/env node
/**
 * stage-public.mjs -- copies exactly the browser-facing files into ./public, the only
 * directory wrangler.jsonc serves. Everything else in this directory (build scripts,
 * tests, README, config) stays private by construction instead of by an ignore list.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');

// The import map in index.html/today.html resolves this one bare specifier to a vendored copy.
const VENDORED = 'node_modules/@red-cup-engineering/gaming/src/running/seed.mjs';
const FILES = ['index.html', 'today.html', 'catalog.json', 'css', 'js', 'chrome/shelf-chrome.css', VENDORED];

export async function stagePublic() {
  await rm(OUT, { recursive: true, force: true });
  for (const rel of FILES) {
    const target = path.join(OUT, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(ROOT, rel), target, { recursive: true, dereference: true });
  }
  process.stdout.write(`stage-public.mjs: staged ${FILES.length} entries into public/\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await stagePublic();
}
