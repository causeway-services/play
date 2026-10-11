import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { discoverCatalog } from '../src/discover-catalog.mjs';
import { bindShelfProjector, catalogSourcesFromEnvironment, publicationDateFromEnvironment } from '../src/composition.mjs';
import { loadShelfCatalog } from '../src/shelf/load-catalog.mjs';
import { planLaunch } from '../src/shelf/launch.mjs';
import { publicationPageStatus } from '../js/catalog.mjs';

const exec = promisify(execFile);
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const record = (id) => ({ id, displayName: id, hostname: `${id}.example.invalid`, entryPoints: { browser: '/' }, cartridgeWrapped: false });
const git = async (root, ...args) => (await exec('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args])).stdout.trim();
const commit = async (root) => git(root, '-c', 'user.name=Composition fixture', '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'synthetic source');
const blob = (raw) => createHash('sha1').update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest('hex');

async function workspace(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'portable-play-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = async (name, id) => {
    const root = path.join(base, name);
    await mkdir(path.join(root, 'games'), { recursive: true });
    await git(root, 'init', '-q');
    await writeFile(path.join(root, 'README'), 'Synthetic source, no runtime modules.\n');
    if (id) await writeFile(path.join(root, 'games/catalog-entry.json'), `${JSON.stringify(record(id))}\n`);
    await git(root, 'add', '--all');
    await commit(root);
    return { repository: `fixture/${name}`, repositoryRoot: root, catalogRoots: ['games'], gameSiteRoots: [] };
  };
  return { base, source };
}

test('portable package exports import without an integrated machine path; omitted composition refuses', async (t) => {
  const { base } = await workspace(t);
  await mkdir(path.join(base, 'node_modules/@causeway-services'), { recursive: true });
  await symlink(PACKAGE, path.join(base, 'node_modules/@causeway-services/play'), 'dir');
  const consumer = path.join(base, 'consumer.mjs');
  await writeFile(consumer, "export { discoverCatalog } from '@causeway-services/play/catalog';\nexport { playUrl } from '@causeway-services/play/catalog-presentation';\n");
  const api = await import(pathToFileURL(consumer).href);
  assert.equal(typeof api.discoverCatalog, 'function');
  assert.equal(api.playUrl(record('game')), 'https://game.example.invalid/');
  await assert.rejects(api.discoverCatalog(), /catalog sources are required/);
  await assert.rejects(api.discoverCatalog({ sources: [] }), /nonempty array/);
});

test('separate Public Games and external Science inputs compose without losing provenance', async (t) => {
  const { source } = await workspace(t);
  const publicGames = await source('public-media', 'public-game');
  const science = await source('science', 'weiqi');
  let fetches = 0;
  const { catalog, json } = await discoverCatalog({ sources: [publicGames, science], generatedDate: '2000-01-01', fetchImpl: () => { fetches++; throw new Error('network forbidden'); } });
  assert.equal(fetches, 0);
  assert.deepEqual(new Set(catalog.games.map((game) => game.id)), new Set(['public-game', 'weiqi']));
  for (const binding of [publicGames, science]) {
    const game = catalog.games.find((entry) => entry.catalogSource.repository === binding.repository);
    assert.equal(game.repoPath, 'games');
    assert.equal(game.catalogSource.repositoryHead, await git(binding.repositoryRoot, 'rev-parse', 'HEAD'));
    assert.equal('pinnedCommit' in game.catalogSource, false, 'worktree read does not claim immutable commit bytes');
    assert.equal(game.catalogSource.readFrom, 'worktree');
    assert.equal(game.catalogSource.blob, blob(await readFile(path.join(binding.repositoryRoot, 'games/catalog-entry.json'), 'utf8')));
  }
  assert.ok(JSON.parse(json).games.every((game) => !('repoPath' in game) && !('catalogSource' in game)));
  const noNulls = (value) => {
    assert.notEqual(value, null, 'internal provenance also preserves the authored no-null contract');
    if (typeof value === 'object') for (const child of Object.values(value)) noNulls(child);
  };
  noNulls(catalog);
});

test('a declared missing or empty external source refuses instead of silently narrowing the catalog', async (t) => {
  const { source } = await workspace(t);
  const publicGames = await source('public-media', 'public-game');
  const science = await source('science');
  await assert.rejects(discoverCatalog({ sources: [publicGames, science] }), /catalog source has no authored records: fixture\/science/);
  await assert.rejects(discoverCatalog({ sources: [publicGames, { ...science, catalogRoots: ['missing'] }] }), /ENOENT/);
});

test('source roots are exact local Git roots with bounded explicit directory inputs', async (t) => {
  const { source, base } = await workspace(t);
  const binding = await source('public-media', 'game');
  await mkdir(path.join(base, 'outside'));
  await assert.rejects(discoverCatalog({ sources: [{ ...binding, repositoryRoot: path.join(binding.repositoryRoot, 'games') }] }), /exact Git checkout root/);
  await assert.rejects(discoverCatalog({ sources: [{ ...binding, catalogRoots: ['../outside'] }] }), /escapes its repository/);
  await assert.rejects(discoverCatalog({ sources: [{ ...binding, catalogRoots: [binding.repositoryRoot] }] }), /relative directory/);
  await assert.rejects(discoverCatalog({ sources: [{ ...binding, gameSiteRoots: undefined }] }), /gameSiteRoots must be an array/);
  await assert.rejects(discoverCatalog({ sources: [{ ...binding, repository: null }] }), /identity must be a nonempty string/);
});

test('a catalog-entry file symlink cannot attribute outside bytes to the declared source', async (t) => {
  const { source, base } = await workspace(t);
  const binding = await source('public-media', 'current');
  const outside = path.join(base, 'outside.json');
  await writeFile(outside, JSON.stringify(record('outside-custody')));
  await mkdir(path.join(binding.repositoryRoot, 'games/alias'));
  await symlink(outside, path.join(binding.repositoryRoot, 'games/alias/catalog-entry.json'));
  await git(binding.repositoryRoot, 'add', 'games/alias/catalog-entry.json');
  await assert.rejects(discoverCatalog({ sources: [binding] }), /catalog source record must be a regular file/);
});

test('a redirected ancestor cannot read a catalog outside its declared roots', async (t) => {
  const { source, base } = await workspace(t);
  const binding = await source('public-media', 'current');
  const directory = path.join(binding.repositoryRoot, 'games/redirected');
  await mkdir(directory);
  await writeFile(path.join(directory, 'catalog-entry.json'), JSON.stringify(record('original')));
  await git(binding.repositoryRoot, 'add', 'games/redirected/catalog-entry.json');
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'catalog-entry.json'), JSON.stringify(record('outside-custody')));
  await rm(directory, { recursive: true });
  await symlink(outside, directory, 'dir');
  await assert.rejects(discoverCatalog({ sources: [binding] }), /catalog source record escapes its declared roots/);
});

