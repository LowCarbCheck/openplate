/**
 * WIRING guard for `FOOD_DB_API_KEY` (M238 spec 01).
 *
 * THE DEFECT CLASS THIS FILE EXISTS FOR is the one
 * `tests/unit/authoritative-net-carbs-wiring.test.ts` and
 * `tests/unit/carb-basis-wiring.test.ts` already document: a correctness value
 * accepted by a function and passed by no call site. There are TWO independent
 * LowCarbCheck callers in this app, each building its own options object from
 * `CONFIG.foodDb`, `app/services/food-resolution` searches the catalogue and
 * `app/services/nutrient-reference/index.server.ts` reads the published
 * reference intakes. A key threaded into one and forgotten in the other leaves
 * half of this app on the anonymous tier, with every other gate green and
 * nothing on screen to say so.
 *
 * So there is ONE CASE PER SERVICE, and they are both driven end to end
 * against a REAL HTTP SERVER that records the headers it actually received. A
 * stubbed `globalThis.fetch` would assert what this app handed the fetch API,
 * not what left the process; the difference is exactly where a header name
 * typo or a dropped spread would hide.
 *
 * A GATE NEEDS A DOOR, so the anonymous path is asserted too: with no key
 * configured neither service sends an `Authorization` header AT ALL. That is
 * the default, it is what every instance ran on before M238, and an
 * implementation that always sent `Bearer null` would pass the two keyed cases
 * on its own.
 *
 * And the key must never reach a browser, because the LowCarbCheck API is
 * CORS-open and a key in a page is a public key. The last describe block reads
 * `app/root.tsx`'s own `PublicConfig` literal, which is the ONE server to
 * browser channel this app has, and pins its key list.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearFoodResolutionCache, resolveIdentifiedFoods } from '../../app/services/food-resolution';
import {
  clearNutrientReferenceCache,
  fetchNutrientReferences,
} from '../../app/services/nutrient-reference/index.server';
import { foodDbKeyDisplayPrefix, foodDbRequestHeaders } from '../../app/services/food-db/request';

/**
 * A key in the frozen M202 format: `lcc_live_` plus 32 url-safe characters.
 *
 * FULL LENGTH ON PURPOSE. The display prefix is 16 characters, so a short
 * stand-in would make "the prefix is not the key" pass by coincidence.
 */
const API_KEY = 'lcc_live_0123456789abcdefghijklmnopqrstuv';

/** A food name nothing caches from another case in this file. */
const FOOD_NAME = 'wiring probe food';

/** One request this app made, as the server on the other end saw it. */
interface ReceivedRequest {
  path: string;
  authorization: string | undefined;
}

let server: Server;
let baseUrl = '';
let received: ReceivedRequest[] = [];

/** The requests that reached the search endpoint. */
function searchRequests(): ReceivedRequest[] {
  return received.filter((request) => request.path === '/api/v1/foods/search');
}

/** The requests that reached the reference-intake endpoint. */
function nutrientRequests(): ReceivedRequest[] {
  return received.filter((request) => request.path === '/api/v1/nutrients');
}

describe('every LowCarbCheck call carries the configured key', () => {
  before(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      received.push({ path, authorization: request.headers.authorization });
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      // An empty, schema-valid search answer for the catalogue, and a body the
      // nutrient parser rejects (it logs at debug and answers an empty
      // document). Neither service's RESULT is under test here; what left the
      // process is.
      response.end(JSON.stringify({ results: [] }));
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
    received = [];
    clearFoodResolutionCache();
    clearNutrientReferenceCache();
  });

  describe('the catalogue search (app/services/food-resolution)', () => {
    it('sends Authorization: Bearer <key> when a key is configured', async () => {
      await resolveIdentifiedFoods([{ name: FOOD_NAME }], { enabled: true, apiUrl: baseUrl, apiKey: API_KEY });

      const [request] = searchRequests();
      assert.ok(request, 'the search must have reached the stub server');
      assert.equal(request.authorization, `Bearer ${API_KEY}`);
    });

    it('sends NO Authorization header at all with no key configured', async () => {
      await resolveIdentifiedFoods([{ name: FOOD_NAME }], { enabled: true, apiUrl: baseUrl, apiKey: null });

      const [request] = searchRequests();
      assert.ok(request, 'the search must have reached the stub server');
      // ABSENT, not empty and not `Bearer null`: the anonymous tier is the
      // default and it must look on the wire exactly as it did before M238.
      assert.equal(request.authorization, undefined);
    });
  });

  describe('the reference intakes (app/services/nutrient-reference)', () => {
    it('sends Authorization: Bearer <key> when a key is configured', async () => {
      await fetchNutrientReferences({ enabled: true, apiUrl: baseUrl, apiKey: API_KEY });

      const [request] = nutrientRequests();
      assert.ok(request, 'the reference read must have reached the stub server');
      assert.equal(request.authorization, `Bearer ${API_KEY}`);
    });

    it('sends NO Authorization header at all with no key configured', async () => {
      await fetchNutrientReferences({ enabled: true, apiUrl: baseUrl, apiKey: null });

      const [request] = nutrientRequests();
      assert.ok(request, 'the reference read must have reached the stub server');
      assert.equal(request.authorization, undefined);
    });
  });

  describe('the shared header helper', () => {
    it('adds nothing but accept when there is no key', () => {
      assert.deepEqual(Object.fromEntries(foodDbRequestHeaders({ apiKey: null })), { accept: 'application/json' });
    });

    it('adds the bearer when there is one', () => {
      assert.deepEqual(Object.fromEntries(foodDbRequestHeaders({ apiKey: API_KEY })), {
        accept: 'application/json',
        authorization: `Bearer ${API_KEY}`,
      });
    });

    it('shortens a key for a log line to 16 characters, which is not the key', () => {
      const prefix = foodDbKeyDisplayPrefix(API_KEY);
      assert.equal(prefix, 'lcc_live_0123456');
      assert.notEqual(prefix, API_KEY, 'the prefix must never be the whole key');
      assert.equal(foodDbKeyDisplayPrefix(null), null);
    });
  });
});

