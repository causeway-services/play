// Authored game record -> card and TUFTE tile. Cowrie Games and its world
// directory share the same entry links and dated observation wording.
import { GLYPHS, FALLBACK_GLYPH, EXTERNAL_LINK_ICON, TERMINAL_ICON } from './glyphs.mjs';

export { GLYPHS, FALLBACK_GLYPH, EXTERNAL_LINK_ICON, TERMINAL_ICON };

export function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function statusLabel(status) {
  return status === 'playable' ? 'Reported playable' : 'In development';
}

export function hostname(entry) {
  return entry.hostname || `${entry.subdomain}.561.group`;
}

export function playUrl(entry) {
  return `https://${hostname(entry)}${(entry.entryPoints && entry.entryPoints.browser) || '/'}`;
}

export function hasHeadless(entry) {
  return Boolean(entry.entryPoints && entry.entryPoints.headless);
}

export function hasBrowser(entry) {
  return Boolean(entry.entryPoints && entry.entryPoints.browser);
}

export function browserAvailable(entry) {
  return entry.status === 'playable' && hasBrowser(entry)
    && entry.availability?.state === 'reachable';
}

export function publicationPageStatus(entry) {
  if (entry.availability?.state === 'reachable') return 'Entry page reached at publication.';
  if (entry.availability?.state === 'unavailable') return 'Entry page unavailable at publication; you can still try its address.';
  return 'Entry page not checked at publication; you can still try its address.';
}

export function catalogCardBodyHtml(entry) {
  const glyph = GLYPHS[entry.id] || FALLBACK_GLYPH;
  const playable = entry.status === 'playable';
  const keywords = (entry.keywords || []).slice(0, 6)
    .map((keyword) => `<li class="keyword">${esc(keyword)}</li>`).join('');
  const headlessBadge = hasHeadless(entry)
    ? `<span class="badge headless" title="${esc(entry.entryPoints.headless)}">${TERMINAL_ICON} API / terminal play</span>`
    : '';
  const actionLink = hasBrowser(entry)
    ? `<a class="play-link" href="${esc(playUrl(entry))}">${EXTERNAL_LINK_ICON} ${browserAvailable(entry) ? 'Open' : 'Visit'} ${esc(entry.displayName)}</a>`
    : '<span class="play-link">No browser entry</span>';
  // Author-reported playability and observed HTTP reachability are different facts.
  // A default build does not probe remote pages; make that uncertainty visible.
  const pageState = hasBrowser(entry) ? entry.availability?.state : null;
  const pageStatus = pageState === 'reachable' ? 'Page reached' : pageState === 'unavailable' ? 'Page unavailable' : 'Page not checked';

  return `
    <div class="card-head"><span class="card-glyph">${glyph}</span></div>
    <p class="desc">${esc(entry.description)}</p>
    <div class="badges">
      <span class="badge ${playable ? 'playable' : 'in-development'}">${statusLabel(entry.status)}</span>
      ${hasBrowser(entry) ? `<span class="badge availability-${pageState === 'reachable' ? 'reachable' : pageState === 'unavailable' ? 'unavailable' : 'unchecked'}">${pageStatus}</span>` : ''}
      ${headlessBadge}
    </div>
    ${hasHeadless(entry) ? `<details class="headless-interface"><summary>Read the API or terminal interface</summary><code>${esc(entry.entryPoints.headless)}</code></details>` : ''}
    ${entry.statusNote ? `<p class="status-note">${esc(entry.statusNote)}</p>` : ''}
    <ul class="keywords">${keywords}</ul>
    <div class="card-actions">${actionLink}<span class="subdomain-hint">${esc(hostname(entry))}</span></div>
    ${entry.availability?.checkedAt ? `<p class="availability-note">${pageStatus} at ${esc(entry.availability.checkedAt.slice(0, 16).replace('T', ' '))} UTC.</p>` : ''}
  `;
}

export function catalogEntryToTile(entry) {
  return {
    id: entry.id,
    title: entry.displayName,
    eyebrow: entry.shelf,
    lifecycle: entry.status === 'in-development' ? 'imminent' : 'present',
    confidence: browserAvailable(entry) ? 'high' : 'low',
    html: catalogCardBodyHtml(entry),
  };
}

export function catalogModel(entries) {
  return { tiles: entries.map(catalogEntryToTile) };
}

export const STATUS_FILTERS = new Set(['all', 'playable', 'in-development']);

export function shelfValues(entries) {
  return [...new Set(entries.map((entry) => entry.shelf).filter(Boolean))];
}

export function matchesSearch(entry, term) {
  if (!term) return true;
  return [entry.displayName, entry.description, entry.id, ...(entry.keywords || [])]
    .join(' ').toLowerCase().includes(term.toLowerCase());
}