test('literal catalog root metacharacters cannot select a sibling decoy', async (t) => {
  const { source } = await workspace(t);
  const binding = await source('public-media');
  for (const name of ['games[2]', 'games2']) {
    await mkdir(path.join(binding.repositoryRoot, name));
    await writeFile(path.join(binding.repositoryRoot, name, 'catalog-entry.json'), JSON.stringify(record(name)));
  }
  const { catalog } = await discoverCatalog({ sources: [{ ...binding, catalogRoots: ['games[2]'] }] });
  assert.deepEqual(catalog.games.map((game) => game.id), ['games[2]']);
});

test('a listed but missing record refuses partial source; staged deletion remains intentional', async (t) => {
  const { source } = await workspace(t);
  const binding = await source('public-media', 'survivor');
  const relative = 'games/missing/catalog-entry.json';
  await mkdir(path.join(binding.repositoryRoot, 'games/missing'));
  await writeFile(path.join(binding.repositoryRoot, relative), JSON.stringify(record('missing')));
  await git(binding.repositoryRoot, 'add', relative);
  await rm(path.join(binding.repositoryRoot, relative));
  await assert.rejects(discoverCatalog({ sources: [binding] }), /catalog source record is missing/);
  await git(binding.repositoryRoot, 'rm', '--cached', relative);
  assert.deepEqual((await discoverCatalog({ sources: [binding] })).catalog.games.map((game) => game.id), ['survivor']);
});

