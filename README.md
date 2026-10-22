# play.561.group

<!-- 561-group-standards:badges:start -->
[![Causeway Services](https://img.shields.io/badge/561%20Group-Causeway%20Services-115e69)](https://github.com/causeway-services)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-115e69)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/causeway-services/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

## Voluntary sustaining support

Play is a public 561 Group games project. If this free-to-use software is useful to you, you can [support the Group's public research, games, and reusable infrastructure for USD $10 per month](https://buy.stripe.com/28E28s1b4gJcb2Y3Io5EY02) using its existing Stripe-hosted sustaining-support checkout. Support renews monthly until canceled, is optional, and provides no extra access, editorial influence, or charitable tax deduction. [Read the existing terms and confidential help route](https://github.com/561-group/561.group#sustain-the-public-commons) before subscribing.

This is a repository-visible first-party funding route; it does not assert that `play.561.group`, the separate house-ad server, or its advertising campaign has deployed, that anyone has seen the link, or that a payment has occurred.

## Current source composition

This complete application lives under Public Media's declared Public Games child.
Its package metadata names that existing repository and directory. Source receiving,
installed provider composition, successful builds, deployment, and public observation
remain separate. The sections below retain historical usage details; current scripts
and explicit source inputs described here govern the portable interface.

Consumers can import `@causeway-services/play/catalog` (`discoverCatalog` and
`readGitCatalogSources`) and `@causeway-services/play/catalog-presentation`
(`playUrl`, `hasBrowser`, and the existing presentation helpers). Importing these
surfaces does not require a machine-specific Group checkout or execute game code.

`discoverCatalog({sources, generatedDate, observePages: false})` receives a nonempty
array of local Git source bindings. Every binding provides:

- `repositoryRoot`: the absolute, exact root of an existing Git checkout
- `catalogRoots`: nonempty repository-relative directories containing authored records
- `gameSiteRoots`: explicit repository-relative directories containing game gitlinks;
  use an explicit empty array for a source with no such children
- optional `repository`: the caller's nonempty repository identity label

Roots cannot escape their checkout. Each supplied source must contribute an authored
record; missing roots, listed-but-missing records and missing pinned objects refuse
composition. Worktree catalog records must be regular files whose resolved location
stays inside the declared roots; file symlinks and redirected outside ancestors refuse
before reading record bytes. This is a source-custody check, not a hostile-filesystem
sandbox guarantee. An intentional staged deletion is no longer enumerated by Git. Ordinary
records still include tracked and nonignored untracked files, excluding generated/test
directories and retained `lib/legacy` history. Pinned child records come from their
exact gitlink commits in either materialization state. Duplicate IDs still refuse.

Compose Public Games and external Science through separate bindings when they live
in separate repositories. A Public Games-only binding does not prove that the external
Science input was received. The caller must supply the complete received source set;
the application neither invents a membership registry nor hardcodes today's games.
The old integrated Group scan remains a lazy compatibility adapter for existing
callers. Outside that layout, omitted sources refuse on discovery, not on import.

The internal catalog retains `repoPath` and `catalogSource` (record path, Git HEAD,
actual blob hash, worktree-versus-Git-object read, and child pin when applicable).
The optional repository label is a caller binding, not a remote verification or
canonical-admission receipt. A worktree record is not claimed to equal Git HEAD.
Both internal provenance fields are omitted from public catalog JSON.

`createShelfProjector({sources, date, observePages: false})` on the publication export
binds these inputs to the existing static publisher. `victor.config.mjs` accepts an
explicit JSON source array through `PLAY_CATALOG_SOURCES` and an optional real UTC
date `PLAY_CATALOG_DATE=YYYY-MM-DD`. These are invocation inputs, not a persistent
registry. The default publisher performs no page observations; unchecked pages are
labelled not checked. A programmatic caller may explicitly request observations with
the boolean `observePages: true`; nonboolean values refuse before source reads.

The terminal application also accepts `PLAY_CATALOG_SOURCES`. Its default is local
discovery, with no HTTP request. Setting `SHELF_CATALOG_URL` explicitly opts into the
existing remote-read/local-fallback behavior. `SHELF_DURANTE_TERMINAL_BIN` supplies
the received absolute Durante client path; the pure terminal-launch export accepts
the same path as `planLaunch(game, {duranteTerminalBin})`. Without the integrated
layout or an explicit client path, no terminal location is invented. Browser/API
entries and the full authored terminal and chrome assets remain present.

Provider versions are not selected by this interface. In particular, an older
registry label does not qualify current Parlor or Weiqi replay contracts. Engineering
implementations remain external. The actual full provider/game composition must be
received before running the full suite or build; the portable tests use synthetic
local Git inputs and no real game/provider execution, terminal spawn or HTTP request.

Bounded controls:

```
node --test test/catalog-source-selection.test.mjs test/portable-composition.test.mjs
```

A progressively enhanced shelf for the 561 Group games catalog. It reads `catalog.json`
(one cartridge-manifest-shaped entry per game, per the Cartridge and Energy Bank spec)
and renders game cards with a static server-rendered baseline -- no framework, no CDN. Browser
clients and terminal/API clients are both first-class; a game's own JSON/SSE API,
declared in its manifest's `entryPoints.headless`, is as legitimate an access path as its
browser page.

## Layout

```
index.html       the shelf -- fetches catalog.json client-side, renders game cards
today.html       the daily front door -- one strip per game with a daily-utc seed policy,
                 with today's real seed computed live in the browser from the UTC date
catalog.json     one cartridge-manifest-shaped entry per game -- GENERATED, see below;
                 never hand-edit this file directly
scripts/build-catalog.mjs
                 collects every game's own catalog-entry.json and writes catalog.json
css/style.css    shared, theme-aware (light/dark) styles for index.html and today.html
js/catalog.mjs   renderer for index.html: fetch, filter, render
js/today.mjs     renderer for today.html: computes each daily game's seed in the browser
js/glyphs.mjs    the shared icon set both renderers draw from
chrome/          vendored shelf-chrome source other 561 Group games import (this site is
                 its origin, so index.html/today.html use css/style.css directly instead)
serve.mjs        thin node:http adapter around sirv's static file middleware
scripts/shelf-browser.mjs
                 a terminal client for the same catalog -- browses and launches games from
                 a terminal instead of a browser tab, over @red-cup-engineering/arnold
src/shelf/       pure navigation/launch-planning functions scripts/shelf-browser.mjs's
                 imperative shell drives (no Screen, no spawn, no fetch -- see below)
test/            node --test behavioral tests
```

## Install and run

```
npm install                 # pulls @red-cup-engineering/gaming/running from Verdaccio (see .npmrc)
npm run serve                # http://127.0.0.1:8561/
node serve.mjs 3000          # or pick a port positionally
PORT=3000 node serve.mjs     # or via env
```

`HOST` defaults to `127.0.0.1`; set `HOST=0.0.0.0` to listen on all interfaces for local
testing on another device. This site only ever fetches its own `catalog.json`. `serve.mjs`
is a dev/test convenience only -- production is a Cloudflare Worker (see Deploy below), not
this server.

## The terminal shelf browser

```
npm run shelf                # node scripts/shelf-browser.mjs
```

A terminal app onto the same catalog `index.html` reads -- browsing and launching a game
from a terminal is exactly as first-class here as browsing and launching one from a
browser tab. Named plainly (`shelf-browser`, not a coined product name) per the same
naming convention the catalog's own entries follow. Fetches `catalog.json` live from
`https://play.561.group/catalog.json`; falls back to the local `catalog.json` next to the
bin if that fails (offline dev, DNS).

Keys: `↑`/`↓` select a game (shelf headers are skipped), `PgUp`/`PgDn` scroll the detail
pane, `Enter` launches, `q` / `Ctrl-C` quit.

`Enter` does one of three honest things, matched by the selected game's `id` and
`entryPoints`, never guessed:

- `durante` / `farstone`: spawns a real child process (durante's own
  `scripts/durante-terminal.mjs`, wheatstone's `scripts/farstone.mjs`) with `stdio: "inherit"`,
  handing it the whole terminal until it quits, then repaints the shelf. A real child
  process, not an in-process call, because both clients call `process.exit(0)`
  unconditionally on quit and two arnold `Screen`s cannot share one process's raw-mode
  stdin.
- any other game with an `entryPoints.browser`: prints its URL and returns to the shelf --
  no takeover, since there is no terminal client for it.
- nothing launchable: says so, plainly.

Built on arnold's `layout`/`list`/`focus`/`viewport` primitives (`@red-cup-engineering/arnold` `^0.2.0`).
All navigation and launch-planning logic lives in `src/shelf/*.mjs` as pure functions --
`scripts/shelf-browser.mjs` is only the imperative shell (fetch, run the `Screen`, execute
whatever a plan says) -- so `test/shelf-browser.test.mts` can script real key sequences
against the real `catalog.json` headlessly, asserting exactly where the selection lands
and exactly what a launch resolves to (a spawn plan's `cmd`/`args`, checked and its target
bin confirmed to exist on disk -- never actually spawned).

## Test

```
npm test          # node --test test/*.test.mts
npm run check      # node --check over serve.mjs, js/*.mjs, test/*.test.mts
```

The suite validates `catalog.json` against the real, published
`@red-cup-engineering/gaming/running`'s own `validateManifest` (strict, for any entry with
`cartridgeWrapped: true`), checks `index.html`/`today.html` reference only local assets,
and boots `serve.mjs` on an ephemeral port for real HTTP round-trips against its routes,
a 404, and a path-traversal attempt.

## Deploy

play.561.group is its own Cloudflare Worker (`wrangler.jsonc` in this directory), serving
the static build straight off disk via a Workers static-assets binding -- no Cloud Run
origin, no proxy through the shared `cloudflare-router` (per the 2026-08-31 GCP exit
ruling: GCP billing is permanently off, and the Cloud Run game fleet is migration
inventory, not outage). `.assetsignore` excludes everything that is not part of the served
site (source, tests, package files, the terminal shelf browser).

```sh
npm run build     # regenerate catalog.json and index.html/today.html first
npm run deploy    # wrangler deploy
```

`custom_domain: true` in `wrangler.jsonc` attaches `play.561.group` and provisions its DNS
record. `npm run dev` runs `wrangler dev` for a local preview of the deployed shape.

## catalog.json

**Generated -- never hand-edit.** `catalog.json` used to be a hand-maintained file and it
drifted out of sync with the actual games more than once. It is now produced by
`scripts/build-catalog.mjs`, which collects every game's own `catalog-entry.json` manifest
(one per game, living at the root of that game's own service directory, not here) and
assembles them. Run `npm run generate-catalog` any time a game's manifest changes (or
`npm run build`, which does that and then re-renders `index.html`/`today.html` from the
result). `test/catalog-generation.test.mts` fails the suite if `catalog.json` on disk is
stale relative to what the generator would produce right now -- that's the mechanism that
now prevents drift, replacing hoping someone remembers to hand-edit the file.

Each game's `catalog-entry.json` is shaped like the spec's `CartridgeManifest`: `id`,
`displayName`, `description`, `subdomain`, `entryPoints`, `seedPolicy`, `intentLog`,
`keywords`, plus the optional `configs`, `energy`, and `replayVerifier`. A field an entry
can't honestly fill in yet (a `replayVerifier` module, an `intentLog.schemaRef`) is
omitted, never set to `null` -- `test/smoke.test.mts` enforces that as a standing rule. Do
not include `repoPath`: the generator derives it from wherever it actually found the
manifest (build-time only; the published catalog.json omits it), which is also why a game's
directory moving can never leave a stale path behind the way hand-typed `repoPath` values used to.

On top of the spec, each entry carries a few storefront-only extensions:

- `status`: `"playable"` or `"in-development"`.
- `statusNote`: a short note when there's something worth knowing beyond the description
  (a known limitation, a design constraint) -- omitted when there's nothing to add.
- `cartridgeWrapped` / `energyBankWrapped`: whether the game ships its own
  `@red-cup-engineering/gaming/running` manifest module / settles against
  `@red-cup-engineering/energy-bank`. A manifest claiming `cartridgeWrapped: true` is held
  to it: the generator stats `replayVerifier`'s file and import-checks its named export,
  and refuses to build if either doesn't resolve against the real tree -- it does not trust
  the claim.
- `shelf`: which shelf-within-the-shelf the game lives on (Card Table / Puzzle Den /
  Study / Deep / Stars / substrate / unshelved).

## Adding a game

Implement `Cartridge` if the game has one, add a `catalog-entry.json` at the root of the
game's own service directory (see `catalog.json` above for the shape), pick a `shelf`, run
`npm run generate-catalog`. The generator finds any `catalog-entry.json` under the known
game-home roots in `scripts/build-catalog.mjs`'s `SEARCH_ROOTS` automatically -- edit that
list only when a whole new game-home tree appears, never per game. No changes to
`index.html`, `css/style.css`, or `js/catalog.mjs` are needed -- the renderer only ever
touches manifest-shaped fields. If the game has a `daily-utc` seed policy, add a strip to
`js/today.mjs` with a ported (not live-imported) copy of its seed formula. Run `npm test`
after editing (it fails loudly if you forgot to regenerate).
