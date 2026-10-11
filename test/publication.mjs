import { publishShelf } from '../src/publication.mjs';
const publication = publishShelf({ observePages: false });
export async function readPublication(path) {
  const artifact = (await publication).artifacts.find((asset) => asset.path === path);
  if (!artifact) throw new Error(`No publication artifact: ${path}`);
  return artifact.body;
}
