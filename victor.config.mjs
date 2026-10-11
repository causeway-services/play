import { createShelfProjector } from './src/publication.mjs';
import { catalogSourcesFromEnvironment, publicationDateFromEnvironment } from './src/composition.mjs';
export default {
  site: { name: 'Cowrie Games', baseIri: 'https://play.561.group/', language: 'en' },
  home: false,
  archives: false,
  search: false,
  projectors: [createShelfProjector({ sources: catalogSourcesFromEnvironment(), date: publicationDateFromEnvironment() })],
};
