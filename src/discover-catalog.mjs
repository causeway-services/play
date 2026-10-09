import { readFile, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { playUrl, hasBrowser } from '../js/catalog.mjs';

/** Observe an HTML entry page; HTTP success is not a game-operation proof. */
export async function observeBrowserPages(games, { fetchImpl = fetch, checkedAt = new Date().toISOString() } = {}) {
  let next = 0;
  const observations = new Array(games.length);
  await Promise.all(Array.from({ length: Math.min(6, games.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= games.length) return;
      const game = games[index];
      if (!hasBrowser(game)) { observations[index] = game; continue; }
      const url = playUrl(game);
      let availability;
      try {
        const response = await fetchImpl(url, {
          headers: { accept: 'text/html', 'user-agent': '561-Group-Shelf/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        const html = /^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '');
        availability = { state: response.ok && html ? 'reachable' : 'unavailable', url, checkedAt, httpStatus: response.status };
        if (response.url && response.url !== url) availability.finalUrl = response.url;
        await response.body?.cancel();
      } catch {
        availability = { state: 'unavailable', url, checkedAt, reason: 'request-failed' };
      }
      observations[index] = { ...game, availability };
    }
  }));
  return observations;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));


// The monorepo root that the catalog's repoPath values are written relative to, and the Group's
// own directory beneath it. Found by locating the Group's directory in this file's own path
// rather than counting ".." segments, so it survives this site itself moving to a new depth.
const SEP = path.sep.replace(/[\\]/gu, '\\$&');
const GROUP_MARKER = new RegExp(`${SEP}lib${SEP}[^${SEP}]+${SEP}services${SEP}561-group${SEP}`, 'u');
const marker = GROUP_MARKER.exec(HERE);
if (marker === null) {
  throw new Error(`could not locate the Group's directory under lib/ in ${HERE} to determine the monorepo root`);
}
const REPO_ROOT = HERE.slice(0, marker.index);
const GROUP_ROOT = HERE.slice(0, marker.index + marker[0].length);

const GAME_SITE_ROOT = path.join(
  GROUP_ROOT,
  'services/public-services-section/services/public-media-services-section/services/public-games-services-section/services/public-web-games-services-section/sites',
);

const MANIFEST_FILENAME = 'catalog-entry.json';
// `dist` is a reproducible Worker-asset publication, not another game home.
// Searching it would let a stale published copy shadow or duplicate the
// authored manifest that the generator is meant to project.
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'test', 'tests', 'dist']);

// Display order for today's known games. A manifest for a game not listed
// here still gets collected and included -- it's appended after these,
// alphabetically by id -- so a brand-new game shows up the moment it grows a
// catalog-entry.json, with no edit required here. Add an id to this list only
// to curate *where on the shelf* it should sit.
const ORDER = [
  'solitaire',
  'gambling-trainer',
  'flickering-delve',
  'onestone',
  'crucible',
  'stoke',
  'lantern',
  'weiqi',
  'ruinfold',
  'durante',
  'farstone',
  'aletheon',
];

