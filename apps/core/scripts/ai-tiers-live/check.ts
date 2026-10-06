/**
 * The logic behind `pnpm ai-tiers:check-live`: it holds the tier file
 * (`ai-tiers.json`) against what OpenRouter says today, so a price assumption
 * or a zero retention route cannot go stale unseen.
 *
 * WHAT IT ASKS, WITH NO KEY. Two public endpoints, nothing else:
 *
 *   GET <host>/models/<model>/endpoints   once per model
 *   GET <host>/endpoints/zdr              once per run
 *
 * No key is read, sent or printed, because none is needed. The one place that
 * touches the network is the {@link FetchJson} function the caller passes in,
 * so a test feeds recorded answers and never reaches the network.
 *
 * WHICH HOST (for Bay). `<host>` is `https://openrouter.ai/api/v1` by default.
 * OpenRouter's EU host, `https://eu.openrouter.ai/api/v1`, lists DIFFERENT
 * endpoints (the same model is `<provider>/eu` there and `<provider>/global`
 * on the global host), so the check must ask the host the instance really
 * uses. Pass it with `--host <base url>`, or with the env variable
 * `AI_TIERS_CHECK_HOST` when the flag is absent; the flag wins. Bay hands in
 * its `UPSTREAM_BASE_URL` here, and compares that host with the pin suffix:
 * a pin that ends in `/eu` belongs on the EU host and nowhere else, and an
 * instance on the EU host should pin a `/eu` slug. Only these two hosts are
 * accepted; any other host is refused before a single request is made, so the
 * script can never send a request elsewhere.
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
 * the cheaper and the dearer one. A pinned slug (`routing.only`) matches a tag
 * BY SEGMENTS: the pin `a` matches the tags `a` and `a/<anything>`, the pin
 * `a/b` matches only `a/b` and `a/b/<anything>`. So a pin on `google-vertex/eu`
 * is never satisfied by a `google-vertex/global` row: not for the existence
 * check, not for the ZDR check and not for the price. Core never asks for flex
 * or priority, so the price is read from the standard rows of the pin only
 * (a last segment of `flex` or `priority` is not standard), and when the pin
 * matches several standard rows (regions) EVERY row that the request can reach
 * must match: a request may land on any of them.
 *
 * THE REGION RULE. On the EU host, every standard row of the pinned provider
 * must carry a tag whose last segment is `eu`: the EU host must never list a
 * non-EU endpoint of the provider, and a row that does is a FAIL. A pin that
 * ends in `/eu` on any other host is a FAIL too (it is a region pin on a host
 * that does not guarantee the region). On the EU host, a pin that does not end
 * in `/eu` is a WARN, never a failure: it passes today, but nothing in the pin
 * keeps it passing. With an empty `only` list the rule reads every standard row
 * of the model.
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

/** OpenRouter's EU host: it lists EU endpoints only, tagged `<provider>/eu`. */
export const OPENROUTER_EU_API = 'https://eu.openrouter.ai/api/v1';

/** The env variable `--host` falls back to. */
export const HOST_ENV_VARIABLE = 'AI_TIERS_CHECK_HOST';

const GLOBAL_HOSTNAME = 'openrouter.ai';
const EU_HOSTNAME = 'eu.openrouter.ai';
const API_PATH = '/api/v1';

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

  Usage: pnpm ai-tiers:check-live [--file <path>] [--host <base url>]

  --file <path>     the tier file to check (default: the ai-tiers.json that ships in the image)
  --host <base url> the OpenRouter host to ask (default: https://openrouter.ai/api/v1; the EU host
                    is https://eu.openrouter.ai/api/v1). Read from ${HOST_ENV_VARIABLE} when the
                    flag is absent; the flag wins. No other host is accepted.

Exit 0: nothing failed. Exit 1: a check failed, or the file is not a valid tier file.
Exit 2: OpenRouter could not be reached or answered in an unknown shape; no verdict.
No key is used or needed.`;

/** An OpenRouter host this check may ask: the canonical base URL, and whether it is the EU host. */
export interface CheckHost {
  base: string;
  isEu: boolean;
}

const ACCEPTED_HOSTS = `only ${OPENROUTER_API} and ${OPENROUTER_EU_API} are accepted`;

/**
 * The one door for a host. Accepts only `https://openrouter.ai/api/v1` and
 * `https://eu.openrouter.ai/api/v1` (a trailing slash is fine) and refuses
 * every other host, port, scheme, credential, query and path, so no request can
 * be sent anywhere else. The error names the host and never the credentials.
 */
export function parseCheckHost(input: { value: string; source: string }): CheckHost {
  let url: URL;
  try {
    url = new URL(input.value.trim());
  } catch {
    throw new Error(`${input.source} is not a URL; ${ACCEPTED_HOSTS}`);
  }
  const isEu = url.hostname === EU_HOSTNAME;
  const isAccepted =
    url.protocol === 'https:' &&
    (isEu || url.hostname === GLOBAL_HOSTNAME) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.pathname.replace(/\/+$/, '') === API_PATH;
  if (!isAccepted)
    throw new Error(`${input.source} names ${url.hostname}${url.pathname}, which is refused; ${ACCEPTED_HOSTS}`);
  return { base: `https://${url.hostname}${API_PATH}`, isEu };
}

/** True when `url` is an https address on one of the two accepted hosts. The network layer asks this before it sends. */
export function isOpenRouterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === GLOBAL_HOSTNAME || parsed.hostname === EU_HOSTNAME) &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

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
  /** The first segment of the tag: the provider a pin names, with or without a region. */
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
async function loadModelEndpoints(input: {
  fetchJson: FetchJson;
  host: CheckHost;
  model: string;
}): Promise<LiveEndpoint[] | null> {
  const url = `${input.host.base}/models/${input.model}/endpoints`;
  const answer = await getJson({ fetchJson: input.fetchJson, url });
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new LiveCheckUnavailable(`OpenRouter answered HTTP ${answer.status}: ${url}`);
  return decodeModelEndpoints({ body: answer.body, url });
}

