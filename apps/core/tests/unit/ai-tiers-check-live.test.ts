/**
 * `pnpm ai-tiers:check-live` (`scripts/ai-tiers-live/check.ts`) on RECORDED
 * OpenRouter answers. Nothing here touches the network: the fetch function is
 * a stub that serves two fixtures and THROWS on any other address, so a test
 * that reached for the real API would fail loudly instead of passing quietly.
 *
 * The fixtures are real answers, read on 2026-10-05 with no key and trimmed to
 * the fields the script reads (`tests/fixtures/openrouter/`):
 *  - `gemini-3.7-flash-endpoints.json`: six rows. Google Vertex and Google AI
 *    Studio each at the standard, flex and priority price. Standard is
 *    0.75 / 3.75 USD per million, flex half of it, priority 1.35 / 6.75.
 *  - `zdr-list.json`: the ZDR rows for the Vertex endpoints of two models and
 *    one unrelated row. Google AI Studio is NOT on it.
 *
 * The EU host and the region pins are tested on three more real answers, read
 * on 2026-10-06 and trimmed the same way:
 *  - `gemini-3.5-flash-lite-eu-endpoints.json`: what the EU host lists for the
 *    model, ONE row, `google-vertex/eu`, at 0.33 / 2.75 USD per million;
 *  - `gemini-3.5-flash-lite-global-endpoints.json`: what the global host lists
 *    for the same model, eight rows: `google-vertex/global` at 0.30 / 2.50, the
 *    regional rows `google-vertex/eu` and `google-vertex/us` at 0.33 / 2.75, and
 *    flex and priority rows;
 *  - `zdr-list-eu.json`: the EU host's ZDR list, trimmed to three rows.
 *
 * Every assertion that something fails has a control beside it that makes the
 * same assertion hold for the opposite input, so a check that fails always, or
 * never, cannot pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseModelTiers } from '../../src/ai/model-tiers.js';
import type { JsonObject, JsonValue } from '../../src/lib/json.js';
import { asArray, asObject } from '../../src/lib/json.js';
import {
  checkTiersLive,
  EXIT_FAILED,
  EXIT_PASSED,
  EXIT_UNAVAILABLE,
  isOpenRouterUrl,
  matchesPin,
  OPENROUTER_API,
  OPENROUTER_EU_API,
  parseCheckHost,
  runCli,
  STALE_AFTER_DAYS,
  type CheckHost,
  type CheckLine,
  type FetchedJson,
  type FetchJson,
} from '../../scripts/ai-tiers-live/check.js';

function readFixture(name: string): JsonValue {
  const path = fileURLToPath(new URL(`../fixtures/openrouter/${name}`, import.meta.url));
  // SAFETY: the fixture is a JSON file this repository ships.
  return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
}

const ENDPOINTS = readFixture('gemini-3.7-flash-endpoints.json');
const ZDR = readFixture('zdr-list.json');
const LITE_EU_ENDPOINTS = readFixture('gemini-3.5-flash-lite-eu-endpoints.json');
const LITE_GLOBAL_ENDPOINTS = readFixture('gemini-3.5-flash-lite-global-endpoints.json');
const EU_ZDR = readFixture('zdr-list-eu.json');

const MODEL = 'google/gemini-3.7-flash';
const ZDR_URL = `${OPENROUTER_API}/endpoints/zdr`;
const ENDPOINTS_URL = `${OPENROUTER_API}/models/${MODEL}/endpoints`;
const LITE = 'google/gemini-3.5-flash-lite';
const EU_ZDR_URL = `${OPENROUTER_EU_API}/endpoints/zdr`;
const LITE_EU_URL = `${OPENROUTER_EU_API}/models/${LITE}/endpoints`;
const LITE_GLOBAL_URL = `${OPENROUTER_API}/models/${LITE}/endpoints`;
const GLOBAL_HOST: CheckHost = parseCheckHost({ value: OPENROUTER_API, source: 'the test' });
const EU_HOST: CheckHost = parseCheckHost({ value: OPENROUTER_EU_API, source: 'the test' });
const NOT_FOUND: FetchedJson = { status: 404, body: { error: { message: 'Not Found', code: 404 } } };

/** The recorded day, 2026-10-05, at noon UTC. */
const RECORDED_DAY = new Date('2026-10-05T12:00:00Z');

interface StubbedFetch {
  fetchJson: FetchJson;
  calls: string[];
}

/** Serves the answers it is given by address, records every address, and throws on any other. */
function stubFetch(answers: Record<string, FetchedJson>): StubbedFetch {
  const calls: string[] = [];
  const fetchJson: FetchJson = (url) => {
    calls.push(url);
    const answer = answers[url];
    if (answer === undefined) return Promise.reject(new Error(`unexpected request to ${url}`));
    return Promise.resolve(answer);
  };
  return { fetchJson, calls };
}

function recorded(): StubbedFetch {
  return stubFetch({ [ENDPOINTS_URL]: { status: 200, body: ENDPOINTS }, [ZDR_URL]: { status: 200, body: ZDR } });
}

