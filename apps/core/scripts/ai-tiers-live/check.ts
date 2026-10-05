/**
 * The logic behind `pnpm ai-tiers:check-live`: it holds the tier file
 * (`ai-tiers.json`) against what OpenRouter says today, so a price assumption
 * or a zero retention route cannot go stale unseen.
 *
 * WHAT IT ASKS, WITH NO KEY. Two public endpoints, nothing else:
 *
 *   GET https://openrouter.ai/api/v1/models/<model>/endpoints   once per model
 *   GET https://openrouter.ai/api/v1/endpoints/zdr              once per run
 *
 * No key is read, sent or printed, because none is needed. The one place that
 * touches the network is the {@link FetchJson} function the caller passes in,
 * so a test feeds recorded answers and never reaches the network.
 *
 * WHAT IT CHECKS, PER TIER (the default tier included):
 *  - the model exists (a 404 is a FAIL);
 *  - every provider in `routing.only` serves it, or, when `only` is empty, at
 *    least one provider does;
 *  - with `routing.zdr` true, that provider's endpoint is on the ZDR list;
 *  - `price` equals the endpoint's `pricing`, per million tokens;
 *  - a warning (never a failure) when `price.checked` is older than
 *    {@link STALE_AFTER_DAYS} days.
 *
 * WHICH ENDPOINT. OpenRouter lists one row per provider, region and pricing
 * tier, and names the row in `tag`: `google-vertex/global` is the standard
 * tier, `google-vertex/global/flex` and `google-vertex/global/priority` are
 * the cheaper and the dearer one. The first segment of a tag is the provider
 * slug that `routing.only` takes. Core never asks for flex or priority, so the
 * price is read from the standard rows of the pinned provider only, and when
 * the provider has several standard rows (regions) EVERY row that the request
 * can reach must match: a request may land on any of them.
 *
 * TWO KINDS OF "NO". A check that fails is a FAIL line and exit code 1: the
 * file says something OpenRouter does not. OpenRouter being unreachable, or
 * answering in a shape this script does not know, is exit code 2 and no verdict
 * at all: the file may well be right.
 */
import { parseArgs } from 'node:util';
import { parseModelTiers, type ModelTier, type ModelTiers } from '../../src/ai/model-tiers.js';
import { asArray, asObject, asString, type JsonValue } from '../../src/lib/json.js';

export const OPENROUTER_API = 'https://openrouter.ai/api/v1';

/** A `price.checked` older than this many days earns a warning. */
export const STALE_AFTER_DAYS = 45;

/** Prices are compared in USD per million tokens; the endpoint reports USD per token as a decimal string. */
export const PRICE_TOLERANCE_USD_PER_MILLION = 1e-6;

const TOKENS_PER_MILLION = 1_000_000;
const MS_PER_DAY = 86_400_000;

/** The last segment of a `tag` that marks a non-standard pricing tier. Anything else is a region or nothing. */
const NON_STANDARD_SUFFIXES: ReadonlySet<string> = new Set(['flex', 'priority']);

export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_UNAVAILABLE = 2;

const USAGE = `ai-tiers:check-live, hold the tier file against OpenRouter's public endpoints API

  Usage: pnpm ai-tiers:check-live [--file <path>]

  --file <path>  the tier file to check (default: the ai-tiers.json that ships in the image)

Exit 0: nothing failed. Exit 1: a check failed, or the file is not a valid tier file.
Exit 2: OpenRouter could not be reached or answered in an unknown shape; no verdict.
No key is used or needed.`;

/** One answer: the HTTP status, and the body when it was JSON (`null` when it was not). */
export interface FetchedJson {
  status: number;
  body: JsonValue | null;
}

/** The only function that touches the network. It throws when the request cannot be made at all. */
export type FetchJson = (url: string) => Promise<FetchedJson>;

/** OpenRouter could not be asked, or its answer cannot be read. Exit code 2, never a FAIL. */
export class LiveCheckUnavailable extends Error {
  constructor(message: string, options?: { cause: Error }) {
    super(message, options);
    this.name = 'LiveCheckUnavailable';
  }
}

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