async function loadZdrList(input: { fetchJson: FetchJson; host: CheckHost }): Promise<ReadonlySet<string>> {
  const url = `${input.host.base}/endpoints/zdr`;
  const answer = await getJson({ fetchJson: input.fetchJson, url });
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
  host: CheckHost;
}

function line(input: { context: TierContext; status: CheckStatus; check: string; detail: string }): CheckLine {
  return { status: input.status, tier: input.context.name, check: input.check, detail: input.detail };
}

/**
 * True when the pinned slug names this tag, by segments: the slug `a` names the
 * tags `a` and `a/<anything>`, the slug `a/b` names `a/b` and `a/b/<anything>`
 * and never `a/c`, `a` or `a/bc`.
 */
export function matchesPin(input: { tag: string; slug: string }): boolean {
  return input.tag === input.slug || input.tag.startsWith(`${input.slug}/`);
}

function lastSegment(text: string): string {
  return text.split('/').at(-1) ?? text;
}

/** True when the last segment is `eu`: a region pin, or a row the EU host lists. */
function endsInEu(text: string): boolean {
  return lastSegment(text) === 'eu';
}

/** The standard rows a request pinned to `pin` (or to nothing, `null`) can land on. */
function standardRows(input: { endpoints: LiveEndpoint[]; pin: string | null }): LiveEndpoint[] {
  const { pin } = input;
  return input.endpoints.filter((row) => row.isStandard && (pin === null || matchesPin({ tag: row.tag, slug: pin })));
}

/** The standard rows of the whole provider a pin names (`google-vertex/eu` names `google-vertex`), or of the model for no pin. */
function providerFamilyRows(input: { endpoints: LiveEndpoint[]; pin: string | null }): LiveEndpoint[] {
  const family = input.pin === null ? null : (input.pin.split('/')[0] ?? input.pin);
  return input.endpoints.filter((row) => row.isStandard && (family === null || row.provider === family));
}

