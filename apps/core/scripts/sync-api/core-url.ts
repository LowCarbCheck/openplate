/**
 * The address the admin CLI talks to, read from `CORE_URL`, with `SYNC_SERVER_URL` as the old name.
 *
 * The same rule `apps/app/app/config/core-url.ts` applies to the app server, written again here
 * because this CLI is a thin client that imports nothing from the service or from the app
 * (`tests/unit/sync-api-no-db-imports.test.ts`), and because the two apps share no package:
 *
 * - `CORE_URL` wins when it is set.
 * - `SYNC_SERVER_URL` is read when `CORE_URL` is not, and one warning goes to standard error.
 * - both set to the same address is quiet, and both set to different addresses is a refusal.
 *   Picking one would aim an admin command that can erase accounts at a server the operator may
 *   not mean.
 * - an empty or blank value counts as unset.
 *
 * `--url` beats all of this, and `main.ts` does not call this function when it is given, so a flag
 * is never refused because of a stale environment variable.
 */
import { CliError } from './client.js';

/** The one line printed when only the old name is set. Plain words, exact text, tested. */
export const DEPRECATED_CORE_URL_WARNING =
  'SYNC_SERVER_URL is deprecated, set CORE_URL instead; the old name stops working in a later release.';

/** The value of one setting, or `undefined` when it is unset, empty or blank. */
function readSetting(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed;
}

/** Whether two addresses are the same place, ignoring trailing slashes. */
function isSameAddress(input: { first: string; second: string }): boolean {
  return input.first.replace(/\/+$/, '') === input.second.replace(/\/+$/, '');
}

/**
 * The service address from the environment, or `undefined` when neither name is set.
 *
 * @param input.env - the environment to read, `process.env` in the CLI.
 * @param input.warn - called once with {@link DEPRECATED_CORE_URL_WARNING} when only the old name is set.
 * @throws {CliError} when both names are set to different addresses.
 */
export function resolveCoreUrl(input: {
  env: Readonly<Record<string, string | undefined>>;
  warn: (message: string) => void;
}): string | undefined {
  const current = readSetting(input.env.CORE_URL);
  const deprecated = readSetting(input.env.SYNC_SERVER_URL);

  if (current !== undefined && deprecated !== undefined && !isSameAddress({ first: current, second: deprecated })) {
    throw new CliError(
      `CORE_URL and SYNC_SERVER_URL are both set, and they name different addresses (${current} and ${deprecated}). ` +
        'SYNC_SERVER_URL is the old name of CORE_URL. Unset SYNC_SERVER_URL, or pass --url.',
    );
  }
  if (current !== undefined) return current;
  if (deprecated !== undefined) input.warn(DEPRECATED_CORE_URL_WARNING);
  return deprecated;
}