/** One line of output. */
export interface CheckLine {
  status: CheckStatus;
  tier: string;
  check: string;
  detail: string;
}

export interface LiveReport {
  lines: CheckLine[];
  passed: number;
  failed: number;
  warnings: number;
}

/** One row of OpenRouter's endpoint list, reduced to what the checks read. */
export interface LiveEndpoint {
  modelId: string;
  tag: string;
  /** The first segment of the tag: the slug `routing.only` takes. */
  provider: string;
  isStandard: boolean;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  audioUsdPerMillion: number | null;
}

// ── Reading OpenRouter's answers ─────────────────────────────────────────────

function unreadable(url: string, problem: string): LiveCheckUnavailable {
  return new LiveCheckUnavailable(`OpenRouter answered in a shape this script does not know (${problem}): ${url}`);
}

/** `"0.00000075"` (USD per token) to `0.75` (USD per million), or `null` when the row carries no usable price. */
function readUsdPerMillion(value: JsonValue | undefined): number | null {
  const text = asString(value);
  if (text === null || text.trim() === '') return null;
  const perToken = Number(text);
  return Number.isFinite(perToken) && perToken >= 0 ? perToken * TOKENS_PER_MILLION : null;
}

interface TagParts {
  provider: string;
  isStandard: boolean;
}

/** Splits `google-vertex/global/flex` into its provider slug and whether it is the standard pricing tier. */
function readTag(tag: string): TagParts {
  const segments = tag.split('/');
  const last = segments[segments.length - 1] ?? '';
  return { provider: segments[0] ?? tag, isStandard: segments.length === 1 || !NON_STANDARD_SUFFIXES.has(last) };
}

function decodeEndpoint(input: { row: JsonValue; url: string }): LiveEndpoint {
  const row = asObject(input.row);
  const tag = asString(row?.tag);
  const modelId = asString(row?.model_id);
  const pricing = asObject(row?.pricing);
  if (row === null || tag === null || modelId === null || pricing === null) {
    throw unreadable(input.url, 'an endpoint row has no tag, model_id or pricing');
  }
  return {
    modelId,
    tag,
    ...readTag(tag),
    inputUsdPerMillion: readUsdPerMillion(pricing.prompt),
    outputUsdPerMillion: readUsdPerMillion(pricing.completion),
    audioUsdPerMillion: readUsdPerMillion(pricing.audio),
  };
}

/** `{ data: { endpoints: [...] } }`, the answer for one model. */
export function decodeModelEndpoints(input: { body: JsonValue | null; url: string }): LiveEndpoint[] {
  const rows = asArray(asObject(asObject(input.body)?.data)?.endpoints);
  if (rows === null) throw unreadable(input.url, 'no data.endpoints list');
  return rows.map((row) => decodeEndpoint({ row, url: input.url }));
}

function zdrKey(endpoint: { modelId: string; tag: string }): string {
  return `${endpoint.modelId}#${endpoint.tag}`;
}

/** `{ data: [...] }`, the ZDR list: a set of `model#tag` keys. */
export function decodeZdrList(input: { body: JsonValue | null; url: string }): ReadonlySet<string> {
  const rows = asArray(asObject(input.body)?.data);
  if (rows === null) throw unreadable(input.url, 'no data list');
  const keys = new Set<string>();
  for (const row of rows) {
    const object = asObject(row);
    const modelId = asString(object?.model_id);
    const tag = asString(object?.tag);
    if (modelId === null || tag === null) throw unreadable(input.url, 'a ZDR row has no model_id or tag');
    keys.add(zdrKey({ modelId, tag }));
  }
  return keys;
}

async function getJson(input: { fetchJson: FetchJson; url: string }): Promise<FetchedJson> {
  try {
    return await input.fetchJson(input.url);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'the request failed';
    throw new LiveCheckUnavailable(`Could not reach OpenRouter at ${input.url}: ${reason}`, {
      cause: cause instanceof Error ? cause : new Error(reason),
    });
  }
}

