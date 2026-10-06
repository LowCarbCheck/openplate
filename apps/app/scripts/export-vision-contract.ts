/**
 * export-vision-contract, write the vision contract the eval harness reads.
 *
 *   pnpm vision:export-contract            # rewrite apps/inference/eval/generated/vision-contract.json
 *   pnpm vision:export-contract -- --check # compare only, exit 1 when the committed file is stale
 *
 * A DEVELOPER TOOL whose output is COMMITTED. The reasoning is in `./lib/vision-contract.ts`: the prompts and
 * schemas come from the app's real builders, so the harness measures the request the app sends. The unit test
 * `tests/unit/vision-contract-export.test.ts` runs the same comparison in the push gate.
 *
 * Idempotent: a second run writes the same bytes, so `git status` stays clean.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  CONTRACT_REPO_PATH,
  REPO_ROOT,
  buildVisionContract,
  describeContractDifferences,
  readCommittedContract,
  serializeVisionContract,
} from './lib/vision-contract';

const CHECK_FLAG = '--check';

/** The committed file, or '' when there is none yet. Any other failure (permissions, a directory) is a real error. */
function readCommittedOrEmpty(): string {
  try {
    return readCommittedContract();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

function main(): void {
  const regenerated = serializeVisionContract(buildVisionContract());
  const target = resolve(REPO_ROOT, CONTRACT_REPO_PATH);

  if (process.argv.includes(CHECK_FLAG)) {
    const committed = readCommittedOrEmpty();
    if (committed === regenerated) {
      process.stdout.write(`${CONTRACT_REPO_PATH} is current\n`);
      return;
    }
    const where =
      committed === '' ? ['the committed file is missing'] : describeContractDifferences({ committed, regenerated });
    process.stderr.write(`${CONTRACT_REPO_PATH} is stale:\n${where.map((path) => `  ${path}\n`).join('')}`);
    process.stderr.write('Run `pnpm vision:export-contract` in apps/app and commit the result.\n');
    process.exit(1);
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, regenerated);
  process.stdout.write(`wrote ${CONTRACT_REPO_PATH} (${regenerated.length} bytes)\n`);
}

main();
