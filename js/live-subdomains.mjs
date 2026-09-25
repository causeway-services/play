// Public hostnames this storefront may honestly link to as live. 2026-08-31 free-tier pivot: a
// migrated game gets its own dedicated Worker and leaves the shared cloudflare-router; a
// game still ONLY in the router rides a dead Cloud Run origin (billing off), not live.
// test/honest-links.test.mts rejects drift from the real routing state.
export const LIVE_SUBDOMAINS = new Set([
  'weiqi.561.group',
  'crucible.play.561.group',
  'solitaire.play.561.group',
  'gambling-trainer.play.561.group',
  'stoke.play.561.group',
  'parlor.play.561.group',
  'you-are-conscious.play.561.group',
  'fearful.play.561.group',
]);
