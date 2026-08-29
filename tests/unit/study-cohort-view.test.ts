/**
 * WHAT THE CONSOLE SAYS, AND IN WHICH REGISTER (M163/03, `openplate-sync`
 * ADR-0003).
 *
 * Three rules, each of which fails silently if it is not executable.
 *
 * ── 1. The un-openable count is INFORMATION ──────────────────────────────
 *
 * "4 of 31 are sealed to a key this device does not hold" is the normal state
 * after a rotation or a restore from an older snapshot; `study.ts` counts it
 * out loud precisely so a cohort does not shrink in silence. A console that
 * painted it as a failure would teach a researcher that a working console is
 * broken — and, worse, that the number is something to make go away.
 * `malformedCount` is the one count that IS a defect, and it is the only line
 * allowed to reach `--destructive`.
 *
 * ── 2. The lines are the export's own ────────────────────────────────────
 *
 * `buildExportHeaderLines` is what the file carries; the screen shows exactly
 * those strings, resolved through the SHIPPED English catalog rather than a
 * stub translator. A paraphrase on screen would be a second wording of a
 * research artifact's provenance, and only one of the two would be reviewed.
 *
 * ── 3. Nothing offers to publish the study key ───────────────────────────
 *
 * There is no registry to publish one to (prohibition 10), and the trust
 * anchor is a PRINTED consent document. The card shows the fingerprint — a
 * hash, meant to be read and typed — and offers no link, no copy, no QR and no
 * send. The key bytes themselves never reach the markup at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { englishExportStrings } from './research-i18n-harness';
import { StudyCohortPanel } from '../../app/components/study-cohort-panel';
import { StudyKeyCard } from '../../app/components/study-key-card';
import { buildExportHeaderLines } from '../../app/lib/sync/research/export';
import type { StudyCohort } from '../../app/lib/sync/research/study';
import { toneCohortLines } from '../../app/lib/sync/research/study-console-view';

const FROM_DAY_KEY = '2026-08-01';
const TO_DAY_KEY = '2026-08-31';

/** The modules a researcher looking at `/study` is actually looking at. */
const CONSOLE_SURFACE_MODULES = [
  '../../app/routes/study._index.tsx',
  '../../app/components/study-key-card.tsx',
  '../../app/components/study-cohort-panel.tsx',
] as const;

/**
 * Anything that would move a study key off this screen.
 *
 * Written as identifiers rather than words, so the rule is about what the code
 * DOES and cannot be tripped by a comment that states the rule — `uqr` is the
 * QR dependency `share-invite-link-card.tsx` uses, and a literal `<svg` is how
 * that card draws its matrix (the icons here are components, never markup).
 */
const PUBLISHING_VERBS = /clipboard|navigator\.share|mailto:|study-link|buildStudyLink|from '@?uqr|<svg/;

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/**
 * The source with comment lines removed.
 *
 * Only used where a comment could make an assertion PASS — a prose mention of
 * the thing being asserted would be a check that reads its own documentation.
 * The bans above deliberately run on the raw source instead, where a comment
 * can only make them fail.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n');
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(withI18n(element));
}

/** React escapes these five in text children; the assertions compare against markup. */
function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** A cohort with something in every count, so no assertion below is about a zero. */
function cohortFixture(overrides: Partial<StudyCohort> = {}): StudyCohort {
  return {
    studyAccountId: 903,
    rows: [
      {
        pseudonym: 'pseudo-one',
        contributionVersion: 3,
        schemaTier: 'daily-intake-v1',
        createdAt: '2026-08-20T10:00:00.000Z',
        days: [],
      },
    ],
    withdrawnCount: 2,
    serverRetainedWithdrawnCount: 0,
    unopenableCount: 4,
    malformedCount: 1,
    ...overrides,
  };
}

/** The header the file will carry, from the real builder and the shipped catalog. */
function headerLinesFor(cohort: StudyCohort): string[] {
  return buildExportHeaderLines({
    cohort,
    fromDayKey: FROM_DAY_KEY,
    toDayKey: TO_DAY_KEY,
    strings: englishExportStrings,
  });
}

function linesFor(cohort: StudyCohort) {
  return toneCohortLines({ lines: headerLinesFor(cohort), cohort });
}

/** The rendered `<li>` for one line, so an assertion can be about THAT element's classes and not the page's. */
function lineElement({ html, id }: { html: string; id: string }): string {
  const match = new RegExp(`<li[^>]*data-cohort-line="${id}"[^>]*>`).exec(html);
  assert.notEqual(match, null, `the panel rendered no line for "${id}"`);
  return match?.[0] ?? '';
}