/** The one server to browser channel this app has. */
const ROOT_SOURCE = readFileSync(fileURLToPath(new URL('../../app/root.tsx', import.meta.url)), 'utf8');

/**
 * The top-level keys of the `publicConfig` object literal in a root module's
 * source.
 *
 * Read from SOURCE rather than by calling the loader: the loader needs a
 * `Request`, a cookie, a toast session and the whole route module graph, and
 * none of that is what this assertion is about. What it is about is the list
 * of names somebody can add a fifth entry to.
 *
 * @param source - the contents of a `root.tsx`.
 * @returns every key at depth one of the literal, in source order.
 */
function publicConfigKeys(source: string): string[] {
  const opening = 'const publicConfig: PublicConfig = {';
  const start = source.indexOf(opening);
  if (start === -1) throw new Error('no `const publicConfig: PublicConfig = {` literal in the source');

  const keys: string[] = [];
  let depth = 1;
  let index = start + opening.length;
  let lineStart = index;
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    if (character === '\n') lineStart = index + 1;
    if (character === ':' && depth === 1) {
      const line = source.slice(lineStart, index).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(line)) keys.push(line);
    }
    index += 1;
  }
  if (depth !== 0) throw new Error('the `publicConfig` literal is not closed');
  return keys;
}

describe('the key never reaches a browser', () => {
  it('PublicConfig carries exactly the five allowlisted values, and no key', () => {
    const keys = publicConfigKeys(ROOT_SOURCE);

    assert.deepEqual(keys.toSorted(), ['analytics', 'foodDbBackfill', 'instancePreset', 'managed', 'syncServerUrl']);
    for (const key of keys) {
      assert.doesNotMatch(key, /key/i, `${key} reads like a credential and must not be in the public config`);
    }
  });

  it('the reader can see a sixth key, so the assertion above can fail', () => {
    // THE CONTROL. Two identical files pass every comparison, and a reader that
    // silently returned `[]` would make the assertion above pass against a
    // root module that published the key. This is that same literal with one
    // line added.
    const tampered = ROOT_SOURCE.replace(
      'const publicConfig: PublicConfig = {',
      'const publicConfig: PublicConfig = {\n    foodDbApiKey: CONFIG.foodDb.apiKey,',
    );

    const keys = publicConfigKeys(tampered);
    assert.ok(keys.includes('foodDbApiKey'), 'the reader must see a key added to the literal');
    assert.notDeepEqual(keys.toSorted(), ['analytics', 'foodDbBackfill', 'instancePreset', 'managed', 'syncServerUrl']);
  });

  it('CONFIG.foodDb.apiKey is read by the two services and by nothing else', () => {
    // A SOURCE SWEEP over `app/`, because the type system cannot express "this
    // value may not be read from a module the client bundle reaches". The two
    // permitted readers are the services' own `configuredOptions` functions;
    // from there it travels as an options field, never as a config read.
    assert.deepEqual(keyReadersUnderApp(), ALLOWED_KEY_READERS, 'a new reader of the key must be reviewed');
  });

  it('the sweep sees a third reader, so the assertion above can fail', () => {
    // THE CONTROL. `readsTheKey` is what decides; hand it a module that reads
    // the key in code and one that only NAMES it in prose, and it must tell
    // them apart. Without this, a sweep that matched nothing would pass while
    // saying nothing.
    assert.equal(readsTheKey('const key = CONFIG.foodDb.apiKey;'), true);
    assert.equal(readsTheKey('// never publish CONFIG.foodDb.apiKey to the browser'), false);
    assert.equal(readsTheKey('/**\n * `CONFIG.foodDb.apiKey` is server only.\n */\nexport const x = 1;'), false);
  });
});

/**
 * The only modules in `app/` allowed to read the key, sorted.
 *
 * `app/config/index.ts` is NOT on this list and does not need to be: it parses
 * the environment variable into `FoodDbConfig` and never reads the field back.
 */
const ALLOWED_KEY_READERS = [
  'app/services/food-resolution/index.ts',
  'app/services/nutrient-reference/index.server.ts',
];

/**
 * Whether a module READS the key, as opposed to talking about it.
 *
 * Comments are stripped first, because half the point of this milestone is
 * that the rule is written down in the modules it governs: the doc comment on
 * `app/services/food-db/request.ts` names `CONFIG.foodDb.apiKey` in prose, and
 * a sweep that counted prose would force those explanations back out.
 *
 * @param source - a TypeScript module's contents.
 */
function readsTheKey(source: string): boolean {
  const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '');
  return withoutComments.includes('foodDb.apiKey');
}

/** Every module under `app/` that reads the key, as repo-relative paths. */
function keyReadersUnderApp(): string[] {
  const appDir = fileURLToPath(new URL('../../app', import.meta.url));
  return sourceFilesUnder(appDir)
    .filter((file) => readsTheKey(readFileSync(file, 'utf8')))
    .map((file) => `app/${file.slice(appDir.length + 1)}`)
    .toSorted();
}

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourceFilesUnder(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFilesUnder(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}
