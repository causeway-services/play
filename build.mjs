#!/usr/bin/env node
/**
 * build.mjs -- the storefront's build step. Server-renders index.html/today.html as TUFTE
 * documents to plain static files so serve.mjs (pure static server) keeps serving as always.
 * catalog.json is the single data source; this script only reads it. Run: npm run build (a
 * source-control-time build, not container-build-time -- see README.md/Dockerfile).
 * TUFTE's renderTufteFragment(model) renders only the tile grid; this file owns the page
 * shell and splices TUFTE's fragment into it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTufteFragment } from '@red-cup-engineering/web-page-tiling-engine';
import { catalogModel, shelfValues } from './js/catalog.mjs';
import { computeTodayModel } from './js/today.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23a3402a'/%3E%3Ctext x='12' y='17' font-family='monospace' font-size='13' fill='%23fff8f4' text-anchor='middle'%3E561%3C/text%3E%3C/svg%3E`;

// House ad server (@red-cup-engineering/advertising-services-section), v0
// served at ads.561.group. The footer slot fetches its creative
// client-side, at property="play-561-group", so it self-excludes and
// never advertises play.561.group on its own page.
const HOUSE_AD_FOOTER = `<div id="house-ad-footer" data-slot="footer" data-property="play-561-group"></div>
  <script>(function(){var s="footer",p="play-561-group",el=document.getElementById("house-ad-footer"),base="https://ads.561.group";fetch(base+"/ad?slot="+s+"&property="+p).then(function(r){return r.ok?r.json():null;}).then(function(d){if(!d||!d.creative||!el)return;var a=document.createElement("a");a.href=base+"/click?slot="+s+"&property="+p+"&creative="+encodeURIComponent(d.creative.id);a.rel="sponsored noopener noreferrer";a.textContent=d.creative.title+" -- "+d.creative.body;el.appendChild(a);}).catch(function(){});})();</script>`;

const MARK_SVG = `<svg class="mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <ellipse cx="24" cy="24" rx="18" ry="11"/>
        <path d="M13 17q11-6 22 0" stroke-width="1.3" opacity="0.6"/>
        <path d="M11 24 14.25 21.5 17.5 24 20.75 21.5 24 24 27.25 21.5 30.5 24 33.75 21.5 37 24"/>
      </svg>`;

// Both pages need TUFTE resolvable to the browser as the exact same bare specifier
// build.mjs/tests import it by (@red-cup-engineering/web-page-tiling-engine[/browser])
// -- an import map pointed at the vendored node_modules copy is the zero-build way to do
// that with no bundler and no extra server route, the same "no build step" spirit
// serve.mjs already has. Both paths stay local/relative, same as every other asset here.
const IMPORT_MAP = `<script type="importmap">
  {
    "imports": {
      "@red-cup-engineering/web-page-tiling-engine": "./node_modules/@red-cup-engineering/web-page-tiling-engine/src/render-tufte-document.mjs",
      "@red-cup-engineering/web-page-tiling-engine/browser": "./node_modules/@red-cup-engineering/web-page-tiling-engine/src/tufte-browser.mjs",
      "@red-cup-engineering/gaming/running/seed": "./node_modules/@red-cup-engineering/gaming/src/running/seed.mjs"
    }
  }
  </script>`;

function escHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

// The shared renderer deliberately indents multi-line tile fragments for
// readability. Normalize their line endings before committing the static
// publication so generated output carries no invisible whitespace churn.
function publicationHtml(html) {
  return html.split('\n').map((line) => line.trimEnd()).join('\n');
}

function indexHtml(gridFragment, entries = []) {
  const shelfOptions = shelfValues(entries)
    .map((shelf) => `<option value="${escHtml(shelf)}">${escHtml(shelf)}</option>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>play.561.group -- 561 Group games catalog</title>
  <meta name="description" content="A directory of 561 Group games: seed in, deterministic engine, intent log out, replay to verify. Browser and terminal/API clients both welcome -- AI players are peers." />
  <link rel="stylesheet" href="css/style.css" />
  <link rel="icon" href="${FAVICON}" />
  ${IMPORT_MAP}
</head>
<body>
  <a class="skip-link" href="#catalog-grid">Skip to catalog</a>

  <header class="site-header">
    <div class="header-inner">
      ${MARK_SVG}
      <div class="title-block">
        <p class="brand-wordmark">Cowrie Games</p>
        <h1>play<span class="domain">.561.group</span></h1>
        <p class="tagline">
          Every game here converges on one shape: seed in, deterministic engine, intent
          log out, replay to verify, ledger entry to settle. This page reads each game's
          cartridge manifest -- nothing more. Browser clients and terminal/API clients
          are both first-class; an AI player is just another client emitting intent logs.
        </p>
      </div>
      <nav class="header-nav" aria-label="Site">
        <a href="today.html" class="today-nav-link">Today &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="controls">
      <label class="visually-hidden" for="search">Search games</label>
      <input type="search" id="search" placeholder="Search by name or keyword&hellip;" autocomplete="off" />
      <div class="status-filter" role="group" aria-label="Filter by status">
        <button type="button" data-status="all" aria-pressed="true">All</button>
        <button type="button" data-status="playable" aria-pressed="false">Playable</button>
        <button type="button" data-status="in-development" aria-pressed="false">In development</button>
      </div>
      <label class="shelf-filter-label" for="shelf-filter">Shelf
        <select id="shelf-filter" name="shelf">
          <option value="all">All shelves</option>
          ${shelfOptions}
        </select>
      </label>
    </div>

    <p class="result-count" id="result-count" aria-live="polite"></p>

    <!-- Rendered by build.mjs from catalog.json via TUFTE's renderTufteFragment; the
         static catalog remains useful without JavaScript, while js/catalog.mjs adds
         shareable search/status/shelf filtering when it is available. -->
    <div class="catalog-grid-wrap" id="catalog-grid" role="region" aria-label="Game catalog">${gridFragment}</div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p>
        Catalog data: <a href="catalog.json">catalog.json</a> --
        one cartridge-manifest-shaped entry per game, fetchable directly by any client.
      </p>
      <p>
        Built on the <code>@red-cup-engineering/gaming/running</code> manifest contract and
        rendered via <code>@red-cup-engineering/web-page-tiling-engine</code>.
        Static, self-contained, no build step at deploy time.
      </p>
      ${HOUSE_AD_FOOTER}
    </div>
  </footer>

  <script type="module" src="js/catalog.mjs"></script>
</body>
</html>
`;
}

function todayHtml(gridFragment) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Today -- play.561.group</title>
  <meta name="description" content="The 561 shelf's shared daily ritual: one strip per game with a real daily seed, today's identity, and a straight link in to play it." />
  <link rel="stylesheet" href="css/style.css" />
  <link rel="icon" href="${FAVICON}" />
  ${IMPORT_MAP}
</head>
<body>
  <a class="skip-link" href="#today-list">Skip to today's games</a>

  <header class="site-header">
    <div class="header-inner">
      ${MARK_SVG}
      <div class="title-block">
        <h1>today<span class="domain">.561.group</span></h1>
        <p class="tagline">
          The suite's front door: today's date resolves to one seed per game, the same
          seed for everyone, everywhere, at once. Not a browsing catalog -- that's
          <a href="index.html">the shelf</a> -- this page is the daily ritual: what does
          today ask, and where do you go to answer it.
        </p>
      </div>
    </div>
  </header>

  <main>
    <div class="today-toolbar">
      <p class="result-count" id="today-date" aria-live="polite">Computing today's UTC date&hellip;</p>
      <button type="button" id="today-refresh">Check for updates</button>
    </div>

    <!-- Rendered by build.mjs from a real build-time UTC date via TUFTE's
         renderTufteFragment, so a no-JS visitor still sees real, working strips instead of
         an empty list. js/today.mjs always recomputes against the visitor's own real "now"
         on load and replaces this with it -- the build-time date is never trusted as
         authoritative, only as an honest starting point. -->
    <div class="today-list-wrap" id="today-list" role="region" aria-label="Today's live daily games">${gridFragment}</div>

    <p class="today-footnote">
      Only games with a <code>daily-utc</code> seed policy get a strip here. The rest of
      the catalog is <code>on-demand</code> -- no daily ritual of its own. See the
      <a href="catalog.json">full catalog</a> for every game.
    </p>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p>
        Every seed above is computed in your own browser from the real UTC clock --
        never hand-typed for one day and left to go stale. See
        <a href="js/today.mjs">js/today.mjs</a> for the ported (not imported) formulas,
        each one headed with the real source file it matches.
      </p>
      <p>
        <a href="index.html">&larr; Back to the shelf</a>
      </p>
    </div>
  </footer>

  <script type="module" src="js/today.mjs"></script>
</body>
</html>
`;
}

async function build() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'catalog.json'), 'utf8'));
  const entries = Array.isArray(catalog.games) ? catalog.games : [];

  const catalogFragment = publicationHtml(renderTufteFragment(catalogModel(entries)));
  await writeFile(path.join(ROOT, 'index.html'), indexHtml(catalogFragment, entries));

  const todayModel = await computeTodayModel(new Date());
  const todayFragment = publicationHtml(renderTufteFragment(todayModel));
  await writeFile(path.join(ROOT, 'today.html'), todayHtml(todayFragment));

  process.stdout.write(`build.mjs: wrote index.html (${catalogFragment.length} bytes of grid) and today.html (${todayFragment.length} bytes of grid)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build();
}

export { build, indexHtml, todayHtml };
