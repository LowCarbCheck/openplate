/**
 * Repo-wide guard for DESIGN.md §11: app code names SEMANTIC TOKENS, never raw
 * Tailwind palette literals.
 *
 * `tests/unit/trend-chart-component.test.ts` already asserts this for the one
 * component where the amber regression actually shipped, but it can only see
 * markup that particular test renders — it cannot notice a fresh `amber-500`
 * appearing in a banner nobody wrote a render test for. This is the general
 * version: a plain source scan, so a literal added anywhere under `app/` fails
 * here the moment it is written.
 *
 * Scoped to the amber family on purpose. Amber is the app's OVER-GOAL signal,
 * and it is the one hue that genuinely differs between themes — the light
 * theme's `--accent-amber` is a dark ochre chosen for AA text contrast on
 * white, while Tailwind's `amber-500` is a 59%-lightness yellow that fails it
 * (see `app/app.css`). So "just use `amber-500`" is not a stylistic slip here,
 * it is an accessibility regression, and it is worth a test of its own rather
 * than a lint rule nobody reads. Green/red/zinc/teal literals still exist in a
 * few places and are deliberately NOT covered yet — widening this to the whole
 * palette is a separate, larger sweep, and a failing-on-day-one test would just
 * get deleted.
 *
 * `app/app.css` is exempt: that is where the token's actual colour values live.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** Tailwind palette classes like `amber-500`, `bg-amber-100`, `dark:text-amber-400/70`. */
const AMBER_LITERAL = /amber-\d{2,3}/g;

/** Files that are allowed to mention a raw amber value — only the token definitions. */
const EXEMPT = new Set(['app.css']);

/** Every `.ts`/`.tsx`/`.css` file under `app/`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (EXEMPT.has(entry.name)) return [];
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}

describe('DESIGN.md §11 — tokens only, no raw palette literals', () => {
  it('has no Tailwind amber palette class anywhere in app code', () => {
    const offenders = sourceFiles(APP_DIR).flatMap((file) => {
      const matches = readFileSync(file, 'utf8').match(AMBER_LITERAL) ?? [];
      return matches.map((match) => `${file.slice(APP_DIR.length + 1)}: ${match}`);
    });

    assert.deepEqual(
      offenders,
      [],
      `Use the \`accent-amber\` token (e.g. \`text-accent-amber\`, \`bg-accent-amber/10\`) instead:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('scans a non-trivial number of files — a broken walk must not pass vacuously', () => {
    // Without this, a typo in APP_DIR would make the check above assert
    // "no offenders in zero files" and stay green forever.
    assert.ok(sourceFiles(APP_DIR).length > 50);
  });

  it('still finds the token itself, so the sweep replaced rather than deleted the colour', () => {
    const uses = sourceFiles(APP_DIR).filter((file) => readFileSync(file, 'utf8').includes('accent-amber'));
    assert.ok(uses.length >= 8, `expected the amber token to be in use across the app, found ${uses.length} file(s)`);
  });
});
