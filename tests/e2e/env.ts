/**
 * The addresses and the fixture account the Playwright tier runs against.
 *
 * ── The three ports come from this checkout, not from a literal ──────────
 *
 * They used to be 5297, 5298 and 5299, the same three numbers in every clone
 * and every worktree of this repository on a host, so two trees running this
 * tier at once collided on all three. They are now derived from the real path
 * of THIS checkout, so each working tree takes its own triple and needs no
 * coordination with any other. See ADR-0017 for the decision and the arithmetic.
 *
 * ── The decision has to be made here, synchronously ──────────────────────
 *
 * `playwright.config.ts` is evaluated before anything is listening: the app
 * server is started by Playwright's own `webServer` with `SYNC_SERVER_URL`
 * already baked into its command line, so the sync address has to be decided
 * first and the fake service has to be told to take it.
 * `tests/integration/fake-sync-service.ts` grew its `port` option for exactly
 * this caller and for no other.
 *
 * That config module is also evaluated in the runner AND in every worker
 * process, exactly like the `FONTCONFIG_FILE` assignment it already carries.
 * So the answer must be a pure function of the checkout path plus the optional
 * override below, computed at module load, identical in every process. A free
 * port picked at run time would give each worker a different answer.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The variable that overrides the derived base, for the rare pair of checkouts
 * whose paths hash to the same slot.
 */
export const E2E_PORT_BASE_VAR = 'OPENPLATE_E2E_PORT_BASE';

/** How many consecutive ports one run of this tier takes. */
const PORTS_PER_TREE = 3;

/** The lowest base the derivation can produce. */
const PORT_BASE_FLOOR = 10_000;

/**
 * How many disjoint triples the derivation chooses between.
 *
 * 7000 slots of 3 ports reach 30999 at the top, which stays below Linux's
 * ephemeral range (32768 upwards) so the kernel never hands this tier's port to
 * somebody else's outgoing socket, and stays well clear of 3000 (dev server),
 * 3007 (seeded instance), 5173 (Vite) and 5433 (the shared Postgres).
 */
const PORT_BASE_SLOTS = 7_000;

/** The lowest base the override accepts: below 1024 a bind needs root. */
const OVERRIDE_FLOOR = 1_024;

/** The highest base that still leaves room for three consecutive valid ports. */
const OVERRIDE_CEILING = 65_535 - (PORTS_PER_TREE - 1);

/** A whole decimal number and nothing else, so `1e4` and `0x2710` are refused. */
const WHOLE_NUMBER = /^[0-9]+$/;

/**
 * The path a derivation should hash: symlinks resolved, so two names for one
 * checkout cannot produce two different triples for the same directory.
 *
 * Separate from the derivation itself because it touches the file system and
 * the derivation does not.
 *
 * @param repoRoot - a path to the repository root, absolute or relative.
 */
export function canonicalRepoRoot(repoRoot: string): string {
  return realpathSync(resolve(repoRoot));
}

/**
 * Reads the override, or refuses it in one sentence that names the variable.
 *
 * @param raw - the variable's value, already trimmed and known to be non-empty.
 */
function portBaseFromOverride(raw: string): number {
  const parsed = Number(raw);
  if (!WHOLE_NUMBER.test(raw) || parsed < OVERRIDE_FLOOR || parsed > OVERRIDE_CEILING) {
    throw new Error(
      `${E2E_PORT_BASE_VAR}=${raw} is not a usable port base: it has to be a whole number ` +
        `between ${OVERRIDE_FLOOR} and ${OVERRIDE_CEILING}, so that it, ${E2E_PORT_BASE_VAR}+1 ` +
        'and +2 are all valid ports this tier can bind.',
    );
  }
  return parsed;
}

/**
 * This checkout's first port. The other two are the next two numbers up.
 *
 * DETERMINISTIC AND OFFLINE, on purpose: every process in a run recomputes it
 * from the same checkout path and gets the same answer, which is what lets the
 * `webServer` command line be built before anything is listening.
 *
 * @param options.repoRoot - the checkout's root path, hashed as written.
 * @param options.override - `OPENPLATE_E2E_PORT_BASE`, when a person set it.
 */
