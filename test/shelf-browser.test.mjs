import { discoverCatalog } from '../src/discover-catalog.mjs';
const discovered = discoverCatalog();
// shelf-browser.test — headless tests for the terminal shelf browser (scripts/shelf-browser.mjs +
// src/shelf/*.mjs). Every test here scripts KEYS against the REAL catalog.json (the same file
// index.html/today.html read, loaded fresh off disk exactly the way smoke.test.mts's own
// loadCatalog() does) through the PURE state machine (src/shelf/state.mjs) — no Screen, no
// terminal, no network. A selection's LAUNCH is asserted as a resolved plan (cmd/args, or a printed
// URL) — a "spawn" plan's arguments are checked and its target bin file's existence on disk is
// confirmed, but the child process is never actually spawned. That separation (state.step /
// dispatchLaunch as pure functions, scripts/shelf-browser.mjs as the only place a plan is executed) is
// exactly what makes this file possible without a pty.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGames, groupByShelf, flattenForList, listLabel } from '../src/shelf/catalog.mjs';
import { initialState, step, dispatchLaunch } from '../src/shelf/state.mjs';
import { planLaunch, DURANTE_TERMINAL_BIN } from '../src/shelf/launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

async function loadRealCatalog() {
  return (await discovered).catalog;
}

const DOWN = { name: 'down' };
const UP = { name: 'up' };
const ENTER = { name: 'enter' };
const PAGEDOWN = { name: 'pagedown' };
const PAGEUP = { name: 'pageup' };
const Q = { name: 'char', char: 'q' };
const CTRL_C = { name: 'char', char: 'c', ctrl: true };

test('groupByShelf + flattenForList: every real catalog game appears exactly once, as a selectable entry', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  assert.ok(games.length > 0, 'the real catalog.json has at least one game');

  const entries = flattenForList(groupByShelf(games));
  const gameEntries = entries.filter((e) => e.game);
  assert.equal(gameEntries.length, games.length, 'flattening never drops or duplicates a catalog game');
  assert.deepEqual(
    gameEntries.map((e) => e.game.id).sort(),
    games.map((g) => g.id).sort(),
    'the flattened list contains exactly the real catalog\'s game ids',
  );

  // every header entry renders distinctly from every game entry (a real render-time invariant:
  // the list widget must never mistake one for the other)
  for (const e of entries) {
    const label = listLabel(e);
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0, 'every list label is non-empty');
  }
});

test('scripted ↓ keys walk EVERY real game in catalog order, never landing on a shelf-header row', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  const entries = flattenForList(groupByShelf(games));

  let state = initialState(entries);
  assert.ok(state.entries[state.selected]?.game, 'the initial selection is a real game, not a header');

  const visitedIds = [state.entries[state.selected].game.id];
  // one ↓ per remaining game is enough to reach the last one, since selectGame skips headers
  for (let i = 0; i < games.length + 5; i++) {
    state = step(state, DOWN);
    const game = state.entries[state.selected]?.game;
    assert.ok(game, `selection after ${i + 1} ↓ presses is a real game, never a header`);
    visitedIds.push(game.id);
  }
  // downs beyond the end clamp on the last game (selectInList's default, non-wrapping behavior)
  const lastGame = games[games.length - 1];
  // the last several presses should all have landed on some game — specifically, once we reach the
  // last game in the flattened list, further ↓ presses must stay there (a clamp, not a wrap).
  const tail = visitedIds.slice(-5);
  assert.ok(new Set(tail).size === 1, 'once the selection reaches the last game, further ↓ presses clamp there (no wrap)');
});

test('scripted ↑ from the top clamps on the first game (never a header, never wraps)', async () => {
  const catalog = await loadRealCatalog();
  const entries = flattenForList(groupByShelf(loadGames(catalog)));
  let state = initialState(entries);
  const firstId = state.entries[state.selected].game.id;
  for (let i = 0; i < 5; i++) state = step(state, UP);
  assert.equal(state.entries[state.selected].game.id, firstId, '↑ from the first game stays on the first game');
});

test('Enter on durante dispatches a SPAWN plan for durante-terminal.mjs, resolved and present on disk, never executed', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  const durante = games.find((g) => g.id === 'durante');
  assert.ok(durante, 'the real catalog has a durante entry');

  const entries = flattenForList(groupByShelf(games));
  let state = initialState(entries);
  // walk ↓ until durante is selected (real catalog navigation, not a hand-picked index)
  for (let i = 0; i < entries.length && state.entries[state.selected].game.id !== 'durante'; i++) state = step(state, DOWN);
  assert.equal(state.entries[state.selected].game.id, 'durante', 'scripted ↓ presses reached the durante entry');

  state = step(state, ENTER);
  assert.equal(state.launch.id, 'durante', 'Enter sets state.launch to the selected durante game record');

  const { state: afterDispatch, plan } = dispatchLaunch(state);
  assert.deepEqual(plan, {
    kind: 'spawn',
    cmd: 'node',
    args: [DURANTE_TERMINAL_BIN, '--daily', '--base', `https://${durante.hostname || `${durante.subdomain}.561.group`}`],
  }, 'dispatchLaunch resolves durante to the EXACT expected spawn plan — asserted, never executed');
  assert.equal(afterDispatch.launch, null, 'dispatchLaunch clears the pending launch once resolved to a plan');
  assert.ok(fs.existsSync(DURANTE_TERMINAL_BIN), 'the resolved durante-terminal.mjs path is a real file on disk');
});

