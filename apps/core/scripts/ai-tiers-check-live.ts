/**
 * `pnpm ai-tiers:check-live [--file <path>]`: holds the model tier file against
 * OpenRouter's public endpoints API, so a price assumption or a zero retention
 * route cannot go stale unseen. It needs no key and prints none.
 *
 * The logic and the exit codes are in `ai-tiers-live/check.ts`; this file only
 * wires the real file system, the real network and the clock to it.
 */
import { readFileSync } from 'node:fs';
import { BUNDLED_MODEL_TIERS } from '../src/ai/model-tiers.js';
import { runCli } from './ai-tiers-live/check.js';
import { fetchJsonFromNetwork } from './ai-tiers-live/network.js';

async function run(): Promise<void> {
  process.exitCode = await runCli({
    argv: process.argv.slice(2),
    fetchJson: fetchJsonFromNetwork,
    now: new Date(),
    bundled: BUNDLED_MODEL_TIERS,
    readFile: (path) => readFileSync(path, 'utf8'),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

run().catch(() => {
  // The message is not printed: an unexpected error is a bug in this tool, and its text could carry a path or an address.
  process.stderr.write('ai-tiers:check-live failed with an unexpected error\n');
  process.exitCode = 1;
});
