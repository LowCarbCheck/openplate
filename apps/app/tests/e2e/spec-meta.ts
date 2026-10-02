/**
 * Reads the area and the smoke flag out of the doc comment at the top of every spec file.
 *
 * The header is the one place a spec can say what it belongs to without a second list to keep in
 * step: a registry in another file drifts the day somebody adds a spec and forgets it. A header
 * that is missing, doubled or wrong therefore THROWS, naming the file, so the push gate stops on
 * the spec instead of silently leaving it out of every scoped run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AREAS, type Area } from './areas';

export type SpecMeta = { path: string; area: Area; smoke: boolean };

/** Paths in a `SpecMeta` are relative to `apps/app`, the same form `git diff --name-only` prints there. */
export const SPEC_DIR_FROM_APP_ROOT = 'tests/e2e';

const AREA_LINE = /^\s*\*\s*@area\s+(\S+)\s*$/;
const SMOKE_LINE = /^\s*\*\s*@smoke\s*$/;

// Widened by assignment so `includes` takes any string, with no type assertion.
const AREA_NAMES: ReadonlyArray<string> = AREAS;

function isArea(value: string): value is Area {
  return AREA_NAMES.includes(value);
}

/** The first `/** ... *\/` block, or throws: a spec with no header cannot declare an area. */
function readHeaderLines(file: string, source: string): string[] {
  const lines = source.split('\n');
  const end = lines.findIndex((line) => line.includes('*/'));
  if (!lines[0]?.startsWith('/**') || end < 0) {
    throw new Error(`${file}: no doc comment at the top, so no "@area <name>" line`);
  }
  return lines.slice(0, end + 1);
}

export function parseSpecMeta(file: string, source: string): SpecMeta {
  const header = readHeaderLines(file, source);
  const areas = header.flatMap((line) => AREA_LINE.exec(line)?.[1] ?? []);
  if (areas.length === 0) throw new Error(`${file}: the header has no "@area <name>" line`);
  if (areas.length > 1)
    throw new Error(`${file}: the header names ${areas.length} areas (${areas.join(', ')}), exactly one is allowed`);

  const [area] = areas;
  if (area === undefined || !isArea(area)) {
    throw new Error(`${file}: "@area ${area}" is not in AREAS (${AREAS.join(', ')})`);
  }
  return { path: `${SPEC_DIR_FROM_APP_ROOT}/${file}`, area, smoke: header.some((line) => SMOKE_LINE.test(line)) };
}

/** Every `*.spec.ts` directly in `dir`, sorted by path. */
export function readSpecMeta(dir: string): SpecMeta[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .toSorted()
    .map((name) => parseSpecMeta(name, readFileSync(join(dir, name), 'utf8')));
}
