/**
 * The address the admin CLI talks to, read from `CORE_URL`, with `SYNC_SERVER_URL` as the old name.
 *
 * The same rule `apps/app/app/config/core-url.ts` applies to the app server, written again here
 * because this CLI is a thin client that imports nothing from the service or from the app
 * (`tests/unit/sync-api-no-db-imports.test.ts`), and because the two apps share no package:
 *
 * - `CORE_URL` wins when it is set.
 * - `SYNC_SERVER_URL` is read when `CORE_URL` is not, and one warning goes to standard error.
 * - both set to the same address is quiet. Both set to different addresses: the OLD name wins for
 *   this release, and one warning to standard error names both values and says the old line must
 *   go before the release that drops the old name. It is not a refusal, on purpose: a quadlet
 *   install keeps `SYNC_SERVER_URL` in its own `app.env` while the new defaults file sets
 *   `CORE_URL`, so the two differ on installs nobody watches, and the address the operator wrote
 *   themselves is the one they meant. The app server applies the same rule.
 * - an empty or blank value counts as unset.
 *
 * `--url` beats all of this, and `main.ts` does not call this function when it is given, so a flag
 * is never affected by a stale environment variable.
 */

/** The one line printed when only the old name is set. Plain words, exact text, tested. */
export const DEPRECATED_CORE_URL_WARNING =
  'SYNC_SERVER_URL is deprecated, set CORE_URL instead; the old name stops working in a later release.';

/**
 * The one line printed when both names are set to different addresses. It names both values, says
 * which one is used, and says what to do. Plain words, exact text, tested.
 */
export function coreUrlConflictWarning(input: { current: string; deprecated: string }): string {
  return (
    `CORE_URL (${input.current}) and SYNC_SERVER_URL (${input.deprecated}) are both set and differ. ` +
    `For this release SYNC_SERVER_URL wins, so the CLI uses ${input.deprecated}. ` +
    'Remove the SYNC_SERVER_URL line before the release that drops the old name.'
  );
}

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
 * @param input.warn - called once with {@link DEPRECATED_CORE_URL_WARNING} when only the old name is
 *   set, and once with {@link coreUrlConflictWarning} when both are set to different addresses.
 */
export function resolveCoreUrl(input: {
  env: Readonly<Record<string, string | undefined>>;
  warn: (message: string) => void;
}): string | undefined {
  const current = readSetting(input.env.CORE_URL);
  const deprecated = readSetting(input.env.SYNC_SERVER_URL);

  if (current !== undefined && deprecated !== undefined) {
    if (isSameAddress({ first: current, second: deprecated })) return current;
    input.warn(coreUrlConflictWarning({ current, deprecated }));
    return deprecated;
  }
  if (current !== undefined) return current;
  if (deprecated !== undefined) input.warn(DEPRECATED_CORE_URL_WARNING);
  return deprecated;
}
