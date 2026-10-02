/**
 * Prints the browser specs a push has to run.
 *
 * stdin: the changed paths relative to `apps/app`, one per line (`git diff --name-only` output
 * with the `apps/app/` prefix stripped). stdout: the word `all`, or the spec paths one per line.
 * stderr: the reasons, as `# ...` lines, so a person reading a hook log sees why. Exit 0, or 2
 * when a spec header is wrong, because a spec that declares no area must stop the gate.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { selectSpecs } from '../tests/e2e/select';
import { readSpecMeta } from '../tests/e2e/spec-meta';

const SPEC_DIR = fileURLToPath(new URL('../tests/e2e', import.meta.url));

function readChangedPaths(): string[] {
  return readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function main(): void {
  const selection = selectSpecs(readChangedPaths(), readSpecMeta(SPEC_DIR));

  if (selection.kind === 'all') {
    process.stderr.write(`# ${selection.reason}\n`);
    process.stdout.write('all\n');
    return;
  }
  for (const reason of selection.reasons) process.stderr.write(`# ${reason}\n`);
  process.stdout.write(selection.specs.map((spec) => `${spec}\n`).join(''));
}

try {
  main();
} catch (error) {
  process.stderr.write(`e2e-select: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