export function deriveE2ePortBase(options: { repoRoot: string; override?: string | undefined }): number {
  const override = options.override?.trim() ?? '';
  if (override !== '') return portBaseFromOverride(override);

  // The first four bytes of the digest, as an unsigned integer. A hash rather
  // than a counter because there is nowhere to keep a counter that two
  // independent checkouts would both read.
  const digest = createHash('sha256').update(resolve(options.repoRoot)).digest();
  const slot = digest.readUInt32BE(0) % PORT_BASE_SLOTS;
  return PORT_BASE_FLOOR + PORTS_PER_TREE * slot;
}

/** This checkout's root: `tests/e2e/` sits two directories below it. */
const REPO_ROOT = canonicalRepoRoot(fileURLToPath(new URL('../../', import.meta.url)));

/** The first of this checkout's three consecutive ports. */
export const E2E_PORT_BASE = deriveE2ePortBase({
  repoRoot: REPO_ROOT,
  override: process.env[E2E_PORT_BASE_VAR],
});

/** Where the fake LowCarbCheck listens for this tier (M234 spec 07). */
export const E2E_FOOD_DB_PORT = E2E_PORT_BASE;

/** Where the fake sync service listens for this tier. */
export const E2E_SYNC_PORT = E2E_PORT_BASE + 1;

/** Where the production app server listens for this tier. */
export const E2E_APP_PORT = E2E_PORT_BASE + 2;

/** The app's base URL, also `use.baseURL` and the `webServer` readiness probe. */
export const E2E_APP_URL = `http://127.0.0.1:${E2E_APP_PORT}`;

/** The sync service's base URL, handed to the app as `SYNC_SERVER_URL`. */
export const E2E_SYNC_SERVER_URL = `http://127.0.0.1:${E2E_SYNC_PORT}`;

/**
 * The food database's base URL, handed to the app as `FOOD_DB_API_URL`.
 *
 * NAMED HERE FOR EVERY SPEC, not only the one that reads reference values:
 * without it the production server would ask the real lowcarbcheck.org on
 * every search, which is somebody else's uptime inside this tier.
 */
export const E2E_FOOD_DB_URL = `http://127.0.0.1:${E2E_FOOD_DB_PORT}`;

/**
 * The Matomo base URL, handed to the app as `MATOMO_URL` with site id 1
 * (M250/06).
 *
 * ON THE FAKE FOOD DATABASE'S ORIGIN, which answers every path it does not
 * know with a fast 404, so every spec that does not care about analytics loads
 * no tracker and pays nothing: `matomo.js` 404s, the queue is never drained,
 * and no request leaves. The funnel spec routes `matomo.js` and `matomo.php`
 * on this origin itself. A loopback origin rather than an invented host,
 * because a name nothing resolves could hold a page's load event for as long
 * as a DNS lookup takes to fail.
 */
export const E2E_MATOMO_URL = `${E2E_FOOD_DB_URL}/matomo/`;

/**
 * The fixture account, created once in `global-setup.ts`.
 *
 * An address in a reserved, undeliverable TLD (RFC 2606), like
 * `scripts/seed-test-account.ts` uses, so it is obviously fake at a glance.
 */
export const E2E_ACCOUNT_EMAIL = 'e2e@example.invalid';

/** The fixture account's password. It exists only inside this test tier. */
export const E2E_ACCOUNT_PASSPHRASE = 'seventeen purple lanterns drifting';

/**
 * The environment variable that carries the minted invite to
 * `create-fixture-account.ts`.
 *
 * Named here rather than in either end of the handover, so the setter and the
 * reader cannot drift apart.
 */
export const E2E_INVITE_TOKEN_VAR = 'OPENPLATE_E2E_INVITE_TOKEN';
