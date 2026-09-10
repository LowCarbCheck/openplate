/**
 * `/describe`, the composer and the pipeline it hands off to.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The launcher's "Type" row opened `/add`. `/add` is the database SEARCH: a
 * one-line field, a list of foods under it, and the AI submit tucked
 * underneath the box. Somebody who tapped "Type" to write "2 fried eggs, a
 * slice of toast with butter, black coffee" was handed a box that wants one
 * noun. The pipeline behind it was already right; the screen in front of it
 * was the wrong screen.
 *
 * ── The second defect, and what replaced it (M203) ────────────────────────
 *
 * This screen then grew a microphone button, wired to the browser's Web Speech
 * API, and every failure of it was reported ONLY to an `sr-only` live region.
 * On a phone that is a button that does nothing at all, which is exactly what
 * the owner found. It is gone. `?speak=1` now focuses the field and shows one
 * line naming the keyboard's own dictation key, so the promise matches the
 * code: this app has no microphone, and it never claims one.
 *
 * ── What is asserted here, and what cannot be ────────────────────────────
 *
 * There is no DOM test library in this repo, so nothing here types into a
 * field or presses a button. Two things are provable without one, and they are
 * the two that matter:
 *
 * 1. The hand-off. `handOffDescription` is called for real and the REAL slot
 *    is read back with `takeIntakeHandoff`, so what `/scan` will pick up is
 *    asserted rather than a spy's record of an intention.
 * 2. The composer's markup, rendered through `renderToStaticMarkup` against
 *    the shipped English catalog. The route is split container/presentational
 *    exactly so this is possible: an effect never runs under a static render,
 *    so a screen whose provider answer arrives through a hook could only ever
 *    be rendered in one state.
 *
 * EVERY ASSERTION HAS A CONTROL. A disabled-attribute check on a `ui/button`
 * is the standing trap in this repo: a cva class list carries
 * `disabled:pointer-events-none`, so `markup.includes('disabled')` passes
 * against a button that is not disabled at all. The send control is found by
 * its own accessible name and the attribute is matched inside that tag, and
 * each disabled case is paired with the enabled one.
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
import { DescribeComposer, describeScanHref, handOffDescription } from '../../app/routes/describe';
import { takeIntakeHandoff } from '../../app/lib/scan-handoff';
import type { AiConnection, AiIntakeDoor } from '../../app/components/add/use-ai-connection';
import type { RepeatYesterdayOffer } from '../../app/lib/copy-day';

/** The shipped copy this file asserts on, so a renamed key fails here rather than shipping a raw `describe.send`. */
const describeCopySchema = z.object({
  describe: z.object({
    title: z.string(),
    lead: z.string(),
    label: z.string(),
    placeholder: z.string(),
    send: z.string(),
    sendHint: z.string(),
    dictateHint: z.string(),
    needsProvider: z.string(),
    connect: z.string(),
    searchInstead: z.string(),
  }),
  /** The sentence a managed instance shows instead, shared with `/add`. */
  aiIntake: z.object({
    noAllowance: z.string(),
  }),
  /** The "Wie gestern" door's label (M217), shared with the diary and the dashboard. */
  diary: z.object({
    copy: z.object({
      door: z.string(),
    }),
  }),
});

const CATALOG = describeCopySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);
const COPY = CATALOG.describe;
const MANAGED_COPY = CATALOG.aiIntake;
const DOOR_COPY = CATALOG.diary.copy;

const SOURCE = readFileSync(new URL('../../app/routes/describe.tsx', import.meta.url), 'utf8');

const noop = () => undefined;

/**
 * The composer, rendered for one set of conditions.
 *
 * A memory router because the screen carries a `<Link>`, and the i18n harness
 * because every string on it comes from the real English catalog.
 */
