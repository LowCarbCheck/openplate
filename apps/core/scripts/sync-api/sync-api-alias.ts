/**
 * `pnpm sync-api`, the old name of `pnpm core-api`, kept for one release.
 *
 * It is the same CLI and not a copy of it: the notice module runs first and prints one line to
 * standard error, then `main.ts` runs exactly as it does under `pnpm core-api`. Delete this file,
 * the notice module and the `sync-api` script in `package.json` when the old name is retired.
 */
import './sync-api-alias-notice.js';
import './main.js';
