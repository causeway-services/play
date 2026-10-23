import { readFile, stat, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { playUrl, hasBrowser } from '../js/catalog.mjs';

/** Observe an HTML entry page; HTTP success is not a game-operation proof.
 * Automatic redirects can contact a foreign origin before a returned page
 * is classified. Follow only bounded same-origin redirects without revealing
 * a foreign Location URL in the public catalog.
 */
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
        const origin = new URL(url);
        if (origin.protocol !== 'https:' || origin.username || origin.password)
          throw new TypeError('untrusted game address');
        const signal = AbortSignal.timeout(5000);
        let current = origin;
        let response;
        let lastStatus;
        let reason;
        // Three same-origin redirects preserve / -> /web/ game entrances.
        // Manual handling refuses off-origin hops before any second request.
        for (let hops = 0; hops <= 3; hops++) {
          response = await fetchImpl(current.href, {
            redirect: 'manual',
            headers: { accept: 'text/html', 'user-agent': '561-Group-Shelf/1.0' },
            signal,
          });
          lastStatus = response.status;
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          response = undefined;
          if (!location) { reason = 'redirect-missing-location'; break; }
          let destination;
          try { destination = new URL(location, current); }
          catch { reason = 'invalid-redirect'; break; }
          if (destination.protocol !== 'https:' || destination.origin !== origin.origin
            || destination.username || destination.password || destination.hash) {
            reason = 'off-origin-redirect';
            break;
          }
          if (hops === 3) { reason = 'redirect-limit'; break; }
          current = destination;
        }
        const offOrigin = Boolean(response?.url && new URL(response.url).origin !== origin.origin);
        const html = /^text\/html(?:;|$)/i.test(response?.headers.get('content-type') ?? '');
        availability = { state: response?.ok && html && !offOrigin ? 'reachable' : 'unavailable',
          url, checkedAt, ...(lastStatus === undefined ? {} : { httpStatus: lastStatus }) };
        // A same-origin redirect may carry a one-use code or private query.
        // Observe its HTML, but never copy a query-bearing destination into
        // the public catalog's finalUrl projection.
        if (current.href !== origin.href && !current.search) availability.finalUrl = current.href;
        if (offOrigin) reason = 'off-origin-redirect';
        if (reason) availability.reason = reason;
        await response?.body?.cancel();
      } catch {
        availability = { state: 'unavailable', url, checkedAt, reason: 'request-failed' };
      }
      observations[index] = { ...game, availability };
    }
  }));
  return observations;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));


// Compatibility for existing integrated callers is resolved only on request.
// Importing the package never assumes a machine-specific checkout layout.
function integratedSources() {
  const marker = /[\\/]lib[\\/][^\\/]+[\\/]services[\\/]561-group[\\/]/u.exec(HERE);
  if (marker === null) {
    throw new Error('catalog sources are required outside an integrated Group checkout');
  }
  const repositoryRoot = HERE.slice(0, marker.index);
  const group = HERE.slice(0, marker.index + marker[0].length);
  return [{
    repositoryRoot,
    catalogRoots: [path.relative(repositoryRoot, group)],
    gameSiteRoots: [path.relative(repositoryRoot, path.join(group,
      'services/public-services-section/services/public-media-services-section/services/public-games-services-section/services/public-web-games-services-section/sites'))],
  }];
}

const MANIFEST_FILENAME = 'catalog-entry.json';
// `dist` is a reproducible Worker-asset publication, not another game home.
// Searching it would let a stale published copy shadow or duplicate the
// authored manifest that the generator is meant to project.
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'test', 'tests', 'dist']);