interface TierOptions {
  model?: string;
  zdr?: boolean;
  only?: string[];
  input?: number;
  output?: number;
  audio?: number;
  checked?: string;
}

/** One tier whose defaults equal the recorded standard price at Google Vertex. */
function tierBody(options: TierOptions = {}): JsonObject {
  const base: JsonObject = {
    inputUsdPerMillion: options.input ?? 0.75,
    outputUsdPerMillion: options.output ?? 3.75,
    checked: options.checked ?? '2026-10-05',
    source: 'a recorded answer',
  };
  const price: JsonObject = options.audio === undefined ? base : { ...base, audioInputUsdPerMillion: options.audio };
  return {
    use: 'A test tier.',
    model: options.model ?? MODEL,
    routing: { zdr: options.zdr ?? true, only: options.only ?? ['google-vertex'] },
    price,
    disclose: ['Gemini'],
  };
}

function tierFile(options: TierOptions = {}): JsonValue {
  return { version: 1, defaultTier: 'standard', routes: {}, tiers: { standard: tierBody(options) } };
}

async function runCheck(input: { file: JsonValue; stub?: StubbedFetch; now?: Date; host?: CheckHost }) {
  return checkTiersLive({
    tiers: parseModelTiers(input.file),
    fetchJson: (input.stub ?? recorded()).fetchJson,
    host: input.host ?? GLOBAL_HOST,
    now: input.now ?? RECORDED_DAY,
  });
}

function linesOf(lines: CheckLine[], suffix: string): CheckLine[] {
  return lines.filter((l) => l.check.endsWith(suffix));
}

// ── Price ────────────────────────────────────────────────────────────────────

test('a price equal to the standard tier endpoint passes every check', async () => {
  const report = await runCheck({ file: tierFile() });
  assert.equal(report.failed, 0);
  assert.equal(report.warnings, 0);
  assert.deepEqual(
    report.lines.map((l) => [l.status, l.check]),
    [
      ['PASS', 'model'],
      ['PASS', 'provider google-vertex'],
      ['PASS', 'provider google-vertex zdr'],
      ['PASS', 'provider google-vertex price'],
      ['PASS', 'price.checked'],
    ],
  );
});

test('a changed input price fails, and says both numbers and the endpoint', async () => {
  const report = await runCheck({ file: tierFile({ input: 0.9 }) });
  const [price] = linesOf(report.lines, 'price');
  assert.equal(price?.status, 'FAIL');
  assert.match(price?.detail ?? '', /input: file 0\.9, OpenRouter 0\.75 \(google-vertex\/global\)/);
  assert.doesNotMatch(price?.detail ?? '', /output/, 'the output price matches and must not be named');
  assert.equal(report.failed, 1, 'only the price line fails: the model, provider and zdr lines still pass');
});

test('a changed output price fails on its own', async () => {
  const report = await runCheck({ file: tierFile({ output: 4.5 }) });
  const [price] = linesOf(report.lines, 'price');
  assert.equal(price?.status, 'FAIL');
  assert.match(price?.detail ?? '', /output: file 4\.5, OpenRouter 3\.75/);
  assert.doesNotMatch(price?.detail ?? '', /input/);
});

test('the flex price is not the price: only the standard row counts', async () => {
  // The recorded flex row is 0.375 / 1.875 and the priority row 1.35 / 6.75. A script that picked the
  // cheapest or the first row would pass these.
  assert.equal((await runCheck({ file: tierFile({ input: 0.375, output: 1.875 }) })).failed, 1);
  assert.equal((await runCheck({ file: tierFile({ input: 1.35, output: 6.75 }) })).failed, 1);
  assert.equal((await runCheck({ file: tierFile() })).failed, 0, 'control: the standard price passes');
});

test('a price within the tolerance passes and one just outside fails', async () => {
  assert.equal((await runCheck({ file: tierFile({ input: 0.7500004 }) })).failed, 0);
  assert.equal((await runCheck({ file: tierFile({ input: 0.750002 }) })).failed, 1);
});

test('an audio price is compared when the file names one', async () => {
  assert.equal((await runCheck({ file: tierFile({ audio: 0.75 }) })).failed, 0);
  const report = await runCheck({ file: tierFile({ audio: 0.5 }) });
  assert.equal(report.failed, 1);
  assert.match(linesOf(report.lines, 'price')[0]?.detail ?? '', /audio input: file 0\.5, OpenRouter 0\.75/);
});

test('a price OpenRouter changed fails against a file that did not move', async () => {
  const doubled = JSON.parse(JSON.stringify(ENDPOINTS), (key, value: JsonValue) =>
    key === 'prompt' && value === '0.00000075' ? '0.0000015' : value,
  );
  const stub = stubFetch({ [ENDPOINTS_URL]: { status: 200, body: doubled }, [ZDR_URL]: { status: 200, body: ZDR } });
  const report = await runCheck({ file: tierFile(), stub });
  assert.equal(report.failed, 1);
  assert.match(linesOf(report.lines, 'price')[0]?.detail ?? '', /input: file 0\.75, OpenRouter 1\.5/);
});