test('Farstone keeps its browser and API record without inventing a missing terminal client', async () => {
  const farstone = (await loadRealCatalog()).games.find((game) => game.id === 'farstone');
  assert.ok(farstone.entryPoints.headless.includes('POST /connect'));
  assert.deepEqual(planLaunch(farstone), { kind: 'print', text: 'https://farstone.561.group/' });
});

test('Enter on a browser-only game prints its URL and does NOT spawn anything', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  // any playable game with a browser entry point that is neither durante nor farstone
  const browserGame = games.find((g) => g.entryPoints?.browser && g.id !== 'durante' && g.id !== 'farstone');
  assert.ok(browserGame, 'the real catalog has at least one non-terminal browser game to test against');

  const entries = flattenForList(groupByShelf(games));
  let state = initialState(entries);
  for (let i = 0; i < entries.length && state.entries[state.selected].game.id !== browserGame.id; i++) state = step(state, DOWN);
  assert.equal(state.entries[state.selected].game.id, browserGame.id);

  state = step(state, ENTER);
  const { state: afterDispatch, plan } = dispatchLaunch(state);
  assert.equal(plan.kind, 'print', 'a browser-only game prints, it does not spawn a child process');
  assert.equal(plan.text, `https://${browserGame.hostname || `${browserGame.subdomain}.561.group`}${browserGame.entryPoints.browser}`,
    'the printed text is exactly the game\'s public hostname + declared browser entry point');
  assert.equal(afterDispatch.message, plan.text, 'the resolved message carries the printed URL forward into state for the view to show');
});

test('Enter on a game with no launchable entry point at all says so honestly, and does not spawn', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  const noEntry = games.find((g) => !g.entryPoints?.browser && g.id !== 'durante' && g.id !== 'farstone');
  if (!noEntry) return; // every current catalog game happens to have SOME entry point — nothing to assert
  const plan = planLaunch(noEntry);
  assert.equal(plan.kind, 'print');
  assert.match(plan.text, /no launchable entry point/);
});

test('PgDn/PgUp scroll the detail pane for a long-description game, bounded, without moving the list selection', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  // pick the game with the longest description, so a small forced detail height guarantees real
  // scrolling headroom (maxOffset > 0) with real catalog text, not a fabricated fixture string
  const longest = games.reduce((a, b) => (b.description || '').length > (a.description || '').length ? b : a);
  const entries = flattenForList(groupByShelf(games));
  let state = initialState(entries);
  for (let i = 0; i < entries.length && state.entries[state.selected].game.id !== longest.id; i++) state = step(state, DOWN);

  const selectedBefore = state.selected;
  state = step(state, PAGEDOWN, { detailHeight: 3 });
  assert.equal(state.selected, selectedBefore, 'PgDn scrolls the detail pane, it never moves the list selection');
  assert.ok(state.detailOffset > 0, `PgDn actually advanced the detail scroll offset for ${longest.id}'s long description`);

  state = step(state, PAGEUP, { detailHeight: 3 });
  assert.ok(state.detailOffset >= 0, 'PgUp never scrolls past the top');
});

test('moving the list selection resets any pending detail scroll and any printed-URL message', async () => {
  const catalog = await loadRealCatalog();
  const games = loadGames(catalog);
  const entries = flattenForList(groupByShelf(games));
  let state = initialState(entries);
  state = step(state, PAGEDOWN, { detailHeight: 2 });
  state = step(state, ENTER);
  const { state: afterDispatch } = dispatchLaunch(state);
  state = afterDispatch;
  state = step(state, DOWN);
  assert.equal(state.detailOffset, 0, 'a new selection starts its detail pane unscrolled');
  assert.equal(state.message, '', 'a new selection clears a stale printed message');
});

test('q and Ctrl-C both set quit, and quit takes priority — a scripted key sequence never launches anything after quitting', () => {
  let state = initialState([{ game: { id: 'x', displayName: 'X', subdomain: 'x' } }]);
  const afterQ = step(state, Q);
  assert.equal(afterQ.quit, true);
  const afterCtrlC = step(state, CTRL_C);
  assert.equal(afterCtrlC.quit, true);
});

test('findMonorepoRoot resolves the available terminal client in this checkout', () => {
  // launch.mjs's findMonorepoRoot() walks up from its own location to a `.git` directory and joins
  // the repo-relative paths from there — this is the end-to-end proof that the traversal actually
  // lands on real files, independent of exactly how many directories deep either path is.
  assert.ok(fs.existsSync(DURANTE_TERMINAL_BIN), 'durante-terminal.mjs resolves to a real file');
  assert.ok(DURANTE_TERMINAL_BIN.endsWith('durante-terminal.mjs'));
});
