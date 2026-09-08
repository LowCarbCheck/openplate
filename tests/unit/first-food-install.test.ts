/**
 * The first-food lesson also teaches installing the app -- proven against
 * RENDERED MARKUP, not against the route's source text.
 *
 * ── Why rendered markup, and what "rendered" can and cannot mean here ──────
 *
 * This repo's unit runner is plain `node --import tsx --test`: no jsdom, no
 * `--experimental-test-module-mocks` (see `recover-gate-wiring.test.ts`'s own
 * header for the same limit). What IS available, and what `scan-connect-
 * card.test.ts` already does for a hook-driven component, is
 * `renderToStaticMarkup` under a `createMemoryRouter` + `RouterProvider`, with
 * `withI18n` resolving real copy from the shipped English catalog. That is
 * used here for everything it CAN prove.
 *
 * One thing it cannot prove: `useInstallAffordance` reads `useEffect` (which
 * never runs under `react-dom/server`) and `useSyncExternalStore` (which, on
 * every `react-dom/server` renderer, always takes the `getServerSnapshot`
 * branch -- this is fixed by which renderer is calling it, not by any global
 * this file could set up). So a REAL render of the wired-up lesson step can
 * only ever exercise the `'none'` branch of the hook -- which happens to be
 * the common case (a desktop browser, or an already-installed device), and is
 * used below for exactly that, not faked. For the other two affordance
 * values, `FirstFoodStep` was split so the affordance-dependent MARKUP is a
 * separate, exported, prop-driven component (`FirstFoodInstallFootnote`,
 * mirroring `InstallAffordanceAction`'s own split in `install-card.tsx`) --
 * every content and branching claim below is proven by rendering THAT
 * directly with an explicit `affordance`, no hook, no mock.
 *
 * The one claim that is genuinely unreachable this way is the JSX POSITION of
 * the footnote relative to the cards and the AI key note: since the real step
 * can never be forced to show non-`'none'` content in this environment, there
 * is no rendered string in which "the install copy is after the cards" is an
 * observable fact for the `'prompt'`/`'ios-instructions'` cases. That single
 * fact is left as a narrow source assertion at the bottom, clearly marked as
 * a stand-in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { FirstFoodInstallFootnote, FirstFoodStep } from '../../app/routes/onboarding';
import { InstallAffordanceAction } from '../../app/components/install-card';
import type { InstallAffordance } from '../../app/lib/pwa-install';
import type { PublicConfig } from '../../app/config/public-config';

// Real, shipped English copy -- distinctive substrings rather than full
// sentences, so a harmless rewording of the rest of a sentence does not break
// this file. `install.title` and `install.action` are the same shipped
// string ("Install openplate"), so one constant covers both.
const INSTALL_TITLE_OR_ACTION = 'Install openplate';
const INSTALL_DESCRIPTION_FRAGMENT = 'Add openplate to your home screen';
const IOS_INSTRUCTION_FRAGMENT = 'Add to Home Screen';
const WAY_TITLE_PLATE = 'Photograph your plate';
const WAY_TITLE_LABEL = 'Photograph a nutrition panel';
const WAY_TITLE_SEARCH = 'Search for a food';
const DICTATION_FRAGMENT = 'never logs a food by itself';

const noopPromptInstall = () => Promise.resolve();

/** A self-hosted instance's public config -- the same shape scan-connect-card.test.ts uses. */
function publicConfig(): PublicConfig {
  return { syncServerUrl: null, analytics: null, instancePreset: null, managed: false };
}

/**
 * Renders the real `FirstFoodStep` under a data router, exactly the way
 * `scan-connect-card.test.ts` renders `ConnectCard`: a `root`-id route
 * supplies `publicConfig` for `useInstancePolicy` (the AI key note reads it),
 * and `FirstFoodStep` itself needs router context for `useNavigation`/`Form`.
 *
 * `useInstallAffordance()` resolves to `'none'` here FOR REAL -- see this
 * file's header -- so this is the render a desktop browser or an
 * already-installed device actually produces, not a stand-in for it.
 */
