/**
 * The capture screen while a TYPED meal is being analysed.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Typing "3 eggs, 2 slices of toast, a glass of orange juice" on `/add` and
 * tapping "Log with AI" landed on `/scan` with the right quote block and the
 * right result. What sat around it was the photo screen: the overlay said
 * "Uploading photo…" when there was no photo, both shutter buttons rendered
 * underneath it greyed out, "Add food without a photo" offered the person the
 * screen they had just come from, and the card wore a camera icon.
 *
 * Every one of those is a sentence the product does not mean, and none of them
 * is reachable by a source read alone: they are all `isTextIntake` branches
 * that were simply absent.
 *
 * ── Why this file renders instead of reading source ──────────────────────
 *
 * `ScanFlow` reads the hand-off slot inside an effect, and
 * `renderToStaticMarkup` never runs effects, so a text intake cannot be
 * reached through the container at all. `UploadForm` is exported for exactly
 * that reason, and every assertion below is paired with a CONTROL: the same
 * screen rendered as a photo intake, which must still show what the text one
 * hides. A test that only checked the text case would pass just as happily
 * against a screen that had lost its shutter button entirely.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';

import { UploadForm } from '../../app/routes/scan';
import type { MonthlyAiUsage } from '../../app/models/ai-usage';

/**
 * The shipped copy this file asserts on, parsed rather than asserted: a key
 * renamed in the component but not in the catalog must fail HERE rather than
 * ship a raw `scan.analyzing.sendingText` to a reader.
 */
const capturedCopySchema = z.object({
  scan: z.object({
    capture: z.object({
      takePhoto: z.string(),
      chooseLibrary: z.string(),
      addWithoutPhoto: z.string(),
    }),
    analyzing: z.object({
      uploading: z.string(),
      sendingText: z.string(),
      stillWorking: z.string(),
    }),
  }),
});

const COPY = capturedCopySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).scan;

/** Zero usage: this screen's monthly line is not what any of these tests are about. */
const NO_USAGE: MonthlyAiUsage = {
  scanCount: 0,
  totalCostUsd: 0,
  unknownCostCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  successCount: 0,
  failedCount: 0,
};

const TYPED_MEAL = '3 eggs, 2 slices of toast, a glass of orange juice';

/**
 * The capture screen, rendered for one intake.
 *
 * A photo intake is given a real `file` and a preview URL, because the
 * in-flight overlay hangs off the preview: without them the photo screen
 * renders no status message at all and every "the photo path still says X"
 * control below would pass vacuously.
 *
 * @param options.typedText - the sentence being analysed, or `null` for a photograph.
 * @param options.elapsedSeconds - how long the in-flight call has been running.
 */
