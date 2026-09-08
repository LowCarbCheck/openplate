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
 * `useInstallAffordance` reads `useEffect` (which never runs under
 * `react-dom/server`) and `useSyncExternalStore` (which, on every
 * `react-dom/server` renderer, always takes the `getServerSnapshot` branch --
 * this is fixed by which renderer is calling it, not by any global this file
 * could set up). So a REAL render of the wired-up lesson step always resolves
 * to `'cannot-install'`: not standalone, no captured prompt, not iOS. That is
 * the state a desktop Firefox, a desktop Safari and a Chrome that has not
 * fired `beforeinstallprompt` all land in, and it is exercised below for real.
 *
 * The other three states (`'prompt'`, `'ios-instructions'`,
 * `'already-installed'`) cannot be reached through the hook here, so
 * `FirstFoodStep` was split: the affordance-dependent MARKUP is a separate,
 * exported, prop-driven component (`FirstFoodInstallFootnote`, mirroring
 * `InstallAffordanceAction`'s own split in `install-card.tsx`) -- every
 * content and branching claim below is proven by rendering THAT directly with
 * an explicit `affordance`, no hook, no mock.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
const PHONE_NOTE_FRAGMENT = 'install openplate on a phone';
const WAY_TITLE_PHOTO = 'Photograph it';
const WAY_TITLE_TYPE = 'Write it';
const WAY_TITLE_SPEAK = 'Say it';
/**
 * The privacy note under the speak card.
 *
 * It used to be the dictation footnote, which said speaking "never logs a food
 * by itself". Speaking runs the AI intake as of 2026-09-08, so that sentence
 * became false and was replaced by the one fact the card cannot carry itself:
 * only the TEXT ever travels onward.
 */
const SPEECH_PRIVACY_FRAGMENT = 'Only the text reaches openplate';
const KEY_NOTE_FRAGMENT = 'Photo scanning is optional';

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
 * `useInstallAffordance()` resolves to `'cannot-install'` here FOR REAL -- see
 * this file's header -- so this is the render a desktop browser actually
 * produces, not a stand-in for it.
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

  it('renders nothing on an already-installed device', () => {
    assert.equal(renderAction('already-installed'), '');
  });

  it('renders nothing when the browser cannot install -- this body is actions only', () => {
    // The plain sentence for this state is information, not an affordance, so
    // it belongs to the surface that chooses to teach it, not to the shared
    // action body every surface renders.
    assert.equal(renderAction('cannot-install'), '');
  });
});

describe('FirstFoodInstallFootnote (the lesson footnote body) answers all four states', () => {
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

  it('for an already-installed device: renders nothing at all, an empty string -- not an empty box', () => {
    assert.equal(renderFootnote('already-installed'), '');
  });

  it('for a browser that cannot install: renders the plain sentence about phones', () => {
    const markup = renderFootnote('cannot-install');
    assert.ok(markup.includes(PHONE_NOTE_FRAGMENT), markup);
  });

  it('offers nothing to press in that sentence -- no button, no link', () => {
    // A false promise is worse than silence: this browser cannot install, so
    // anything clickable here either does nothing or lies about what it does.
    const markup = renderFootnote('cannot-install');
    assert.ok(!markup.includes('<button'), 'the cannot-install sentence grew a button this browser cannot honour');
    assert.ok(!markup.includes('<a '), 'the cannot-install sentence grew a link');
    assert.ok(!markup.includes(INSTALL_TITLE_OR_ACTION), 'the cannot-install sentence reads as an install offer');
    assert.ok(!markup.includes(INSTALL_DESCRIPTION_FRAGMENT), 'the cannot-install sentence tells THIS browser to add it');
    assert.ok(!markup.includes(IOS_INSTRUCTION_FRAGMENT), 'the cannot-install sentence leaked the iOS instructions');
  });
});

describe('the real first-food step on a browser that cannot install', () => {
  const stepMarkup = renderFirstFoodStep();

  it('is a real render of the lesson: the three ways and the privacy note are present', () => {
    assert.ok(stepMarkup.includes(WAY_TITLE_PHOTO), stepMarkup.slice(0, 400));
    assert.ok(stepMarkup.includes(WAY_TITLE_TYPE));
    assert.ok(stepMarkup.includes(WAY_TITLE_SPEAK));
    assert.ok(stepMarkup.includes(SPEECH_PRIVACY_FRAGMENT));
  });

  it('teaches that the app installs on a phone, instead of saying nothing at all', () => {
    // The reported defect: this render used to carry no install copy of any
    // kind, so the lesson taught nothing on the majority of browsers.
    assert.ok(stepMarkup.includes(PHONE_NOTE_FRAGMENT), stepMarkup);
  });

  it('offers no install affordance this browser could not honour', () => {
    assert.ok(!stepMarkup.includes(INSTALL_TITLE_OR_ACTION), 'the step offers an install action it cannot run');
    assert.ok(!stepMarkup.includes(INSTALL_DESCRIPTION_FRAGMENT));
    assert.ok(!stepMarkup.includes(IOS_INSTRUCTION_FRAGMENT), 'the step shows iOS instructions on a non-iOS browser');
  });

  it('places the footnote after the three cards and after the AI key note', () => {
    // Now an observable fact in real markup rather than a source read: the
    // cannot-install state renders content, so its position is rendered too.
    const lastCardIndex = stepMarkup.indexOf(WAY_TITLE_SPEAK);
    const keyNoteIndex = stepMarkup.indexOf(KEY_NOTE_FRAGMENT);
    const footnoteIndex = stepMarkup.indexOf(PHONE_NOTE_FRAGMENT);
    assert.notEqual(lastCardIndex, -1, 'the last card is gone from the lesson');
    assert.notEqual(keyNoteIndex, -1, 'the AI key note is gone from the lesson');
    assert.notEqual(footnoteIndex, -1, 'the install footnote is gone from the lesson');
    assert.ok(lastCardIndex < keyNoteIndex, 'the AI key note moved above the cards it is supposed to follow');
    assert.ok(keyNoteIndex < footnoteIndex, 'the install footnote moved above the AI key note');
  });

  it('emits exactly two quiet boxes -- the AI key note and the install footnote', () => {
    // `FirstFoodKeyNote` and the footnote share the same quiet-box classes
    // (`bg-muted/50`) deliberately: they are meant to read as the same kind of
    // aside. Counting them is how an EMPTY container gets caught -- a third
    // box, or a box with nothing rendered inside it, moves this number.
    const occurrences = stepMarkup.match(/bg-muted\/50/g) ?? [];
    assert.equal(occurrences.length, 2, 'the quiet boxes in the lesson changed count');
  });
});
