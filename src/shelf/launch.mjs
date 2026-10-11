// launch — decide WHAT selecting a game should do, without doing it. planLaunch is a PURE function
// (a catalog game record in, a PLAN out: `{ kind: "spawn", cmd, args }` or `{ kind: "print", text
// }`) so a test can assert the exact plan — including the real, resolved bin paths — without ever
// spawning a process or touching the network. scripts/shelf-browser.mjs (the imperative shell) is the
// only thing that executes a plan.
//
// Three honest cases, matched by id/entryPoints, never guessed:
//   - durante: a real child process, durante-terminal.mjs --daily — the terminal peer of the
//     browser face, submitting through the same public POST /runs route.
//   - anything else with a browser entry point: print its URL and return to the shelf — no
//     takeover, because there is no terminal client for it.
//   - no launchable entry point at all: say so, plainly, rather than pretending.
//
// Why a real CHILD process, not an in-process call: both wheatstone's `Wheatstone.stop()` and
// durante-terminal's interactive loop call `process.exit(0)` (or otherwise own the whole process)
// unconditionally on quit — correct for a standalone CLI, but it would kill the whole shelf
// browser if invoked as a library call from inside it. Two arnold `Screen`s also cannot coexist in
// one process (each owns alt-screen enter/leave and raw-mode stdin independently). A spawned child
// with `stdio: "inherit"` is the only sound way to hand the terminal to one of them and get it back.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// findMonorepoRoot(startDir) — walk up from `startDir` until a `.git` directory is found. This
// site and the sibling packages a launch spawns (durante, wheatstone) live in the same monorepo
// checkout; this is how a LOCAL terminal session finds them. It has no meaning once this site is
// deployed standalone to Cloud Run — which is exactly why the shelf browser is a separate local
// dev/agent tool (this bin/, run from a checkout), not part of the deployed storefront website.
export function findMonorepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir; // reached the filesystem root without finding one
    dir = parent;
  }
}

const ROOT = findMonorepoRoot(HERE);

// The Group's own directory beneath the checkout, found in this file's own path (as discovery does),
// so the sibling programs below are named relative to it.
const GROUP_MARKER = /[\\/]lib[\\/][^\\/]+[\\/]services[\\/]561-group[\\/]/u;
const marker = GROUP_MARKER.exec(HERE);
const GROUP_ROOT = marker === null ? ROOT : HERE.slice(0, marker.index + marker[0].length);

// Paths relative to the Group's directory.
const REPO_RELATIVE = {
  durante: "services/public-services-section/services/public-media-services-section/services/public-games-services-section/services/public-web-games-services-section/sites/durante.play.561.group/scripts/durante-terminal.mjs",
};

export const DURANTE_TERMINAL_BIN = marker === null ? null : path.join(GROUP_ROOT, REPO_RELATIVE.durante);

export function publicHostname(game) {
  return game.hostname || `${game.subdomain}.561.group`;
}

// planLaunch(game) -> LaunchPlan
export function planLaunch(game, { duranteTerminalBin = DURANTE_TERMINAL_BIN } = {}) {
  if (duranteTerminalBin !== null && (typeof duranteTerminalBin !== 'string' || !path.isAbsolute(duranteTerminalBin))) {
    throw new TypeError('duranteTerminalBin must be an absolute file path or null');
  }
  if (game.id === "durante" && duranteTerminalBin && fs.existsSync(duranteTerminalBin) && fs.statSync(duranteTerminalBin).isFile()) {
    return { kind: "spawn", cmd: "node", args: [duranteTerminalBin, "--daily", "--base", `https://${publicHostname(game)}`] };
  }
  if (game.entryPoints?.browser) {
    return { kind: "print", text: `https://${publicHostname(game)}${game.entryPoints.browser}` };
  }
  return { kind: "print", text: `— ${game.displayName}: no launchable entry point —` };
}
