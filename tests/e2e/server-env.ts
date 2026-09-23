/**
 * WHAT THE BROWSER TIER'S SERVERS ARE TOLD, so no spec depends on the network.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The production server asks GitHub for the newest release tag at boot and
 * every six hours (M203, `app/lib/update-check.server.ts`). In this tier that
 * made the specs depend on the release calendar: the day 0.43.0 was tagged,
 * every branch still on 0.42.0 drew an "update available" ribbon at the top of
 * each page, and eight layout specs that measure the header and the first
 * screen failed on a tree nobody had touched. A tier that goes red because of
 * somebody else's release is not a gate, so the check is OFF here.
 *
 * A spec that is about the ribbon itself (`lcc-lineage-update-ribbon.spec.ts`)
 * answers `/api/update-status` with its own stub, so it needs no real answer.
 *
 * ── Why one module and not a literal in each server ──────────────────────
 *
 * The tier boots two kinds of server: its own (`playwright.config.ts`) and the
 * managed one some specs start (`managed-app-server.ts`). Both read their
 * environment from here, and `tests/unit/e2e-hermetic-server.test.ts` feeds
 * what each one would receive through the app's own parser. The hermetic values
 * are written LAST in both, so neither a caller's override nor the operator's
 * shell can turn the check back on.
 */

/** The variables that keep a tier server off the network. `UPDATE_CHECK` is parsed by `parseUpdateCheck`. */
export const HERMETIC_SERVER_ENV = {
  UPDATE_CHECK: 'off',
} as const satisfies Readonly<Record<string, string>>;

/** What the tier's own server needs to know, apart from the hermetic set. */
export interface TierServerCommandOptions {
  readonly port: number;
  readonly appUrl: string;
  readonly syncServerUrl: string;
  readonly contentDir: string;
  readonly foodDbUrl: string;
  readonly foodDbApiKey: string;
  readonly matomoUrl: string;
}

/** Renders a variable set as `cross-env` assignments, one `KEY=value` per entry. */
function toAssignments(env: Readonly<Record<string, string>>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

/**
 * The command `playwright.config.ts` starts its production server with.
 *
 * `cross-env` assignments override the inherited environment, so an
 * `UPDATE_CHECK=on` in the shell that runs the tier does not reach the server.
 */
export function buildTierServerCommand(options: TierServerCommandOptions): string {
  const assignments = {
    NODE_ENV: 'production',
    PORT: String(options.port),
    HOST: '127.0.0.1',
    APP_URL: options.appUrl,
    SYNC_SERVER_URL: options.syncServerUrl,
    // THE LEGAL PAGES COME FROM A FIXTURE FOLDER. Unset, every content route
    // would 404 and the footer would lose its five legal links, which several
    // specs here count.
    CONTENT_DIR: options.contentDir,
    // THE FOOD DATABASE IS A FAKE IN THIS TIER (`fake-food-db.ts`). Left unset,
    // the production server asks the real lowcarbcheck.org, so a smoke tier
    // would depend on somebody else's uptime and assert against numbers this
    // repository does not hold.
    FOOD_DB_API_URL: options.foodDbUrl,
    // ANALYTICS ARE ON IN THIS TIER, pointed at a loopback origin that serves
    // nothing, so the plans funnel spec can read the events off the wire. Every
    // other spec loads no tracker, because `matomo.js` 404s there.
    MATOMO_URL: options.matomoUrl,
    MATOMO_SITE_ID: '1',
    // BACKFILL IS ON IN THIS TIER (M251/04), with a key the fake knows, so
    // `food-proposals.spec.ts` can read what the server relays. The person's
    // own switch is what a spec turns off to prove nothing is sent.
    FOOD_DB_API_KEY: options.foodDbApiKey,
    FOOD_DB_BACKFILL: 'true',
    ...HERMETIC_SERVER_ENV,
  } satisfies Readonly<Record<string, string>>;
  return `cross-env ${toAssignments(assignments)} tsx ./server.ts`;
}

/**
 * The environment the managed server is spawned with: the inherited one, the
 * caller's values, and the hermetic set on top of both.
 */
export function buildManagedServerEnv(options: {
  readonly inherited: NodeJS.ProcessEnv;
  readonly values: Readonly<Record<string, string>>;
}): NodeJS.ProcessEnv {
  return { ...options.inherited, ...options.values, ...HERMETIC_SERVER_ENV };
}
