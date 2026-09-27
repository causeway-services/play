// Pure daily-strip projection followed by the browser-only page bootstrap.

import { esc, GLYPHS, FALLBACK_GLYPH, EXTERNAL_LINK_ICON } from './catalog.mjs';
import { utcDateString, dailySeed } from '@red-cup-engineering/gaming/running/seed';
import { LIVE_SUBDOMAINS } from './live-subdomains.mjs';

export { esc, utcDateString };

async function hashedDailySeed(gameId, dateStr) {
  const bytes = new TextEncoder().encode(`${gameId}-daily:${dateStr}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new DataView(digest).getUint32(0, false);
}

export async function ruinfoldDailySeedHex(dateStr) {
  const n = await hashedDailySeed('ruinfold', dateStr);
  return { hex: `0x${n.toString(16).padStart(8, '0')}`, seedInt: n };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ruinfoldFloorCount(seedInt) {
  const rng = mulberry32(seedInt);
  return 4 + Math.floor(rng() * 4); // intBetween(rng, 0, 3), dungeon.mts's first draw
}

export async function duranteDailySeedHex(dateStr) {
  const n = await hashedDailySeed('durante', dateStr);
  return `0x${n.toString(16).padStart(8, '0')}`;
}

export const crucibleDailySeed = (dateStr) => dailySeed('crucible', dateStr);
export const solitaireDailySeed = (dateStr, variantId) => dailySeed('solitaire', dateStr, variantId);
export const gamblingTrainerDailySeed = (dateStr, configId) => dailySeed('gambling-trainer', dateStr, configId);

const DEV_HOST = 'http://localhost:8787';

const STRIP_DEFS = [
  { id: 'ruinfold', name: 'Ruinfold', subdomain: 'ruinfold', subdomainPath: '/play', devPath: '/play' },
  { id: 'crucible', name: 'Crucible', subdomain: 'crucible', subdomainPath: '/web/index.html', devPath: '/web/index.html' },
  { id: 'solitaire', name: 'Solitaire', subdomain: 'solitaire', subdomainPath: '/web/table.html?variant=klondike-draw1&daily=1', devPath: '/web/table.html?variant=klondike-draw1&daily=1' },
  { id: 'gambling-trainer', name: "Kelly's Wager", subdomain: 'gambling-trainer', subdomainPath: '/', devPath: '/web/index.html' },
  { id: 'durante', name: 'Durante', subdomain: 'durante', subdomainPath: '/', devPath: '/' },
  { id: 'pig', name: 'Pig', subdomain: 'parlor', subdomainPath: '/pig/', devPath: '/web/pig/' },
  { id: 'farkle', name: 'Farkle', subdomain: 'parlor', subdomainPath: '/farkle/', devPath: '/web/farkle/' },
  { id: 'yacht', name: 'Yacht', subdomain: 'parlor', subdomainPath: '/yacht/', devPath: '/web/yacht/' },
  { id: 'chutes', name: 'Chutes & Ladders', subdomain: 'parlor', subdomainPath: '/chutes/', devPath: '/web/chutes/' },
  { id: 'reels', name: 'Fair Spin', subdomain: 'parlor', subdomainPath: '/reels/', devPath: '/web/reels/' },
];

function askFor(id, { floors }) {
  switch (id) {
    case 'ruinfold':
      return `Descend today's ${floors}-floor keep and risk the five-way bilattice death, for a place on today's leaderboard.`;
    case 'crucible':
      return "Settle today's tangle to zero-H¹ -- merge, split, rebond, catalyze -- before the furnace energy runs out.";
    case 'solitaire':
      return "Today's solver-certified deal -- pick Klondike, FreeCell, or Spider, everyone gets the same shuffle.";
    case 'gambling-trainer':
      return "Today's practice bankroll run -- grade every stake against the real Kelly optimum, novice track.";
    case 'durante':
      return "Today's seeded arena -- walk the maze, shoot the demons, land on today's leaderboard next to anyone (human or agent) who played the same seed.";
    case 'pig':
      return "Today's hold-or-roll game — use the live expected value to decide when to bank.";
    case 'farkle':
      return "Today's hot-dice run — bank a turn or risk the real bust probability.";
    case 'yacht':
      return "Today's five-dice game — commit a category or use its exact reroll expectation.";
    case 'chutes':
      return "Today's shared race — every player gets the same board and exact finish-turn distribution.";
    case 'reels':
      return "Today's practice reels — published RTP and session loss stay visible throughout.";
    default:
      return '';
  }
}

export async function computeTodayStrips(date) {
  const dateStr = utcDateString(date);
  const { hex: ruinfoldSeed, seedInt } = await ruinfoldDailySeedHex(dateStr);
  const floors = ruinfoldFloorCount(seedInt);
  const duranteSeed = await duranteDailySeedHex(dateStr);

  return STRIP_DEFS.map((def) => {
    const seedValue = {
      ruinfold: ruinfoldSeed,
      crucible: crucibleDailySeed(dateStr),
      solitaire: solitaireDailySeed(dateStr, 'klondike-draw1'),
      'gambling-trainer': gamblingTrainerDailySeed(dateStr, 'novice'),
      durante: duranteSeed,
      pig: dailySeed('parlor:pig', dateStr),
      farkle: dailySeed('parlor:farkle', dateStr),
      yacht: dailySeed('parlor:yacht', dateStr),
      chutes: dailySeed('parlor:chutes', dateStr, 'human,bot'),
      reels: dailySeed('parlor:reels', dateStr, 'default'),
    }[def.id];
    const seedLabel = def.id === 'solitaire' ? "Today's seed (Klondike Draw-1)" : "Today's seed";
    return { ...def, ask: askFor(def.id, { floors }), seedLabel, seedValue };
  });
}

function todayStripBodyHtml(strip) {
  const glyph = GLYPHS[strip.id] || FALLBACK_GLYPH;
  const isLive = LIVE_SUBDOMAINS.has(strip.subdomain);
  const playLink = isLive
    ? `<a class="play-link" href="https://${esc(strip.subdomain)}.561.group${esc(strip.subdomainPath)}">${EXTERNAL_LINK_ICON} Play at ${esc(strip.subdomain)}.561.group</a>`
    : `<span class="play-link" aria-disabled="true">Not yet deployed -- run it locally</span>`;
  return `
    <div class="strip-head">
      <span class="card-glyph">${glyph}</span>
      <span class="badge playable">Live daily</span>
    </div>
    <p class="strip-ask">${esc(strip.ask)}</p>
    <p class="strip-seed"><span class="seed-label">${esc(strip.seedLabel)}</span> <code>${esc(strip.seedValue)}</code></p>
    <div class="strip-links">
      ${playLink}
      <a class="dev-link" href="${esc(DEV_HOST + strip.devPath)}">${esc(DEV_HOST + strip.devPath)} <span class="dev-hint">(local dev)</span></a>
    </div>
  `;
}

function todayEntryToTile(strip) {
  return {
    id: strip.id,
    title: strip.name,
    role: 'rail',
    lifecycle: 'present',
    confidence: LIVE_SUBDOMAINS.has(strip.subdomain) ? 'high' : 'low',
    html: todayStripBodyHtml(strip),
  };
}

export async function computeTodayModel(date) {
  const strips = await computeTodayStrips(date);
  return { tiles: strips.map(todayEntryToTile) };
}

export async function initTodayPage() {
  const gridWrapper = document.getElementById('today-list');
  if (!gridWrapper) return; // not on today.html -- safe no-op import elsewhere

  const { renderTufteFragment, normalizeTufteModel, diffTufteProjection } = await import('@red-cup-engineering/web-page-tiling-engine');
  const { applyTufteProjectionPatch } = await import('@red-cup-engineering/web-page-tiling-engine/browser');

  const DATE_LABEL = document.getElementById('today-date');
  const REFRESH_BUTTON = document.getElementById('today-refresh');

  let lastProjection = null;

  async function renderFresh(date) {
    const model = await computeTodayModel(date);
    const projection = normalizeTufteModel(model);
    gridWrapper.innerHTML = renderTufteFragment(model);
    lastProjection = projection;
    DATE_LABEL.textContent = `${utcDateString(date)} UTC`;
  }

  async function refresh() {
    if (!lastProjection) return renderFresh(new Date());
    let entries;
    try {
      const res = await fetch('catalog.json', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`catalog.json responded ${res.status}`);
      const catalog = await res.json();
      entries = Array.isArray(catalog.games) ? catalog.games : [];
    } catch {
      // catalog.json is unreachable -- leave the last-known-good grid on screen rather
      // than blanking it; the button simply has nothing new to show this click.
      return;
    }
    const dailyIds = new Set(entries.filter((g) => g.seedPolicy && g.seedPolicy.kind === 'daily-utc').map((g) => g.id));
    const strips = await computeTodayStrips(new Date());
    const model = { tiles: strips.filter((s) => dailyIds.has(s.id)).map(todayEntryToTile) };
    const nextProjection = normalizeTufteModel(model);
    applyTufteProjectionPatch(gridWrapper, diffTufteProjection(lastProjection, nextProjection));
    lastProjection = nextProjection;
    DATE_LABEL.textContent = `${utcDateString(new Date())} UTC`;
  }

  DATE_LABEL.textContent = "Computing today's UTC date…";
  try {
    await renderFresh(new Date());
  } catch (err) {
    gridWrapper.innerHTML = `<p class="empty-state">Could not compute today's seeds: ${esc(err.message)}</p>`;
    return;
  }

  if (REFRESH_BUTTON) REFRESH_BUTTON.addEventListener('click', () => { refresh(); });
}

if (typeof document !== 'undefined' && document.getElementById('today-list')) {
  initTodayPage();
}
