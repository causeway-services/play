import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyWebStandards, inlineScriptHashes } from "../scripts/apply-web-standards.mjs";
import standards from "../standards.config.mjs";
import { indexHtml, todayHtml } from "../src/shells.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const games = [
  { id: "pig", displayName: "Pig", description: "Hold-or-roll, first to 100. Every decision shows the bust probability.", subdomain: "parlor", shelf: "Card Table", entryPoints: { browser: "/pig/" } },
  { id: "equivo", displayName: "Equivo", description: "Study evidence readings.", subdomain: "equivo", hostname: "equivo.play.561.group", shelf: "Study", entryPoints: { browser: "/" } },
];

async function built() {
  const dir = await mkdtemp(join(tmpdir(), "play-standards-"));
  await mkdir(join(dir, "atlas"));
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ games }));
  await writeFile(join(dir, "index.html"), indexHtml("", games));
  await writeFile(join(dir, "today.html"), todayHtml("", "2026-10-21"));
  await writeFile(join(dir, "atlas/index.html"), "<!doctype html><html lang=\"en\"><head><title>Atlas</title></head><body></body></html>");
  await writeFile(join(dir, "404.html"), "<!doctype html><html lang=\"en\"><head><title>Not found</title></head><body></body></html>");
  const config = await standards({ dir, configDir: root });
  const result = await applyWebStandards({ dir, config, date: "2026-10-21" });
  return { dir, result };
}

test("the shelf names every game to crawlers, cards and answer engines", async () => {
  const { dir } = await built();
  const html = await readFile(join(dir, "index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/play\.561\.group\/">/u);
  assert.match(html, /<meta property="og:image" content="https:\/\/play\.561\.group\/card\.png">/u);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/u);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)[1]);
  const types = ld["@graph"].map((node) => node["@type"]);
  assert.deepEqual(types, ["WebSite", "Organization", "ItemList"]);
  const [pig, equivo] = ld["@graph"][2].itemListElement.map((entry) => entry.item);
  assert.equal(pig.url, "https://parlor.561.group/pig/");
  assert.equal(equivo.url, "https://equivo.play.561.group/");
  assert.equal(pig.gamePlatform, "Web browser");
  assert.equal(pig.isAccessibleForFree, true);
});

test("applying the standards twice changes nothing", async () => {
  const { dir } = await built();
  const once = await readFile(join(dir, "index.html"), "utf8");
  const config = await standards({ dir, configDir: root });
  await applyWebStandards({ dir, config, date: "2026-10-21" });
  assert.equal(await readFile(join(dir, "index.html"), "utf8"), once);
});

test("headers carry HSTS without subdomains and a CSP hashed to the page's own inline script", async () => {
  const { dir, result } = await built();
  const headers = await readFile(join(dir, "_headers"), "utf8");
  assert.match(headers, /Strict-Transport-Security: max-age=63072000\n/u);
  assert.doesNotMatch(headers, /includeSubDomains/u);
  assert.match(headers, /X-Content-Type-Options: nosniff/u);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/u);
  assert.match(headers, /object-src 'none'/u);
  assert.match(headers, /frame-ancestors 'none'/u);
  assert.match(headers, /connect-src 'self' https:\/\/ads\.561\.group/u);
  const hashes = inlineScriptHashes(await readFile(join(dir, "index.html"), "utf8"));
  assert.equal(hashes.length, 1);
  assert.ok(headers.includes(hashes[0]));
  assert.deepEqual(result.inlineScriptHashes, hashes);
});

test("discovery files exist: robots with AI crawlers, dated sitemap, llms.txt, security.txt", async () => {
  const { dir } = await built();
  const robots = await readFile(join(dir, "robots.txt"), "utf8");
  for (const agent of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"]) {
    assert.match(robots, new RegExp(`User-agent: ${agent}\\nAllow: /`, "u"));
  }
  assert.match(robots, /Sitemap: https:\/\/play\.561\.group\/sitemap\.xml/u);
  assert.match(await readFile(join(dir, "sitemap.xml"), "utf8"), /<lastmod>2026-10-21<\/lastmod>/u);
  const llms = await readFile(join(dir, "llms.txt"), "utf8");
  assert.match(llms, /^# Play\n\n> /u);
  assert.match(llms, /- \[Pig\]\(https:\/\/parlor\.561\.group\/pig\/\): Hold-or-roll, first to 100\./u);
  const security = await readFile(join(dir, ".well-known/security.txt"), "utf8");
  assert.match(security, /^Contact: mailto:cto@561\.group$/mu);
  assert.match(security, /^Canonical: https:\/\/play\.561\.group\/\.well-known\/security\.txt$/mu);
  const expires = Date.parse(security.match(/^Expires: (.*)$/mu)[1]);
  assert.ok(expires > Date.parse("2026-10-21") && expires - Date.parse("2026-10-21") < 365 * 86400000);
});
