// Pure daily-strip projection followed by the browser-only page bootstrap.

import { esc, GLYPHS, FALLBACK_GLYPH, EXTERNAL_LINK_ICON, playUrl, browserAvailable, publicationPageStatus } from './catalog.mjs';
import { utcDateString, dailySeed } from '@red-cup-engineering/gaming/running/seed';

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

// Only these seed formulas have been recovered from the game's own implementation.
// Hostnames and browser entries always come from its authored record.
const DAILY_IDS = ['ruinfold', 'crucible', 'solitaire', 'gambling-trainer', 'durante', 'pig', 'farkle', 'yacht', 'chutes', 'reels'];

function askFor(id, { floors, variantName }) {
  switch (id) {
    case 'ruinfold':
      return `Descend today's ${floors}-floor keep.`;
    case 'crucible':
      return "Merge, split, rebond, and catalyze today's tangle before the furnace energy runs out.";
    case 'solitaire':
      return `Today's ${variantName} deal: everyone gets the same shuffle.`;
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

export async function computeTodayStrips(date, entries = []) {
  const dateStr = utcDateString(date);
  const { hex: ruinfoldSeed, seedInt } = await ruinfoldDailySeedHex(dateStr);
  const floors = ruinfoldFloorCount(seedInt);
  const duranteSeed = await duranteDailySeedHex(dateStr);

  const byId = new Map(entries.filter((entry) => entry.seedPolicy?.kind === 'daily-utc').map((entry) => [entry.id, entry]));
  return DAILY_IDS.filter((id) => byId.has(id)).map((id) => {
    const game = byId.get(id);
    const def = { id, name: game.displayName };
    const url = new URL(game.entryPoints?.daily ?? playUrl(game), playUrl(game));
    const variantId = url.searchParams.get('variant');
    const variantName = game.configs?.find((config) => config.id === variantId)?.displayName ?? variantId;
    if (id === 'solitaire') {
      // The game owns its table path and variant. Its bootstrap accepts the
      // labelled UTC date, so following this link reproduces the printed seed.
      url.searchParams.set('date', dateStr);
    } else if (id === 'crucible') {
      url.searchParams.set('date', dateStr);
    }
    const seedValue = {
      ruinfold: ruinfoldSeed,
      crucible: crucibleDailySeed(dateStr),
      solitaire: id === 'solitaire' ? solitaireDailySeed(dateStr, variantId) : undefined,
      'gambling-trainer': gamblingTrainerDailySeed(dateStr, 'novice'),
      durante: duranteSeed,
      pig: dailySeed('parlor:pig', dateStr),
      farkle: dailySeed('parlor:farkle', dateStr),
      yacht: dailySeed('parlor:yacht', dateStr),
      chutes: dailySeed('parlor:chutes', dateStr, 'human,bot'),
      reels: dailySeed('parlor:reels', dateStr),
    }[def.id];
    const seedLabel = def.id === 'solitaire' ? `Today's seed (${variantName})` : "Today's seed";
    return { ...def, game, url: url.href, ask: askFor(def.id, { floors, variantName }), seedLabel, seedValue };
  });
}

function todayStripBodyHtml(strip) {
  const glyph = GLYPHS[strip.id] || FALLBACK_GLYPH;
  const playLink = `<a class="play-link" data-tufte-control href="${esc(strip.url)}">${EXTERNAL_LINK_ICON} Open ${esc(strip.name)}</a>`;
  const pageStatus = publicationPageStatus(strip.game);
  return `
    <div class="strip-head">
      <span class="card-glyph">${glyph}</span>
      <span class="badge playable">UTC daily seed</span>
    </div>
    <p class="strip-ask">${esc(strip.ask)}</p>
    <p class="strip-seed"><span class="seed-label">${esc(strip.seedLabel)}</span> <code>${esc(strip.seedValue)}</code></p>
    <div class="strip-links">
      ${playLink}
      <span class="availability-note">${pageStatus}</span>
    </div>
  `;
}

function todayEntryToTile(strip) {
  return {
    id: strip.id,
    title: strip.name,
    role: 'rail',
    lifecycle: 'present',
    confidence: browserAvailable(strip.game) ? 'high' : 'low',
    html: todayStripBodyHtml(strip),
  };
}

export async function computeTodayModel(date, entries = []) {
  const strips = await computeTodayStrips(date, entries);
  return { tiles: strips.map(todayEntryToTile) };
}

export async function initTodayPage() {
  const grid = document.getElementById('today-list');
  if (!grid) return;
  const dateLabel = document.getElementById('today-date');
  const button = document.getElementById('today-refresh');
  let entries;
  try {
    const response = await fetch('catalog.json');
    if (!response.ok) throw new Error('Catalog unavailable');
    entries = (await response.json()).games;
  } catch {
    if (button) button.disabled = true;
    return; // Preserve the published seeds and their explicitly labelled UTC date.
  }
  async function refresh() {
    const now = new Date();
    const strips = await computeTodayStrips(now, entries);
    for (const strip of strips) {
      const tile = document.getElementById(strip.id);
      if (!tile) continue;
      tile.querySelector('.strip-seed code').textContent = strip.seedValue;
      tile.querySelector('.strip-ask').textContent = strip.ask;
      tile.querySelector('.play-link').href = strip.url;
    }
    dateLabel.textContent = `${utcDateString(now)} UTC`;
  }
  const update = () => refresh().catch(() => { dateLabel.textContent += ' — update unavailable'; });
  await update();
  if (button) {
    button.addEventListener('click', update);
    button.disabled = false;
  }
}

if (typeof document !== 'undefined' && document.getElementById('today-list')) {
  initTodayPage();
}
