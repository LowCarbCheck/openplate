/**
 * The tracking invariants, enforced against the code.
 *
 * ── What this file used to be, and why it changed ────────────────────────
 *
 * Until 2026-08-31 this test asserted that NO analytics wiring existed
 * anywhere in `app/`, because the landing page promised exactly that. That
 * promise was reversed deliberately — the hosted instance now runs a
 * cookie-free, self-hosted Matomo — and the reversal went through the order
 * this file's previous version prescribed: the landing copy changed in both
 * locales, the privacy policy changed, and only then did this test change.
 * See `.adr/0010-hosted-analytics.md` for the decision and its reasoning.
 *
 * ── What it asserts NOW ──────────────────────────────────────────────────
 *
 * The blanket ban is gone; four narrower invariants replace it, and each one
 * is a thing that would otherwise rot silently:
 *
 *  1. **Only `matomo-events.ts` and the tracker hook touch `_paq`.** The whole
 *     no-diary-content rule lives in that one module's type signatures. A
 *     component reaching for the global queue directly bypasses every one of
 *     them and could push a food name in a single line.
 *  2. **No competitor tracker, anywhere.** Google, GTM and Plausible stay
 *     banned outright — the decision was "our own Matomo", not "analytics".
 *  3. **No hardcoded Matomo host or site id in `app/`.** Both must arrive from
 *     `MATOMO_URL`/`MATOMO_SITE_ID`, or a self-hosted instance would report
 *     into SPRQVNTRS's Matomo. This is the invariant that protects a
 *     self-hoster, and it is the one a hurried copy-paste from the sibling
 *     SelfHostedWorld hook would break — that hook hardcodes both as defaults.
 *  4. **The sync telemetry allowlist stays unwired.** `SYNC_TELEMETRY_EVENTS`
 *     is governed by M128 spec 04 and M117/D9, not by this change, and must
 *     not be quietly folded into the new events module.
 *
 * ── Why it strips comments first ─────────────────────────────────────────
 *
 * Several of these modules NAME the thing they forbid, on purpose, to explain
 * the rule. A raw grep would fail on the documentation that exists to prevent
 * the problem. Comments are removed before matching so every assertion is
 * about executable code only.
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

/** The module that DEFINES the sync allowlist, relative to `app/`. It may name it. */
const TELEMETRY_MODULE = 'lib/sync/telemetry.ts';

/** The two modules that are ALLOWED to touch Matomo's global queue. */
const MATOMO_MODULES = ['lib/matomo-events.ts', 'hooks/use-matomo-tracker.ts'];

/**
 * Banned everywhere in `app/`, by the shapes the mistakes actually take.
 *
 * Names only — a bare `analytics` or `plausible` word-match would fire on
 * prose like "a plausible height", which is in `app/models/body-metrics.ts`
 * today.
 *
 * `exceptIn` exempts the files a pattern is legitimately expected in.
 */
const TRACKING_PATTERNS: readonly { name: string; pattern: RegExp; exceptIn?: readonly string[] }[] = [
  // (1) The global queue, confined to the two modules that own it.
  { name: 'Matomo global queue (_paq) outside the analytics modules', pattern: /_paq\b/, exceptIn: MATOMO_MODULES },
  { name: 'a raw trackEvent call outside the analytics modules', pattern: /\btrackEvent\s*\(/, exceptIn: MATOMO_MODULES },
  { name: 'a matomo.js / piwik.js script outside the tracker hook', pattern: /(matomo|piwik)\.js/, exceptIn: MATOMO_MODULES },

  // (2) Competitors, banned outright. The decision was "our own Matomo".
  { name: 'Google gtag', pattern: /\bgtag\s*\(/ },
  { name: 'Google Tag Manager dataLayer', pattern: /\bdataLayer\b/ },
  { name: 'a plausible.io beacon', pattern: /plausible\.io/ },

  // (3) The self-hoster protection. A hardcoded host or site id would make
  // every self-hosted instance report into somebody else's Matomo. The
  // SelfHostedWorld hook this one was ported from defaults BOTH — that is
  // precisely the mistake being pinned here.
  { name: 'a hardcoded Matomo host', pattern: /matomo\.[a-z0-9-]+\.[a-z]{2,}/i },
  { name: 'a hardcoded Matomo site id', pattern: /\bsiteId\s*[:=]\s*\d/ },

  // (4) The sync allowlist stays unwired — M128 spec 04 owns it.
  {
    name: 'the sync telemetry allowlist, used outside its own module',
    pattern: /\bSYNC_TELEMETRY_EVENTS\b/,
    exceptIn: [TELEMETRY_MODULE],
  },
  { name: 'an import of a telemetry module', pattern: /from\s+['"][^'"]*\/telemetry(\.js)?['"]/ },
];

describe('tracking invariants', () => {
  it('keeps every banned tracking shape out of app/', () => {
    const offences = sourceFiles(APP_DIR).flatMap((path) => {
      const relative = path.slice(APP_DIR.length);
      const code = stripComments(readFileSync(path, 'utf8'));
      return TRACKING_PATTERNS.filter(
        ({ pattern, exceptIn }) => !(exceptIn ?? []).includes(relative) && pattern.test(code),
      ).map(({ name }) => `${relative}: ${name}`);
    });

    assert.deepEqual(
      offences,
      [],
      `Tracking wiring found where it is not allowed. Read .adr/0010-hosted-analytics.md ` +
        `before relaxing any of these — each one protects either a self-hoster or the ` +
        `no-diary-content rule in matomo-events.ts:\n  ${offences.join('\n  ')}`,
    );
  });

  it('still scans a meaningful number of files', () => {
    // Guards the guard: a broken walk would make the assertion above pass on
    // an empty list forever.
    assert.ok(sourceFiles(APP_DIR).length > 100, 'expected the app/ source walk to find more than 100 files');
  });

  it('every exported event is actually fired somewhere — no dead analytics exports', () => {
    // The failure this pins is one that already happened once in this file's
    // history: a full events module was written, reviewed and reported as
    // "implemented" while nothing in the app called any of it. A defined-but-
    // unfired event is worse than a missing one — it reads as coverage.
    const eventsSource = readFileSync(join(APP_DIR, 'lib/matomo-events.ts'), 'utf8');
    const exported = [...eventsSource.matchAll(/^export function (track\w+)/gm)].map((m) => m[1]);
    assert.ok(exported.length > 0, 'expected matomo-events.ts to export some track* functions');

    const callers = sourceFiles(APP_DIR)
      .filter((path) => path.slice(APP_DIR.length) !== 'lib/matomo-events.ts')
      .map((path) => stripComments(readFileSync(path, 'utf8')))
      .join('\n');

    const unfired = exported.filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(callers));
    assert.deepEqual(
      unfired,
      [],
      `Exported but never called. Wire it, or delete it — do not leave it:\n  ${unfired.join('\n  ')}`,
    );
  });

  it('the modules it exempts actually exist — an exemption for a deleted file is a silent hole', () => {
    for (const relative of [...MATOMO_MODULES, TELEMETRY_MODULE]) {
      assert.ok(
        sourceFiles(APP_DIR).some((path) => path.slice(APP_DIR.length) === relative),
        `exempted module not found: ${relative}`,
      );
    }
  });
});