test('unopenable rows are information, not an error', () => {
  const cohort = cohortFixture();
  const lines = linesFor(cohort);

  // The pure half: the register itself.
  const unopenable = lines.find((line) => line.id === 'unopenable');
  assert.equal(unopenable?.tone, 'information');
  // And it is genuinely about a non-zero count, not a line that never appears.
  assert.equal(unopenable?.text, englishExportStrings.unopenable(4, 6));

  // The rendered half: whatever the tone map does, this element must not be
  // painted as a failure.
  const element = lineElement({
    html: render(createElement(StudyCohortPanel, { lines, participantCount: 1, onExport: () => undefined })),
    id: 'unopenable',
  });
  assert.match(element, /data-cohort-tone="information"/);
  assert.doesNotMatch(element, /destructive/, 'the un-openable count is styled as a failure');
});

test('malformed is a bug report, unopenable is a keyring', () => {
  const lines = linesFor(cohortFixture());
  const html = render(createElement(StudyCohortPanel, { lines, participantCount: 1, onExport: () => undefined }));

  assert.equal(lines.find((line) => line.id === 'malformed')?.tone, 'bug');
  const malformed = lineElement({ html, id: 'malformed' });
  assert.match(malformed, /data-cohort-tone="bug"/);
  assert.match(malformed, /destructive/, 'the malformed count is not presented as a defect');

  // The two must not share a register — that is the whole distinction.
  assert.notEqual(lineElement({ html, id: 'unopenable' }).includes('destructive'), malformed.includes('destructive'));
});

test('the operator anomaly is its own register, and only when there is one', () => {
  const quiet = linesFor(cohortFixture());
  assert.equal(
    quiet.some((line) => line.id === 'serverRetainedWithdrawn'),
    false,
  );

  const noisy = linesFor(cohortFixture({ serverRetainedWithdrawnCount: 3 }));
  const anomaly = noisy.find((line) => line.id === 'serverRetainedWithdrawn');
  assert.equal(anomaly?.tone, 'operator-warning');
  const element = lineElement({
    html: render(createElement(StudyCohortPanel, { lines: noisy, participantCount: 1, onExport: () => undefined })),
    id: 'serverRetainedWithdrawn',
  });
  assert.match(element, /accent-amber/);
  assert.doesNotMatch(element, /destructive/, 'an operator warning is not the researcher’s bug report');
});

