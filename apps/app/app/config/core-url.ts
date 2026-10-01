/**
 * The address of openplate-core, read from `CORE_URL`, with `SYNC_SERVER_URL` as the old name.
 *
 * openplate-core started as the sync service, and the setting that names it was called
 * `SYNC_SERVER_URL`. Core is the account service, the AI proxy and the mailer now, so the setting
 * is `CORE_URL`. Renaming a setting breaks every running install that still has the old name in
 * its `.env`, so the old name keeps working for one release, with a warning.
 *
 * ── What is decided here, and nowhere else ───────────────────────────────
 *
 * - `CORE_URL` wins when it is set.
 * - `SYNC_SERVER_URL` is read when `CORE_URL` is not, and the boot logs ONE warning that names the
 *   new setting.
 * - Both set to the same address is quiet: the operator already has the new name and has not
 *   cleaned up the old one yet.
 * - Both set to different addresses stops the boot. There is no correct silent reading: either
 *   name could be the one the operator means, and picking one would point the app at a server the
 *   operator may not expect, with their people's diaries on it.
 * - An empty or whitespace-only value counts as unset, like every other setting here. Compose
 *   forwards both names with an empty default, so an install that sets one of them has the other
 *   one empty, and that must not read as a conflict.
 *
 * ── The warning is once per process, not once per parse ──────────────────
 *
 * The production server loads the config twice, once from `server.ts` and once inside the
 * react-router build, so a plain "warn when parsing" prints the line twice. The sink is wrapped in
 * {@link warnOncePerProcess}, which remembers what it has said on `globalThis`, shared by both
 * copies of this module.
 *
 * Pure module: it reads only the environment bag it is given, so it is unit tested without a
 * process environment (`tests/unit/core-url.test.ts`).
 */

/** The setting this app reads the address of openplate-core from. */
export const CORE_URL_NAME = 'CORE_URL';

/** The old name of the setting, still read for one release. */
export const DEPRECATED_CORE_URL_NAME = 'SYNC_SERVER_URL';

/** The one line the boot logs when only the old name is set. Plain words, exact text, tested. */
export const DEPRECATED_CORE_URL_WARNING =
  'SYNC_SERVER_URL is deprecated, set CORE_URL instead; the old name stops working in a later release.';

/** The address as the operator wrote it, and the name it came from, so an error can name that setting. */
export interface CoreUrlSetting {
  /** The trimmed value, or `undefined` when neither name is set. */
  raw: string | undefined;
  /** The name `raw` was read from, or `CORE_URL` when neither is set. */
  name: typeof CORE_URL_NAME | typeof DEPRECATED_CORE_URL_NAME;
}

/** An environment bag: `process.env`, or whatever a test hands in. */
type EnvironmentBag = Readonly<Record<string, string | undefined>>;

/** The value of one setting, or `undefined` when it is unset, empty or whitespace. */
function readSetting(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed;
}

/** Whether two addresses are the same place, ignoring the trailing slashes the parser trims anyway. */
function isSameAddress(input: { first: string; second: string }): boolean {
  return input.first.replace(/\/+$/, '') === input.second.replace(/\/+$/, '');
}

/**
 * Reads the address of openplate-core from the environment.
 *
 * @param input.env - the environment bag to read.
 * @param input.warn - called once with {@link DEPRECATED_CORE_URL_WARNING} when only the old name
 *   is set. Not called in any other case.
 * @returns the winning raw value and the name it came from. The value is NOT validated here:
 *   `parseCoreUrl` in `public-config.ts` does that, and names this setting in its error.
 * @throws when both names are set to different addresses.
 */
export function resolveCoreUrl(input: { env: EnvironmentBag; warn: (message: string) => void }): CoreUrlSetting {
  // Literal `env.NAME` reads, not the constants above: the compose and docs checks find a setting
  // by scanning the config sources for exactly this shape, and both names must stay visible to them.
  const current = readSetting(input.env.CORE_URL);
  const deprecated = readSetting(input.env.SYNC_SERVER_URL);

  if (current !== undefined && deprecated !== undefined) {
    if (!isSameAddress({ first: current, second: deprecated })) {
      throw new Error(
        `${CORE_URL_NAME} and ${DEPRECATED_CORE_URL_NAME} are both set, and they name different addresses ` +
          `(${current} and ${deprecated}). ${DEPRECATED_CORE_URL_NAME} is the old name of ${CORE_URL_NAME}. ` +
          `Remove ${DEPRECATED_CORE_URL_NAME}, or make the two the same.`,
      );
    }
    return { raw: current, name: CORE_URL_NAME };
  }
  if (current !== undefined) return { raw: current, name: CORE_URL_NAME };
  if (deprecated !== undefined) {
    input.warn(DEPRECATED_CORE_URL_WARNING);
    return { raw: deprecated, name: DEPRECATED_CORE_URL_NAME };
  }
  return { raw: undefined, name: CORE_URL_NAME };
}

declare global {
  /**
   * What {@link warnOncePerProcess} has already said, shared by every copy of this module. It
   * lives on `globalThis` for the reason the header gives, and has a name no other code uses.
   */
  var openplateCoreUrlWarningsSaid: Set<string> | undefined;
}

/**
 * Passes `message` to `sink` the first time this process sees it, and drops it after that.
 *
 * The memory lives on `globalThis` and not in a module variable, because the same source is
 * loaded twice in the production server (see the header), and two module variables would each
 * say the line once.
 */
export function warnOncePerProcess(input: { message: string; sink: (message: string) => void }): void {
  const said = (globalThis.openplateCoreUrlWarningsSaid ??= new Set<string>());
  if (said.has(input.message)) return;
  said.add(input.message);
  input.sink(input.message);
}
