// Generates catalog.json from per-game catalog-entry.json manifests, so the
// storefront's game list has exactly one source of truth: the game's own
// service directory, not a hand-maintained file here that drifts.
//
// Each game carries a `catalog-entry.json` at the root of its service
// directory. It is either a complete catalog entry, or a small storefront
// sidecar naming the executable cartridge manifest with `cartridgeManifest`.
// In the latter case the executable manifest owns the game rules, replay
// contract, and browser/headless endpoints; the sidecar owns only shelf
// metadata. `repoPath` is always derived from where the entry was found.
//
// This script does two jobs:
//   1. Collect: recursively find every catalog-entry.json under the known
//      game-home roots, parse it, and derive repoPath from its location.
//   2. Verify: for any entry claiming cartridgeWrapped:true, actually check
//      the tree -- stat the replayVerifier's file and import-check that its
//      named export exists, and stat intentLog.schemaRef's file when present.
//      A manifest that asserts a wrapping the code doesn't have is a build
//      error, not a silent catalog.json that lies about it (see: the
//      flickering-delve entry this generator replaced, which kept claiming
//      cartridgeWrapped:true and a replayVerifier pointing at a
//      src/cartridge.manifest.mts that had already been deleted).
//
// Run directly (`node scripts/build-catalog.mjs`) to regenerate catalog.json.
// Import `buildCatalog()` (as test/catalog-generation.test.mts does) to get
// the assembled object/JSON without writing anything.

import { glob, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.join(HERE, '..');

// The monorepo root that catalog.json's historical repoPath values were
// written relative to (e.g. "lib/emsenn/services/561-group/services/...").
// Found by locating that marker in this file's own path rather than counting
// ".." segments, so it survives this site itself moving to a new depth.
const REPO_MARKER = `${path.sep}lib${path.sep}emsenn${path.sep}services${path.sep}561-group${path.sep}`;
const markerIndex = HERE.indexOf(REPO_MARKER);
if (markerIndex === -1) {
  throw new Error(`could not locate "${REPO_MARKER}" in ${HERE} to determine the monorepo root`);
}
const REPO_ROOT = HERE.slice(0, markerIndex);

const GAME_SITE_ROOT = path.join(
  REPO_ROOT,
  'lib/emsenn/services/561-group/services/public-services-section/services/public-media-services-section/services/public-games-services-section/services/public-web-games-services-section/sites',
);

// Known trees where a game's service directory can live. Games move between
// directories inside these roots over time (see: the 2026-08-19 game-homes
// move); the manifest-per-game design means that only ever changes where a
// manifest is *found*, never a hand-typed path someone has to remember to
// update. Adding a whole new game-home tree (not just a new game inside an
// existing one) is the only reason to touch this list.
const SEARCH_ROOTS = [
  GAME_SITE_ROOT,
  path.join(
    REPO_ROOT,
    'lib/emsenn/services/561-group/services/science-services-section/services/philosophy-services-section/services/relationality-services-section/services/agency-services-section/services/being-services-section/services/doing-services-section/services/playing-services-section/services/gaming-services-section/services/board-games-services-section/services/weiqi-services-section',
  ),
  path.join(
    REPO_ROOT,
    'lib/emsenn/services/561-group/services/public-services-section/services/public-computer-services-section/services/public-web-services-section/services/public-web-game-services-section/services',
  ),
  path.join(
    REPO_ROOT,
    'lib/emsenn/services/561-group/services/public-services-section/services/public-publishing-services-section/services/public-computer-publishing-services-section/services/public-system-computer-publishing-section/services/public-web-publishing-services-section/sites',
  ),
];

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

async function findManifests(root) {
  const found = [];
  for await (const relativePath of glob(`**/${MANIFEST_FILENAME}`, {
    cwd: root,
    exclude: [...SKIP_DIR_NAMES].map((name) => `**/${name}/**`),
  })) found.push(path.join(root, relativePath));
  return found;
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
  const absPath = path.join(homeDir, filePart);
  try {
    await stat(absPath);
  } catch {
    throw new Error(`${entry.id}: replayVerifier file does not exist: ${filePart} (resolved ${absPath})`);
  }
  if (exportName) {
    let mod;
    try {
      mod = await import(pathToFileURL(absPath).href);
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
 *  anything -- callers (the CLI block below, or a test) decide what to do
 *  with the result. */
export async function buildCatalog({ generatedDate } = {}) {
  const manifestPaths = (
    await Promise.all(SEARCH_ROOTS.map((root) => findManifests(root)))
  ).flat();

  if (manifestPaths.length === 0) {
    throw new Error('found zero catalog-entry.json manifests under the known search roots');
  }

  const games = [];
  const seenIds = new Set();
  for (const manifestPath of manifestPaths) {
    const homeDir = path.dirname(manifestPath);
    const raw = await readFile(manifestPath, 'utf8');
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
    // A manifest below the public game-sites carrier is a deployable site. Its
    // directory name is its stable public hostname, rather than a second field
    // each game author must keep synchronized by hand.
    const siteRelative = path.relative(GAME_SITE_ROOT, homeDir);
    const siteName = !siteRelative.startsWith('..') && !path.isAbsolute(siteRelative)
      ? siteRelative.split(path.sep)[0]
      : undefined;
    const hostname = siteName?.endsWith('.play.561.group') ? siteName : undefined;
    games.push({ ...manifest, ...(hostname ? { hostname } : {}), repoPath });
  }

  games.sort((a, b) => {
    const diff = orderIndex(a.id) - orderIndex(b.id);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const catalog = {
    $schemaNote:
      "One cartridge-manifest-shaped entry per game, validated against the real, published @red-cup-engineering/gaming/running's validateGameManifest by test/smoke.test.mts (full strict validation when cartridgeWrapped is true, an honest subset check otherwise). A field this catalog can't fill in yet is omitted, never set to null. status, statusNote, cartridgeWrapped, energyBankWrapped, and shelf are storefront-only extensions, not part of the manifest spec.",
    generated: generatedDate ?? new Date().toISOString().slice(0, 10),
    games,
  };

  // repoPath is build-time provenance only (tests read it from `catalog`); the published
  // catalog.json never carries repository-internal paths.
  const publicCatalog = { ...catalog, games: games.map(({ repoPath: _internal, ...entry }) => entry) };
  const json = JSON.stringify(publicCatalog, null, 2) + '\n';
  return { catalog, json };
}

if (import.meta.main) {
  const { json } = await buildCatalog();
  await writeFile(path.join(SITE_ROOT, 'catalog.json'), json, 'utf8');
}
