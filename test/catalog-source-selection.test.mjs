import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const GROUP = 'lib/fixture/services/561-group';
const WEB_GAMES = `${GROUP}/services/public-services-section/services/public-media-services-section/services/public-games-services-section/services/public-web-games-services-section`;
const SITES = `${WEB_GAMES}/sites`;
const FARSTONE = `${SITES}/farstone.561.group`;
const NAME = 'games/farstone';
const legacy = (name) => `${WEB_GAMES}/lib/legacy/restored-from-main/fixture/sites/${name}`;
const record = (id) => ({ id, displayName: id, subdomain: id, entryPoints: { browser: '/' }, cartridgeWrapped: false });

async function git(root, ...args) {
  return (await exec('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args])).stdout.trim();
}

async function commit(root) {
  await git(root, '-c', 'user.name=Catalog source fixture', '-c', 'user.email=catalog-fixture@example.invalid', 'commit', '-qm', 'synthetic catalog source');
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'catalog-source-selection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '-q');
  const play = path.join(root, SITES, 'play.561.group');
  // Copy the actual discovery implementation and its renderer imports. No game,
  // replay, publisher, provider, terminal client or network module is executed.
  for (const relative of ['src/discover-catalog.mjs', 'js/catalog.mjs', 'js/glyphs.mjs']) {
    await mkdir(path.dirname(path.join(play, relative)), { recursive: true });
    await copyFile(path.join(PACKAGE, relative), path.join(play, relative));
  }
  await git(root, 'add', '--all');
  await commit(root);
  let fetchCalls = 0;
  const { discoverCatalog } = await import(pathToFileURL(path.join(play, 'src/discover-catalog.mjs')).href);
  return {
    root,
    async record(home, value, { tracked = true } = {}) {
      const filename = path.join(root, home, 'catalog-entry.json');
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
      if (tracked) await git(root, 'add', '--', `${home}/catalog-entry.json`);
      return filename;
    },
    async discover() {
      const result = await discoverCatalog({ generatedDate: '2000-01-01', fetchImpl: () => { fetchCalls++; throw new Error('network forbidden in source-selection tests'); } });
      assert.equal(fetchCalls, 0, 'default discovery must not observe public endpoints');
      return result;
    },
    async child({ layout = 'absorbed', materialized = true, value = record('farstone'), pin } = {}) {
      const home = path.join(root, FARSTONE);
      await mkdir(home, { recursive: true });
      if (layout === 'absorbed') {
        const objectStore = path.join(root, '.git/modules', NAME);
        await mkdir(path.dirname(objectStore), { recursive: true });
        await git(home, 'init', '-q', '--separate-git-dir', objectStore);
      } else {
        await git(home, 'init', '-q');
      }
      await writeFile(path.join(home, 'README'), 'Synthetic child source; no game code.\n');
      if (value !== null) await writeFile(path.join(home, 'catalog-entry.json'), `${JSON.stringify(value)}\n`);
      await git(home, 'add', '--all');
      await commit(home);
      const sourceCommit = await git(home, 'rev-parse', 'HEAD');
      await writeFile(path.join(root, '.gitmodules'), `[submodule "${NAME}"]\n\tpath = ${FARSTONE}\n\turl = https://example.invalid/never-fetched.git\n`);
      await git(root, 'add', '.gitmodules');
      await git(root, 'update-index', '--add', '--cacheinfo', `160000,${pin ?? sourceCommit},${FARSTONE}`);
      await commit(root);
      if (!materialized) await rm(home, { recursive: true, force: true });
      return { home, sourceCommit };
    },
  };
}

test('current and future authored records remain discoverable, including external Science', async (t) => {
  const f = await fixture(t);
  await f.record(`${SITES}/new-game`, record('new-game'));
  await f.record(`${SITES}/legacy`, record('game-named-legacy'));
  await f.record(`${GROUP}/services/science-services-section/weiqi`, record('weiqi'));
  await f.record(`${SITES}/untracked-game`, record('untracked-game'), { tracked: false });
  const { catalog, json } = await f.discover();
  assert.deepEqual(new Set(catalog.games.map((game) => game.id)), new Set(['new-game', 'game-named-legacy', 'weiqi', 'untracked-game']));
  assert.equal(catalog.generated, '2000-01-01');
  assert.ok(catalog.games.every((game) => typeof game.repoPath === 'string'));
  assert.ok(JSON.parse(json).games.every((game) => !('repoPath' in game)));
});

test('retained history is excluded before JSON parsing or executable manifest imports', async (t) => {
  const f = await fixture(t);
  await f.record(`${SITES}/current`, record('current'));
  const malformed = await f.record(legacy('malformed'), '{this retained record is not JSON');
  const retired = await f.record(legacy('lantern'), { cartridgeManifest: 'must-not-load.mjs#manifest' });
  const retained = await readFile(retired, 'utf8');
  const { catalog } = await f.discover();
  assert.deepEqual(catalog.games.map((game) => game.id), ['current']);
  assert.equal(await readFile(malformed, 'utf8'), '{this retained record is not JSON');
  assert.equal(await readFile(retired, 'utf8'), retained, 'history is preserved, not deleted');
});

for (const materialized of [false, true]) {
  test(`pinned Farstone appears exactly once with ${materialized ? 'a materialized' : 'an unmaterialized'} absorbed child`, async (t) => {
    const f = await fixture(t);
    const retained = await f.record(legacy('farstone'), record('farstone'));
    await f.child({ materialized });
    const { catalog } = await f.discover();
    assert.equal(catalog.games.length, 1);
    assert.equal(catalog.games[0].id, 'farstone');
    assert.equal(catalog.games[0].repoPath, FARSTONE);
    assert.equal(JSON.parse(await readFile(retained, 'utf8')).id, 'farstone');
  });
}

test('materialized child with its own Git directory supplies the declared pin', async (t) => {
  const f = await fixture(t);
  await f.child({ layout: 'independent' });
  const { catalog } = await f.discover();
  assert.deepEqual(catalog.games.map((game) => game.id), ['farstone']);
  assert.equal(catalog.games[0].repoPath, FARSTONE);
});

test('dirty files and an advanced child HEAD cannot replace the pinned catalog', async (t) => {
  const f = await fixture(t);
  const { home } = await f.child();
  await writeFile(path.join(home, 'catalog-entry.json'), `${JSON.stringify(record('newer-head'))}\n`);
  await git(home, 'add', 'catalog-entry.json');
  await commit(home);
  await writeFile(path.join(home, 'catalog-entry.json'), `${JSON.stringify(record('dirty-worktree'))}\n`);
  const { catalog } = await f.discover();
  assert.deepEqual(catalog.games.map((game) => game.id), ['farstone']);
});

test('missing pinned objects fail without accepting the retained copy', async (t) => {
  const f = await fixture(t);
  await f.record(legacy('farstone'), record('farstone'));
  await f.child({ pin: 'f'.repeat(40) });
  await assert.rejects(f.discover(), /pinned source f{40} is unavailable/);
});

test('an empty child mount cannot fall back to the parent Git repository', async (t) => {
  const f = await fixture(t);
  const { home } = await f.child({ materialized: false });
  await rm(path.join(f.root, '.git/modules', NAME), { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  await assert.rejects(f.discover(), /materialized Git root is not the declared child/);
});

test('duplicate IDs from current sources still refuse the catalog', async (t) => {
  const f = await fixture(t);
  await f.record(`${SITES}/other-current`, record('farstone'));
  await f.child();
  await assert.rejects(f.discover(), /duplicate game id "farstone"/);
});

test('current malformed records and unfulfilled replay claims still fail', async (t) => {
  const f = await fixture(t);
  await f.record(`${SITES}/current`, '{not JSON');
  await assert.rejects(f.discover(), /invalid JSON/);
  await f.record(`${SITES}/current`, { ...record('current'), cartridgeWrapped: true });
  await assert.rejects(f.discover(), /cartridgeWrapped:true requires replayVerifier/);
});

test('a declared child with no pinned catalog preserves the existing no-entry behavior', async (t) => {
  const f = await fixture(t);
  await f.record(`${SITES}/current`, record('current'));
  await f.child({ value: null });
  const { catalog } = await f.discover();
  assert.deepEqual(catalog.games.map((game) => game.id), ['current']);
});

test('a game gitlink without source configuration still fails', async (t) => {
  const f = await fixture(t);
  await f.child();
  await writeFile(path.join(f.root, '.gitmodules'), '[submodule "different"]\n\tpath = unrelated\n');
  await assert.rejects(f.discover(), /has no source configuration/);
});

test('retained gitlinks do not require source configuration or pinned objects', async (t) => {
  const f = await fixture(t);
  await f.record(`${SITES}/current`, record('current'));
  const retainedChild = `${SITES}/old-container/lib/legacy/retired-child`;
  await git(f.root, 'update-index', '--add', '--cacheinfo', `160000,${'f'.repeat(40)},${retainedChild}`);
  await commit(f.root);
  const { catalog } = await f.discover();
  assert.deepEqual(catalog.games.map((game) => game.id), ['current']);
});
