import { discoverCatalog } from '../discover-catalog.mjs';

/** Local authored sources are the default. A remote URL is an explicit input,
 * not an implicit startup request. No screen or child process is started here. */
export async function loadShelfCatalog({ sources, catalogUrl, fetchImpl = fetch } = {}) {
  if (catalogUrl) {
    try {
      const response = await fetchImpl(catalogUrl, { signal: AbortSignal.timeout(4000) });
      if (response.ok) return await response.json();
    } catch { /* retain the existing local-source fallback */ }
  }
  return (await discoverCatalog({ sources })).catalog;
}