test('new records are selected only from declared roots; history and unrelated roots stay out', async (t) => {
  const { source } = await workspace(t);
  const binding = await source('public-media', 'current');
  for (const [directory, value] of [['games/new-game', record('future-game')], ['games/lib/legacy/retired', '{bad historical JSON'], ['unrelated', record('outside-binding')]]) {
    await mkdir(path.join(binding.repositoryRoot, directory), { recursive: true });
    await writeFile(path.join(binding.repositoryRoot, directory, 'catalog-entry.json'), typeof value === 'string' ? value : JSON.stringify(value));
  }
  const { catalog } = await discoverCatalog({ sources: [binding] });
  assert.deepEqual(new Set(catalog.games.map((game) => game.id)), new Set(['current', 'future-game']));
});

for (const materialized of [true, false]) {
  test(`portable pinned game source works with ${materialized ? 'materialized' : 'unmaterialized'} child`, async (t) => {
    const { source } = await workspace(t);
    const binding = await source('public-media');
    const root = materialized ? 'games[2]' : 'games';
    binding.catalogRoots = [root];
    binding.gameSiteRoots = materialized ? [root] : ['.'];
    const relativeHome = `${root}/farstone`;
    const home = path.join(binding.repositoryRoot, relativeHome);
    const store = path.join(binding.repositoryRoot, '.git/modules/farstone');
    await mkdir(home, { recursive: true });
    await mkdir(path.dirname(store), { recursive: true });
    await git(home, 'init', '-q', '--separate-git-dir', store);
    const raw = `${JSON.stringify(record('farstone'))}\n`;
    await writeFile(path.join(home, 'catalog-entry.json'), raw);
    await git(home, 'add', '--all');
    await commit(home);
    const pin = await git(home, 'rev-parse', 'HEAD');
    await writeFile(path.join(binding.repositoryRoot, '.gitmodules'), `[submodule "farstone"]\n\tpath = ${relativeHome}\n\turl = https://example.invalid/never-fetched.git\n`);
    await git(binding.repositoryRoot, 'add', '.gitmodules');
    await git(binding.repositoryRoot, 'update-index', '--add', '--cacheinfo', `160000,${pin},${relativeHome}`);
    if (materialized) await git(binding.repositoryRoot, 'update-index', '--add', '--cacheinfo', `160000,${'f'.repeat(40)},games2/decoy`);
    await commit(binding.repositoryRoot);
    if (!materialized) await rm(home, { recursive: true, force: true });
    else await writeFile(path.join(home, 'catalog-entry.json'), '{unreceived dirty data');
    const { catalog } = await discoverCatalog({ sources: [binding] });
    assert.equal(catalog.games.length, 1);
    assert.equal(catalog.games[0].id, 'farstone');
    assert.equal(catalog.games[0].catalogSource.pinnedCommit, pin);
    assert.equal(catalog.games[0].catalogSource.blob, blob(raw));
    assert.equal(catalog.games[0].catalogSource.readFrom, 'git-object');
  });
}

test('duplicate IDs across provider inputs and unfulfilled replay claims retain refusal', async (t) => {
  const { source } = await workspace(t);
  const one = await source('one', 'duplicate');
  const two = await source('two', 'duplicate');
  await assert.rejects(discoverCatalog({ sources: [one, two] }), /duplicate game id/);
  await writeFile(path.join(one.repositoryRoot, 'games/catalog-entry.json'), JSON.stringify({ ...record('wrapped'), cartridgeWrapped: true }));
  await assert.rejects(discoverCatalog({ sources: [one] }), /requires replayVerifier/);
});