// lib/legacy retains source history, including retired catalog entries. Those
// bytes remain available as evidence, but are not a game's current source home.
// Match that structural boundary, not game IDs or a list of today's games.
function isCurrentSourceLocation(location) {
  const parts = location.split('/');
  return !parts.some((part, index) => SKIP_DIR_NAMES.has(part)
    || (part === 'lib' && parts[index + 1] === 'legacy'));
}

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
// object whether or not this checkout has materialized it; never substitute a
// dirty worktree or retained catalog, or lose the game because its mount is empty.
const git = promisify(execFile);
async function pinnedGameRecords({ repositoryRoot, gameSiteRoots }) {
  const run = async (args) => (await git('git', ['-C', repositoryRoot, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
  if (!gameSiteRoots.length) return [];
  const links = (await run(['ls-tree', '-r', 'HEAD', '--', ...gameSiteRoots.map((root) => `:(literal)${root || '.'}`)])).split('\n')
    .filter((line) => line.startsWith('160000 ') && isCurrentSourceLocation(line.slice(line.indexOf('\t') + 1)));
  if (!links.length) return [];
  const configuration = await run(['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']);
  const names = new Map(configuration.split('\n').map((line) => {
    const [, name, location] = /^submodule\.(.+)\.path (.+)$/.exec(line);
    return [location, name];
  }));
  const common = path.resolve(repositoryRoot, await run(['rev-parse', '--git-common-dir']));
  const records = [];
  for (const link of links) {
    const [, commit, location] = /^160000 commit ([a-f0-9]+)\t(.+)$/.exec(link);
    const homeDir = path.join(repositoryRoot, location);
    const name = names.get(location);
    if (!name) throw new Error(`submodule ${location} has no source configuration`);
    let moduleDir = path.join(common, 'modules', name);
    const moduleGit = async (...args) => (await git('git', ['--git-dir', moduleDir, ...args], { maxBuffer: 1024 * 1024 })).stdout;
    try {
      await moduleGit('cat-file', '-e', `${commit}^{commit}`);
    } catch {
      // A child may be an ordinary nested clone rather than an absorbed
      // submodule. Prove its Git root is this exact mount before using it:
      // git -C on an empty mount can otherwise discover the parent repository.
      try {
        const childRoot = (await git('git', ['-C', homeDir, 'rev-parse', '--show-toplevel'])).stdout.trim();
        if (await realpath(childRoot) !== await realpath(homeDir)) {
          throw new Error('materialized Git root is not the declared child');
        }
        moduleDir = (await git('git', ['-C', homeDir, 'rev-parse', '--absolute-git-dir'])).stdout.trim();
        await moduleGit('cat-file', '-e', `${commit}^{commit}`);
      } catch (error) {
        throw new Error(`submodule ${location}: pinned source ${commit} is unavailable (${error.message})`);
      }
    }
    // Missing pinned objects are a missing source, not evidence that the game vanished.
    const manifest = await moduleGit('ls-tree', '--name-only', commit, '--', MANIFEST_FILENAME);
    if (!manifest.trim()) continue;
    records.push({ homeDir, raw: await moduleGit('show', `${commit}:${MANIFEST_FILENAME}`), sourcePath: `${location}/${MANIFEST_FILENAME}`, sourceCommit: commit, readFrom: 'git-object' });
  }
  return records;
}

/** Read existing local Git sources. Each binding names one real checkout and
 * its declared catalog/game roots; it is not a catalog or an owner registry.
 * Separate repositories (for example Public Games and Science) stay separate.
 * A supplied empty/missing source fails rather than silently dropping a provider. */
export async function readGitCatalogSources(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('catalog sources must be a nonempty array');
  const collected = [];
  for (const source of sources) {
    if (!source || !path.isAbsolute(source.repositoryRoot ?? '')) throw new Error('source repositoryRoot must be absolute');
    if (source.repository !== undefined && (typeof source.repository !== 'string' || !source.repository.trim())) throw new Error('source repository identity must be a nonempty string when supplied');
    const repositoryRoot = await realpath(source.repositoryRoot);
    const run = async (...args) => (await git('git', ['-C', repositoryRoot, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
    if (await realpath(await run('rev-parse', '--show-toplevel')) !== repositoryRoot) {
      throw new Error('source repositoryRoot must be the exact Git checkout root');
    }
    const sourceHead = await run('rev-parse', 'HEAD');
    const roots = async (values, name, required) => {
      if (!Array.isArray(values) || (required && !values.length)) throw new Error(`${name} must be ${required ? 'a nonempty' : 'an'} array`);
      return Promise.all(values.map(async (value) => {
        if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error(`${name} must contain relative directory paths`);
        const absolute = await realpath(path.resolve(repositoryRoot, value));
        const relative = path.relative(repositoryRoot, absolute);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${name} escapes its repository`);
        if (!(await stat(absolute)).isDirectory()) throw new Error(`${name} must name directories`);
        return relative.split(path.sep).join('/');
      }));
    };
    const catalogRoots = await roots(source.catalogRoots, 'catalogRoots', true);
    const gameSiteRoots = await roots(source.gameSiteRoots, 'gameSiteRoots', false);
    const escapeGlob = (value) => value.replace(/[\\*?[\]]/g, '\\$&');
    const patterns = catalogRoots.map((root) => `:(glob)${root ? `${escapeGlob(root)}/` : ''}**/${MANIFEST_FILENAME}`);
    const { stdout } = await git('git', ['-C', repositoryRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z', '--', ...patterns], { maxBuffer: 1024 * 1024 });
    const locations = stdout.split('\0').filter(Boolean).filter(isCurrentSourceLocation);
    const records = (await Promise.all(locations.map(async (location) => {
      const manifestPath = path.join(repositoryRoot, location);
      try {
        // Source custody is the declared checkout/root, not whatever a file or
        // ancestor symlink happens to lead to. Validate before reading bytes.
        if (!(await lstat(manifestPath)).isFile()) throw new Error(`catalog source record must be a regular file: ${location}`);
        const resolved = await realpath(manifestPath);
        const within = (root) => {
          const relative = path.relative(path.resolve(repositoryRoot, root), resolved);
          return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        };
        if (!within('') || !catalogRoots.some(within)) throw new Error(`catalog source record escapes its declared roots: ${location}`);
        return { homeDir: path.dirname(manifestPath), raw: await readFile(resolved, 'utf8'), sourcePath: location, readFrom: 'worktree' };
      }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error(`catalog source record is missing: ${location}`);
        throw error;
      }
    }))).filter(Boolean);
    records.push(...await pinnedGameRecords({ repositoryRoot, gameSiteRoots }));
    if (!records.length) throw new Error(`catalog source has no authored records: ${source.repository ?? repositoryRoot}`);
    for (const record of records) {
      const bytes = Buffer.from(record.raw, 'utf8');
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      collected.push({ ...record, repoPath: path.relative(repositoryRoot, record.homeDir).split(path.sep).join('/'), catalogSource: {
        ...(source.repository === undefined ? {} : { repository: source.repository }), path: record.sourcePath, repositoryHead: sourceHead,
        ...(record.readFrom === 'git-object' ? { pinnedCommit: record.sourceCommit } : {}), blob, readFrom: record.readFrom,
      } });
    }
  }
  return collected;
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
export async function discoverCatalog({ sources, generatedDate, observePages = false, fetchImpl, checkedAt } = {}) {
  if (typeof observePages !== 'boolean') throw new TypeError('observePages must be boolean');
  const records = await readGitCatalogSources(sources ?? integratedSources());

  let games = [];
  const seenIds = new Set();
  for (const { homeDir, raw, repoPath, catalogSource } of records) {
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

    // The authored hostname (or subdomain's established *.561.group address)
    // owns public identity. Repository paths are provenance, never a route.
    games.push({ ...manifest, repoPath, catalogSource });
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
  const publicCatalog = { ...catalog, games: games.map(({ repoPath: _internal, catalogSource: _source, ...entry }) => entry) };
  const json = JSON.stringify(publicCatalog, null, 2) + '\n';
  return { catalog, json };
}