// ── Providers and zero data retention ────────────────────────────────────────

test('a provider whose endpoint is missing from the ZDR list fails', async () => {
  // Google AI Studio serves the model at the standard tier (the endpoint answer lists it) but is not on the ZDR list.
  const report = await runCheck({ file: tierFile({ only: ['google-ai-studio'] }) });
  const [serves] = linesOf(report.lines, 'provider google-ai-studio');
  const [zdr] = linesOf(report.lines, 'zdr');
  assert.equal(serves?.status, 'PASS', 'the provider does serve the model');
  assert.equal(zdr?.status, 'FAIL');
  assert.match(zdr?.detail ?? '', /none of google-ai-studio is on OpenRouter's ZDR list for google\/gemini-3\.7-flash/);
  assert.equal(linesOf(report.lines, 'price').length, 0, 'no price is judged for an endpoint the request cannot reach');
});

test('a tier with zdr false skips the ZDR check, and the same tier with zdr true fails it', async () => {
  const off = await runCheck({ file: tierFile({ only: ['google-ai-studio'], zdr: false }) });
  assert.equal(off.failed, 0);
  assert.deepEqual(
    off.lines.filter((l) => l.status === 'SKIP').map((l) => l.check),
    ['zdr'],
  );
  assert.equal(
    linesOf(off.lines, 'zdr').some((l) => l.status === 'PASS' || l.status === 'FAIL'),
    false,
  );

  const on = await runCheck({ file: tierFile({ only: ['google-ai-studio'], zdr: true }) });
  assert.equal(on.failed, 1, 'control: with zdr true the same provider fails');
});

test('a provider that does not serve the model fails, and the others are not blamed', async () => {
  const report = await runCheck({ file: tierFile({ only: ['google-vertex', 'nobody-home'] }) });
  const [missing] = linesOf(report.lines, 'provider nobody-home');
  assert.equal(missing?.status, 'FAIL');
  assert.match(missing?.detail ?? '', /providers that do: google-ai-studio, google-vertex/);
  assert.equal(linesOf(report.lines, 'provider google-vertex')[0]?.status, 'PASS');
  assert.equal(report.failed, 1);
});

test('with an empty only list, one provider that serves it is enough', async () => {
  const report = await runCheck({ file: tierFile({ only: [] }) });
  assert.equal(report.failed, 0);
  assert.ok(report.lines.some((l) => l.check === 'any provider price' && l.status === 'PASS'));
  const wrong = await runCheck({ file: tierFile({ only: [], input: 0.9 }) });
  assert.equal(wrong.failed, 1, 'control: no provider has that price');
});

// ── The model ────────────────────────────────────────────────────────────────

test('a model that does not exist fails, and nothing else is judged for it', async () => {
  const gone = 'vendor/test-model';
  const stub = stubFetch({
    [`${OPENROUTER_API}/models/${gone}/endpoints`]: NOT_FOUND,
    [ZDR_URL]: { status: 200, body: ZDR },
  });
  const report = await runCheck({ file: tierFile({ model: gone }), stub });
  assert.equal(report.failed, 1);
  assert.equal(report.lines[0]?.status, 'FAIL');
  assert.equal(report.lines[0]?.check, 'model');
  assert.match(report.lines[0]?.detail ?? '', /vendor\/test-model does not exist on OpenRouter/);
  assert.equal(report.lines.length, 1);
});

test('a model asked for twice is fetched once, and no address but the two public ones is used', async () => {
  const twoTiers: JsonValue = {
    version: 1,
    defaultTier: 'standard',
    routes: { speech_transcript: 'audio' },
    tiers: {
      standard: tierBody(),
      audio: tierBody(),
    },
  };
  const stub = recorded();
  const report = await runCheck({ file: twoTiers, stub });
  assert.equal(report.failed, 0);
  assert.deepEqual(stub.calls.toSorted(), [ENDPOINTS_URL, ZDR_URL].toSorted());
  assert.deepEqual([...new Set(report.lines.map((l) => l.tier))], ['standard (default)', 'audio']);
});

// ── Staleness ────────────────────────────────────────────────────────────────

test('a checked date older than 45 days warns and still passes', async () => {
  const now = new Date('2026-12-01T12:00:00Z'); // 57 days after 2026-10-05
  const report = await runCheck({ file: tierFile(), now });
  const [fresh] = linesOf(report.lines, 'price.checked');
  assert.equal(fresh?.status, 'WARN');
  assert.match(fresh?.detail ?? '', /57 days old, the limit is 45/);
  assert.equal(report.warnings, 1);
  assert.equal(report.failed, 0);

  const code = await runCli({ ...cliInput({ stub: recorded(), now }), argv: [] });
  assert.equal(code, EXIT_PASSED, 'a warning never changes the exit code');
});

test('the warning starts after day 45, not on it', async () => {
  const day45 = new Date(RECORDED_DAY.getTime() + STALE_AFTER_DAYS * 86_400_000);
  const day46 = new Date(day45.getTime() + 86_400_000);
  assert.equal((await runCheck({ file: tierFile(), now: day45 })).warnings, 0);
  assert.equal((await runCheck({ file: tierFile(), now: day46 })).warnings, 1);
});

// ── The command and its exit codes ───────────────────────────────────────────

interface Captured {
  stdout: string;
  stderr: string;
}

function noArguments(): string[] {
  return [];
}

function cliInput(input: {
  stub: StubbedFetch;
  now?: Date;
  files?: Record<string, string>;
  bundled?: JsonValue;
  env?: Record<string, string | undefined>;
}) {
  const captured: Captured = { stdout: '', stderr: '' };
  return {
    argv: noArguments(),
    env: input.env ?? {},
    fetchJson: input.stub.fetchJson,
    now: input.now ?? RECORDED_DAY,
    bundled: input.bundled ?? tierFile(),
    readFile: (path: string): string => {
      const text = input.files?.[path];
      if (text === undefined) throw new Error('no such file');
      return text;
    },
    stdout: (text: string) => {
      captured.stdout += text;
    },
    stderr: (text: string) => {
      captured.stderr += text;
    },
    captured,
  };
}

test('exit 0 when nothing failed, with one line per check and a summary', async () => {
  const input = cliInput({ stub: recorded() });
  const code = await runCli(input);
  assert.equal(code, EXIT_PASSED);
  const lines = input.captured.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 6, 'five checks and the summary');
  assert.match(lines[0] ?? '', /^PASS {2}standard \(default\) {2}model: /);
  assert.equal(lines.at(-1), 'OK: 5 lines, 5 passed, 0 failed, 0 warnings');
  assert.equal(input.captured.stderr, '');
});

