import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import productionConfig from './vite.config';

/**
 * ── THE STATES PLAYGROUND'S OWN VITE CONFIG (DEV ONLY) ───────────────────
 *
 * `pnpm playground` runs `vite --config vite.playground.config.ts`. The page
 * is `playground.html`, its code is `app/playground/`. See that HTML file for
 * why none of it can reach a build.
 *
 * WHY A CONFIG OF ITS OWN. `vite.config.ts` loads `reactRouter()`, which puts
 * the whole app in framework mode: it owns the entry, the routes and the
 * server. The playground is one plain page of real components, so it needs
 * none of that. The plugins are Tailwind and nothing else. Vite 8 compiles
 * TSX itself, and reads the `react-jsx` setting from `tsconfig.json`.
 *
 * WHAT IS SHARED WITH THE PRODUCTION CONFIG, by calling it rather than by
 * copying it:
 *
 * - `resolve.tsconfigPaths`, which is what makes `#app/*` resolve (the paths
 *   live in `tsconfig.json`, there is no `imports` field in `package.json`).
 * - `optimizeDeps.include`, the pre-bundle list. A copy would drift; the call
 *   cannot. It only reads the config object, it builds nothing.
 *
 * NO SERVER BEHIND IT. Every `/api/*` request is answered with a 404 and a
 * one-line JSON body, so a component that fetches something fails loudly and
 * the same way every time, instead of getting the dev server's HTML page.
 *
 * NO SERVICE WORKER. `app/playground/main.tsx` imports no registration code,
 * and `public/` is served as files only.
 */

/** The port is fixed: a second playground on the same host should fail, not move. */
const PLAYGROUND_PORT = 5299;

/** The page the bare address goes to. */
const PLAYGROUND_PAGE = '/playground.html';

/** The stamp every `__OPENPLATE_BUILD__` read gets. Not a real build, and it says so. */
const PLAYGROUND_BUILD: OpenplateBuildInfo = {
  version: 'playground',
  sha: 'playground',
  builtAt: new Date().toISOString(),
};

/** Sends `/` to the playground page and answers the API prefix with a plain 404. */
function playgroundServerPlugin(): Plugin {
  return {
    name: 'openplate-playground-server',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '/';
        const pathname = url.split('?')[0] ?? '/';
        if (pathname === '/') {
          response.statusCode = 302;
          response.setHeader('Location', PLAYGROUND_PAGE);
          response.end();
          return;
        }
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'playground has no server' }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const production = productionConfig({ mode, command, isSsrBuild: false, isPreview: false });

  return {
    root: import.meta.dirname,
    // Multi-page behaviour: an unknown path is a 404, never the single-page fallback.
    appType: 'mpa',
    plugins: [tailwindcss(), playgroundServerPlugin()],
    define: {
      __OPENPLATE_BUILD__: JSON.stringify(PLAYGROUND_BUILD),
    },
    resolve: {
      tsconfigPaths: true,
    },
    optimizeDeps: {
      // The page is the entry; without it Vite scans the whole app for imports.
      entries: [resolve(import.meta.dirname, 'playground.html')],
      include: production.optimizeDeps?.include ?? [],
    },
    server: {
      port: PLAYGROUND_PORT,
      strictPort: true,
      // Never `0.0.0.0` by default. `make playground` passes the tailnet address.
      host: env.PLAYGROUND_HOST ?? '127.0.0.1',
      // Same rule as `vite.config.ts`: names beyond localhost and IPs are listed here.
      allowedHosts: (env.VITE_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter((host) => host !== ''),
    },
  };
});