test('the screen shows the export’s own lines, word for word', () => {
  for (const cohort of [cohortFixture(), cohortFixture({ serverRetainedWithdrawnCount: 3 })]) {
    const html = render(
      createElement(StudyCohortPanel, {
        lines: linesFor(cohort),
        participantCount: cohort.rows.length,
        onExport: () => undefined,
      }),
    );
    const headerLines = headerLinesFor(cohort);
    assert.ok(headerLines.length >= 8, 'the export header produced nothing to compare against');
    for (const line of headerLines) {
      assert.ok(
        html.includes(escapeMarkup(line)),
        `the screen paraphrased an export header line instead of showing it: ${line}`,
      );
    }
  }

  // The route is where the ONE call lives, and no unit test renders it — so
  // the shape of that call is asserted directly. `toneCohortLines` must be fed
  // the builder's own output, never an array assembled beside it.
  // The builder's output must be handed STRAIGHT in: the pattern allows no
  // property access between the closing `})` and the next argument, so a
  // `.map()` that rewrites one line fails here.
  assert.match(
    codeOf('../../app/routes/study._index.tsx'),
    /toneCohortLines\(\{\s*lines: buildExportHeaderLines\(\{[^{}]*\}\),\s*cohort:/,
    'the console no longer hands the export’s own lines, unaltered, to the screen',
  );
});

test('offers no way to publish the study key', () => {
  const html = render(
    createElement(StudyKeyCard, {
      identity: {
        accountId: 903,
        email: 'study@example.org',
        generationCount: 2,
        fingerprint: 'AB12-CD34-EF56',
        hasUnopenedCompartment: false,
      },
      onGenerate: () => undefined,
      isBusy: false,
    }),
  );

  // Not vacuous: the fingerprint IS on screen, in the printed form.
  assert.match(html, /AB12-CD34-EF56/);
  assert.match(html, /consent document/i);

  // And there is nothing to move it with. A study key reaches contributors by
  // being printed, never by a control on this screen.
  assert.doesNotMatch(html, /<a[\s>]/i, 'the key card grew a link');
  assert.doesNotMatch(html, /href=/i, 'the key card grew a link target');
  for (const modulePath of CONSOLE_SURFACE_MODULES) {
    assert.doesNotMatch(
      sourceOf(modulePath),
      PUBLISHING_VERBS,
      `${modulePath} can publish or transmit the study key; there is no registry to publish one to`,
    );
  }
});

test('neither key half ever reaches the markup', () => {
  const html = render(
    createElement(StudyKeyCard, {
      identity: {
        accountId: 903,
        email: 'study@example.org',
        generationCount: 1,
        fingerprint: 'AB12-CD34-EF56',
        hasUnopenedCompartment: false,
      },
      onGenerate: () => undefined,
      isBusy: false,
    }),
  );
  // The card is given a fingerprint and a count, and that is all it is given:
  // there is no prop through which a key could arrive on screen.
  assert.doesNotMatch(html, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.equal(
    Object.keys({ accountId: 0, email: '', generationCount: 0, fingerprint: '' }).includes('publicKey'),
    false,
  );
});

/**
 * "NO KEYS YET" AND "I CANNOT READ YOUR KEYS" ARE NOT ONE SCREEN (M164/07).
 *
 * `loadStudyIdentity` reports a count and a fingerprint, and a compartment
 * this console could not open leaves both at their empty values — `0` and
 * `null`, which is what a study on its first visit shows. One of those two is
 * a normal Tuesday and the other is the state where minting a generation is a
 * mistake, so the card must not render the same sentence for both.
 *
 * Both directions are asserted, because either alone passes on a card that
 * always shows one line: the ordinary empty console still gets the invitation
 * to mint, and the unopened one does not.
 */
test('the key card tells "no key yet" apart from "these keys will not open"', () => {
  const emptyConsole = render(
    createElement(StudyKeyCard, {
      identity: {
        accountId: 903,
        email: 'study@example.org',
        generationCount: 0,
        fingerprint: null,
        hasUnopenedCompartment: false,
      },
      onGenerate: () => undefined,
      isBusy: false,
    }),
  );
  assert.match(emptyConsole, /holds no key yet/i, 'a study that has minted nothing must still be invited to mint');
  assert.doesNotMatch(emptyConsole, /could not open/i, 'an ordinary empty console must not be told anything failed');

  const unopened = render(
    createElement(StudyKeyCard, {
      identity: {
        accountId: 903,
        email: 'study@example.org',
        generationCount: 0,
        fingerprint: null,
        hasUnopenedCompartment: true,
      },
      onGenerate: () => undefined,
      isBusy: false,
    }),
  );
  // The two states carry the SAME count and the SAME fingerprint, so the only
  // thing that can be different here is the sentence.
  assert.match(unopened, /could not open/i, 'a console that could not read the keyring must say so');
  assert.doesNotMatch(unopened, /holds no key yet/i, 'a keyring it could not read is not an absent keyring');

  // AMBER, never destructive: nothing is lost, and this is not a defect —
  // `study-cohort-panel.tsx`'s own header states the same rule for the same
  // reason.
  assert.match(unopened, /accent-amber/, 'the unopened-compartment line must be the amber operator warning');
  // `text-destructive` and not a bare `destructive`: the shared Button's base
  // classes carry `aria-invalid:ring-destructive`, so the loose pattern can
  // only ever fail. `study-cohort-panel.tsx` paints its one real defect line
  // with `text-destructive`, and that is the class this must not reach.
  assert.doesNotMatch(unopened, /text-destructive/, 'a wrong passphrase is not a defect');

  // And the mint stays available: `generateStudyKey` refuses on its own with
  // the reason (M164/01), and a disabled button would say "this is broken"
  // where the truth is "you are signed in with the wrong passphrase".
  //
  // `disabled=` and not `disabled`: the shared Button's class string carries
  // `disabled:pointer-events-none`, so the loose pattern matches every render
  // and the assertion could never fail. The busy card below is what proves the
  // tight one can still see a disabled button.
  const DISABLED_ATTRIBUTE = /<button[^>]*\sdisabled=/i;
  assert.doesNotMatch(unopened, DISABLED_ATTRIBUTE, 'the mint must not be disabled by an unopened compartment');
  assert.match(
    render(
      createElement(StudyKeyCard, {
        identity: {
          accountId: 903,
          email: 'study@example.org',
          generationCount: 0,
          fingerprint: null,
          hasUnopenedCompartment: true,
        },
        onGenerate: () => undefined,
        isBusy: true,
      }),
    ),
    DISABLED_ATTRIBUTE,
    'the pattern above must be able to see a disabled button, or the assertion before it is vacuous',
  );
});
