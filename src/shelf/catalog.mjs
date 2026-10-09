// catalog — pure helpers over a play.561.group catalog.json's `games` array. No fetch, no I/O:
// given the array (already fetched/parsed by the imperative shell, scripts/shelf-browser.mjs), decide
// how a terminal shelf browser groups and describes it. Nothing here knows about a Screen, a
// spawned child process, or the network — that separation is what makes the navigation and launch
// logic testable with scripted keys against the real catalog.json, with no terminal involved.

// loadGames(catalog) — the `games` array off a parsed catalog.json, or [] for anything malformed.
export function loadGames(catalog) {
  return Array.isArray(catalog?.games) ? catalog.games : [];
}

// groupByShelf(games) — games in catalog order, grouped by their `shelf` field (default
// "unshelved" for an entry with none), each group's games kept in catalog order and each shelf
// appearing once, in the order it was first seen. Returns [{ shelf, games }].
export function groupByShelf(games) {
  const order = [];
  const byShelf = new Map();
  for (const g of games) {
    const shelf = g.shelf || "unshelved";
    if (!byShelf.has(shelf)) { byShelf.set(shelf, []); order.push(shelf); }
    byShelf.get(shelf).push(g);
  }
  return order.map((shelf) => ({ shelf, games: byShelf.get(shelf) }));
}

// flattenForList(groups) — one flat, ordered list of { header } and { game } entries — a synthetic
// shelf-header entry before each group's games — the shape a single scrollable list widget draws
// from directly (arnold's list() takes one flat array; grouping-with-headers-in-one-list is an
// app-level decision, not something arnold's list widget needs to know about).
export function flattenForList(groups) {
  const out = [];
  for (const { shelf, games } of groups) {
    out.push({ header: shelf });
    for (const g of games) out.push({ game: g });
  }
  return out;
}

// listLabel(entry) — the display text for one flattened entry, either shape.
export function listLabel(entry) {
  if (entry.header) return `── ${entry.header} ──`;
  const g = entry.game;
  return g.status === "playable" ? g.displayName : `${g.displayName} (in development)`;
}

// publicHostname(game) — explicit site names take precedence; legacy catalog records retain
// their established <subdomain>.561.group address until their capability is migrated.
export function publicHostname(game) {
  return game.hostname || `${game.subdomain}.561.group`;
}

// detailText(game) — the description + status/shelf/entry-point facts for the detail pane, as one
// string ready for arnold's wrap() (which the draw step feeds into textViewport()).
export function detailText(game) {
  const parts = [game.displayName, "", game.description || ""];
  if (game.statusNote) parts.push("", game.statusNote);
  parts.push("", `shelf: ${game.shelf || "unshelved"}    status: ${game.status || "unknown"}`);
  if (game.entryPoints?.browser) parts.push(`browser: https://${publicHostname(game)}${game.entryPoints.browser}`);
  if (game.entryPoints?.headless) parts.push(`headless: ${game.entryPoints.headless}`);
  return parts.join("\n");
}