function checkServes(input: {
  context: TierContext;
  label: string;
  rows: LiveEndpoint[];
  all: LiveEndpoint[];
  isRegionPin: boolean;
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
  const standard = input.all.filter((row) => row.isStandard);
  // A pin with a region (`a/eu`) is compared with whole tags; a bare provider with providers.
  const names = input.isRegionPin ? standard.map((row) => row.tag) : standard.map((row) => row.provider);
  const known = names.length === 0 ? 'none at the standard tier' : [...new Set(names)].join(', ');
  return line({
    context,
    status: 'FAIL',
    check: label,
    detail: `no standard tier endpoint serves ${context.model}; ${input.isRegionPin ? 'endpoints' : 'providers'} that do: ${known}`,
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

/**
 * The region rule for one pin (see the header). `null` when there is nothing to
 * say: a global host with no region pin, or no row of the provider to judge.
 */
function checkRegion(input: {
  context: TierContext;
  label: string;
  pin: string | null;
  endpoints: LiveEndpoint[];
}): CheckLine | null {
  const { context, label, pin } = input;
  const check = `${label} region`;
  const isRegionPin = pin !== null && endsInEu(pin);
  if (!context.host.isEu) {
    if (!isRegionPin) return null;
    return line({
      context,
      status: 'FAIL',
      check,
      detail: `an /eu pin on a non-EU host: ${pin} is a region pin, but the host is ${context.host.base}; ask ${OPENROUTER_EU_API} or drop the region from the pin`,
    });
  }
  const family = providerFamilyRows({ endpoints: input.endpoints, pin });
  if (family.length === 0) return null;
  const foreign = family.filter((row) => !endsInEu(row.tag));
  if (foreign.length > 0) {
    return line({
      context,
      status: 'FAIL',
      check,
      detail: `the EU host lists a non-EU endpoint of ${pin ?? context.model}: ${foreign.map((r) => r.tag).join(', ')}; every standard endpoint on the EU host must end in /eu`,
    });
  }
  if (!isRegionPin) {
    return line({
      context,
      status: 'WARN',
      check,
      detail: `${pin === null ? 'no provider is pinned' : `the pin ${pin} has no /eu suffix`} on the EU host; it passes today (${family.map((r) => r.tag).join(', ')}), but nothing in the pin keeps it in the EU`,
    });
  }
  return line({
    context,
    status: 'PASS',
    check,
    detail: `every standard endpoint of ${pin} on the EU host ends in /eu: ${family.map((r) => r.tag).join(', ')}`,
  });
}

/** The provider checks for one pin, or for the whole list when `pin` is `null`. */
function checkProvider(input: { context: TierContext; pin: string | null; endpoints: LiveEndpoint[] }): CheckLine[] {
  const { context, pin } = input;
  const label = pin === null ? 'any provider' : `provider ${pin}`;
  const rows = standardRows({ endpoints: input.endpoints, pin });
  const region = checkRegion({ context, label, pin, endpoints: input.endpoints });
  const lines = region === null ? [] : [region];
  const serves = checkServes({
    context,
    label,
    rows,
    all: input.endpoints,
    isRegionPin: pin !== null && pin.includes('/'),
  });
  lines.push(serves);
  if (serves.status === 'FAIL') return lines;

  let reachable = rows;
  if (context.tier.routing.zeroDataRetention) {
    const zdr = checkZdr({ context, label, rows });
    lines.push(zdr);
    if (zdr.status === 'FAIL') return lines;
    reachable = rows.filter((row) => context.zdr.has(zdrKey(row)));
  }
  lines.push(checkPrice({ context, label, rows: reachable, isPinned: pin !== null }));
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
  const pins: readonly (string | null)[] = only.length === 0 ? [null] : only;
  const lines = pins.flatMap((pin) => checkProvider({ context, pin, endpoints: input.endpoints }));
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
  host: CheckHost;
  now: Date;
}): Promise<LiveReport> {
  const zdr = await loadZdrList({ fetchJson: input.fetchJson, host: input.host });
  const endpointsByModel = new Map<string, LiveEndpoint[] | null>();
  const lines: CheckLine[] = [];

  for (const [tierName, tier] of input.tiers.tiers) {
    const name = tierName === input.tiers.defaultTier ? `${tierName} (default)` : tierName;
    if (tier.model === null || tier.price === null)
      throw new Error(`The tier ${tierName} has no model or price to check`);
    const context: TierContext = { name, tier, model: tier.model, zdr, host: input.host };

    if (!endpointsByModel.has(tier.model)) {
      endpointsByModel.set(
        tier.model,
        await loadModelEndpoints({ fetchJson: input.fetchJson, host: input.host, model: tier.model }),
      );
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
        detail: `${tier.model} exists, ${endpoints.length} endpoints listed on ${input.host.base}`,
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
  /** The environment: only `AI_TIERS_CHECK_HOST` is read, and only when `--host` is absent. */
  env: Readonly<Record<string, string | undefined>>;
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

interface CliOptions {
  file: string | null;
  host: string | null;
}

function readOptions(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: { file: { type: 'string' }, host: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  return { file: values.file ?? null, host: values.host ?? null };
}

/** The flag wins; the env variable is read only when the flag is absent; an unset or empty env means the global host. */
function resolveHost(input: { flag: string | null; env: CliInput['env'] }): CheckHost {
  if (input.flag !== null) return parseCheckHost({ value: input.flag, source: '--host' });
  const fromEnv = input.env[HOST_ENV_VARIABLE]?.trim() ?? '';
  if (fromEnv !== '') return parseCheckHost({ value: fromEnv, source: HOST_ENV_VARIABLE });
  return parseCheckHost({ value: OPENROUTER_API, source: 'the default host' });
}

/** Runs the command and returns its exit code: 0 nothing failed, 1 a check or the file failed, 2 no verdict. */
export async function runCli(input: CliInput): Promise<number> {
  let tiers: ModelTiers;
  let host: CheckHost;
  try {
    const options = readOptions(input.argv);
    host = resolveHost({ flag: options.host, env: input.env });
    tiers = readTiers({ file: options.file, bundled: input.bundled, readFile: input.readFile });
  } catch (cause) {
    input.stderr(
      `${cause instanceof Error ? cause.message : 'The arguments or the tier file cannot be used'}\n\n${USAGE}\n`,
    );
    return EXIT_FAILED;
  }

  let report: LiveReport;
  try {
    report = await checkTiersLive({ tiers, fetchJson: input.fetchJson, host, now: input.now });
  } catch (cause) {
    if (!(cause instanceof LiveCheckUnavailable)) throw cause;
    input.stderr(`No verdict. ${cause.message}\nThis is not a FAIL: the tier file was not judged. Try again later.\n`);
    return EXIT_UNAVAILABLE;
  }

  for (const l of report.lines) input.stdout(`${formatLine(l)}\n`);
  input.stdout(`${formatSummary(report)}\n`);
  return report.failed === 0 ? EXIT_PASSED : EXIT_FAILED;
}
