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
import {
  checkTiersLive,
  EXIT_FAILED,
  EXIT_PASSED,
  EXIT_UNAVAILABLE,
  OPENROUTER_API,
  runCli,
  STALE_AFTER_DAYS,
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

const MODEL = 'google/gemini-3.7-flash';
const ZDR_URL = `${OPENROUTER_API}/endpoints/zdr`;
const ENDPOINTS_URL = `${OPENROUTER_API}/models/${MODEL}/endpoints`;
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

async function runCheck(input: { file: JsonValue; stub?: StubbedFetch; now?: Date }) {
  return checkTiersLive({
    tiers: parseModelTiers(input.file),
    fetchJson: (input.stub ?? recorded()).fetchJson,
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

function cliInput(input: { stub: StubbedFetch; now?: Date; files?: Record<string, string>; bundled?: JsonValue }) {
  const captured: Captured = { stdout: '', stderr: '' };
  return {
    argv: noArguments(),
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
