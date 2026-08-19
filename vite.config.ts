import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.PORT ? parseInt(env.PORT, 10) : 3000;

  return {
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port: serverPort,
      // Dev-only: allow access via the machine hostname / tailnet MagicDNS name
      // (Vite blocks non-IP hosts by default). Override with VITE_ALLOWED_HOSTS
      // (comma-separated) for other setups.
      allowedHosts:
        env.VITE_ALLOWED_HOSTS ? env.VITE_ALLOWED_HOSTS.split(',') : ['bluefin', '.sprqvntrs.tailnet.internal'],
    },
    optimizeDeps: {
      // Dev-only QoL fix: the first navigation to a route using a
      // not-yet-discovered Radix primitive (e.g. Select, AlertDialog — not on
      // the app's first-loaded routes) triggers Vite's dependency optimizer to
      // discover it lazily mid-session, re-bundle, and reload — which can land
      // React with "more than one copy" errors if that reload races a render
      // in flight. Pre-bundling every Radix primitive this app actually uses
      // (see `app/components/ui/*.tsx`) up front avoids the lazy-discovery
      // reload entirely. Keep this list in sync with new `@radix-ui/react-*`
      // imports as they're added.
      include: [
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-avatar',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-label',
        '@radix-ui/react-select',
        '@radix-ui/react-separator',
        '@radix-ui/react-slot',
        '@radix-ui/react-switch',
        '@radix-ui/react-tooltip',
        // Same lazy-discovery hazard as the Radix primitives above, but for the
        // local-first primary store (M117/01): `tinybase` and its IndexedDB
        // persister aren't on every first-loaded route (e.g. a cold landing on
        // the marketing page), so the optimizer can discover them mid-session on
        // the first navigation into a local-store-backed route and trigger the
        // same re-bundle-and-reload race.
        'tinybase',
        'tinybase/persisters/persister-indexed-db',
        // Same lazy-discovery hazard again, for the i18n stack (M129/05):
        // `react-i18next` pulls in React, so a mid-session re-bundle of it is
        // exactly the "more than one copy of React" crash this list exists to
        // prevent.
        'i18next',
        'react-i18next',
        'i18next-browser-languagedetector',
        // Same hazard once more, for the sync engine's Argon2id (M128 spec
        // 04). `hash-wasm` is reached only from `/settings/sync` and from the
        // Argon2id Worker — never on a first load — so without this entry the
        // optimizer discovers it mid-session on the first navigation into
        // sync and triggers the re-bundle-and-reload race. The Worker makes it
        // worse than the others: a reload mid-derivation drops the derivation.
        // (`engine/crypto/argon2.ts`'s header records this requirement.)
        'hash-wasm',
      ],
    },
  };
});
