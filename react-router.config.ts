import type { Config } from '@react-router/dev/config';

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Offline PWA navigation cannot depend on runtime `/__manifest` fetches (they fail offline and abort navigation before any route loader runs); ship the full route manifest upfront instead — the route tree is small, so the extra initial-load cost is negligible.
  routeDiscovery: { mode: 'initial' },
} satisfies Config;