/** The endpoints of one model, or `null` when OpenRouter says it does not exist (404). */
async function loadModelEndpoints(input: { fetchJson: FetchJson; model: string }): Promise<LiveEndpoint[] | null> {
  const url = `${OPENROUTER_API}/models/${input.model}/endpoints`;
  const answer = await getJson({ fetchJson: input.fetchJson, url });
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new LiveCheckUnavailable(`OpenRouter answered HTTP ${answer.status}: ${url}`);
  return decodeModelEndpoints({ body: answer.body, url });
}

async function loadZdrList(fetchJson: FetchJson): Promise<ReadonlySet<string>> {
  const url = `${OPENROUTER_API}/endpoints/zdr`;
  const answer = await getJson({ fetchJson, url });
  if (answer.status !== 200) throw new LiveCheckUnavailable(`OpenRouter answered HTTP ${answer.status}: ${url}`);
  return decodeZdrList({ body: answer.body, url });
}

// ── The checks ───────────────────────────────────────────────────────────────

function formatUsd(value: number | null): string {
  return value === null ? 'none' : String(Number(value.toFixed(6)));
}

function differs(input: { expected: number; actual: number | null }): boolean {
  return input.actual === null || Math.abs(input.expected - input.actual) > PRICE_TOLERANCE_USD_PER_MILLION;
}

/** What one endpoint's price disagrees on, as short phrases; empty means the price matches. */
function priceMismatches(input: { tier: ModelTier; endpoint: LiveEndpoint }): string[] {
  const price = input.tier.price;
  if (price === null) throw new Error('A tier without a price reached the live check');
  const fields: { name: string; expected: number | null; actual: number | null }[] = [
    { name: 'input', expected: price.inputUsdPerMillion, actual: input.endpoint.inputUsdPerMillion },
    { name: 'output', expected: price.outputUsdPerMillion, actual: input.endpoint.outputUsdPerMillion },
    { name: 'audio input', expected: price.audioInputUsdPerMillion, actual: input.endpoint.audioUsdPerMillion },
  ];
  return fields.flatMap(({ name, expected, actual }) => {
    if (expected === null || !differs({ expected, actual })) return [];
    return [`${name}: file ${formatUsd(expected)}, OpenRouter ${formatUsd(actual)} (${input.endpoint.tag})`];
  });
}

interface TierContext {
  name: string;
  tier: ModelTier;
  model: string;
  zdr: ReadonlySet<string>;
}

function line(input: { context: TierContext; status: CheckStatus; check: string; detail: string }): CheckLine {
  return { status: input.status, tier: input.context.name, check: input.check, detail: input.detail };
}

/** The standard rows a request pinned to `provider` (or to nothing, `null`) can land on. */
function standardRows(input: { endpoints: LiveEndpoint[]; provider: string | null }): LiveEndpoint[] {
  return input.endpoints.filter(
    (row) => row.isStandard && (input.provider === null || row.provider === input.provider),
  );
}

function checkServes(input: {
  context: TierContext;
  label: string;
  rows: LiveEndpoint[];
  all: LiveEndpoint[];
}): CheckLine {
  const { context, label, rows } = input;
  if (rows.length > 0) {
    return line({
      context,
      status: 'PASS',
      check: label,
      detail: `serves ${context.model}: ${rows.map((r) => r.tag).join(', ')}`,
    });
  }
  const providers = [...new Set(input.all.filter((row) => row.isStandard).map((row) => row.provider))];
  const known = providers.length === 0 ? 'none at the standard tier' : providers.join(', ');
  return line({
    context,
    status: 'FAIL',
    check: label,
    detail: `no standard tier endpoint serves ${context.model}; providers that do: ${known}`,
  });
}

function checkZdr(input: { context: TierContext; label: string; rows: LiveEndpoint[] }): CheckLine {
  const { context, label, rows } = input;
  const listed = rows.filter((row) => context.zdr.has(zdrKey(row)));
  if (listed.length > 0) {
    return line({
      context,
      status: 'PASS',
      check: `${label} zdr`,
      detail: `on the ZDR list: ${listed.map((r) => r.tag).join(', ')}`,
    });
  }
  return line({
    context,
    status: 'FAIL',
    check: `${label} zdr`,
    detail: `routing.zdr is true but none of ${rows.map((r) => r.tag).join(', ')} is on OpenRouter's ZDR list for ${context.model}`,
  });
}

