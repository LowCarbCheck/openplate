/**
 * Which browser specs a push has to run, as a pure function of the touched paths.
 *
 * No file system and no git in here: the caller hands in the changed paths and the specs'
 * metadata, so every rule is a unit test (`tests/unit/e2e-select.test.ts`). The CLI that feeds it
 * is `scripts/e2e-select.ts`; the rules themselves are `PATH_RULES` in `areas.ts`.
 */
import { PATH_RULES, type Area } from './areas';
import { SPEC_DIR_FROM_APP_ROOT, type SpecMeta } from './spec-meta';

export type Selection = { kind: 'all'; reason: string } | { kind: 'some'; specs: string[]; reasons: string[] };

type Resolution = Area | 'all' | 'none';

const SPEC_PATH = new RegExp(`^${SPEC_DIR_FROM_APP_ROOT.replaceAll('/', '\\/')}\\/[^/]+\\.spec\\.ts$`);

/** First matching rule wins. A path no rule names is `all`: see the note on `PATH_RULES`. */
export function resolvePath(path: string): Resolution {
  return PATH_RULES.find((rule) => rule.pattern.test(path))?.area ?? 'all';
}

export function selectSpecs(changedPaths: string[], specs: SpecMeta[]): Selection {
  const knownSpecs = new Set(specs.map((spec) => spec.path));
  const picked = new Set<string>();
  const touchedAreas = new Map<Area, string>();
  const reasons: string[] = [];

  for (const raw of changedPaths) {
    const path = raw.replace(/^\.\//, '');
    if (SPEC_PATH.test(path)) {
      // A deleted spec is a changed path with nothing to run, so it is skipped rather than thrown on.
      if (knownSpecs.has(path)) {
        picked.add(path);
        reasons.push(`${path}: the spec itself changed`);
      }
      continue;
    }

    const resolution = resolvePath(path);
    if (resolution === 'all') return { kind: 'all', reason: `${path} is shared or unmapped code, so every spec runs` };
    if (resolution === 'none') {
      reasons.push(`${path}: no browser reach, nothing to run for it`);
      continue;
    }
    if (!touchedAreas.has(resolution)) touchedAreas.set(resolution, path);
  }

  for (const [area, path] of touchedAreas) reasons.push(`${path}: the ${area} area runs`);
  if (changedPaths.length === 0) reasons.push('no changed paths, so only the smoke set runs');

  for (const spec of specs) {
    if (spec.smoke || touchedAreas.has(spec.area)) picked.add(spec.path);
  }
  reasons.push('the smoke set always runs');

  return { kind: 'some', specs: [...picked].toSorted(), reasons };
}
