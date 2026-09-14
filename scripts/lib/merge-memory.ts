/**
 * merge-memory, union two copies of the translation memory.
 *
 *   node --import tsx scripts/merge-memory.ts --branch <dir> --run <dir> --out <dir>
 *
 * ── WHY THIS EXISTS AT ALL ──
 * `sync-docs.yml` regenerates `src/generated/` on every run and commits it. When two runs overlap,
 * a release dispatch and the run before it, both trees are complete and they differ wherever the
 * upstream repositories moved. Git cannot know that one of them is simply newer, so a rebase
 * conflicts and a text merge of two generations produces a tree that matches neither: docs synced
 * at one tag beside a `SOURCE.json` from another. That happened on 2026-09-07 in run 34096862439.
 *
 * The workflow resolves that by regenerating rather than reconciling: it throws the merge away and
 * keeps the newest complete generation, which is this run's own. That rule is right for every
 * generated file except one.
 *
 * ── THE MEMORY IS BOUGHT, NOT DERIVED ──
 * `src/generated/docs-i18n/<locale>.json` is not a function of the three source repositories. It is
 * a record of sentences a model was PAID to translate, keyed by a hash of the English. Taking this
 * run's copy whole would delete the entries the other run bought minutes earlier, and the next run
 * would buy them again and charge for them again. So the memory is unioned instead: every key from
 * both sides survives.
 *
 * ── ON A KEY PRESENT IN BOTH SIDES, THIS RUN'S VALUE IS KEPT ──
 * A key is a hash of the English, so both sides translated the SAME sentence. Both answers are
 * correct German by construction and neither is better; the translator is not deterministic, which
 * is the whole reason two runs can hold different values for one key. There is no adjudication to
 * do, so the rule is the one that needs no judgement: this run wins, the same as every other
 * generated file. Preferring the branch instead would be equally correct and harder to explain
 * beside the rest of the resolution.
 *
 * ── A DIRECTORY, NOT A FILE ──
 * The locales come from `app/i18n/language.ts` and a third one must not need an edit here. Taking
 * directories also covers the case where one side has a locale file the other has never written,
 * which is exactly what the run that ADDS a language looks like from the branch's point of view.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Memory } from './translate-shims/docs-i18n.server';
import { loadMemory, saveMemory } from './translate';

/** The two copies of one locale's memory: the one on the branch, and the one this run produced. */
interface MemoryPair {
  /** The memory as it is on `origin/main`, bought by whichever run landed first. */
  branch: Memory;
  /** The memory this run produced, which is the one its own gate has seen. */
  run: Memory;
}

/**
 * Every key from both sides, with this run's entry where both hold one.
 *
 * Named arguments rather than two positional `Memory` values: the two sides have the same type, and
 * a caller that swaps them compiles, runs, and silently applies the opposite preference rule.
 */
export function mergeMemory({ branch, run }: MemoryPair): Memory {
  return { ...branch, ...run };
}

/** What one locale file's union did, for the workflow log. */
export interface MergeReport {
  /** The file name, `de.json` and so on. */
  file: string;
  /** Entries in the merged file. */
  merged: number;
  /** Entries the branch had bought that this run's copy did not hold, and that the union saved. */
  kept: number;
}

/** The three directories: both inputs, and where the union is written. */
interface MergeDirs {
  branch: string;
  run: string;
  out: string;
}

/** Every `*.json` in a directory that may not exist. A missing directory is an empty side. */
function memoryFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json'));
}

/**
 * The union of two memory directories, written to a third.
 *
 * `out` may be either input's directory: every file is read before anything is written.
 */
export function mergeMemoryDirs({ branch, run, out }: MergeDirs): MergeReport[] {
  const files = [...new Set([...memoryFiles(branch), ...memoryFiles(run)])].toSorted((a, b) => (a < b ? -1 : 1));
  const pairs = files.map((file) => ({
    file,
    pair: { branch: loadMemory(join(branch, file)), run: loadMemory(join(run, file)) },
  }));

  mkdirSync(out, { recursive: true });
  return pairs.map(({ file, pair }) => {
    const merged = mergeMemory(pair);
    // `saveMemory` and nothing else writes this file's bytes, here and in `translate-docs`. Sorted
    // by hash, two-space JSON, one trailing newline: a union that wrote a different shape would
    // show up as a whole-file diff on the next translation run.
    saveMemory(join(out, file), merged, true);
    const kept = Object.keys(pair.branch).filter((key) => pair.run[key] === undefined).length;
    return { file, merged: Object.keys(merged).length, kept };
  });
}

/** One `--name value` pair out of the argument list, or a refusal naming the flag. */
function arg(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`merge-memory: --${name} <dir> is required`);
    process.exit(1);
  }
  return value;
}

const reports = mergeMemoryDirs({ branch: arg('branch'), run: arg('run'), out: arg('out') });
for (const report of reports) {
  console.log(`${report.file}: ${report.merged} entries, ${report.kept} kept from the branch`);
}