test('exit 1 when a check failed, and the line says FAIL', async () => {
  const input = cliInput({ stub: recorded(), bundled: tierFile({ input: 0.9 }) });
  const code = await runCli(input);
  assert.equal(code, EXIT_FAILED);
  assert.match(input.captured.stdout, /^FAIL {2}standard \(default\) {2}provider google-vertex price: /m);
  assert.match(input.captured.stdout, /FAILED: 5 lines, 4 passed, 1 failed, 0 warnings/);
});

test('a network failure is exit 2 with a clear message, and prints no FAIL line', async () => {
  const stub: StubbedFetch = {
    calls: [],
    fetchJson: () => Promise.reject(new Error('getaddrinfo ENOTFOUND openrouter.ai')),
  };
  const input = cliInput({ stub });
  const code = await runCli(input);
  assert.equal(code, EXIT_UNAVAILABLE);
  assert.match(
    input.captured.stderr,
    /No verdict\. Could not reach OpenRouter at https:\/\/openrouter\.ai\/api\/v1\/endpoints\/zdr: getaddrinfo ENOTFOUND/,
  );
  assert.match(input.captured.stderr, /not a FAIL/);
  assert.equal(input.captured.stdout, '', 'no verdict means no result lines');
});

test('an HTTP 503 and an answer in an unknown shape are exit 2 too, not a FAIL', async () => {
  const down = stubFetch({ [ZDR_URL]: { status: 503, body: null } });
  assert.equal(await runCli(cliInput({ stub: down })), EXIT_UNAVAILABLE);

  const odd = stubFetch({
    [ENDPOINTS_URL]: { status: 200, body: { data: 'nope' } },
    [ZDR_URL]: { status: 200, body: ZDR },
  });
  const input = cliInput({ stub: odd });
  assert.equal(await runCli(input), EXIT_UNAVAILABLE);
  assert.match(input.captured.stderr, /shape this script does not know \(no data\.endpoints list\)/);
});

test('a 404 for the model is a FAIL (exit 1) and not a network failure (exit 2)', async () => {
  const stub = stubFetch({ [ENDPOINTS_URL]: NOT_FOUND, [ZDR_URL]: { status: 200, body: ZDR } });
  assert.equal(await runCli(cliInput({ stub })), EXIT_FAILED);
});

test('--file reads the named file, and the shipped file is used without it', async () => {
  const named = JSON.stringify(tierFile({ input: 0.9 }));
  const withFile = {
    ...cliInput({ stub: recorded(), files: { '/tmp/candidate.json': named } }),
    argv: ['--file', '/tmp/candidate.json'],
  };
  assert.equal(await runCli(withFile), EXIT_FAILED, 'the named file (a wrong price) is the one judged');
  const without = cliInput({ stub: recorded(), files: { '/tmp/candidate.json': named } });
  assert.equal(
    await runCli(without),
    EXIT_PASSED,
    'control: the bundled file (a right price) is judged without --file',
  );
});

