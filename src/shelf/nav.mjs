// nav — list navigation over the shelf browser's flattened [{header}|{game}] entries, built on
// arnold's own selectInList reducer rather than reimplementing up/down/pageup/pagedown by hand
// (arnold/widgets ships selectInList for exactly this). The one thing arnold's generic reducer
// cannot know is that a shelf-header row is not selectable here — selectGame wraps selectInList
// and skips header rows, re-stepping in the same direction until it lands on a real game.

import { selectInList } from "@red-cup-engineering/arnold/widgets";

// selectGame(selected, key, entries, opts) — the next selected index after `key`, guaranteed to
// land on a `{ game }` entry (never a `{ header }` one) whenever the list contains at least one
// game. `entries` is flattenForList()'s output. opts.pageSize forwards to selectInList.
export function selectGame(selected, key, entries, opts = {}) {
  const count = entries.length;
  if (count === 0) return selected;
  const dir = key.name === "up" || key.name === "pageup" ? -1 : 1;
  let next = selectInList(selected, key, count, opts);
  // step past header rows in the direction we were already moving; bounded by the list length so
  // a list of all headers (never happens in practice — every shelf group is non-empty) cannot loop.
  let guard = count;
  while (guard-- > 0 && !entries[next]?.game) {
    const stepped = next + dir;
    if (stepped < 0 || stepped >= count) break; // hit an edge with nothing selectable past it
    next = stepped;
  }
  if (entries[next]?.game) return next;
  // still on a header (an edge case: the list starts or ends on one with no game in that
  // direction) — fall back to the nearest real game anywhere in the list, or leave the selection
  // exactly as it was if the list has no game at all.
  const firstGame = entries.findIndex((e) => e.game);
  return firstGame === -1 ? selected : firstGame;
}

// firstSelectable(entries) — the index of the first `{ game }` entry, or 0 for an empty/all-header
// list. Used to seed the initial selection so the browser never opens with a header highlighted.
export function firstSelectable(entries) {
  const i = entries.findIndex((e) => e.game);
  return i === -1 ? 0 : i;
}
