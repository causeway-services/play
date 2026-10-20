import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderTufteFragment } from '@red-cup-engineering/web-page-tiling-engine';
import { TUFTE_TOUCH_STYLES } from '@red-cup-engineering/web-page-tiling-engine/theme';
import { discoverCatalog } from './discover-catalog.mjs';
import { catalogModel } from '../js/catalog.mjs';
import { computeTodayModel } from '../js/today.mjs';
import { indexHtml, todayHtml } from './shells.mjs';
import { bindShelfProjector } from './composition.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function publishShelf({ sources, observePages = false, fetchImpl, date = new Date() } = {}) {
  const { catalog, json } = await discoverCatalog({ sources, generatedDate: date.toISOString().slice(0, 10), observePages, fetchImpl });
  const entries = catalog.games;
  const daily = await computeTodayModel(date, entries);
  const artifacts = [
    { path: 'catalog.json', body: json, source: 'authored-game-records' },
    { path: 'css/tufte-touch.css', body: TUFTE_TOUCH_STYLES, source: 'tufte-touch-contract' },
    { path: 'index.html', body: indexHtml(renderTufteFragment(catalogModel(entries)), entries), source: 'game-shelf' },
    { path: 'today.html', body: todayHtml(renderTufteFragment(daily), catalog.generated), source: 'daily-seeds' },
  ];
  for (const name of ['catalog', 'today']) {
    const result = await build({ absWorkingDir: root, entryPoints: [`js/${name}.mjs`], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, legalComments: 'eof' });
    artifacts.push({ path: `js/${name}.js`, body: result.outputFiles[0].text, source: `browser:${name}` });
  }
  for (const path of ['css/style.css', 'chrome/shelf-chrome.css', 'src/favicon.svg']) {
    artifacts.push({ path: path === 'src/favicon.svg' ? 'favicon.svg' : path, body: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'), source: path });
  }
  return { artifacts };
}

export const createShelfProjector = (options = {}) => bindShelfProjector(publishShelf, options);
export const shelfProjector = createShelfProjector();
