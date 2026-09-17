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
 * Starts the fake on a named port.
 *
 * A NAMED PORT for the reason `fake-sync-service` takes one: the app server is
 * started by Playwright's own `webServer` with `FOOD_DB_API_URL` already on its
 * command line, so the address is decided before anything is listening.
 *
 * @param options.port - the port to listen on.
 */
export async function startFakeFoodDb({ port }: { port: number }): Promise<FakeFoodDb> {
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
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

  await new Promise<void>((settle) => server.listen(port, '127.0.0.1', settle));

  return {
    url: `http://127.0.0.1:${port}`,
    async close(): Promise<void> {
      await new Promise<void>((settle, fail) => server.close((error) => (error ? fail(error) : settle())));
    },
  };
}