export function filterEntries(entries, { term = '', status = 'all', shelf = 'all' } = {}) {
  return entries.filter((entry) => (status === 'all' || entry.status === status)
    && (shelf === 'all' || entry.shelf === shelf) && matchesSearch(entry, term));
}

export function normalizeFilters({ term = '', status = 'all', shelf = 'all' } = {}, entries = []) {
  return {
    term: String(term).trim(),
    status: STATUS_FILTERS.has(status) ? status : 'all',
    shelf: shelf === 'all' || shelfValues(entries).includes(shelf) ? shelf : 'all',
  };
}

export function filtersFromSearchParams(params, entries) {
  return normalizeFilters({ term: params.get('q') || '', status: params.get('status') || 'all', shelf: params.get('shelf') || 'all' }, entries);
}

export function filtersToSearchParams(filters) {
  const params = new URLSearchParams();
  if (filters.term) params.set('q', filters.term);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.shelf && filters.shelf !== 'all') params.set('shelf', filters.shelf);
  return params;
}

// ---------------------------------------------------------------------------------------
// Browser-only bootstrap below this line. Nothing above here touches `document`.
// ---------------------------------------------------------------------------------------

/** Wires up index.html's progressively enhanced search/status/shelf controls. The static
 *  SSR grid remains readable without JavaScript; with JavaScript, the current filter is
 *  represented in the URL so it can be shared and restored by browser history. */
export async function initCatalogPage() {
  const gridWrapper = document.getElementById('catalog-grid');
  if (!gridWrapper) return; // not on index.html -- safe no-op import elsewhere


  const COUNT = document.getElementById('result-count');
  const SEARCH = document.getElementById('search');
  const SHELF = document.getElementById('shelf-filter');
  const STATUS_BUTTONS = Array.from(document.querySelectorAll('.status-filter button'));

  if (!COUNT || !SEARCH || !SHELF || !STATUS_BUTTONS.length) return;

  function render(entries) {
    const visible = new Set(entries.map((entry) => entry.id));
    for (const tile of gridWrapper.querySelectorAll('.tufte-tile')) tile.hidden = !visible.has(tile.id);
    COUNT.textContent = entries.length ? `${entries.length} game${entries.length === 1 ? '' : 's'}` : 'No games match your filters.';
  }

  let allEntries = [];
  let hydrated = false;

  function selectedFilters() {
    const activeStatus = STATUS_BUTTONS.find((b) => b.getAttribute('aria-pressed') === 'true');
    return normalizeFilters({
      term: SEARCH.value,
      status: activeStatus?.dataset.status || 'all',
      shelf: SHELF.value,
    }, allEntries);
  }

  function applyFilters() {
    render(filterEntries(allEntries, selectedFilters()));
  }

  function restoreControlsFromUrl() {
    const filters = filtersFromSearchParams(new URLSearchParams(window.location.search), allEntries);
    SEARCH.value = filters.term;
    SHELF.value = filters.shelf;
    STATUS_BUTTONS.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.status === filters.status));
    });
  }

  function updateUrl(mode) {
    const query = filtersToSearchParams(selectedFilters()).toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history[mode](null, '', nextUrl);
  }

  try {
    const res = await fetch('catalog.json', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`catalog.json responded ${res.status}`);
    const catalog = await res.json();
    allEntries = Array.isArray(catalog.games) ? catalog.games : [];
    hydrated = true;
  } catch (err) {
    // The published grid stays visible and fully readable --
    // losing live search/filter on a fetch failure is a real degradation, but it is
    // never a blank page the way a full client-only render used to be.
    if (SEARCH) {
      SEARCH.disabled = true;
      SEARCH.placeholder = `Search unavailable (${err.message})`;
    }
    STATUS_BUTTONS.forEach((btn) => { btn.disabled = true; });
    SHELF.disabled = true;
    return;
  }

  if (!hydrated) return;

  restoreControlsFromUrl();
  applyFilters();

  SEARCH.addEventListener('input', () => {
    applyFilters();
    updateUrl('replaceState');
  });
  STATUS_BUTTONS.forEach((btn) => {
    btn.addEventListener('click', () => {
      STATUS_BUTTONS.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyFilters();
      updateUrl('pushState');
    });
  });
  SHELF.addEventListener('change', () => {
    applyFilters();
    updateUrl('pushState');
  });
  window.addEventListener('popstate', () => {
    restoreControlsFromUrl();
    applyFilters();
  });
  SEARCH.disabled = false;
  SHELF.disabled = false;
  STATUS_BUTTONS.forEach((button) => { button.disabled = false; });
}

if (typeof document !== 'undefined' && document.getElementById('catalog-grid')) {
  initCatalogPage();
}
