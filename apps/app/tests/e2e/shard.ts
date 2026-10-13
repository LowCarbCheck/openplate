/**
 * WHICH SHARD OF A SHARDED RUN THIS PROCESS BELONGS TO.
 *
 * `scripts/e2e-sharded.sh` starts N Playwright processes of one checkout, each with
 * `--shard=i/N`, and gives each one its number in `OPENPLATE_E2E_SHARD`. Three things in this
 * tier were shared by every run of a checkout and have to be separate per shard, and each one
 * reads this variable to find out which shard it is:
 *
 *  - the three ports (`env.ts`, `shardPortBase`; the runner also hands each shard its own
 *    `OPENPLATE_E2E_PORT_BASE`, so `env.ts` needs no knowledge of the shard to follow it),
 *  - the fontconfig cache directory (`font-cache.ts`), which `global-setup.ts` wipes,
 *  - Playwright's output folder (`--output`, set by the runner).
 *
 * UNSET MEANS "NOT SHARDED", and a run that is not sharded behaves exactly as it did before this
 * variable existed: one shared cache directory name, `test-results/` for output, the derived
 * ports. The runner does not set it for a single shard, so `OPENPLATE_E2E_SHARDS=1` is today's
 * run, byte for byte.
 */

/** The variable that carries this process's shard number, counted from 1 as `--shard=i/N` counts. */
export const E2E_SHARD_VAR = 'OPENPLATE_E2E_SHARD';

/** A whole decimal number and nothing else, so `1e1` and `0x2` are refused. */
const WHOLE_NUMBER = /^[0-9]+$/;

/**
 * Reads the shard number, or `null` when this run is not sharded.
 *
 * An empty value counts as unset, the same rule `OPENPLATE_E2E_PORT_BASE` follows, so a blank
 * line in somebody's shell profile cannot change what a run does. Anything else that is not a
 * whole number of 1 or more is refused in one sentence that names the variable: a shard that
 * quietly read as "not sharded" would share its cache and its ports with a sibling.
 *
 * @param raw - the variable's value.
 */
export function parseShardNumber(raw: string | undefined): number | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  const parsed = Number(value);
  if (!WHOLE_NUMBER.test(value) || parsed < 1) {
    throw new Error(`${E2E_SHARD_VAR}=${value} is not a shard number: it has to be a whole number of 1 or more.`);
  }
  return parsed;
}

/** The variable that sets how many times Playwright retries a failed spec. */
export const E2E_RETRIES_VAR = 'OPENPLATE_E2E_RETRIES';

/** The most retries a run may ask for: more than this is a race being hidden, not a load spike. */
const MAX_RETRIES = 3;

/**
 * Reads the retry count, or refuses it.
 *
 * Unset or empty is 0, today's behaviour. Anything else must be a whole number from 0 to 3, and
 * is NOT trimmed: a typo that quietly read as 0 would turn a gate meant to tolerate one slow
 * spec into one that fails on it, and a value that quietly read as a large number would hide a
 * race. So the refusal is one sentence that names the variable and the value.
 *
 * @param value - the variable's value.
 */
export function retriesFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!WHOLE_NUMBER.test(value) || parsed > MAX_RETRIES) {
    throw new Error(
      `${E2E_RETRIES_VAR}=${value} is not a retry count: it has to be a whole number from 0 to ${MAX_RETRIES}.`,
    );
  }
  return parsed;
}

/** The variable that scales the per-spec timeout, for a runner slower than the dev host. */
export const E2E_TIMEOUT_FACTOR_VAR = 'OPENPLATE_E2E_TIMEOUT_FACTOR';

/** The smallest factor: 1 is the host figure, and a gate may never be stricter than that. */
const MIN_TIMEOUT_FACTOR = 1;

/** The largest factor: more than this is a hang being hidden, not a slow runner. */
const MAX_TIMEOUT_FACTOR = 5;

/** A plain decimal number and nothing else, so `1e1`, `0x2` and `Infinity` are refused. */
const DECIMAL_NUMBER = /^[0-9]+(\.[0-9]+)?$/;

/**
 * Reads the timeout factor, or refuses it.
 *
 * Unset or blank is 1, today's behaviour, so the local gate and the nightly stay exactly as strict
 * as they are. Anything else must be a finite decimal number from 1 to 5, and is refused in one
 * sentence that names the variable and the value: a typo that quietly read as 1 would leave a slow
 * runner failing on timeouts, and one that read as a large number would hide a hang.
 *
 * @param raw - the variable's value.
 */
export function timeoutFactorFromEnv(raw: string | undefined): number {
  const value = raw?.trim() ?? '';
  if (value === '') return MIN_TIMEOUT_FACTOR;
  const parsed = Number(value);
  const isInRange = parsed >= MIN_TIMEOUT_FACTOR && parsed <= MAX_TIMEOUT_FACTOR;
  if (!DECIMAL_NUMBER.test(value) || !Number.isFinite(parsed) || !isInRange) {
    throw new Error(
      `${E2E_TIMEOUT_FACTOR_VAR}=${raw} is not a timeout factor: it has to be a number from ${MIN_TIMEOUT_FACTOR} to ${MAX_TIMEOUT_FACTOR}.`,
    );
  }
  return parsed;
}
