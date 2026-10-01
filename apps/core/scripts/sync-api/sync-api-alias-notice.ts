/**
 * The notice `pnpm sync-api` prints before it runs the admin CLI.
 *
 * `pnpm sync-api` is the old name of `pnpm core-api`. The two run the same CLI, `main.ts`, and
 * this module is the only difference: `sync-api-alias.ts` imports it BEFORE `main.ts`, and an ES
 * module runs its imports in order, so the line reaches standard error first. Standard error and
 * not standard output, so `pnpm sync-api accounts list --json` still pipes clean JSON.
 */

/** The one line the old name prints. Plain words, exact text, tested. */
const SYNC_API_ALIAS_NOTICE = 'pnpm sync-api is now pnpm core-api; the old name stops working in a later release.';

process.stderr.write(`${SYNC_API_ALIAS_NOTICE}\n`);
