// What play.561.group publishes about itself to crawlers, card renderers and
// answer engines. scripts/apply-web-standards.mjs applies it to the built public/
// directory; everything per-game is read from the catalog that build produced.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { playUrl } from './js/catalog.mjs';

const ORIGIN = 'https://play.561.group';
const NAME = 'Play';
const TAGLINE = '561 Group browser games that show their odds';
const HOME_DESCRIPTION = "Find 561 Group games and courses, their browser entry pages, and their terminal or API interfaces.";

// schema.org genre for each shelf; a game's own entry here wins over its shelf.
const SHELF_GENRE = { 'Card Table': 'Card game', 'Puzzle Den': 'Puzzle', Study: 'Educational', Deep: 'Role-playing', unshelved: 'Action' };
const GENRE = {
  'gambling-trainer': 'Educational', 'flickering-delve': 'Idle roguelike', onestone: 'Puzzle', crucible: 'Puzzle',
  stoke: 'Idle', 'you-are-conscious': 'Idle', weiqi: 'Board game', ruinfold: 'Roguelike', durante: 'First-person shooter',
  farstone: 'Text adventure', aletheon: 'MMORPG', 'be-not-so-fearful': 'First-person shooter', blackjack: 'Casino card game',
  chutes: 'Board game', farkle: 'Dice game', pig: 'Dice game', reels: 'Slot machine', slots: 'Slot machine', yacht: 'Dice game',
};

/** The first sentence of an authored description, trimmed to one line. */
export function oneLine(text, limit = 170) {
  const first = String(text).replace(/\s+/gu, ' ').trim().split(/(?<=[.!?])\s/u)[0];
  if (first.length <= limit) return first;
  const cut = first.slice(0, limit - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export function llmsTxt(games, count = games.length) {
  const lines = [
    `# ${NAME}`, '',
    `> ${NAME} is the 561 Group's catalog of ${count} browser games and courses. Each entry links to its own page and keeps its author's description and reported status; page checks report reachability at publication, not a complete play test.`, '',
    `Machine-readable catalog: ${ORIGIN}/catalog.json. Games are free to open in a browser; many show their odds, expected value or house edge.`, '',
    '## Games', '',
    ...games.map((game) => `- [${game.displayName}](${playUrl(game)}): ${oneLine(game.description)}`), '',
    '## Catalog', '',
    `- [Catalog data](${ORIGIN}/catalog.json): every game's description, entry points, replay contracts and page observations as JSON`,
    `- [Today](${ORIGIN}/today): the shared UTC daily seed for each game that has one`,
    `- [Shelf](${ORIGIN}/): searchable catalog of all games, filterable by shelf and status`, '',
    '## Optional', '',
    `- [Atom feed](${ORIGIN}/feed.atom.xml)`,
    `- [JSON Feed](${ORIGIN}/feed.json)`,
    '- [561 Group](https://561.group/): the publisher',
    '- [Services](https://services.561.group/): Causeway Services, the 561 Group company that publishes Play', '',
  ];
  return `${lines.join('\n')}`;
}

export function jsonLd(games, count = games.length) {
  const organization = { '@type': 'Organization', '@id': 'https://561.group/#organization', name: '561 Group', url: 'https://561.group/', logo: `${ORIGIN}/logo.png` };
  return [{
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: NAME, alternateName: 'Cowrie Games', description: HOME_DESCRIPTION, inLanguage: 'en', publisher: { '@id': organization['@id'] } },
      organization,
      {
        '@type': 'ItemList', '@id': `${ORIGIN}/#games`, name: `${NAME}: ${count} browser games and courses`, numberOfItems: games.length, itemListOrder: 'https://schema.org/ItemListUnordered',
        itemListElement: games.map((game, index) => ({
          '@type': 'ListItem', position: index + 1,
          item: {
            '@type': 'VideoGame', name: game.displayName, url: playUrl(game), description: oneLine(game.description, 300),
            genre: GENRE[game.id] ?? SHELF_GENRE[game.shelf] ?? 'Game', gamePlatform: 'Web browser', isAccessibleForFree: true,
            publisher: { '@id': organization['@id'] },
          },
        })),
      },
    ],
  }];
}

export default async function standards({ dir, configDir }) {
  const catalog = JSON.parse(await readFile(join(dir, 'catalog.json'), 'utf8'));
  const games = catalog.games;
  return {
    origin: ORIGIN, name: NAME, tagline: TAGLINE, description: HOME_DESCRIPTION, contact: 'cto@561.group',
    brandDir: join(configDir, 'brand'),
    feeds: [
      { type: 'application/rss+xml', title: 'Play RSS', href: '/feed.rss.xml' },
      { type: 'application/atom+xml', title: 'Play Atom', href: '/feed.atom.xml' },
      { type: 'application/feed+json', title: 'Play JSON Feed', href: '/feed.json' },
    ],
    csp: { connect: ['https://ads.561.group'] },
    llms: llmsTxt(games),
    pages: [
      { path: '/', file: 'index.html', ogTitle: `${NAME}: ${TAGLINE}`, jsonLd: jsonLd(games) },
      { path: '/today', file: 'today.html', description: "Today's shared UTC daily seed for each Play game, with links to open each one in your browser." },
      { path: '/atlas/', file: 'atlas/index.html', description: 'Play games ordered by date created, newest first.' },
      { path: '/404', file: '404.html', noindex: true, sitemap: false },
    ],
  };
}