test('a missing, broken or invalid tier file is exit 1 before any request is made', async () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ['/tmp/none.json', {}, /cannot be read/],
    ['/tmp/bad.json', { '/tmp/bad.json': '{ nope' }, /is not valid JSON/],
    ['/tmp/old.json', { '/tmp/old.json': '{"version":2}' }, /Invalid AI tiers file, version/],
  ];
  for (const [path, files, message] of cases) {
    const stub = recorded();
    const input = { ...cliInput({ stub, files }), argv: ['--file', path] };
    assert.equal(await runCli(input), EXIT_FAILED, path);
    assert.match(input.captured.stderr, message, path);
    assert.deepEqual(stub.calls, [], 'a bad file never reaches the network');
  }
});

// ── Slug matching by segments ────────────────────────────────────────────────

function matches(tag: string, slug: string): boolean {
  return matchesPin({ tag, slug });
}

test('a pinned slug matches a tag by whole segments', () => {
  // A provider slug names every region and tier of it.
  assert.equal(matches('google-vertex', 'google-vertex'), true);
  assert.equal(matches('google-vertex/global', 'google-vertex'), true);
  assert.equal(matches('google-vertex/eu', 'google-vertex'), true);
  assert.equal(matches('google-vertex/global/flex', 'google-vertex'), true);
  // A region slug names that region and nothing else of the provider.
  assert.equal(matches('google-vertex/eu', 'google-vertex/eu'), true);
  assert.equal(matches('google-vertex/eu/flex', 'google-vertex/eu'), true);
  assert.equal(matches('google-vertex/global', 'google-vertex/eu'), false);
  assert.equal(matches('google-vertex/us', 'google-vertex/eu'), false);
  assert.equal(matches('google-vertex', 'google-vertex/eu'), false);
  // Whole segments, never a string prefix.
  assert.equal(matches('google-vertex-ai/eu', 'google-vertex'), false);
  assert.equal(matches('google-vertex/europe', 'google-vertex/eu'), false);
});

// ── The EU host and a region pin ─────────────────────────────────────────────

/** One tier pinned to the EU endpoint of the lite model, priced as the EU host lists it (0.33 / 2.75). */
function euTierFile(options: TierOptions = {}): JsonValue {
  return tierFile({
    model: LITE,
    only: ['google-vertex/eu'],
    input: 0.33,
    output: 2.75,
    checked: '2026-10-06',
    ...options,
  });
}

const EU_DAY = new Date('2026-10-06T12:00:00Z');

function euStub(endpoints: JsonValue = LITE_EU_ENDPOINTS): StubbedFetch {
  return stubFetch({
    [LITE_EU_URL]: { status: 200, body: endpoints },
    [EU_ZDR_URL]: { status: 200, body: EU_ZDR },
  });
}

function globalLiteStub(): StubbedFetch {
  return stubFetch({
    [LITE_GLOBAL_URL]: { status: 200, body: LITE_GLOBAL_ENDPOINTS },
    [`${OPENROUTER_API}/endpoints/zdr`]: { status: 200, body: ZDR },
  });
}

/** The same answer with its endpoint rows changed by `change`. */
function withRows(body: JsonValue, change: (rows: JsonValue[]) => JsonValue[]): JsonValue {
  const data = asObject(asObject(body)?.data);
  const rows = asArray(data?.endpoints);
  if (data === null || rows === null) throw new Error('the fixture has no endpoint rows');
  return { ...asObject(body), data: { ...data, endpoints: change(rows) } };
}

function rowWithTag(body: JsonValue, tag: string): JsonValue {
  const row = asArray(asObject(asObject(body)?.data)?.endpoints)?.find((r) => asObject(r)?.tag === tag);
  if (row === undefined) throw new Error(`the fixture has no row ${tag}`);
  return row;
}

test('a /eu pin on the EU host passes with the EU price, and every request goes to the EU host', async () => {
  const stub = euStub();
  const report = await runCheck({ file: euTierFile(), stub, host: EU_HOST, now: EU_DAY });
  assert.equal(report.failed, 0);
  assert.equal(report.warnings, 0);
  assert.deepEqual(
    report.lines.map((l) => [l.status, l.check]),
    [
      ['PASS', 'model'],
      ['PASS', 'provider google-vertex/eu region'],
      ['PASS', 'provider google-vertex/eu'],
      ['PASS', 'provider google-vertex/eu zdr'],
      ['PASS', 'provider google-vertex/eu price'],
      ['PASS', 'price.checked'],
    ],
  );
  assert.deepEqual(stub.calls.toSorted(), [EU_ZDR_URL, LITE_EU_URL].toSorted(), 'the endpoints call and the ZDR call');

  // Control: the same file with a price off by a cent fails, so the pass above is a real comparison.
  const wrong = await runCheck({ file: euTierFile({ input: 0.34 }), stub: euStub(), host: EU_HOST, now: EU_DAY });
  assert.equal(wrong.failed, 1);
  assert.match(
    linesOf(wrong.lines, 'price')[0]?.detail ?? '',
    /input: file 0\.34, OpenRouter 0\.33 \(google-vertex\/eu\)/,
  );
});

