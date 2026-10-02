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