// A public game can be authored in a pinned submodule. Read its actual Git
// object when this checkout has not materialized it; never substitute an old
// generated catalog, or silently lose the game because its directory is empty.
const git = promisify(execFile);
async function pinnedGameRecords() {
  const run = async (args) => (await git('git', ['-C', REPO_ROOT, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
  const relativeRoot = path.relative(REPO_ROOT, GAME_SITE_ROOT);
  const links = (await run(['ls-tree', '-r', 'HEAD', '--', relativeRoot])).split('\n').filter((line) => line.startsWith('160000 '));
  if (!links.length) return [];
  const configuration = await run(['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']);
  const names = new Map(configuration.split('\n').map((line) => {
    const [, name, location] = /^submodule\.(.+)\.path (.+)$/.exec(line);
    return [location, name];
  }));
  const common = path.resolve(REPO_ROOT, await run(['rev-parse', '--git-common-dir']));
  const records = [];
  for (const link of links) {
    const [, commit, location] = /^160000 commit ([a-f0-9]+)\t(.+)$/.exec(link);
    const homeDir = path.join(REPO_ROOT, location);
    try { await access(path.join(homeDir, MANIFEST_FILENAME)); continue; } catch {}
    const name = names.get(location);
    if (!name) throw new Error(`submodule ${location} has no source configuration`);
    const moduleDir = path.join(common, 'modules', name);
    const moduleGit = async (...args) => (await git('git', ['--git-dir', moduleDir, ...args], { maxBuffer: 1024 * 1024 })).stdout;
    // Missing pinned objects are a missing source, not evidence that the game vanished.
    const manifest = await moduleGit('ls-tree', '--name-only', commit, '--', MANIFEST_FILENAME);
    if (!manifest.trim()) continue;
    records.push({ homeDir, raw: await moduleGit('show', `${commit}:${MANIFEST_FILENAME}`) });
  }
  return records;
}

/** Splits "relative/path.mts#exportName" into its two halves. */
function splitRef(ref) {
  const hashIndex = ref.lastIndexOf('#');
  if (hashIndex === -1) return { filePart: ref, exportName: undefined };
  return { filePart: ref.slice(0, hashIndex), exportName: ref.slice(hashIndex + 1) };
}

/** Projects an executable cartridge manifest into a shelf entry.  This keeps
 * game identity, state-transition contract, and replay verifier in one
 * place.  A sidecar may add storefront metadata, but may not shadow a field
 * the executable manifest already owns. */
async function materializeCartridgeManifest(entry, homeDir) {
  if (!entry.cartridgeManifest) return { entry, verificationHomeDir: homeDir };
  if (typeof entry.cartridgeManifest !== 'string') {
    throw new Error(`${homeDir}: cartridgeManifest must be a string reference`);
  }

  const { filePart, exportName } = splitRef(entry.cartridgeManifest);
  if (!filePart || !exportName) {
    throw new Error(`${homeDir}: cartridgeManifest must be "file#namedExport"`);
  }
  const verificationHomeDir = entry.cartridgeHome
    ? path.resolve(homeDir, entry.cartridgeHome)
    : homeDir;
  if (entry.cartridgeHome !== undefined && typeof entry.cartridgeHome !== 'string') {
    throw new Error(`${homeDir}: cartridgeHome must be a relative directory path`);
  }
  const absPath = path.join(verificationHomeDir, filePart);
  let mod;
  try {
    await stat(absPath);
    mod = await import(pathToFileURL(absPath).href);
  } catch (err) {
    throw new Error(`${homeDir}: cartridgeManifest failed to load (${filePart}): ${err.message}`);
  }
  const cartridge = mod[exportName];
  if (!cartridge || typeof cartridge !== 'object' || Array.isArray(cartridge)) {
    throw new Error(`${homeDir}: cartridgeManifest export "${exportName}" is not an object`);
  }

  const { cartridgeManifest, cartridgeHome, ...storefront } = entry;
  const shadowedFields = Object.keys(storefront).filter((field) => field in cartridge);
  if (shadowedFields.length > 0) {
    throw new Error(`${cartridge.id ?? homeDir}: catalog sidecar shadows executable manifest field(s): ${shadowedFields.join(', ')}`);
  }
  return {
    entry: { ...cartridge, ...storefront, cartridgeWrapped: true },
    verificationHomeDir,
  };
}

/** Verifies a cartridgeWrapped:true entry's claims actually resolve against
 *  the tree, rather than trusting the manifest's own say-so. Throws with a
 *  clear, specific message on any failure -- a manifest that overclaims must
 *  fail the build, not silently ship a catalog that lies. */
async function verifyEntry(entry, homeDir) {
  if (entry.cartridgeWrapped !== true) return;

  if (!entry.replayVerifier) {
    throw new Error(`${entry.id}: cartridgeWrapped:true requires replayVerifier`);
  }
  const { filePart, exportName } = splitRef(entry.replayVerifier);
  const moduleUrl = filePart.startsWith('@')
    ? import.meta.resolve(filePart)
    : pathToFileURL(path.join(homeDir, filePart)).href;
  try {
    await stat(fileURLToPath(moduleUrl));
  } catch {
    throw new Error(`${entry.id}: replayVerifier module does not exist: ${filePart}`);
  }

  if (exportName) {
    let mod;
    try {
      mod = await import(moduleUrl);
    } catch (err) {
      throw new Error(`${entry.id}: replayVerifier file failed to import (${filePart}): ${err.message}`);
    }
    if (typeof mod[exportName] !== 'function') {
      throw new Error(`${entry.id}: replayVerifier's named export "${exportName}" is not a function in ${filePart}`);
    }
  }

  // schemaRef, when present, usually names a TypeScript *type* export, which
  // has no runtime existence to import-check -- so this only verifies the
  // file itself exists, not the named export. That's a known, weaker
  // guarantee than the replayVerifier check above.
  if (entry.intentLog?.schemaRef) {
    const { filePart: schemaFile } = splitRef(entry.intentLog.schemaRef);
    const schemaAbsPath = path.join(homeDir, schemaFile);
    try {
      await stat(schemaAbsPath);
    } catch {
      throw new Error(`${entry.id}: intentLog.schemaRef file does not exist: ${schemaFile} (resolved ${schemaAbsPath})`);
    }
  }
}

function orderIndex(id) {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
}

/** Collects every catalog-entry.json manifest, verifies cartridgeWrapped:true
 *  claims against the tree, and assembles catalog.json's shape. Never writes
 *  anything -- publication and local readers decide what to do
 *  with the result. */
export async function discoverCatalog({ generatedDate, observePages = false, fetchImpl, checkedAt } = {}) {
  const pattern = `:(glob)${path.relative(REPO_ROOT, GROUP_ROOT)}/**/${MANIFEST_FILENAME}`;
  const { stdout } = await git('git', ['-C', REPO_ROOT, 'ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z', '--', pattern], { maxBuffer: 1024 * 1024 });
  const locations = stdout.split('\0').filter(Boolean).filter((location) => !location.split('/').some((part) => SKIP_DIR_NAMES.has(part)));
  const records = (await Promise.all(locations.map(async (location) => {
    const manifestPath = path.join(REPO_ROOT, location);
    try { return { homeDir: path.dirname(manifestPath), raw: await readFile(manifestPath, 'utf8') }; }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }))).filter(Boolean);
  records.push(...await pinnedGameRecords());
  if (!records.length) throw new Error('found zero authored game records');

  let games = [];
  const seenIds = new Set();
  for (const { homeDir, raw } of records) {
    const manifestPath = path.join(homeDir, MANIFEST_FILENAME);
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${manifestPath}: invalid JSON (${err.message})`);
    }
    const materialized = await materializeCartridgeManifest(manifest, homeDir);
    manifest = materialized.entry;
    if (!manifest.id) {
      throw new Error(`${manifestPath}: manifest has no id`);
    }
    if (seenIds.has(manifest.id)) {
      throw new Error(`duplicate game id "${manifest.id}" -- one manifest at ${manifestPath}, another already collected`);
    }
    seenIds.add(manifest.id);

    await verifyEntry(manifest, materialized.verificationHomeDir);

    const repoPath = path.relative(REPO_ROOT, homeDir).split(path.sep).join('/');
    // The authored hostname (or subdomain's established *.561.group address)
    // owns public identity. Repository paths are provenance, never a route.
    games.push({ ...manifest, repoPath });
  }

  games.sort((a, b) => {
    const diff = orderIndex(a.id) - orderIndex(b.id);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  if (observePages) games = await observeBrowserPages(games, { fetchImpl, checkedAt });

  const catalog = {
    $schemaNote:
      "Game metadata and declared replay contracts are collected from their authored records. Page reachability is observed separately and does not prove that a game works.",
    generated: generatedDate ?? new Date().toISOString().slice(0, 10),
    games,
  };

  // repoPath is build-time provenance only (tests read it from `catalog`); the published
  // catalog.json never carries repository-internal paths.
  const publicCatalog = { ...catalog, games: games.map(({ repoPath: _internal, ...entry }) => entry) };
  const json = JSON.stringify(publicCatalog, null, 2) + '\n';
  return { catalog, json };
}