test('a /eu pin against an answer with only a google-vertex/global row fails, and the global row does not stand in', async () => {
  const onlyGlobal = withRows(LITE_GLOBAL_ENDPOINTS, (rows) =>
    rows.filter((r) => asObject(r)?.tag === 'google-vertex/global'),
  );
  assert.equal(asArray(asObject(asObject(onlyGlobal)?.data)?.endpoints)?.length, 1, 'the planted answer holds one row');
  const report = await runCheck({
    file: euTierFile({ input: 0.3, output: 2.5 }),
    stub: euStub(onlyGlobal),
    host: EU_HOST,
    now: EU_DAY,
  });
  const [serves] = linesOf(report.lines, 'provider google-vertex/eu');
  assert.equal(serves?.status, 'FAIL', 'the existence check refuses the global row');
  assert.match(serves?.detail ?? '', /no standard tier endpoint serves .*; endpoints that do: google-vertex\/global/);
  assert.equal(
    linesOf(report.lines, 'zdr').length,
    0,
    'the ZDR check is never reached for a row the pin does not name',
  );
  assert.equal(linesOf(report.lines, 'price').length, 0, 'and no price is taken from it, though it matches the file');

  // Control: the same pin, price and host pass when the answer holds the EU row.
  const control = await runCheck({ file: euTierFile(), stub: euStub(), host: EU_HOST, now: EU_DAY });
  assert.equal(control.failed, 0);
});

test('a /eu pin never takes the price of a global row, and the unsuffixed pin takes every row of the provider', async () => {
  // The global host lists google-vertex/global at 0.30 / 2.50 beside google-vertex/eu at 0.33 / 2.75.
  // zdr is off: the recorded ZDR list of the global host does not cover this model.
  const euPin = (price: { input: number; output: number }) =>
    runCheck({
      file: euTierFile({ ...price, zdr: false }),
      stub: globalLiteStub(),
      host: GLOBAL_HOST,
      now: EU_DAY,
    });

  const globalPrice = await euPin({ input: 0.3, output: 2.5 });
  const [wrongPrice] = linesOf(globalPrice.lines, 'price');
  assert.equal(wrongPrice?.status, 'FAIL', 'the global row price does not satisfy a /eu pin');
  assert.match(wrongPrice?.detail ?? '', /input: file 0\.3, OpenRouter 0\.33 \(google-vertex\/eu\)/);
  assert.doesNotMatch(wrongPrice?.detail ?? '', /google-vertex\/global/);

  const euPrice = await euPin({ input: 0.33, output: 2.75 });
  assert.equal(linesOf(euPrice.lines, 'price')[0]?.status, 'PASS', 'control: the EU row price satisfies it');

  // Control: the unsuffixed pin reads the global row too, so it demands all of google-vertex at once
  // (global 0.30 against eu and us 0.33) and passes for neither price.
  const bare = (price: { input: number; output: number }) =>
    runCheck({
      file: tierFile({ model: LITE, only: ['google-vertex'], zdr: false, checked: '2026-10-06', ...price }),
      stub: globalLiteStub(),
      host: GLOBAL_HOST,
      now: EU_DAY,
    });
  const bareGlobal = await bare({ input: 0.3, output: 2.5 });
  assert.match(linesOf(bareGlobal.lines, 'price')[0]?.detail ?? '', /\(google-vertex\/eu\)/);
  assert.match(linesOf(bareGlobal.lines, 'price')[0]?.detail ?? '', /\(google-vertex\/us\)/);
  assert.equal(linesOf(bareGlobal.lines, 'price')[0]?.status, 'FAIL');
});

test('an unsuffixed pin still passes on the global host with the recorded 3.7 answers, and asks the global host', async () => {
  const stub = recorded();
  const report = await runCheck({ file: tierFile({ only: ['google-vertex'] }), stub, host: GLOBAL_HOST });
  assert.equal(report.failed, 0);
  assert.equal(report.warnings, 0);
  assert.equal(linesOf(report.lines, 'region').length, 0, 'no region line for a global host and a bare pin');
  assert.ok(stub.calls.every((url) => url.startsWith(`${OPENROUTER_API}/`)));
});

test('the EU host fails when it lists a non-/eu tag of the pinned provider, and not when it lists only /eu', async () => {
  const planted = withRows(LITE_EU_ENDPOINTS, (rows) => [
    ...rows,
    rowWithTag(LITE_GLOBAL_ENDPOINTS, 'google-vertex/global'),
  ]);
  for (const only of [['google-vertex/eu'], ['google-vertex']]) {
    const report = await runCheck({ file: euTierFile({ only }), stub: euStub(planted), host: EU_HOST, now: EU_DAY });
    const [region] = linesOf(report.lines, 'region');
    assert.equal(region?.status, 'FAIL', only.join());
    assert.match(region?.detail ?? '', /the EU host lists a non-EU endpoint of .*: google-vertex\/global/, only.join());
    assert.ok(report.failed >= 1, only.join());
  }

  // The /eu pin ignores the planted row for everything else: only the region line fails.
  const pinned = await runCheck({ file: euTierFile(), stub: euStub(planted), host: EU_HOST, now: EU_DAY });
  assert.equal(pinned.failed, 1);

  // Control: the real EU answer has no such tag and the same file passes.
  const real = await runCheck({ file: euTierFile(), stub: euStub(), host: EU_HOST, now: EU_DAY });
  assert.equal(real.failed, 0);
});

