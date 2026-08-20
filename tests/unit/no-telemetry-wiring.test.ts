/**
 * The landing page's no-tracking claim, enforced against the code.
 *
 * ── The claim ────────────────────────────────────────────────────────────
 *
 * `landing.features.noTracking` says, on the public front page, in two
 * languages:
 *
 * > "There is no analytics, no advertising and no tracking pixel in openplate.
 * >  Nothing you do in the app is counted, and nothing about it is sent
 * >  anywhere."
 *
 * That is a product promise on the same footing as "the key never reaches the
 * server" (AGENTS.md, BYOK Security Rules) — and unlike that one, nothing was
 * stopping it from quietly becoming false. `app/lib/sync/telemetry.ts` already
 * holds a Matomo custom-event allowlist, deliberately UNWIRED, with a comment
 * saying M128 spec 04 decides where each event fires. The day someone wires it
 * up, the six-card grid on `/` starts lying and no test notices.
 *
 * So: this file fails the moment a tracking call appears in `app/`. If that is
 * a deliberate decision rather than an accident, the fix is to change the
 * claim on the landing page in both locales and then change this test — in
 * that order.
 *
 * ── Why it strips comments first ─────────────────────────────────────────
 *
 * The allowlist module NAMES `trackEvent` and Matomo in its own doc block, on
 * purpose, to explain that it is not wired. A raw grep would fail on the
 * documentation that exists to prevent the problem. Comments are removed
 * before matching so the assertion is about executable code only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

/** Every `.ts`/`.tsx` file under `app/`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * Drops `/* … *\/` blocks and whole-line `//` comments.
 *
 * Whole-line only, deliberately: a trailing `//` cannot be stripped without
 * parsing, because `https://…` inside a string literal looks identical. Every
 * comment this test needs to ignore is a doc block or a full comment line, and
 * being conservative here can only ever produce a false FAILURE (which a human
 * reads) and never a false pass (which nobody does).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/** The module that DEFINES the allowlist, relative to `app/`. It is allowed to name it. */
const TELEMETRY_MODULE = 'lib/sync/telemetry.ts';

/**
 * Analytics wiring, by the shapes it actually takes. Names only — a bare
 * `analytics` or `plausible` word-match would fire on prose like "a plausible
 * height", which is in `app/models/body-metrics.ts` today.
 *
 * `exceptIn` exempts the one file a pattern is expected in. Only the allowlist
 * module itself may mention its own export; every other file naming it is a
 * file that has started using it.
 */
const TRACKING_PATTERNS: readonly { name: string; pattern: RegExp; exceptIn?: string }[] = [
  { name: 'Matomo global queue (_paq)', pattern: /_paq\b/ },
  // A conventional name for a hand-rolled tracker. Nothing in this repository
  // is called this today — see the note below on why that is not enough on its
  // own, but it costs nothing and catches the obvious version of the mistake.
  { name: 'a trackEvent call', pattern: /\btrackEvent\s*\(/ },
  { name: 'Google gtag', pattern: /\bgtag\s*\(/ },
  { name: 'Google Tag Manager dataLayer', pattern: /\bdataLayer\b/ },
  { name: 'a matomo.js / piwik.js script', pattern: /(matomo|piwik)\.js/ },
  { name: 'a plausible.io beacon', pattern: /plausible\.io/ },
  /*
   * The two that name the ACTUAL unwired module, rather than a function that
   * would have to be invented first.
   *
   * `trackEvent(` used to be the ONLY guard aimed at this repository's own
   * telemetry, and as a guard it was aimed at nothing: no function of that
   * name exists here, in the allowlist module or out of it. The wiring, when
   * it comes, will import `SYNC_TELEMETRY_EVENTS` from
   * `app/lib/sync/telemetry.ts` — that is the module that exists, and its own
   * header says M128 spec 04 decides where each event fires. So these two
   * watch the real seam: the allowlist escaping its module, and anyone
   * importing a telemetry module at all.
   */
  {
    name: 'the sync telemetry allowlist, used outside its own module',
    pattern: /\bSYNC_TELEMETRY_EVENTS\b/,
    exceptIn: TELEMETRY_MODULE,
  },
  { name: 'an import of a telemetry module', pattern: /from\s+['"][^'"]*\/telemetry(\.js)?['"]/ },
];

describe('the landing page\'s "no analytics, no tracking pixel" claim', () => {
  it('has no analytics wiring anywhere in app/', () => {
    const offences = sourceFiles(APP_DIR).flatMap((path) => {
      const relative = path.slice(APP_DIR.length);
      const code = stripComments(readFileSync(path, 'utf8'));
      return TRACKING_PATTERNS.filter(({ pattern, exceptIn }) => exceptIn !== relative && pattern.test(code)).map(
        ({ name }) => `${relative}: ${name}`,
      );
    });

    assert.deepEqual(
      offences,
      [],
      `Tracking wiring found in app/. The landing page claims openplate has none ` +
        `(landing.features.noTracking, en + de). Change that copy in both locales first, ` +
        `then this test:\n  ${offences.join('\n  ')}`,
    );
  });

  it('still scans a meaningful number of files', () => {
    // Guards the guard: a broken walk would make the assertion above pass on
    // an empty list forever.
    assert.ok(sourceFiles(APP_DIR).length > 100, 'expected the app/ source walk to find more than 100 files');
  });
});