function renderComposer({
  text = '',
  aiConnection = 'connected',
  door = { kind: 'byok' },
  speakArmed = false,
  repeatYesterday = null,
}: {
  text?: string;
  aiConnection?: AiConnection;
  door?: AiIntakeDoor;
  speakArmed?: boolean;
  repeatYesterday?: RepeatYesterdayOffer | null;
} = {}): string {
  const element = createElement(DescribeComposer, {
    text,
    onTextChange: noop,
    onSend: noop,
    aiConnection,
    door,
    speakArmed,
    searchHref: '/add',
    repeatYesterday,
  });
  const router = createMemoryRouter([{ path: '/describe', element: withI18n(element) }], {
    initialEntries: ['/describe'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * The send control's own opening tag, found by its accessible name.
 *
 * THE POINT OF READING ONE TAG. `markup.includes('disabled')` is satisfied by
 * any `disabled:` utility class anywhere on the page, so the attribute has to
 * be looked for inside the element that is supposed to carry it and nowhere
 * else.
 */
function sendButtonTag(markup: string): string {
  const found = new RegExp(`<button[^>]*aria-label="${COPY.send}"[^>]*>`).exec(markup);
  assert.ok(found !== null, 'no button on the composer is labelled as Send');
  return found[0];
}

function isSendDisabled(markup: string): boolean {
  return /\sdisabled(=""|\s|>)/.test(sendButtonTag(markup));
}

describe('the composer is a message box, not a form', () => {
  it('asks for the meal and shows the example', () => {
    const markup = renderComposer();
    assert.ok(markup.includes(COPY.title), 'the heading is gone');
    assert.ok(markup.includes(COPY.lead), 'the line that explains what the AI does is gone');
    assert.ok(markup.includes(COPY.placeholder), 'the example meal is gone from the placeholder');
    assert.ok(markup.includes(COPY.sendHint), 'the line that says Enter sends is gone');
  });

  it('grows one line at a time instead of opening as a two-row box', () => {
    const markup = renderComposer();
    assert.match(markup, /<textarea[^>]*id="describe-meal"/, 'the composer is no longer a textarea');
    assert.match(markup, /<textarea[^>]*rows="1"/, 'the composer opens taller than one line again');
    // The control: a search input would be the first defect coming back.
    assert.doesNotMatch(markup, /type="search"/, 'a search field reappeared on the composer screen');
  });

  it('puts the field and Send in ONE rounded container', () => {
    const markup = renderComposer();
    const container = /<div class="([^"]*rounded-2xl[^"]*)">\s*<textarea/.exec(markup);
    assert.ok(container !== null, 'the textarea no longer sits inside a rounded container');
    const className = container[1] ?? '';
    assert.match(className, /\bborder-input\b/, 'the container lost its border');
    assert.match(className, /\bbg-card\b/, 'the container lost its background');
    assert.match(className, /focus-within:ring/, 'focusing the field no longer lights the whole box');
    // The control: the border belongs to the container, so the field inside it
    // must not draw a second rectangle of its own.
    assert.match(
      /<textarea[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? '',
      /\bborder-0\b/,
      'the field draws its own border inside the container again',
    );
  });

  it('keeps the label for the field and takes it off the screen', () => {
    const markup = renderComposer();
    const label = /<label[^>]*for="describe-meal"[^>]*>/.exec(markup);
    assert.ok(label !== null, 'the field lost its label, which is the only name a screen reader has for it');
    assert.match(label[0], /\bsr-only\b/, 'the visible label is back, and with it the form look');
  });

  it('sends on Enter and keeps Shift and Enter for a new line', () => {
    assert.match(SOURCE, /if \(event\.key !== 'Enter' \|\| event\.shiftKey\) return;/);
    assert.match(SOURCE, /event\.preventDefault\(\);\s*\n\s*onSend\(\);/);
  });

  it('runs no lookup and lists no food', () => {
    for (const forbidden of ['fetchFoodMatches', 'listLocalFoods', 'SearchResultRow', 'computeLocalRecentFoods']) {
      assert.ok(!SOURCE.includes(forbidden), `the composer screen started doing a database lookup (${forbidden})`);
    }
  });
});

describe('Send', () => {
  it('is an icon button inside the box, never a full-width bar under it', () => {
    const tag = sendButtonTag(renderComposer({ text: '2 fried eggs' }));
    assert.match(tag, /\brounded-full\b/, 'Send is no longer round');
    assert.match(tag, /\bh-10 w-10\b/, 'Send is no longer the 40px icon button');
    assert.doesNotMatch(tag, /\bw-full\b/, 'Send is a full-width bar again');
  });

  it('is disabled while the box is empty', () => {
    assert.ok(isSendDisabled(renderComposer({ text: '' })), 'an empty composer can be sent');
    // The control, and the one that makes the check above mean anything: the
    // same button with words in the box carries no such attribute.
    assert.ok(
      !isSendDisabled(renderComposer({ text: '2 fried eggs' })),
      'the composer cannot be sent even with a meal in it',
    );
  });

  it('is disabled for whitespace, which is an empty box wearing a space', () => {
    assert.ok(isSendDisabled(renderComposer({ text: '   \n ' })));
  });

  it('is disabled until the provider answer has arrived, and while it is absent', () => {
    for (const aiConnection of ['unknown', 'absent'] as const) {
      assert.ok(
        isSendDisabled(renderComposer({ text: '2 fried eggs', aiConnection })),
        `the composer offers to send with the connection ${aiConnection}`,
      );
    }
    assert.ok(!isSendDisabled(renderComposer({ text: '2 fried eggs', aiConnection: 'connected' })));
  });

  it('is rendered either way, and greyed rather than hidden', () => {
    const disabled = sendButtonTag(renderComposer({ text: '' }));
    assert.match(disabled, /\bbg-muted\b/, 'the unusable Send is not the muted one');
    // The control: the same button with a meal in the box is the primary.
    const enabled = sendButtonTag(renderComposer({ text: '2 fried eggs' }));
    assert.match(enabled, /\bbg-primary\b/, 'a sendable composer does not show a primary Send');
    assert.doesNotMatch(enabled, /\bbg-muted\b/);
  });
});

describe('dictation belongs to the keyboard, and this app never claims a microphone', () => {
  it('names the keyboard key when the person arrived from the Speak entry', () => {
    assert.ok(renderComposer({ speakArmed: true }).includes(COPY.dictateHint), 'the dictation hint is gone');
  });

  it('says nothing about dictation when the person arrived to type', () => {
    // THE CONTROL. Without it a hint rendered unconditionally would pass the
    // check above while telling every typist to press a microphone key.
    assert.ok(
      !renderComposer({ speakArmed: false }).includes(COPY.dictateHint),
      'the dictation hint shows on the plain typing entry too',
    );
  });

  it('renders no microphone control at all, armed or not', () => {
    for (const speakArmed of [true, false]) {
      const markup = renderComposer({ speakArmed });
      assert.ok(!markup.includes('lucide-mic'), 'a microphone button is back on the composer');
    }
    // And the code that drove it is gone from the route, not merely unrendered.
    for (const forbidden of ['SpeechInputButton', 'useSpeechInputAvailable', 'startListening', 'onTranscript']) {
      assert.ok(!SOURCE.includes(forbidden), `the composer still reaches for speech (${forbidden})`);
    }
  });
});

describe('with no AI provider on this device', () => {
  it('says so, and offers both ways out', () => {
    const markup = renderComposer({ aiConnection: 'absent' });
    assert.ok(markup.includes(COPY.needsProvider), 'the screen no longer explains why nothing can be sent');
    assert.ok(markup.includes(COPY.connect), 'the way to connect a provider is gone');
    assert.match(markup, /href="\/settings\/ai\?next=describe"/, 'the connect link no longer returns here');
    assert.ok(markup.includes(COPY.searchInstead), 'the database search is no longer offered');
    assert.match(markup, /href="\/add"/, 'the search link no longer points at the search screen');
  });

  it('says none of that when a provider is connected', () => {
    // The control: without it, a screen that showed the connect notice to
    // everybody would pass the test above.
    const markup = renderComposer({ aiConnection: 'connected' });
    assert.ok(!markup.includes(COPY.needsProvider));
    assert.ok(!markup.includes(COPY.connect));
  });
});

describe('on a managed instance, where nobody brings a provider', () => {
  it('names the administrator, because no page raises an allowance', () => {
    const markup = renderComposer({ aiConnection: 'absent', door: { kind: 'ask-admin' } });
    assert.ok(markup.includes(MANAGED_COPY.noAllowance), 'the account with no allowance is told nothing');
    // THE 0.20.0 BLOCKER ITSELF. `/settings/ai` redirects to `/settings` on a
    // managed instance, and `/settings` has no AI row: this link was a dead end.
    assert.doesNotMatch(markup, /href="\/settings\/ai/, 'a settings link appeared for an allowance');
    assert.ok(!markup.includes(COPY.connect), 'a managed instance still offers to connect a provider');
  });

  // M204 spec 01. The composer used to carry a third notice, for a signed-out
  // visitor on a managed instance, with a link to the sign in screen. Nobody
  // could reach it: signing out of a managed instance locks the device, and
  // `_personal.tsx`'s gate turns `/describe` into a redirect to `/welcome`
  // before this component renders. `describe-signed-out-door.test.ts` holds
  // the lock half of that decision; this is the screen half.
  it('offers no way back into a session, in any state the notice has', () => {
    for (const door of [{ kind: 'byok' }, { kind: 'ask-admin' }] as const) {
      for (const aiConnection of ['unknown', 'absent', 'connected'] as const) {
        const markup = renderComposer({ aiConnection, door });
        assert.doesNotMatch(
          markup,
          /href="\/sign-in"/,
          `the composer offers a session door for ${door.kind}/${aiConnection}`,
        );
      }
    }
    // THE CONTROL. The same render DOES carry the two links it is supposed to,
    // so the check above is reading real markup rather than an empty string.
    const byok = renderComposer({ aiConnection: 'absent', door: { kind: 'byok' } });
    assert.match(byok, /href="\/settings\/ai\?next=describe"/);
    assert.match(byok, /href="\/add"/);
  });

  it('still offers the provider settings on an open instance', () => {
    // THE CONTROL for the managed case above: without it, a notice that had
    // simply dropped the BYOK branch would pass it and break every self-hoster.
    const markup = renderComposer({ aiConnection: 'absent', door: { kind: 'byok' } });
    assert.match(markup, /href="\/settings\/ai\?next=describe"/);
    assert.ok(markup.includes(COPY.needsProvider));
    assert.ok(!markup.includes(MANAGED_COPY.noAllowance), 'an open instance is sent to an administrator');
  });

  it('says none of it while the AI answer is still unknown', () => {
    for (const door of [{ kind: 'byok' }, { kind: 'ask-admin' }] as const) {
      const markup = renderComposer({ aiConnection: 'unknown', door });
      assert.ok(!markup.includes(MANAGED_COPY.noAllowance));
      assert.ok(!markup.includes(COPY.needsProvider));
    }
  });
});

/** Empties the slot, so one test can never read what a previous one parked. */
function clearSlot(): void {
  takeIntakeHandoff();
}

describe('the hand-off to /scan', () => {
  it('parks the trimmed words as a typed intake and leaves for /scan', () => {
    clearSlot();
    const visited: string[] = [];
    handOffDescription({
      text: '  2 fried eggs, a slice of toast  ',
      source: 'text',
      scanHref: '/scan',
      go: (href) => visited.push(href),
    });

    assert.deepStrictEqual(takeIntakeHandoff(), {
      kind: 'text',
      text: '2 fried eggs, a slice of toast',
      source: 'text',
    });
    assert.deepStrictEqual(visited, ['/scan']);
  });

  it('carries the day the person is looking at', () => {
    assert.equal(describeScanHref(null), '/scan');
    assert.equal(describeScanHref('2026-09-07'), '/scan?date=2026-09-07');
  });

  it('spends nothing on an empty box', () => {
    clearSlot();
    const visited: string[] = [];
    handOffDescription({ text: '   ', source: 'text', scanHref: '/scan', go: (href) => visited.push(href) });

    assert.equal(takeIntakeHandoff(), null, 'an empty box was parked for /scan to pay for');
    assert.deepStrictEqual(visited, [], 'an empty box navigated to the scan screen anyway');
  });
});

////////////////////////////////////////////////////////////////////////////////
// The "Wie gestern" door on the composer (M217/02)
////////////////////////////////////////////////////////////////////////////////

/** An eligible offer: yesterday holds three entries, today none. */
const REPEAT_OFFER: RepeatYesterdayOffer = {
  sourceDate: '2026-09-09',
  targetDate: '2026-09-10',
  sourceCount: 3,
  targetCount: 0,
};

/** Where the door's form starts in the markup, or -1 when there is no door. */
function doorFormIndex(markup: string): number {
  return markup.search(/<form[^>]*action="\/diary"/);
}

/** Where the composer's heading starts. Always present, on every render. */
function titleIndex(markup: string): number {
  const found = markup.indexOf(`>${COPY.title}<`);
  assert.notEqual(found, -1, 'the composer lost its heading');
  return found;
}

describe('the composer offers a repeat of yesterday', () => {
  it('is absent with no offer, and the same probe finds it when there is one', () => {
    // Control first: a probe that can never see a door makes the absence
    // assertion below vacuous.
    assert.notEqual(doorFormIndex(renderComposer({ repeatYesterday: REPEAT_OFFER })), -1, 'the probe is blind');

    assert.equal(doorFormIndex(renderComposer()), -1, 'a composer with no offer drew a door anyway');
    assert.ok(!renderComposer().includes(DOOR_COPY.door), 'the door label is on the screen with nothing to repeat');
  });

  it('sits ABOVE the title, where a late arrival cannot move the Send button', () => {
    const markup = renderComposer({ repeatYesterday: REPEAT_OFFER });

    assert.ok(doorFormIndex(markup) < titleIndex(markup), 'the door landed under the heading');
  });

  it('leaves the Send button exactly where it was, with or without the door', () => {
    const withDoor = renderComposer({ text: '2 fried eggs', repeatYesterday: REPEAT_OFFER });
    const without = renderComposer({ text: '2 fried eggs' });

    // Same tag, same classes, same state: the door is added above the pinned
    // composer, so nothing about the button changes.
    assert.equal(sendButtonTag(withDoor), sendButtonTag(without));
    assert.equal(isSendDisabled(withDoor), isSendDisabled(without));
    // And it is still the LAST thing before the hint line, not pushed around
    // in the composer container.
    assert.ok(withDoor.indexOf(sendButtonTag(withDoor)) > titleIndex(withDoor));
  });

  it('adds no loader to a screen that must never blank its box', () => {
    assert.doesNotMatch(SOURCE, /^export (async )?(function|const) (client)?[lL]oader/m, '/describe grew a loader');
    assert.doesNotMatch(SOURCE, /^export function HydrateFallback/m, '/describe grew a hydrate fallback');
    // The offer is read after the first paint instead.
    assert.ok(SOURCE.includes('selectRepeatYesterday'), 'the composer stopped asking the selector');
  });
});
