# shelf-chrome — the shared shelf frame

source for the small shared UI frame every 561 shelf game wears: the-suite-and-
the-studio.md §5 directive 1 ("Shelf chrome... the modern card back. Rides the cartridge
contract; vendored per house doctrine, not live-imported.").

**Scope, deliberately small.** This is not a theme system and does not replace any game's
own palette. It owns exactly three things: the small shelf mark next to a game's own title,
the "part of the 561 shelf" footer line, and the focus-visible/reduced-motion/type-scale
rules those two things need. Every game keeps its own background, panel, ink, and accent
tokens — same card back, different felt.

## Files

- `shelf-chrome.css` — the CSS. Every `--shelf-*` token falls back to the game's own
  `--accent` / `--ink-dim` (or `--text-dim`) / `--border` / `--bg` / `--ink` tokens first,
  and only then to a neutral default (crucible / gambling-trainer's palette, the newest pair
  at the time this was drawn up). A game with no matching token still renders correctly off
  the defaults alone.

## Vendoring a copy (house doctrine: vendor a copy, not a live import)

1. Copy `shelf-chrome.css` byte-identical into the game's own css directory (or, for a
   template-literal `.mts` client with no separate CSS file, into a small `chrome.mts` that
   exports the same text as a string constant).
2. Add a one-line provenance header at the top of the copy naming this file as the source —
   the same convention as `onestone-service/src/ledger.mts`'s header naming
   `flickering-delve-service/src/ledger.mts`, or `lantern-service/src/stability.mts`'s header
   naming `onestone-service/src/validate.mts` (house-specification-standard.md, "vendor a
   copy, not a cross-service import").
3. Link/import it *after* the game's own stylesheet so the game's own rules still win any
   token collision.
4. Add the mark next to the game's own title and the footer line at the end of the page —
   see markup below. No other HTML should change.

## Markup

Header (goes next to the game's own title, inside its existing header element):

```html
<svg class="shelf-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
  <ellipse cx="24" cy="24" rx="18" ry="11"/>
  <path d="M13 17q11-6 22 0" stroke-width="1.3" opacity="0.6"/>
  <path d="M11 24 14.25 21.5 17.5 24 20.75 21.5 24 24 27.25 21.5 30.5 24 33.75 21.5 37 24"/>
</svg>
```

Footer (a new line inside or beside the game's existing footer):

```html
<p class="shelf-footer-line">
  <svg class="shelf-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
    <ellipse cx="24" cy="24" rx="18" ry="11"/>
    <path d="M13 17q11-6 22 0" stroke-width="1.3" opacity="0.6"/>
    <path d="M11 24 14.25 21.5 17.5 24 20.75 21.5 24 24 27.25 21.5 30.5 24 33.75 21.5 37 24"/>
  </svg>
  Part of the <a href="https://play.561.group">561 shelf</a>.
</p>
```

The `<svg>` is a small hand-drawn cowrie shell — an oval shell outline, a faint dorsal ridge,
and a toothed aperture line down the middle, echoing the real animal's underside — the same
mark `play.561.group/index.html` uses for its own header (`.mark`), at chrome scale, so a
player recognizes the same glyph on the storefront and inside every game (the house's Cowrie
Games mark; see naming-the-three-houses.md).

## Where it's vendored

crucible-service, gambling-trainer-service, flickering-delve-service, onestone-service,
weiqi-web. See each service's own vendored `shelf-chrome.css` (or `chrome.mts`) header for
its provenance note. solitaire-service does not yet carry the shelf mark + footer line --
the vendoring recipe above applies unchanged whenever it's picked up.