test('a flex row on the EU host is not a standard row, so it neither fails the region rule nor the price', async () => {
  const flex: JsonValue = {
    ...asObject(rowWithTag(LITE_EU_ENDPOINTS, 'google-vertex/eu')),
    tag: 'google-vertex/global/flex',
  };
  const withFlex = withRows(LITE_EU_ENDPOINTS, (rows) => [...rows, flex]);
  const report = await runCheck({ file: euTierFile(), stub: euStub(withFlex), host: EU_HOST, now: EU_DAY });
  assert.equal(report.failed, 0, 'a non-standard row is never reached by core');
  // Control: the same tag as a standard row (no flex suffix) fails.
  const standard: JsonValue = { ...asObject(flex), tag: 'google-vertex/global' };
  const bad = await runCheck({
    file: euTierFile(),
    stub: euStub(withRows(LITE_EU_ENDPOINTS, (rows) => [...rows, standard])),
    host: EU_HOST,
    now: EU_DAY,
  });
  assert.equal(bad.failed, 1);
});

test('a /eu pin on the global host fails with a message, and passes the region rule on the EU host', async () => {
  const onGlobal = await runCheck({
    file: euTierFile({ zdr: false }),
    stub: globalLiteStub(),
    host: GLOBAL_HOST,
    now: EU_DAY,
  });
  const [region] = linesOf(onGlobal.lines, 'region');
  assert.equal(region?.status, 'FAIL');
  assert.match(
    region?.detail ?? '',
    /an \/eu pin on a non-EU host: google-vertex\/eu is a region pin, but the host is https:\/\/openrouter\.ai\/api\/v1/,
  );
  assert.equal(onGlobal.failed, 1, 'the EU row exists and is priced right on the global host: the host alone fails it');

  const onEu = await runCheck({ file: euTierFile({ zdr: false }), stub: euStub(), host: EU_HOST, now: EU_DAY });
  assert.equal(linesOf(onEu.lines, 'region')[0]?.status, 'PASS', 'control: the same pin on the EU host');
  assert.equal(onEu.failed, 0);
});

test('on the EU host a pin without a region suffix is a warning, not a failure', async () => {
  const bare = await runCheck({
    file: euTierFile({ only: ['google-vertex'] }),
    stub: euStub(),
    host: EU_HOST,
    now: EU_DAY,
  });
  const [region] = linesOf(bare.lines, 'region');
  assert.equal(region?.status, 'WARN');
  assert.match(region?.detail ?? '', /the pin google-vertex has no \/eu suffix on the EU host/);
  assert.equal(bare.failed, 0);
  assert.equal(bare.warnings, 1);

  const unpinned = await runCheck({ file: euTierFile({ only: [] }), stub: euStub(), host: EU_HOST, now: EU_DAY });
  assert.match(linesOf(unpinned.lines, 'region')[0]?.detail ?? '', /no provider is pinned/);
  assert.equal(unpinned.failed, 0);

  const suffixed = await runCheck({ file: euTierFile(), stub: euStub(), host: EU_HOST, now: EU_DAY });
  assert.equal(suffixed.warnings, 0, 'control: the /eu pin does not warn');
});

// ── The host ─────────────────────────────────────────────────────────────────

function parse(value: string): CheckHost {
  return parseCheckHost({ value, source: '--host' });
}

test('only the two OpenRouter hosts are accepted, and the base is rebuilt, not echoed', () => {
  assert.deepEqual(parse(OPENROUTER_API), { base: OPENROUTER_API, isEu: false });
  assert.deepEqual(parse(OPENROUTER_EU_API), { base: OPENROUTER_EU_API, isEu: true });
  assert.deepEqual(
    parse(` ${OPENROUTER_EU_API}/ `),
    { base: OPENROUTER_EU_API, isEu: true },
    'a trailing slash and spaces',
  );

  const refused = [
    'https://evil.example/api/v1',
    'https://openrouter.ai.evil.example/api/v1',
    'https://eu.openrouter.ai.evil.example/api/v1',
    'https://evil.example/https://openrouter.ai/api/v1',
    'https://notopenrouter.ai/api/v1',
    'https://us.openrouter.ai/api/v1',
    'http://openrouter.ai/api/v1',
    'https://user:secret@openrouter.ai/api/v1',
    'https://openrouter.ai:8443/api/v1',
    'https://openrouter.ai/api/v1?x=1',
    'https://openrouter.ai/other',
    'https://openrouter.ai/api/v1/models',
    'openrouter.ai',
    '',
  ];
  for (const value of refused) assert.throws(() => parse(value), /--host/, JSON.stringify(value));
});

