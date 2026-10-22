#!/usr/bin/env node
// Bring a built static-assets directory up to the web's ordinary standards.
//
//   node scripts/apply-web-standards.mjs <public-dir> <standards.config.mjs> [--date YYYY-MM-DD]
//
// Run it after the site build and before `wrangler deploy`. It is idempotent:
// it rewrites only what it owns (the head block between the standards markers,
// plus <title>, description, canonical and icon links) and writes robots.txt,
// sitemap.xml (with lastmod), llms.txt, /.well-known/security.txt, the brand
// icons and the Workers Static Assets `_headers` file (HSTS without
// includeSubDomains, nosniff, Referrer-Policy and a CSP whose inline-script
// allowance is the exact hash of each inline script the pages carry).
//
// The config module default-exports `(context) => config` where context is
// `{ dir }` and config is:
//   origin, name, description, brandDir, contact, pages[], llms (string),
//   csp ({connect, img, frame}), feeds[], organization
// and each page is `{ path, file, title?, description?, ogTitle?, ogType?,
//   noindex?, sitemap?, jsonLd? }`.

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AI_CRAWLERS = Object.freeze([
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot',
  'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot',
]);
const START = '<!--standards:start-->';
const END = '<!--standards:end-->';
const escapeHtml = (value) => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
const jsonScript = (value) => `<script type="application/ld+json">${JSON.stringify(value).replace(/</gu, '\\u003c')}</script>`;

export function robotsTxt(origin) {
  const groups = ['User-agent: *\nAllow: /', ...AI_CRAWLERS.map((agent) => `User-agent: ${agent}\nAllow: /`)];
  return `${groups.join('\n\n')}\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin, pages, date) {
  const urls = pages.filter((page) => page.sitemap !== false && !page.noindex)
    .map((page) => `  <url>\n    <loc>${origin}${page.path}</loc>\n    <lastmod>${page.lastmod ?? date}</lastmod>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** RFC 9116: Contact, Expires (under a year, renewed by every build), Canonical. */
export function securityTxt(origin, contact, date) {
  const expires = new Date(Date.parse(`${date}T00:00:00Z`) + 330 * 86400000).toISOString();
  return `Contact: mailto:${contact}\nExpires: ${expires}\nPreferred-Languages: en\nCanonical: ${origin}/.well-known/security.txt\n`;
}

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

export function inlineScriptHashes(html) {
  const hashes = [];
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (/\bsrc=/iu.test(attrs) || /application\/ld\+json/iu.test(attrs) || body.trim() === '') continue;
    hashes.push(sha256(body));
  }
  return hashes;
}

export function contentSecurityPolicy({ hashes = [], connect = [], img = [], frame = [], style = [] } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self'${hashes.length ? ` ${[...new Set(hashes)].join(' ')}` : ''}`,
    // Both sites render tiles with style attributes and an inline stylesheet.
    `style-src 'self' 'unsafe-inline'${style.length ? ` ${style.join(' ')}` : ''}`,
    `img-src 'self' data:${img.length ? ` ${img.join(' ')}` : ''}`,
    "font-src 'self'",
    `connect-src 'self'${connect.length ? ` ${connect.join(' ')}` : ''}`,
    frame.length ? `frame-src ${frame.join(' ')}` : "frame-src 'none'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
}

export function headersFile(csp) {
  return `/*\n  Strict-Transport-Security: max-age=63072000\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Content-Security-Policy: ${csp}\n`;
}

