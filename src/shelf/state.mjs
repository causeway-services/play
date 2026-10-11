// state — the shelf browser's PURE state machine. `step(state, key, opts)` takes one key event and
// returns the next state; nothing here touches a Screen, spawns a process, or does network I/O, so
// a headless test can script a sequence of keys against the REAL catalog data and assert exactly
// where the selection lands and what a launch request resolves to — the same seam
// arnold's editInput/selectInList and wheatstone's Wheatstone.onKey are each built around.
//
// Keys: ↑/↓ move the list selection (skipping shelf-header rows — see nav.mjs). PgUp/PgDn scroll
// the detail pane for the currently-selected game. Enter sets `state.launch` to the selected game
// record (the caller is responsible for turning that into a `planLaunch()` plan and executing it,
// then clearing `launch` — see `dispatchLaunch` below for the pure half of that). q / Ctrl-C set
// `state.quit`.

import { scrollViewport } from "@red-cup-engineering/arnold/widgets";
import { selectGame, firstSelectable } from "./nav.mjs";
import { detailText } from "./catalog.mjs";
import { planLaunch } from "./launch.mjs";

const DEFAULT_DETAIL_HEIGHT = 10;

// initialState(entries) — entries is flattenForList()'s output. Selection starts on the first real
// game (never a header), the detail pane starts unscrolled, nothing pending.
export function initialState(entries) {
  return { entries, selected: firstSelectable(entries), detailOffset: 0, quit: false, launch: null, message: "" };
}

// step(state, key, opts) — opts.detailHeight is the REAL rendered height of the detail pane (the
// draw step passes its actual rect height); it only affects PgUp/PgDn clamping, so tests that don't
// care can omit it and get DEFAULT_DETAIL_HEIGHT.
export function step(state, key, opts = {}) {
  if (key.name === "char" && key.char === "q") return { ...state, quit: true };
  if (key.ctrl && key.char === "c") return { ...state, quit: true };

  if (key.name === "up" || key.name === "down") {
    const selected = selectGame(state.selected, key, state.entries, { pageSize: 5 });
    // moving the selection to a different game resets the detail pane's scroll and clears any
    // stale "printed a URL" message from a previous Enter.
    return { ...state, selected, detailOffset: 0, launch: null, message: "" };
  }

  if (key.name === "pageup" || key.name === "pagedown") {
    const game = state.entries[state.selected]?.game;
    const lineCount = game ? detailText(game).split("\n").length : 0;
    const height = opts.detailHeight ?? DEFAULT_DETAIL_HEIGHT;
    const detailOffset = scrollViewport(state.detailOffset, key, lineCount, height);
    return { ...state, detailOffset };
  }

  if (key.name === "enter") {
    const game = state.entries[state.selected]?.game;
    return { ...state, launch: game || null, message: "" };
  }

  return state;
}

// dispatchLaunch(state) — the PURE half of acting on a pending launch: resolves `state.launch` (if
// any) to a plan via planLaunch(), and returns { state, plan }. `plan` is null when there was
// nothing to launch. The caller (scripts/shelf-browser.mjs) is the only place that actually executes a
// "spawn" plan or prints a "print" plan's text — this function only ever computes what SHOULD
// happen, which is exactly what a test can assert without a real child process ever running.
export function dispatchLaunch(state, launchOptions) {
  if (!state.launch) return { state, plan: null };
  const plan = planLaunch(state.launch, launchOptions);
  const next = { ...state, launch: null, message: plan.kind === "print" ? plan.text : "" };
  return { state: next, plan };
}
