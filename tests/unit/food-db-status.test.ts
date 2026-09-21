/**
 * A REFUSED FOOD DATABASE IS VISIBLE INSTEAD OF SILENT (M238 spec 02).
 *
 * ── THE FAILURE THIS FILE GUARDS ─────────────────────────────────────────
 *
 * Both LowCarbCheck callers fail open, and they still do: a scan with a dead
 * or refused food database completes, shows numbers, and lets a person log
 * food. What changed is that fail-open used to be fail-SILENT. Every non-OK
 * status went to `logger.debug` and returned an empty result, so a 401 looked
 * exactly like "we checked, and there is nothing" and the numbers quietly
 * stopped being curated figures.
 *
 * ── THE ASSERTION THAT MATTERS MOST IS THE CLEARING ONE ──────────────────
 *
 * A status that latches on forever is a worse bug than the silence it
 * replaced: it would put a permanent "unavailable" line under numbers that are
 * fine, and a person who saw it every day would stop reading it. So every
 * "a refusal sets it" case below is paired with "and the next good answer
 * clears it", driven through the real services.
 *
 * ── EVERY ASSERTION HAS A CONTROL ────────────────────────────────────────
 *
 * A 500 is the control for the split: it must record NOTHING, because a
 * timeout or a server error is weather and nobody can act on it. A 200 is the
 * control for the rendered line: the review card must not draw it. Without
 * those two, an implementation that recorded every failure, or a card that
 * drew the line always, would pass everything else here.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { ConfirmDraftForm } from '../../app/routes/add.photo';
import { clearFoodResolutionCache, resolveIdentifiedFoods } from '../../app/services/food-resolution';
import {
  clearNutrientReferenceCache,
  fetchNutrientReferences,
} from '../../app/services/nutrient-reference/index.server';
import { foodDbStatus, noteFoodDbAccepted, noteFoodDbRefusal } from '../../app/services/food-db/status';
import { FOOD_DB_STATUS_UNKNOWN } from '../../app/services/food-db/wire';

/** A key in the frozen M202 format, long enough that its 16-character display prefix is not the whole key. */
const API_KEY = 'lcc_live_0123456789abcdefghijklmnopqrstuv';

/** The refusal envelope M202 froze. */
function refusalBody(code: string): string {
  return JSON.stringify({ error: { code, message: 'no', docs: 'https://lowcarbcheck.org/developers' } });
}

