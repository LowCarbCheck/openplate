/**
 * LowCarbCheck, faked, for the browser tier (M234 spec 07).
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 *
 * Two of the app's screens read published data from `FOOD_DB_API_URL`, and the
 * nutrient screen is one of them. A smoke tier that reached the real
 * lowcarbcheck.org would go red whenever somebody else's service was slow, and
 * would also be asserting against numbers that change without this repository
 * knowing. Worse, the live API is deliberately BEHIND this repository on the
 * DGE work, so the one thing spec 07 has to show, a screen that follows the
 * instance's basis, cannot be seen there yet.
 *
 * ── THE REFERENCE BODY IS THE COMMITTED FIXTURE ──────────────────────────
 *
 * `tests/fixtures/nutrients-response.json` is byte identical to LowCarbCheck's
 * own copy and SHA-256 pinned in both repositories, so what this serves on
 * `/api/v1/nutrients` is the real document with all three bases in it. Nothing
 * here invents a reference value.
 *
 * ── THE SEARCH RESULT IS INVENTED, AND SAYS SO ───────────────────────────
 *
 * `/api/v1/foods/search` answers with ONE made-up food that carries a full
 * micronutrient block. The nutrient screen only prints a reference amount for a
 * nutrient the log actually covers, so a walk that logs a hand-typed food sees
 * "not enough data" on every row and no source at all. This is the smallest
 * thing that puts a covered row on that screen.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MINERAL_KEYS, VITAMIN_KEYS } from '../../app/lib/micronutrients';

/** The committed wire fixture, the one LowCarbCheck's own tests hash. */
const NUTRIENTS_BODY = readFileSync(
  fileURLToPath(new URL('../fixtures/nutrients-response.json', import.meta.url)),
  'utf8',
);

/** What the invented food is called. A name nothing else in the tier uses, and obviously not a real row. */
export const E2E_FOOD_NAME = 'E2E reference greens';

/** Per 100 g, in the unit each nutrient is published in. Generous, so one portion covers a day. */
const VITAMIN_VALUE = 50;
const MINERAL_VALUE = 200;

function block(keys: readonly string[], value: number): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, value]));
}

/** The one search result, in LowCarbCheck's `/api/v1/foods/search` shape. */
const SEARCH_BODY = {
  results: [
    {
      slug: 'e2e-reference-greens',
      locale: 'en',
      title: E2E_FOOD_NAME,
      canonicalName: E2E_FOOD_NAME,
      url: null,
      imageUrl: null,
      macrosPer100g: { kcal: 40, protein: 3, fat: 1, carbs: 4, fiber: 2, sugars: 1, polyols: 0 },
      netCarbsPer100g: 2,
      attribution: null,
      // Comfortably above the lexical floor, so the row is offered rather than
      // filtered out as a fuzzy guess.
      score: 0.95,
      origin: 'curated',
      portionSize: 100,
      vitamins: block(VITAMIN_KEYS, VITAMIN_VALUE),
      minerals: block(MINERAL_KEYS, MINERAL_VALUE),
    },
  ],
};

export interface FakeFoodDb {
  url: string;
  close(): Promise<void>;
}

/**
 * The path a spec POSTs to to make the catalogue search refuse (M238 spec 02).
 *
 * AN HTTP SEAM, because `globalSetup` runs in the RUNNER process and specs run
 * in WORKERS: a spec cannot call a method on the fake this module holds. Named
 * `__e2e__` so nobody reads it as part of the LowCarbCheck protocol, exactly
 * as `fake-sync-service.ts` names its own.
 *
 * The body is `{"status": 401}` to start refusing and `{"status": null}` to
 * stop.
 */
export const FOOD_DB_REFUSAL_PATH = '/__e2e__/search-refusal';

/**
 * Starts the fake on a named port.
 *
 * A NAMED PORT for the reason `fake-sync-service` takes one: the app server is
 * started by Playwright's own `webServer` with `FOOD_DB_API_URL` already on its
 * command line, so the address is decided before anything is listening.
 *
 * @param options.port - the port to listen on.
 */
export async function startFakeFoodDb({ port }: { port: number }): Promise<FakeFoodDb> {
  /**
   * The status `/api/v1/foods/search` answers with, or `null` for the ordinary
   * 200. Set over {@link FOOD_DB_REFUSAL_PATH}, and reset by the spec that set
   * it, because this fake outlives every spec in the run.
   */
  let refusalStatus: number | null = null;

  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === FOOD_DB_REFUSAL_PATH) {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        // SAFETY: the body a spec in this repository just sent, one line of
        // JSON with one field. A malformed one is a broken spec, and the
        // `Number.isInteger` guard below is what decides either way.
        const asked = (JSON.parse(body || '{}') as { status?: number | null }).status ?? null;
        refusalStatus = Number.isInteger(asked) ? asked : null;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ refusalStatus }));
      });
      return;
    }
    if (path === '/api/v1/foods/search' && refusalStatus !== null) {
      // The refusal envelope M202 froze. The app reads the STATUS CODE to
      // decide and the body only to phrase a log line, so both are here.
      request.resume();
      response.writeHead(refusalStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'invalid_key', message: 'no such key', docs: 'https://x.test' } }));
      return;
    }
    if (path === '/api/v1/nutrients') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(NUTRIENTS_BODY);
      return;
    }
    if (path === '/api/v1/foods/search') {
      // The body is read and thrown away: this fake answers the same row for
      // every term, and the walk types the row's own name anyway.
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(SEARCH_BODY));
      return;
    }
    // Everything else is the ordinary 404 the app already fails open on, which
    // is what a nutrient's source-food ranking gets here.
    request.resume();
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((settle, fail) => {
    // The port here is a NAMED one from `tests/e2e/env.ts`, derived from this
    // checkout's path, so something else on the host can already hold it. A
    // bare `listen` with only a success callback never learns that: Node skips
    // the callback and emits `error` with EADDRINUSE, and a promise that waits only
    // for `listening` then neither settles nor fails, so the tier prints
    // nothing and sits at nought percent CPU until somebody kills it. That
    // reads as flakiness. A rejection that names the port reads as a fact.
    //
    // Both handlers go on with `once`, and whichever fires first removes the
    // other. `once` on its own would still leave the loser attached: a fake
    // that DID start and then failed at runtime would hand that late `error` to
    // a promise which has already settled, where it does nothing, and every
    // start would leak the listener that never fired.
    function onListening(): void {
      server.removeListener('error', onFailure);
      settle();
    }
    function onFailure(error: Error): void {
      server.removeListener('listening', onListening);
      fail(
        new Error(
          `the fake food database could not take 127.0.0.1:${port}, because another process on this host already holds that port (${error.message}). ` +
            'Name the process that holds it with `ss -ltnp`; if it is another checkout of this repository whose path hashed to the same triple, set `OPENPLATE_E2E_PORT_BASE` in one of the two trees.',
          { cause: error },
        ),
      );
    }
    server.once('listening', onListening);
    server.once('error', onFailure);
    server.listen(port, '127.0.0.1');
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async close(): Promise<void> {
      await new Promise<void>((settle, fail) => server.close((error) => (error ? fail(error) : settle())));
    },
  };
}
