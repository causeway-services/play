/** Parse explicit invocation inputs, never a catalog or a persistent registry. */
export function catalogSourcesFromEnvironment(env = process.env) {
  if (env.PLAY_CATALOG_SOURCES === undefined) return undefined;
  const sources = JSON.parse(env.PLAY_CATALOG_SOURCES);
  if (!Array.isArray(sources) || !sources.length) throw new Error('PLAY_CATALOG_SOURCES must be a nonempty source array');
  return sources;
}

export function publicationDateFromEnvironment(env = process.env) {
  if (env.PLAY_CATALOG_DATE === undefined) return undefined;
  const value = env.PLAY_CATALOG_DATE;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('PLAY_CATALOG_DATE must be a real UTC date in YYYY-MM-DD form');
  }
  return date;
}

/** The publisher's real domain is {sources, date, observePages, fetchImpl};
 * its result is {artifacts}. Binding those invocation inputs does no I/O. */
export function bindShelfProjector(publishShelf, options = {}) {
  if (typeof publishShelf !== 'function') throw new TypeError('publishShelf must be a function');
  const observePages = options.observePages ?? false;
  if (typeof observePages !== 'boolean') throw new TypeError('observePages must be boolean');
  return { name: 'game-shelf', priority: 15, project: () => publishShelf({ ...options, observePages }) };
}