/**
 * Pinned to a provider, EVERY reachable row must match (a request may land on
 * any of them). Pinned to nothing, ONE matching row is enough: the file does
 * not say which provider the request takes.
 */
function checkPrice(input: {
  context: TierContext;
  label: string;
  rows: LiveEndpoint[];
  isPinned: boolean;
}): CheckLine {
  const { context, label, rows } = input;
  const perRow = rows.map((endpoint) => ({ endpoint, problems: priceMismatches({ tier: context.tier, endpoint }) }));
  const isMatch = input.isPinned
    ? perRow.every((r) => r.problems.length === 0)
    : perRow.some((r) => r.problems.length === 0);
  const check = `${label} price`;
  if (isMatch) {
    const matching = perRow.filter((r) => r.problems.length === 0).map((r) => r.endpoint.tag);
    const price = context.tier.price;
    const words =
      price === null
        ? ''
        : `input ${formatUsd(price.inputUsdPerMillion)} and output ${formatUsd(price.outputUsdPerMillion)} USD per million`;
    return line({ context, status: 'PASS', check, detail: `${words} match ${matching.join(', ')}` });
  }
  const detail = perRow.flatMap((r) => r.problems).join('; ');
  return line({ context, status: 'FAIL', check, detail });
}

/** The provider checks for one pinned provider, or for the whole list when `provider` is `null`. */
function checkProvider(input: {
  context: TierContext;
  provider: string | null;
  endpoints: LiveEndpoint[];
}): CheckLine[] {
  const { context, provider } = input;
  const label = provider === null ? 'any provider' : `provider ${provider}`;
  const rows = standardRows({ endpoints: input.endpoints, provider });
  const serves = checkServes({ context, label, rows, all: input.endpoints });
  if (serves.status === 'FAIL') return [serves];

  const lines = [serves];
  let reachable = rows;
  if (context.tier.routing.zeroDataRetention) {
    const zdr = checkZdr({ context, label, rows });
    lines.push(zdr);
    if (zdr.status === 'FAIL') return lines;
    reachable = rows.filter((row) => context.zdr.has(zdrKey(row)));
  }
  lines.push(checkPrice({ context, label, rows: reachable, isPinned: provider !== null }));
  return lines;
}

function checkFreshness(input: { context: TierContext; now: Date }): CheckLine {
  const { context } = input;
  const price = context.tier.price;
  if (price === null) throw new Error('A tier without a price reached the live check');
  const days = Math.floor((input.now.getTime() - Date.parse(`${price.checked}T00:00:00Z`)) / MS_PER_DAY);
  if (days > STALE_AFTER_DAYS) {
    return line({
      context,
      status: 'WARN',
      check: 'price.checked',
      detail: `${price.checked} is ${days} days old, the limit is ${STALE_AFTER_DAYS}; read the price again and update checked`,
    });
  }
  return line({
    context,
    status: 'PASS',
    check: 'price.checked',
    detail: `${price.checked} is ${Math.max(days, 0)} days old, the limit is ${STALE_AFTER_DAYS}`,
  });
}

function checkTierAgainst(input: { context: TierContext; endpoints: LiveEndpoint[]; now: Date }): CheckLine[] {
  const { context } = input;
  const only = context.tier.routing.onlyProviders;
  const providers: readonly (string | null)[] = only.length === 0 ? [null] : only;
  const lines = providers.flatMap((provider) => checkProvider({ context, provider, endpoints: input.endpoints }));
  if (!context.tier.routing.zeroDataRetention) {
    lines.push(
      line({ context, status: 'SKIP', check: 'zdr', detail: 'routing.zdr is false, the ZDR list is not consulted' }),
    );
  }
  lines.push(checkFreshness({ context, now: input.now }));
  return lines;
}

function summarize(lines: CheckLine[]): LiveReport {
  const count = (status: CheckStatus): number => lines.filter((l) => l.status === status).length;
  return { lines, passed: count('PASS'), failed: count('FAIL'), warnings: count('WARN') };
}

/**
 * Checks every tier of the file against OpenRouter. Throws
 * {@link LiveCheckUnavailable} when OpenRouter cannot be asked or read; a check
 * that fails is a line, not a throw.
 */
