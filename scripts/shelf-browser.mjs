#!/usr/bin/env node
// shelf-browser — a terminal app for browsing and launching the 561 Group games catalog, built on
// arnold's layout/list/focus/viewport primitives. Named plainly (per the games label's own
// capability-naming convention: this is an APP, not a coined product) — it is a terminal window
// onto exactly the same catalog.json index.html/today.html read; a browser client and a terminal
// client are equally first-class here, the storefront's own README already says so.
//
//   node scripts/shelf-browser.mjs
//
// keys: ↑/↓ select a game (shelf headers are skipped)  PgUp/PgDn scroll the detail pane
//       Enter launch (durante: a real terminal session, taking over this terminal until
//       you quit it; anything else with a browser entry point: prints its URL and returns here;
//       nothing launchable: says so)  q / Ctrl-C quit
//
// The catalog is fetched live from https://play.561.group/catalog.json; if that fails (offline dev,
// DNS), this discovers authored local game records (same source of truth
// the deployed storefront serves, just read off disk instead of over HTTP).
//
// All the NAVIGATION and LAUNCH-PLANNING logic lives in src/shelf/*.mjs as pure functions (no
// Screen, no spawn, no fetch) precisely so it can be driven by scripted keys in a headless test
// against the real catalog data — see test/shelf-browser.test.mts. This file is only the
// imperative shell: fetch the catalog once, run arnold's Screen, translate keys through state.step,
// and actually execute whatever dispatchLaunch() decided.

import { spawnSync } from "node:child_process";

import { Screen } from "@red-cup-engineering/arnold/app";
import { stack, flex } from "@red-cup-engineering/arnold/layout";
import { box, text, list, textViewport, statusLine, wrap } from "@red-cup-engineering/arnold/widgets";

import { discoverCatalog } from "../src/discover-catalog.mjs";
import { loadGames, groupByShelf, flattenForList, listLabel, detailText } from "../src/shelf/catalog.mjs";
import { initialState, step, dispatchLaunch } from "../src/shelf/state.mjs";

const CATALOG_URL = process.env.SHELF_CATALOG_URL || "https://play.561.group/catalog.json";


async function loadCatalog() {
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return await res.json();
  } catch { /* offline, DNS failure, or a non-2xx — discover the actual local sources */ }
  return (await discoverCatalog()).catalog;
}

// runChild(screen, cmd, args) — hand the real terminal to a child process and get it back. The
// child (durante-terminal.mjs) owns stdin/stdout/stderr directly
// (`stdio: "inherit"`) and may itself run an arnold Screen with its own alt-screen/raw-mode
// lifecycle; this process's own Screen is stopped first so the two never fight over the terminal,
// and `screen.shown` is cleared afterward so the next render is a FULL repaint rather than a diff
// against now-stale state — the terminal was written to by something else in between.
function runChild(screen, cmd, args) {
  screen.stop();
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  screen.shown = null;
  screen.start();
  return result;
}

function draw(state, heightRef) {
  return function paint(buf, rect) {
    const [titleR, bodyR, statusR] = stack(rect, [1, null, 1]);
    text(buf, titleR, "561 Group — shelf browser", { style: { bold: true } });

    const [listR, detailR] = flex(bodyR, [{ grow: 1 }, { grow: 2 }], { direction: "row" });

    const listInner = box(buf, listR, { title: "games" });
    const labels = state.entries.map((e) => ({
      text: listLabel(e),
      style: e.header ? { dim: true, bold: true } : undefined,
    }));
    list(buf, listInner, labels, { selected: state.selected });

    const detailInner = box(buf, detailR, { title: "detail" });
    heightRef.value = detailInner.height;
    const game = state.entries[state.selected]?.game;
    const lines = game ? wrap(detailText(game), detailInner.width) : [];
    const { offset } = textViewport(buf, detailInner, lines, { offset: state.detailOffset });

    const gameCount = state.entries.filter((e) => e.game).length;
    statusLine(buf, statusR, {
      left: `${gameCount} games`,
      center: state.message || "↑/↓ select · PgUp/PgDn scroll · Enter launch · q quit",
      right: lines.length ? `${offset + 1}/${lines.length}` : "",
    });
  };
}

async function main() {
  const catalog = await loadCatalog();
  const games = loadGames(catalog);
  const entries = flattenForList(groupByShelf(games));

  const screen = new Screen();
  let state = initialState(entries);
  const heightRef = { value: 10 };
  const repaint = () => screen.render(draw(state, heightRef));

  screen.start();
  repaint();

  screen.onKey((key) => {
    state = step(state, key, { detailHeight: heightRef.value });
    if (state.quit) { screen.stop(); process.exit(0); }
    if (state.launch) {
      const { state: next, plan } = dispatchLaunch(state);
      state = next;
      if (plan?.kind === "spawn") runChild(screen, plan.cmd, plan.args);
    }
    repaint();
  });
  screen.onInterrupt(() => { screen.stop(); process.exit(0); });
}

main().catch((err) => {
  process.stderr.write(`shelf-browser: ${err?.stack || err}\n`);
  process.exit(1);
});