function renderFirstFoodStep(): string {
  const config = publicConfig();
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: withI18n(createElement(FirstFoodStep)) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Renders the footnote's own markup directly, with an explicit affordance -- no hook, no router. */
function renderFootnote(affordance: InstallAffordance): string {
  return renderToStaticMarkup(
    withI18n(createElement(FirstFoodInstallFootnote, { affordance, promptInstall: noopPromptInstall })),
  );
}

/** Renders the shared platform-branching body directly, with an explicit affordance. */
function renderAction(affordance: InstallAffordance): string {
  return renderToStaticMarkup(
    withI18n(createElement(InstallAffordanceAction, { affordance, promptInstall: noopPromptInstall })),
  );
}

describe('InstallAffordanceAction, rendered directly, is the one place the platforms branch', () => {
  it('renders the install button for a captured native prompt, and no iOS sentence', () => {
    const markup = renderAction('prompt');
    assert.ok(markup.includes('<button'), 'the prompt case stopped rendering a button');
    assert.ok(markup.includes(INSTALL_TITLE_OR_ACTION), markup);
    assert.ok(!markup.includes(IOS_INSTRUCTION_FRAGMENT), 'the prompt case leaked the iOS sentence too');
  });

  it('renders the iOS instructions, and no button, when there is no captured prompt on iOS', () => {
    const markup = renderAction('ios-instructions');
    assert.ok(markup.includes(IOS_INSTRUCTION_FRAGMENT), markup);
    assert.ok(!markup.includes('<button'), 'the iOS case still renders an install button nobody can use');
  });

  it('renders nothing at all when there is nothing to offer', () => {
    assert.equal(renderAction('none'), '');
  });
});

describe('FirstFoodInstallFootnote (the lesson footnote body) renders the same two shapes', () => {
  it('for a captured prompt: shows the install title, the description, and the shared action button', () => {
    const markup = renderFootnote('prompt');
    assert.ok(markup.includes(INSTALL_TITLE_OR_ACTION), markup);
    assert.ok(markup.includes(INSTALL_DESCRIPTION_FRAGMENT), markup);
    assert.ok(markup.includes('<button'), 'the footnote stopped rendering the install action for the prompt case');
    assert.ok(!markup.includes(IOS_INSTRUCTION_FRAGMENT));
  });

  it('for iOS with no prompt: shows the iOS sentence and no install button', () => {
    const markup = renderFootnote('ios-instructions');
    assert.ok(markup.includes(IOS_INSTRUCTION_FRAGMENT), markup);
    assert.ok(!markup.includes('<button'), 'the footnote rendered a button nobody on this device can use');
  });

  it('for none: renders nothing at all, an empty string -- not an empty box', () => {
    assert.equal(renderFootnote('none'), '');
  });
});

describe('the real first-food step offers nothing to install when there is nothing to offer', () => {
  const stepMarkup = renderFirstFoodStep();

  it('is a real render of the lesson: the three ways and the dictation note are present', () => {
    assert.ok(stepMarkup.includes(WAY_TITLE_PLATE), stepMarkup.slice(0, 400));
    assert.ok(stepMarkup.includes(WAY_TITLE_LABEL));
    assert.ok(stepMarkup.includes(WAY_TITLE_SEARCH));
    assert.ok(stepMarkup.includes(DICTATION_FRAGMENT));
  });

  it('carries none of the install copy -- the common desktop / already-installed case', () => {
    assert.ok(!stepMarkup.includes(INSTALL_TITLE_OR_ACTION), 'the step shows install copy with nothing to install');
    assert.ok(!stepMarkup.includes(INSTALL_DESCRIPTION_FRAGMENT));
    assert.ok(!stepMarkup.includes(IOS_INSTRUCTION_FRAGMENT));
  });

  // The AI key note (`FirstFoodKeyNote`) renders unconditionally and uses the
  // exact same quiet-box classes as the install footnote (`bg-muted/50`) --
  // deliberately, they are meant to read as the same kind of aside. That
  // makes the class itself a real, checkable stand-in for "did an empty box
  // get emitted": if `FirstFoodInstallFootnote` ever rendered its wrapper
  // `<div>` even with nothing inside it (instead of returning `null`), this
  // count would go from 1 to 2. This is the render-based version of
  // "compare against the same render with the install piece unreachable":
  // the piece IS unreachable here (see this file's header), and this proves
  // it contributed nothing, not an empty container.
  it('emits no second quiet box -- only the AI key note carries this class', () => {
    const occurrences = stepMarkup.match(/bg-muted\/50/g) ?? [];
    assert.equal(
      occurrences.length,
      1,
      'a second quiet box appeared in the step with nothing rendered inside it -- the install footnote emitted an empty container',
    );
  });
});

describe('the one fact rendered markup cannot prove in this environment', () => {
  // Every claim above is proven by rendering real output. This is the single
  // exception, and it is narrow on purpose: WHERE in FirstFoodStep's JSX the
  // footnote sits. `useInstallAffordance` cannot be made to resolve to
  // anything but `'none'` under `renderToStaticMarkup` (no jsdom, no module
  // mocking -- see this file's header), so there is no rendered string in
  // which the footnote's position relative to the cards is an observable
  // fact for the `'prompt'`/`'ios-instructions'` cases. This is a stand-in
  // for that one claim only.
  const onboardingSource = readFileSync(
    fileURLToPath(new URL('../../app/routes/onboarding.tsx', import.meta.url)),
    'utf8',
  );

  it('places the footnote after the cards/dictation Form and after the AI key note in FirstFoodStep', () => {
    const start = onboardingSource.indexOf('export function FirstFoodStep()');
    assert.notEqual(start, -1, 'FirstFoodStep is gone or no longer exported');
    const body = onboardingSource.slice(start, onboardingSource.indexOf('\nfunction WayToLogCard'));
    const formCloseIndex = body.lastIndexOf('</Form>');
    const keyNoteIndex = body.indexOf('<FirstFoodKeyNote />');
    const installNoteIndex = body.indexOf('<FirstFoodInstallNote />');
    assert.notEqual(formCloseIndex, -1, 'the cards/dictation Form is gone from FirstFoodStep');
    assert.notEqual(keyNoteIndex, -1, 'the AI key note is gone from FirstFoodStep');
    assert.notEqual(installNoteIndex, -1, 'the install footnote is gone from FirstFoodStep');
    assert.ok(formCloseIndex < keyNoteIndex, 'the AI key note moved above the cards it is supposed to follow');
    assert.ok(keyNoteIndex < installNoteIndex, 'the install footnote moved above the AI key note');
  });
});
