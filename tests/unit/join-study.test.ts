/**
 * THE JOIN SCREEN, and the two things it must never do (M163/02,
 * `openplate-sync` ADR-0003).
 *
 * ── 1. It never shows the fingerprint it computed ────────────────────────
 *
 * The study's key arrives in the LINK. The fingerprint is typed from the
 * study's PRINTED CONSENT DOCUMENT. Two channels — and if the screen displayed
 * the fingerprint it computed from the received key and asked the person to
 * confirm it, both halves would come from the same source and a substituted
 * key would pass the ceremony cleanly, for a whole cohort at once.
 *
 * This is asserted TWO ways, because neither alone is enough. Rendering proves
 * the markup carries no fingerprint — but `renderToStaticMarkup` runs no
 * effects, and the fingerprint is a SHA-256 that WebCrypto only computes
 * asynchronously, so a value parked in state by an effect would be invisible
 * to a render assertion. The structural half closes that: to display a
 * fingerprint at all, a module of this surface must first obtain one, and
 * `share-wrap.ts` is the only thing in this codebase that produces one. What
 * the surface imports instead is `use-typed-fingerprint-match.ts`, whose whole
 * point is that it hands back a BOOLEAN — a value that cannot be rendered as
 * twelve characters.
 *
 * ── 2. An account with no compartment is refused, never nudged ───────────
 *
 * ADR-0003 prohibition 4: without an owner-private compartment the pseudonym
 * root would be per-device, so a restore or a second device would present the
 * study a new participant. The screen offers the recovery setup and NOTHING
 * that enrols.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { StudyCompartmentMissing } from '../../app/components/study-compartment-missing';
import { StudyVerifyStep } from '../../app/components/study-verify-step';
import { joinStudyViewFor } from '../../app/lib/study-link';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import {
  generateShareKeyPair,
  shareFingerprintDisplay,
  shareKeyFingerprint,
} from '../../app/lib/sync/engine/crypto/share-wrap';

/** The modules a person looking at `/join-study` is actually looking at. */
const JOIN_SURFACE_MODULES = [
  '../../app/routes/join-study.tsx',
  '../../app/components/study-verify-step.tsx',
  '../../app/components/study-compartment-missing.tsx',
] as const;

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, withI18n(element)));
}

test('the join screen never shows the fingerprint it computed from the link', async () => {
  const study = await generateShareKeyPair();
  const fingerprint = await shareKeyFingerprint(study.publicKeyRaw);
  const display = shareFingerprintDisplay(fingerprint);

  const html = render(
    createElement(StudyVerifyStep, {
      invite: {
        studyAccountId: 903,
        publicKeyBase64: bytesToBase64(study.publicKeyRaw),
        claimedLabel: 'Charité sleep trial',
      },
      onSubmit: () => undefined,
      isSubmitting: false,
      message: null,
    }),
  );

  // Not vacuous: the ceremony's own field is on the page, so the assertions
  // below are about a rendered form and not about an empty string.
  assert.match(html, /study-typed-fingerprint/);
  assert.doesNotMatch(html, new RegExp(display, 'i'), 'the screen rendered the fingerprint display form');
  assert.doesNotMatch(html, new RegExp(fingerprint, 'i'), 'the screen rendered the full fingerprint');
  for (const group of display.split('-')) {
    assert.doesNotMatch(html, new RegExp(group, 'i'), `the screen rendered the fingerprint group ${group}`);
  }

  // The structural half — see this file's header for why rendering alone
  // cannot see an effect-computed value.
  for (const modulePath of JOIN_SURFACE_MODULES) {
    assert.doesNotMatch(
      sourceOf(modulePath),
      /from '[^']*share-wrap'/,
      `${modulePath} can reach a fingerprint string; the join surface may only learn a boolean`,
    );
  }
  assert.match(
    sourceOf('../../app/components/study-verify-step.tsx'),
    /use-typed-fingerprint-match/,
    'the step no longer performs the typed check at all',
  );
});

test('an account with no compartment offers recovery, never enrolment', async () => {
  // The route branches on nothing else, so this pair is what an account with
  // no compartment sees.
  assert.equal(joinStudyViewFor({ status: 'compartment-missing' }), 'compartment-missing');
  assert.notEqual(joinStudyViewFor({ status: 'compartment-missing' }), joinStudyViewFor({ status: 'verify' }));

  const html = render(createElement(StudyCompartmentMissing));

  // The way out leads to the recovery code, which is what establishes a
  // compartment. Nothing here submits anything.
  assert.match(html, /href="\/settings\/sync"/);
  assert.doesNotMatch(html, /<button/i, 'the refusal grew a control');
  assert.doesNotMatch(html, /<form/i, 'the refusal grew a form');
  assert.doesNotMatch(html, /<input/i, 'the refusal grew a field');
  // And it explains the refusal in the person's own terms rather than as a
  // technical failure: no compartment means no stable identity for a study.
  assert.match(html, /recovery code/i);
});
