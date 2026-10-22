import { shelfValues } from '../js/catalog.mjs';



// First-party Play receiver of Red Cup's existing contextual house advertising
// protocol. The catalog, admission, redirect and aggregation still belong to
// the original ads.561.group service. No reader identifier or cookies.
function mountPlayHouseAdFooter() {
  const el = document.getElementById("house-ad-footer");
  if (!el) return;
  const { adServer, slot, property, context } = el.dataset;
  if (!adServer || !slot || !property || !context) return;
  let origin;
  try {
    const url = new URL(adServer);
    if (url.protocol !== "https:" || url.origin !== "https://ads.561.group" ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    origin = url.origin;
  } catch { return; }
  const args = new URLSearchParams({ slot, property, context }).toString();
  fetch(origin + "/ad?" + args, { credentials: "omit" })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const creative = data?.creative;
      // This slot has first-party house authority only. Reject third-party
      // sponsored/affiliate creatives rather than falsely labeling them.
      if (!creative || creative.relationship !== "house" ||
          typeof creative.id !== "string" || !/^[A-Za-z0-9_-]+$/u.test(creative.id) ||
          typeof creative.title !== "string" || !creative.title.trim()) return;
      const label = document.createElement("span");
      label.className = "ad-slot__label";
      label.textContent = "From the publisher";
      el.appendChild(label);
      const anchor = document.createElement("a");
      anchor.href = origin + "/click?" + args + "&creative=" + encodeURIComponent(creative.id);
      anchor.rel = "noopener noreferrer";
      const title = document.createElement("strong");
      title.textContent = creative.title;
      anchor.appendChild(title);
      if (typeof creative.body === "string" && creative.body.trim())
        anchor.appendChild(document.createTextNode(" — " + creative.body));
      el.appendChild(anchor);
      // A fetched creative is not an impression: optional unsigned browser
      // telemetry records a visible opportunity, never a billable view.
      if (typeof IntersectionObserver !== "function") return;
      let visible = false, sent = false, pending = null;
      const cancel = () => { if (pending !== null) clearTimeout(pending); pending = null; };
      const submit = () => {
        pending = null;
        if (sent || !visible || document.visibilityState !== "visible") return;
        sent = true;
        fetch(origin + "/view?" + args + "&creative=" + encodeURIComponent(creative.id),
          { method: "POST", credentials: "omit", keepalive: true })
          .catch(() => { /* Optional telemetry is not a customer purchase. */ });
      };
      const schedule = () => {
        if (!sent && pending === null && visible && document.visibilityState === "visible")
          pending = setTimeout(submit, 1000);
      };
      const observer = new IntersectionObserver(entries => {
        const entry = entries.find(item => item.target === el);
        if (!entry) return;
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (visible) schedule(); else cancel();
      }, { threshold: [0, 0.5] });
      observer.observe(el);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") schedule(); else cancel();
      });
    }).catch(() => { /* No ad is safer than an inaccurate ad. */ });
}

const HOUSE_AD_FOOTER = `<aside id="house-ad-footer" class="ad-slot ad-slot--house"
  aria-label="From the publisher" data-slot="footer"
  data-property="play-561-group" data-context="games"
  data-ad-server="https://ads.561.group/"></aside>
  <script>(${mountPlayHouseAdFooter.toString()})();</script>`;

const MARK_SVG = `<svg class="mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <ellipse cx="24" cy="24" rx="18" ry="11"/>
        <path d="M13 17q11-6 22 0" stroke-width="1.3" opacity="0.6"/>
        <path d="M11 24 14.25 21.5 17.5 24 20.75 21.5 24 24 27.25 21.5 30.5 24 33.75 21.5 37 24"/>
      </svg>`;

function escHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function indexHtml(gridFragment, entries = []) {
  const shelfOptions = shelfValues(entries)
    .map((shelf) => `<option value="${escHtml(shelf)}">${escHtml(shelf)}</option>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>play.561.group -- 561 Group games catalog</title>
  <meta name="description" content="Find 561 Group games and courses, their browser entry pages, and their terminal or API interfaces." />
  <link rel="stylesheet" href="css/tufte-touch.css" />
  <link rel="stylesheet" href="css/style.css" />
  <link rel="stylesheet" href="chrome/shelf-chrome.css" />
  <link rel="icon" href="favicon.svg" />
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
          Games and courses from the Group. Follow a browser link or find a terminal
          or API interface. Each entry keeps its author's description and reported
          status. Page checks report reachability at publication, not a complete play test.
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
      <input type="search" id="search" disabled placeholder="Search by name or keyword&hellip;" autocomplete="off" />
      <div class="status-filter" role="group" aria-label="Filter by status">
        <button type="button" disabled data-status="all" aria-pressed="true">All</button>
        <button type="button" disabled data-status="playable" aria-pressed="false">Reported playable</button>
        <button type="button" disabled data-status="in-development" aria-pressed="false">In development</button>
      </div>
      <div class="shelf-filter-label"><label for="shelf-filter">Shelf</label>
        <select id="shelf-filter" name="shelf" disabled>
          <option value="all">All shelves</option>
          ${shelfOptions}
        </select>
      </div>
    </div>

    <p class="result-count" id="result-count" aria-live="polite">${entries.length} games</p>

    <div class="catalog-grid-wrap" id="catalog-grid" role="region" aria-label="Game catalog">${gridFragment}</div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p>
        Catalog data: <a href="catalog.json">catalog.json</a> --
        game descriptions, interfaces, and page observations, readable by any client.
      </p>
      ${HOUSE_AD_FOOTER}
    </div>
  </footer>

  <script type="module" src="js/catalog.js"></script>
</body>
</html>
`;
}

export function todayHtml(gridFragment, date) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>Today -- play.561.group</title>
  <meta name="description" content="Shared UTC daily seeds and game entry links." />
  <link rel="stylesheet" href="css/tufte-touch.css" />
  <link rel="stylesheet" href="css/style.css" />
  <link rel="stylesheet" href="chrome/shelf-chrome.css" />
  <link rel="icon" href="favicon.svg" />
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
      <nav class="header-nav" aria-label="Site"><a href="index.html">Back to the shelf</a></nav>
    </div>
  </header>

  <main>
    <div class="today-toolbar">
      <p class="result-count" id="today-date" aria-live="polite">${escHtml(date)} UTC</p>
      <button type="button" id="today-refresh" disabled>Refresh UTC date</button>
    </div>

    <div class="today-list-wrap" id="today-list" role="region" aria-label="Today's daily seeds">${gridFragment}</div>

    <p class="today-footnote">
      These games have recovered daily seed formulas. Seeds use the UTC calendar
      day; the displayed date remains explicit when JavaScript is unavailable.
      Visit <a href="catalog.json">the full catalog</a> for all games and interfaces.
    </p>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p>
        With JavaScript, seeds update from your browser's current UTC date.
        Without it, the published seeds belong to the date printed above.
      </p>
      <p>
        <a href="index.html">&larr; Back to the shelf</a>
      </p>
      ${HOUSE_AD_FOOTER}
    </div>
  </footer>

  <script type="module" src="js/today.js"></script>
</body>
</html>
`;
}