function headBlock(config, page) {
  const url = `${config.origin}${page.path}`;
  const title = page.title ?? page.currentTitle;
  const description = page.description ?? config.description;
  const image = `${config.origin}/card.png`;
  const lines = [START];
  if (page.noindex) lines.push('<meta name="robots" content="noindex">');
  else {
    lines.push(`<link rel="canonical" href="${url}">`);
    lines.push(`<meta property="og:site_name" content="${escapeHtml(config.name)}">`);
    lines.push(`<meta property="og:type" content="${page.ogType ?? 'website'}">`);
    lines.push(`<meta property="og:title" content="${escapeHtml(page.ogTitle ?? title)}">`);
    lines.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
    lines.push(`<meta property="og:url" content="${url}">`);
    lines.push('<meta property="og:locale" content="en_US">');
    lines.push(`<meta property="og:image" content="${image}">`);
    lines.push('<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">');
    lines.push(`<meta property="og:image:alt" content="${escapeHtml(config.name)} — ${escapeHtml(config.tagline)}">`);
    lines.push('<meta name="twitter:card" content="summary_large_image">');
    lines.push(`<meta name="twitter:title" content="${escapeHtml(page.ogTitle ?? title)}">`);
    lines.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`);
    lines.push(`<meta name="twitter:image" content="${image}">`);
    for (const feed of config.feeds ?? []) lines.push(`<link rel="alternate" type="${feed.type}" title="${escapeHtml(feed.title)}" href="${feed.href}">`);
    for (const value of page.jsonLd ?? []) lines.push(jsonScript(value));
  }
  lines.push(END);
  return lines.join('\n');
}

export function patchHtml(html, config, page) {
  if (!/<\/head>/iu.test(html)) throw new Error(`${page.file}: no </head>`);
  let out = html.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}`, 'u'), '');
  page.currentTitle = out.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] ?? config.name;
  const description = page.description ?? config.description;
  const title = page.title;
  if (title) out = /<title/iu.test(out) ? out.replace(/<title[^>]*>[^<]*<\/title>/iu, `<title>${escapeHtml(title)}</title>`) : out.replace(/<\/head>/iu, `<title>${escapeHtml(title)}</title>\n</head>`);
  const unique = [];
  out = out.replace(/\s*<meta\s+name=["']description["'][^>]*>/giu, '');
  out = out.replace(/\s*<link\s+rel=["']canonical["'][^>]*>/giu, '');
  out = out.replace(/\s*<link\s+rel=["'](?:icon|apple-touch-icon|shortcut icon)["'][^>]*>/giu, '');
  unique.push(`<meta name="description" content="${escapeHtml(description)}">`);
  unique.push('<link rel="icon" type="image/svg+xml" href="/favicon.svg">', '<link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="48x48">', '<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  const block = `${unique.join('\n')}\n${headBlock(config, page)}`;
  return out.replace(/<\/head>/iu, `${block}\n</head>`);
}

export async function applyWebStandards({ dir, config, date }) {
  const out = resolve(dir);
  const write = async (path, body) => { await mkdir(dirname(join(out, path)), { recursive: true }); await writeFile(join(out, path), body); };
  const hashes = [];
  for (const page of config.pages) {
    const html = await readFile(join(out, page.file), 'utf8');
    const patched = patchHtml(html, config, page);
    hashes.push(...inlineScriptHashes(patched));
    await write(page.file, patched);
  }
  for (const name of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'card.png', 'logo.png']) {
    await mkdir(out, { recursive: true });
    await cp(join(config.brandDir, name), join(out, name));
  }
  await write('robots.txt', robotsTxt(config.origin));
  await write('sitemap.xml', sitemapXml(config.origin, config.pages, date));
  await write('llms.txt', config.llms);
  await write('.well-known/security.txt', securityTxt(config.origin, config.contact ?? 'cto@561.group', date));
  await write('_headers', headersFile(contentSecurityPolicy({ hashes, ...config.csp })));
  return { pages: config.pages.map((page) => page.file), inlineScriptHashes: [...new Set(hashes)] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dateAt = args.indexOf('--date');
  const date = dateAt >= 0 ? args.splice(dateAt, 2)[1] : new Date().toISOString().slice(0, 10);
  const [dir, configPath] = args;
  if (!dir || !configPath || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error('Usage: apply-web-standards <public-dir> <standards.config.mjs> [--date YYYY-MM-DD]');
  const factory = (await import(pathToFileURL(resolve(configPath)).href)).default;
  const config = await factory({ dir: resolve(dir), configDir: dirname(resolve(configPath)) });
  console.log(JSON.stringify(await applyWebStandards({ dir, config, date }), null, 2));
}