function renderCaptureScreen({
  typedText,
  elapsedSeconds = 0,
  error,
}: {
  typedText: string | null;
  elapsedSeconds?: number;
  /** A failed attempt, which is what puts the alert (and its icon) on screen. */
  error?: string;
}): string {
  const isText = typedText !== null;
  const element = createElement(UploadForm, {
    // `dispatching` is the in-flight phase, which is where the defect lived.
    phase: 'dispatching' as const,
    file: isText ? null : new File(['x'], 'plate.jpg', { type: 'image/jpeg' }),
    typedText,
    previewUrl: isText ? null : 'blob:test-preview',
    isProcessing: false,
    selectionError: null,
    elapsedSeconds,
    error,
    monthlyUsage: NO_USAGE,
    logDate: null,
    logDateLabel: null,
    onPick: () => {},
    onCancel: () => {},
    onRetry: () => {},
  });
  const router = createMemoryRouter([{ path: '/scan', element: withI18n(element) }], {
    initialEntries: ['/scan'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * The same screen with a failed attempt on it, so the ALERT is rendered too.
 *
 * The card title's icon and the alert's icon are two separate branches and the
 * defect report named both, so both have to be on screen at once for one
 * assertion to cover them.
 */
function renderCaptureScreenWithError({ typedText }: { typedText: string | null }): string {
  return renderCaptureScreen({ typedText, error: 'something went wrong' });
}

const TEXT_INTAKE = renderCaptureScreen({ typedText: TYPED_MEAL });
const PHOTO_INTAKE = renderCaptureScreen({ typedText: null });

describe('the capture screen hides every photo control during a typed intake', () => {
  it('shows the words being analysed', () => {
    // The control that makes the rest of this file mean something: the text
    // screen really did render, so an absent photo control below is a gate
    // rather than an empty render.
    assert.ok(TEXT_INTAKE.includes(TYPED_MEAL), 'the typed meal is not on the screen at all');
    assert.ok(!PHOTO_INTAKE.includes(TYPED_MEAL));
  });

  it('offers no shutter, where a photo intake does', () => {
    assert.ok(
      !TEXT_INTAKE.includes(COPY.capture.takePhoto),
      'the take-photo button still renders for a typed meal, disabled but visible',
    );
    assert.ok(
      PHOTO_INTAKE.includes(COPY.capture.takePhoto),
      'the photo intake lost its shutter, so the check above proves nothing',
    );
  });

  it('offers no library picker, where a photo intake does', () => {
    assert.ok(!TEXT_INTAKE.includes(COPY.capture.chooseLibrary));
    assert.ok(
      PHOTO_INTAKE.includes(COPY.capture.chooseLibrary),
      'the photo intake lost its library picker, so the check above proves nothing',
    );
  });

  it('does not offer the screen the person just came from', () => {
    // "Add food without a photo" is a description of what they already did.
    assert.ok(!TEXT_INTAKE.includes(COPY.capture.addWithoutPhoto));
    assert.ok(
      PHOTO_INTAKE.includes(COPY.capture.addWithoutPhoto),
      'the photo intake lost its search link, so the check above proves nothing',
    );
  });

  it('wears a text icon on the card and the alert, never a camera', () => {
    // lucide stamps its own name into the class list (`lucide-camera`,
    // `lucide-type`), which is what makes this checkable at all: the two SVGs
    // are otherwise identical boilerplate down to the xmlns.
    const withError = (typedText: string | null) => renderCaptureScreenWithError({ typedText });

    assert.ok(!withError(TYPED_MEAL).includes('lucide-camera'), 'a typed meal still shows a camera icon');
    assert.ok(withError(TYPED_MEAL).includes('lucide-type'), 'the typed meal lost its text icon');
    assert.ok(
      withError(null).includes('lucide-camera'),
      'the photo intake lost its camera icon, so the check above proves nothing',
    );
    assert.ok(!withError(null).includes('lucide-type'));
  });

  it('keeps the hidden capture inputs mounted either way', () => {
    // They must NOT be gated: the element whose `click()` lands on the gesture
    // stack cannot be allowed to unmount while the camera is opening.
    for (const [name, markup] of [
      ['text', TEXT_INTAKE],
      ['photo', PHOTO_INTAKE],
    ] as const) {
      assert.match(markup, /capture="environment"/, `the ${name} intake dropped its hidden capture input`);
    }
  });
});

describe('the in-flight message describes the intake it belongs to', () => {
  it('says the words are being sent, never that a photo is uploading', () => {
    assert.ok(
      TEXT_INTAKE.includes(COPY.analyzing.sendingText),
      'the first in-flight stage no longer names what is actually being sent',
    );
    assert.ok(!TEXT_INTAKE.includes(COPY.analyzing.uploading), 'a typed meal is still told a photo is uploading');
  });

  it('still says a photo is uploading for a photograph', () => {
    assert.ok(PHOTO_INTAKE.includes(COPY.analyzing.uploading), 'the photo path lost its own first-stage copy');
    assert.ok(!PHOTO_INTAKE.includes(COPY.analyzing.sendingText));
  });

  it('shares the later stages, because they are true of both', () => {
    const lateText = renderCaptureScreen({ typedText: TYPED_MEAL, elapsedSeconds: 20 });
    const latePhoto = renderCaptureScreen({ typedText: null, elapsedSeconds: 20 });

    assert.ok(lateText.includes(COPY.analyzing.stillWorking));
    assert.ok(latePhoto.includes(COPY.analyzing.stillWorking));
  });
});
