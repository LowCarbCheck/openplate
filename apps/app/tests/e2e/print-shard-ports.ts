/**
 * Prints the first port of each shard of a sharded run, one number per line, and nothing else.
 *
 *     node --import tsx tests/e2e/print-shard-ports.ts 4
 *
 * `scripts/e2e-sharded.sh` reads it to give each Playwright process its own
 * `OPENPLATE_E2E_PORT_BASE` and to check that every port of every shard is free before it starts
 * anything. It prints the plan this checkout would use, so it honours the override the way a run
 * does: an exported `OPENPLATE_E2E_PORT_BASE` is shard 1's base and the others follow it.
 *
 * The shell cannot compute this itself, because the derivation hashes the checkout's REAL path
 * (`env.ts`), and a second copy of the arithmetic in sh is the kind of thing that drifts.
 */
import { E2E_PORT_BASE, planShardPortBases } from './env';

const requested = process.argv[2] ?? '';
if (!/^[0-9]+$/.test(requested)) {
  console.error(`print-shard-ports: expected a shard count, got "${requested}".`);
  process.exit(2);
}

for (const base of planShardPortBases({ base: E2E_PORT_BASE, count: Number(requested) })) {
  console.log(base);
}
