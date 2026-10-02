/**
 * Moved mode (`MOVED_TO_URL`): this instance is closed, and its people now use another address.
 *
 * ── Why a setting and not a redirect ─────────────────────────────────────
 *
 * People install openplate on a phone's home screen, and the installed app runs a service worker
 * that keeps the app's pages in its own cache. A redirect of the whole host, or a host that simply
 * goes away, never reaches that worker: a browser does not follow a redirect when it checks
 * `/sw.js` for an update, so the old worker stays installed and keeps opening its saved pages.
 * openplate.de met exactly that after the M194 cutover (see `public/sw.js` in LowCarbCheck/openplate-website). So the
 * closed instance keeps running, in this mode, until the last installed copy has asked for its
 * worker again: `/sw.js` answers a worker that deletes every cache and unregisters itself, and
 * every page answers one server-rendered page that names the new address. See
 * `app/lib/moved/moved-mode.server.ts` for the routes.
 *
 * ── What is refused, and why a refusal stops the boot ────────────────────
 *
 * Only an absolute `https://` address is accepted. The page sends people to sign in there, with
 * their password, so a plain `http://` address would put that password on the wire in clear, and
 * a relative or schemeless value has no host to name on the page. A user name or password inside
 * the address would be printed into a link every visitor can read. An address on this instance's
 * own origin (`APP_URL`) would send people to the page that sent them. Each of these is a typo
 * that has no correct silent reading, so each one stops the boot, the house rule
 * `DEFAULT_UI_LANGUAGE` follows too.
 *
 * Unset, empty and whitespace-only all mean `null`: the mode is off and nothing about the app
 * changes. `docker/compose.yml` forwards the variable with an empty default for that reason.
 *
 * Pure module: no `process.env` read, so it is unit tested without an environment
 * (`tests/unit/moved-config.test.ts`).
 */

/** Where the people of a closed instance go now. `null` everywhere else means the mode is off. */
export interface MovedConfig {
  /** The new address, normalized by the URL parser, e.g. `https://app.openplate.de/`. */
  readonly url: string;
  /** Its host, e.g. `app.openplate.de`: the name the moved page prints. */
  readonly host: string;
  /**
   * The sign-in page at the new address, where the moved page's one button goes. Always
   * `/sign-in` on that origin, because the new address runs openplate and the people sent there
   * already have an account.
   */
  readonly signInUrl: string;
}

/** An absolute `https://` address, scheme and both slashes, in any letter case. */
const ABSOLUTE_HTTPS = /^https:\/\//i;

/** The path of the sign-in page on any openplate instance (`app/routes.ts`). */
const SIGN_IN_PATH = '/sign-in';

/**
 * Parses `MOVED_TO_URL`.
 *
 * @param options.movedToUrl - `MOVED_TO_URL`, raw.
 * @param options.appUrl - `APP_URL` as the config resolved it, the address this instance serves.
 * @returns the new address, or `null` when the mode is off.
 * @throws when the value is set and is not an absolute `https://` address, carries credentials,
 *   or points at this instance's own origin.
 */
export function parseMovedConfig(options: { movedToUrl: string | undefined; appUrl: string }): MovedConfig | null {
  const raw = options.movedToUrl?.trim() ?? '';
  if (raw === '') return null;

  if (!ABSOLUTE_HTTPS.test(raw) || !URL.canParse(raw)) {
    throw new Error(
      `MOVED_TO_URL must be an absolute https:// address, such as https://app.openplate.de, got "${options.movedToUrl}". ` +
        'The moved page sends people there to sign in with their password, so a plain http:// or relative ' +
        'address is refused rather than printed.',
    );
  }

  const url = new URL(raw);
  if (url.username !== '' || url.password !== '') {
    throw new Error(
      'MOVED_TO_URL carries a user name or password. The moved page prints the address into a link every ' +
        'visitor can read, so it is refused.',
    );
  }

  if (URL.canParse(options.appUrl) && new URL(options.appUrl).origin === url.origin) {
    throw new Error(
      `MOVED_TO_URL (${url.origin}) is this instance's own address (APP_URL). The moved page would send ` +
        'people back to itself.',
    );
  }

  return { url: url.href, host: url.host, signInUrl: new URL(SIGN_IN_PATH, url.origin).href };
}