test('publication consumer binds explicit sources/date and defaults to no page observation', async () => {
  const sources = [{ repositoryRoot: '/received/source', catalogRoots: ['games'], gameSiteRoots: [] }];
  const date = new Date('2000-01-01T00:00:00.000Z');
  let received;
  const artifacts = { artifacts: [] };
  const projector = bindShelfProjector(async (options) => { received = options; return artifacts; }, { sources, date });
  assert.equal(await projector.project(), artifacts);
  assert.deepEqual(received, { sources, date, observePages: false });
  assert.throws(() => bindShelfProjector(() => {}, { observePages: 'true' }), /must be boolean/);
  const publication = await readFile(path.join(PACKAGE, 'src/publication.mjs'), 'utf8');
  assert.match(publication, /publishShelf\(\{ sources, observePages = false,/);
  assert.match(publication, /discoverCatalog\(\{ sources,/);
});

test('page observation requires a boolean before source reads, with explicit true using only a fake receiver', async (t) => {
  let fetches = 0;
  const fetchImpl = async () => { fetches++; return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }) }; };
  for (const observePages of ['false', null, 0]) {
    await assert.rejects(discoverCatalog({ observePages, fetchImpl }), /observePages must be boolean/);
  }
  assert.equal(fetches, 0);
  const { source } = await workspace(t);
  const binding = await source('public-media', 'observed');
  const { catalog } = await discoverCatalog({ sources: [binding], observePages: true, fetchImpl, checkedAt: '2000-01-01T00:00:00.000Z' });
  assert.equal(fetches, 1);
  assert.equal(catalog.games[0].availability.state, 'reachable');
  assert.equal(catalog.games[0].availability.checkedAt, '2000-01-01T00:00:00.000Z');
});

test('offline publication reports not-checked separately from actual unavailable observations', async () => {
  assert.match(publicationPageStatus(record('unchecked')), /not checked/);
  assert.match(publicationPageStatus({ availability: { state: 'reachable' } }), /reached/);
  assert.match(publicationPageStatus({ availability: { state: 'unavailable' } }), /unavailable/);
  const today = await readFile(path.join(PACKAGE, 'js/today.mjs'), 'utf8');
  assert.match(today, /pageStatus = publicationPageStatus\(strip.game\)/);
});

test('invocation inputs reject empty source declarations and invalid reproducibility dates', () => {
  assert.equal(catalogSourcesFromEnvironment({}), undefined);
  assert.throws(() => catalogSourcesFromEnvironment({ PLAY_CATALOG_SOURCES: '[]' }), /nonempty source array/);
  assert.throws(() => catalogSourcesFromEnvironment({ PLAY_CATALOG_SOURCES: '{bad' }), SyntaxError);
  assert.equal(publicationDateFromEnvironment({ PLAY_CATALOG_DATE: '2000-02-29' }).toISOString(), '2000-02-29T00:00:00.000Z');
  assert.throws(() => publicationDateFromEnvironment({ PLAY_CATALOG_DATE: '2001-02-29' }), /real UTC date/);
});

test('terminal catalog defaults to local inputs; remote access requires an explicit URL', async (t) => {
  const { source } = await workspace(t);
  const binding = await source('public-media', 'local');
  let fetches = 0;
  const fetchImpl = async () => { fetches++; return { ok: true, json: async () => ({ games: [record('remote')] }) }; };
  assert.equal((await loadShelfCatalog({ sources: [binding], fetchImpl })).games[0].id, 'local');
  assert.equal(fetches, 0);
  assert.equal((await loadShelfCatalog({ sources: [binding], catalogUrl: 'https://example.invalid/catalog.json', fetchImpl })).games[0].id, 'remote');
  assert.equal(fetches, 1, 'fake provider only; no real HTTP request');
  const fallback = await loadShelfCatalog({ sources: [binding], catalogUrl: 'https://example.invalid/catalog.json', fetchImpl: async () => ({ ok: false }) });
  assert.equal(fallback.games[0].id, 'local', 'explicit remote failure preserves the local-source fallback');
});

test('terminal launch accepts a received executable path without spawning or losing browser/API access', async (t) => {
  const { base } = await workspace(t);
  const bin = path.join(base, 'durante-terminal.mjs');
  await writeFile(bin, 'throw new Error("must not execute");\n');
  const durante = record('durante');
  assert.deepEqual(planLaunch(durante), { kind: 'print', text: 'https://durante.example.invalid/' }, 'standalone import does not invent a terminal location');
  assert.deepEqual(planLaunch(durante, { duranteTerminalBin: bin }), { kind: 'spawn', cmd: 'node', args: [bin, '--daily', '--base', 'https://durante.example.invalid'] });
  assert.deepEqual(planLaunch(durante, { duranteTerminalBin: null }), { kind: 'print', text: 'https://durante.example.invalid/' });
  assert.throws(() => planLaunch(durante, { duranteTerminalBin: 'relative.mjs' }), /absolute file path/);
  assert.deepEqual(planLaunch(record('farstone'), { duranteTerminalBin: bin }), { kind: 'print', text: 'https://farstone.example.invalid/' });
  assert.ok((await readFile(path.join(PACKAGE, 'chrome/shelf-chrome.css'), 'utf8')).length > 0);
});