/** A response as the upstream would have sent it, without a network in the middle. */
function refusal(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('the status module', () => {
  beforeEach(() => noteFoodDbAccepted());

  it('starts clear', () => {
    assert.deepEqual(foodDbStatus(), { ok: true, reason: null });
  });

  it('records a 401 as invalid_key', async () => {
    await noteFoodDbRefusal(refusal(401, refusalBody('invalid_key')));
    assert.deepEqual(foodDbStatus(), { ok: false, reason: 'invalid_key' });
  });

  it('records a 429 as whatever the body names', async () => {
    await noteFoodDbRefusal(refusal(429, refusalBody('allowance_exhausted')));
    assert.deepEqual(foodDbStatus(), { ok: false, reason: 'allowance_exhausted' });
  });

  it('falls back to the STATUS CODE when the body is missing, malformed or unfamiliar', async () => {
    // Three bodies that tell this app nothing, against the same status code.
    // The status code is what drives behaviour; the body only improves the
    // wording, and a proxy in the middle that answered HTML must not change
    // the outcome.
    for (const body of ['', 'not json at all', JSON.stringify({ error: { code: 'something_new' } })]) {
      noteFoodDbAccepted();
      await noteFoodDbRefusal(refusal(429, body));
      assert.deepEqual(foodDbStatus(), { ok: false, reason: 'rate_limited' }, `body: ${body || '(empty)'}`);
    }

    noteFoodDbAccepted();
    await noteFoodDbRefusal(refusal(401, ''));
    assert.deepEqual(foodDbStatus(), { ok: false, reason: 'invalid_key' });
  });

  it('records NOTHING for every other failure', async () => {
    // THE CONTROL for the whole split. An implementation that treated every
    // non-OK status as a refusal would pass every case above and fail here,
    // and it would put an "unavailable" line under a scan whose only problem
    // was a five second upstream blip.
    for (const status of [400, 403, 404, 500, 502, 503]) {
      noteFoodDbAccepted();
      const recorded = await noteFoodDbRefusal(refusal(status, refusalBody('invalid_key')));
      assert.equal(recorded, null, `status ${status} must not be recorded as a refusal`);
      assert.deepEqual(foodDbStatus(), { ok: true, reason: null }, `status ${status}`);
    }
  });

  it('clears on the next good answer, and is the only thing that does', async () => {
    await noteFoodDbRefusal(refusal(401, refusalBody('invalid_key')));
    assert.equal(foodDbStatus().ok, false);

    noteFoodDbAccepted();
    assert.deepEqual(foodDbStatus(), { ok: true, reason: null });
  });

  it('hands back a fresh object, so no reader can latch it by mutating one', async () => {
    await noteFoodDbRefusal(refusal(401, refusalBody('invalid_key')));
    const held = foodDbStatus();
    noteFoodDbAccepted();

    assert.equal(held.ok, false, 'the caller keeps the answer it was given');
    assert.equal(foodDbStatus().ok, true, 'and the module has moved on');
  });
});

/** What the stub server answers next, set per case. */
let nextStatus = 200;
let nextBody = JSON.stringify({ results: [] });
let requestCount = 0;

let server: Server;
let baseUrl = '';

describe('the two services report into that status', () => {
  before(async () => {
    server = createServer((request, response) => {
      requestCount += 1;
      request.resume();
      response.writeHead(nextStatus, { 'content-type': 'application/json' });
      response.end(nextBody);
    });
    await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
    const address = server.address();
    assert.ok(address !== null, 'the stub server must be listening');
    // SAFETY: `server.address()` is typed as the union of a unix-socket path
    // string and an `AddressInfo`; `listen(0, '127.0.0.1')` above is a TCP
    // bind, so it is always the object form.
    const { port } = address as { port: number };
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((settle, fail) => server.close((error) => (error ? fail(error) : settle())));
  });

  beforeEach(() => {
    nextStatus = 200;
    nextBody = JSON.stringify({ results: [] });
    requestCount = 0;
    noteFoodDbAccepted();
    clearFoodResolutionCache();
    clearNutrientReferenceCache();
  });

  /** The options both keyed cases below run under. */
  function keyed() {
    return { enabled: true, apiUrl: baseUrl, apiKey: API_KEY };
  }

  describe('the catalogue search', () => {
    it('reports a 401 AND still fails open, so the scan completes', async () => {
      nextStatus = 401;
      nextBody = refusalBody('invalid_key');

      const matches = await resolveIdentifiedFoods([{ name: 'rye bread' }], keyed());

      // FAIL OPEN IS UNCHANGED. One empty list per name, in order, no throw.
      assert.deepEqual(matches, [[]]);
      assert.deepEqual(foodDbStatus(), { ok: false, reason: 'invalid_key' });
    });

    it('clears on the next successful search', async () => {
      nextStatus = 401;
      nextBody = refusalBody('invalid_key');
      await resolveIdentifiedFoods([{ name: 'rye bread' }], keyed());
      assert.equal(foodDbStatus().ok, false, 'the refusal must have registered, or the next line proves nothing');

      nextStatus = 200;
      nextBody = JSON.stringify({ results: [] });
      await resolveIdentifiedFoods([{ name: 'oat bran' }], keyed());

      assert.deepEqual(foodDbStatus(), { ok: true, reason: null });
    });

    it('does not cache a refusal, so a fix takes effect on the next lookup', async () => {
      // `{ matches: [], cacheable: false }` was already correct and must stay
      // correct: a cached 401 would outlive the fix for it by the full cache
      // TTL. The same name is searched twice and must leave twice.
      nextStatus = 401;
      nextBody = refusalBody('invalid_key');
      await resolveIdentifiedFoods([{ name: 'rye bread' }], keyed());
      await resolveIdentifiedFoods([{ name: 'rye bread' }], keyed());

      assert.equal(requestCount, 2);
    });

    it('leaves the status alone for a 500', async () => {
      // THE CONTROL, through the real service this time.
      nextStatus = 500;
      nextBody = 'upstream is unwell';

      const matches = await resolveIdentifiedFoods([{ name: 'rye bread' }], keyed());

      assert.deepEqual(matches, [[]]);
      assert.deepEqual(foodDbStatus(), { ok: true, reason: null });
    });
  });

  describe('the reference intakes', () => {
    it('reports a 429 AND still answers an empty document', async () => {
      nextStatus = 429;
      nextBody = refusalBody('allowance_exhausted');

      const document = await fetchNutrientReferences(keyed());

      assert.ok(document, 'the screen still gets a document to render');
      assert.deepEqual(foodDbStatus(), { ok: false, reason: 'allowance_exhausted' });
    });

    it('clears on the next successful read', async () => {
      nextStatus = 429;
      nextBody = refusalBody('rate_limited');
      await fetchNutrientReferences(keyed());
      assert.equal(foodDbStatus().ok, false, 'the refusal must have registered, or the next line proves nothing');

      nextStatus = 200;
      nextBody = JSON.stringify({ nutrients: [] });
      await fetchNutrientReferences(keyed());

      assert.deepEqual(foodDbStatus(), { ok: true, reason: null });
    });

    it('leaves the status alone for a 500', async () => {
      nextStatus = 500;
      nextBody = 'upstream is unwell';

      await fetchNutrientReferences(keyed());

      assert.deepEqual(foodDbStatus(), { ok: true, reason: null });
    });
  });
});

/** One identified food, enough to put a review card on the screen. */
const IDENTIFICATION = {
  unreadable: false,
  foods: [
    {
      name: 'Rye bread',
      estimatedGrams: 40,
      confidence: 'high' as const,
      macroSource: 'estimated' as const,
      macrosPer100g: { kcal: 250, protein: 8, fat: 3, carbs: 45 },
    },
  ],
};

/** The shipped English sentence, read from the catalog so no wording is pinned here. */
const UNAVAILABLE_LINE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8'),
).scan.review.foodDbUnavailable;