export async function checkTiersLive(input: {
  tiers: ModelTiers;
  fetchJson: FetchJson;
  now: Date;
}): Promise<LiveReport> {
  const zdr = await loadZdrList(input.fetchJson);
  const endpointsByModel = new Map<string, LiveEndpoint[] | null>();
  const lines: CheckLine[] = [];

  for (const [tierName, tier] of input.tiers.tiers) {
    const name = tierName === input.tiers.defaultTier ? `${tierName} (default)` : tierName;
    if (tier.model === null || tier.price === null)
      throw new Error(`The tier ${tierName} has no model or price to check`);
    const context: TierContext = { name, tier, model: tier.model, zdr };

    if (!endpointsByModel.has(tier.model)) {
      endpointsByModel.set(tier.model, await loadModelEndpoints({ fetchJson: input.fetchJson, model: tier.model }));
    }
    const endpoints = endpointsByModel.get(tier.model) ?? null;
    if (endpoints === null) {
      lines.push(
        line({ context, status: 'FAIL', check: 'model', detail: `${tier.model} does not exist on OpenRouter (404)` }),
      );
      continue;
    }
    lines.push(
      line({
        context,
        status: 'PASS',
        check: 'model',
        detail: `${tier.model} exists, ${endpoints.length} endpoints listed`,
      }),
    );
    lines.push(...checkTierAgainst({ context, endpoints, now: input.now }));
  }
  return summarize(lines);
}

export function formatLine(l: CheckLine): string {
  return `${l.status.padEnd(4)}  ${l.tier}  ${l.check}: ${l.detail}`;
}

export function formatSummary(report: LiveReport): string {
  const total = report.lines.length;
  const verdict = report.failed === 0 ? 'OK' : 'FAILED';
  return `${verdict}: ${total} ${total === 1 ? 'line' : 'lines'}, ${report.passed} passed, ${report.failed} failed, ${report.warnings} warnings`;
}

// ── The command ──────────────────────────────────────────────────────────────

export interface CliInput {
  argv: string[];
  fetchJson: FetchJson;
  now: Date;
  /** The file inside the image, used when no `--file` is given. */
  bundled: JsonValue;
  readFile: (path: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function readTiers(input: { file: string | null; bundled: JsonValue; readFile: (path: string) => string }): ModelTiers {
  if (input.file === null) return parseModelTiers(input.bundled);
  let text: string;
  try {
    text = input.readFile(input.file);
  } catch (cause) {
    throw new Error(`The tier file ${input.file} cannot be read`, { cause });
  }
  try {
    // SAFETY: `JSON.parse` returns JSON by construction; `parseModelTiers`
    // re-establishes every key and type before anything is used.
    return parseModelTiers(JSON.parse(text) as JsonValue);
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error(`The tier file ${input.file} is not valid JSON`, { cause });
    throw cause;
  }
}

function readFileOption(argv: string[]): string | null {
  const { values } = parseArgs({
    args: argv,
    options: { file: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  return values.file ?? null;
}

/** Runs the command and returns its exit code: 0 nothing failed, 1 a check or the file failed, 2 no verdict. */
export async function runCli(input: CliInput): Promise<number> {
  let tiers: ModelTiers;
  try {
    tiers = readTiers({ file: readFileOption(input.argv), bundled: input.bundled, readFile: input.readFile });
  } catch (cause) {
    input.stderr(`${cause instanceof Error ? cause.message : 'The tier file cannot be used'}\n\n${USAGE}\n`);
    return EXIT_FAILED;
  }

  let report: LiveReport;
  try {
    report = await checkTiersLive({ tiers, fetchJson: input.fetchJson, now: input.now });
  } catch (cause) {
    if (!(cause instanceof LiveCheckUnavailable)) throw cause;
    input.stderr(`No verdict. ${cause.message}\nThis is not a FAIL: the tier file was not judged. Try again later.\n`);
    return EXIT_UNAVAILABLE;
  }

  for (const l of report.lines) input.stdout(`${formatLine(l)}\n`);
  input.stdout(`${formatSummary(report)}\n`);
  return report.failed === 0 ? EXIT_PASSED : EXIT_FAILED;
}