test('a refusal never echoes a credential in the host', () => {
  assert.throws(
    () => parseCheckHost({ value: 'https://user:secret@evil.example/api/v1', source: '--host' }),
    (error: Error) => error.message.includes('evil.example') && !error.message.includes('secret'),
  );
});

test('the network layer asks for the same two hosts only', () => {
  assert.equal(isOpenRouterUrl(`${OPENROUTER_API}/endpoints/zdr`), true);
  assert.equal(isOpenRouterUrl(`${OPENROUTER_EU_API}/models/${LITE}/endpoints`), true);
  assert.equal(isOpenRouterUrl('https://evil.example/api/v1/endpoints/zdr'), false);
  assert.equal(isOpenRouterUrl('http://openrouter.ai/api/v1/endpoints/zdr'), false);
  assert.equal(isOpenRouterUrl('https://openrouter.ai.evil.example/api/v1'), false);
  assert.equal(isOpenRouterUrl('not a url'), false);
});

test('a foreign host is refused with exit 1 before any request, from the flag and from the env', async () => {
  const viaFlag = { ...cliInput({ stub: recorded() }), argv: ['--host', 'https://evil.example/api/v1'] };
  assert.equal(await runCli(viaFlag), EXIT_FAILED);
  assert.match(viaFlag.captured.stderr, /--host names evil\.example\/api\/v1, which is refused/);
  assert.equal(viaFlag.captured.stdout, '');

  const stub = recorded();
  const viaEnv = cliInput({ stub, env: { AI_TIERS_CHECK_HOST: 'https://evil.example/api/v1' } });
  assert.equal(await runCli(viaEnv), EXIT_FAILED);
  assert.match(viaEnv.captured.stderr, /AI_TIERS_CHECK_HOST names evil\.example/);
  assert.deepEqual(stub.calls, [], 'not one request left');

  // Control: with a good host the same command makes requests and passes.
  const good = cliInput({ stub, env: { AI_TIERS_CHECK_HOST: OPENROUTER_API } });
  assert.equal(await runCli(good), EXIT_PASSED);
  assert.ok(stub.calls.length > 0);
});

test('--host, then AI_TIERS_CHECK_HOST, then the global host; the flag beats the env', async () => {
  const run = async (input: { argv: string[]; env: Record<string, string | undefined> }) => {
    const stub = euStub();
    const cli = { ...cliInput({ stub, bundled: euTierFile(), env: input.env }), argv: input.argv, now: EU_DAY };
    const code = await runCli(cli);
    return { code, calls: stub.calls, stderr: cli.captured.stderr };
  };

  // The env alone selects the EU host.
  const fromEnv = await run({ argv: [], env: { AI_TIERS_CHECK_HOST: OPENROUTER_EU_API } });
  assert.equal(fromEnv.code, EXIT_PASSED);
  assert.deepEqual(fromEnv.calls.toSorted(), [EU_ZDR_URL, LITE_EU_URL].toSorted());

  // The flag alone selects it too.
  const fromFlag = await run({ argv: ['--host', OPENROUTER_EU_API], env: {} });
  assert.equal(fromFlag.code, EXIT_PASSED);

  // Both given: the flag wins. The env names the global host, the flag the EU host, and the EU host is asked.
  const flagWins = await run({ argv: ['--host', OPENROUTER_EU_API], env: { AI_TIERS_CHECK_HOST: OPENROUTER_API } });
  assert.equal(flagWins.code, EXIT_PASSED);
  assert.ok(flagWins.calls.every((url) => url.startsWith(`${OPENROUTER_EU_API}/`)));

  // The other way round: the flag names the global host and the env the EU host. The global host is asked,
  // the stub knows no such address, and the run ends as "no verdict" (exit 2), which proves the env was ignored.
  const flagGlobal = await run({ argv: ['--host', OPENROUTER_API], env: { AI_TIERS_CHECK_HOST: OPENROUTER_EU_API } });
  assert.equal(flagGlobal.code, EXIT_UNAVAILABLE);
  assert.match(flagGlobal.stderr, /unexpected request to https:\/\/openrouter\.ai\/api\/v1\/endpoints\/zdr/);

  // A bad env value does not matter when the flag is given, and an empty one is the same as none.
  const badEnvGoodFlag = await run({
    argv: ['--host', OPENROUTER_EU_API],
    env: { AI_TIERS_CHECK_HOST: 'https://evil.example/api/v1' },
  });
  assert.equal(badEnvGoodFlag.code, EXIT_PASSED, 'the flag wins, so the env is not even read');
  const emptyEnv = await run({ argv: [], env: { AI_TIERS_CHECK_HOST: '  ' } });
  assert.equal(emptyEnv.code, EXIT_UNAVAILABLE, 'an empty env is the global host, and the EU stub knows nothing of it');
});