/**
 * The real review card, rendered through the shipped English catalog.
 *
 * @param foodDb - what the server reported, or `undefined` for a render that ran no lookup.
 */
function renderReview(foodDb: { ok: boolean; reason: null } | undefined): string {
  const element = createElement(ConfirmDraftForm, {
    identification: IDENTIFICATION,
    foodDb: foodDb === undefined ? undefined : { ok: foodDb.ok, reason: null },
    modelId: 'test-model',
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
    defaultMealType: null,
    intakeSource: 'photo' as const,
    typedText: null,
  });
  const router = createMemoryRouter([{ path: '/scan', element: withI18n(element) }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('the review card says so, quietly', () => {
  it('draws one line when the food database is refusing', () => {
    const markup = renderReview({ ok: false, reason: null });

    assert.ok(markup.includes(UNAVAILABLE_LINE), 'the shipped sentence must be on the card');
    // QUIET, not a blocker: the draft below is complete and the confirm button
    // is still there. A modal or a disabled form would be a policy change, and
    // fail-open policy did not change.
    assert.ok(markup.includes('Confirm'), 'the draft must still be loggable');
  });

  it('draws NOTHING when the food database is fine', () => {
    // THE CONTROL. A card that drew the line unconditionally would pass the
    // case above and fail here, and a test that only ever looked for an
    // absence could pass by finding nothing anywhere.
    assert.equal(renderReview({ ok: true, reason: null }).includes(UNAVAILABLE_LINE), false);
  });

  it('draws NOTHING when nothing is known', () => {
    // The confirm-revalidation path ran no lookup. Silence is the honest
    // answer there; a warning invented from an absence is not.
    assert.equal(renderReview(undefined).includes(UNAVAILABLE_LINE), false);
    assert.equal(FOOD_DB_STATUS_UNKNOWN.ok, true, 'and the shared "nothing known" value is the quiet one');
  });
});

/** The two services' source, which is where the no-key-in-a-log rule has to be checked. */
const SERVICE_SOURCES = ['app/services/food-resolution/index.ts', 'app/services/nutrient-reference/index.server.ts'];

/**
 * Every `logger.*(...)` call in a module, as source text.
 *
 * Read from SOURCE because pino writes past `process.stdout.write` (it holds
 * its own file descriptor), so an in-process capture of a real log line is not
 * available here. What IS checkable, and is the actual rule, is that no call
 * site hands the logger anything but the display prefix.
 *
 * @param source - a TypeScript module's contents.
 */
function loggerCalls(source: string): string[] {
  const calls: string[] = [];
  const opener = /logger\.(debug|info|warn|error)\(/g;
  let match = opener.exec(source);
  while (match !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < source.length && depth > 0) {
      if (source[index] === '(') depth += 1;
      if (source[index] === ')') depth -= 1;
      index += 1;
    }
    calls.push(source.slice(match.index, index));
    match = opener.exec(source);
  }
  return calls;
}

/** Whether a logger call hands over the raw key rather than its display prefix. */
function leaksTheKey(call: string): boolean {
  return call.replaceAll('foodDbKeyDisplayPrefix(apiKey)', '').includes('apiKey');
}

describe('a log line never carries the key', () => {
  it('no logger call in either service names the raw key', () => {
    for (const relative of SERVICE_SOURCES) {
      const source = readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
      const calls = loggerCalls(source);
      assert.ok(calls.length > 0, `${relative} must have logger calls, or this assertion reads nothing`);
      for (const call of calls) {
        assert.equal(leaksTheKey(call), false, `${relative} logs the raw key: ${call}`);
      }
    }
  });

  it('the reader can see a leak, so the assertion above can fail', () => {
    // THE CONTROL, on the two functions that decide.
    assert.deepEqual(loggerCalls("logger.warn('x', { a: f(b) });\nconst y = 1;"), ["logger.warn('x', { a: f(b) })"]);
    assert.equal(leaksTheKey("logger.warn('x', { keyPrefix: foodDbKeyDisplayPrefix(apiKey) })"), false);
    assert.equal(leaksTheKey("logger.warn('x', { key: apiKey })"), true);
  });
});
