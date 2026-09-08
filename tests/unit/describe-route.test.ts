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
 *    so a screen whose provider and recogniser arrive through hooks could only
 *    ever be rendered in one state.
 *
 * EVERY ASSERTION HAS A CONTROL. A disabled-attribute check on a `ui/button`
 * is the standing trap in this repo: the cva class list carries
 * `disabled:pointer-events-none`, so `markup.includes('disabled')` passes
 * against a button that is not disabled at all. The attribute is matched
 * exactly, and each disabled case is paired with the enabled one.
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
import {
  DescribeComposer,
  applyDescribeTranscript,
  describeScanHref,
  handOffDescription,
} from '../../app/routes/describe';
import { takeIntakeHandoff } from '../../app/lib/scan-handoff';
import type { AiConnection, AiIntakeDoor } from '../../app/components/add/use-ai-connection';
import type { TypedIntakeSource } from '../../app/lib/intake-source';

/** The shipped copy this file asserts on, so a renamed key fails here rather than shipping a raw `describe.send`. */
const describeCopySchema = z.object({
  describe: z.object({
    title: z.string(),
    lead: z.string(),
    placeholder: z.string(),
    send: z.string(),
    needsProvider: z.string(),
    connect: z.string(),
    searchInstead: z.string(),
  }),
  /** The two sentences a managed instance shows instead, shared with `/add`. */
  aiIntake: z.object({
    signedOut: z.string(),
    signIn: z.string(),
    noAllowance: z.string(),
  }),
});

const CATALOG = describeCopySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);
const COPY = CATALOG.describe;
const MANAGED_COPY = CATALOG.aiIntake;

/** An exactly-matched boolean `disabled` attribute, never the `disabled:` class prefix the button's own styles carry. */
const DISABLED_ATTRIBUTE = /\sdisabled=""/;

const noop = () => undefined;

/**
 * The composer, rendered for one set of conditions.
 *
 * A memory router because the screen carries two `<Link>`s, and the i18n
 * harness because every string on it comes from the real English catalog.
 */
function renderComposer({
  text = '',
  aiConnection = 'connected',
  door = 'byok',
  speechAvailable = false,
  speakArmed = false,
}: {
  text?: string;
  aiConnection?: AiConnection;
  door?: AiIntakeDoor;
  speechAvailable?: boolean | null;
  speakArmed?: boolean;
} = {}): string {
  const element = createElement(DescribeComposer, {
    text,
    onTextChange: noop,
    onSend: noop,
    onTranscript: noop,
    onNotice: noop,
    notice: '',
    aiConnection,
    door,
    speechAvailable,
    speakArmed,
    onListenStart: noop,
    searchHref: '/add',
  });
  const router = createMemoryRouter([{ path: '/describe', element: withI18n(element) }], {
    initialEntries: ['/describe'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('the composer is a message box, not a search form', () => {
  it('asks for the meal and shows the example', () => {
    const markup = renderComposer();
    assert.ok(markup.includes(COPY.title), 'the heading is gone');
    assert.ok(markup.includes(COPY.lead), 'the line that explains what the AI does is gone');
    assert.ok(markup.includes(COPY.placeholder), 'the example meal is gone from the placeholder');
  });

  it('offers a multi-line field, never a single-line search input', () => {
    const markup = renderComposer();
    assert.match(markup, /<textarea[^>]*id="describe-meal"/, 'the composer is no longer a textarea');
    // The control: a search input would be the defect coming back.
    assert.doesNotMatch(markup, /type="search"/, 'a search field reappeared on the composer screen');
  });

  it('runs no lookup and lists no food', () => {
    const source = readFileSync(new URL('../../app/routes/describe.tsx', import.meta.url), 'utf8');
    for (const forbidden of ['fetchFoodMatches', 'listLocalFoods', 'SearchResultRow', 'computeLocalRecentFoods']) {
      assert.ok(!source.includes(forbidden), `the composer screen started doing a database lookup (${forbidden})`);
    }
  });
});

describe('Send', () => {
  it('is disabled while the box is empty', () => {
    assert.match(renderComposer({ text: '' }), DISABLED_ATTRIBUTE, 'an empty composer can be sent');
    // The control, and the one that makes the check above mean anything: the
    // same button with words in the box carries no such attribute.
    assert.doesNotMatch(
      renderComposer({ text: '2 fried eggs' }),
      DISABLED_ATTRIBUTE,
      'the composer cannot be sent even with a meal in it',
    );
  });

  it('is disabled for whitespace, which is an empty box wearing a space', () => {
    assert.match(renderComposer({ text: '   \n ' }), DISABLED_ATTRIBUTE);
  });

  it('is disabled until the provider answer has arrived, and while it is absent', () => {
    for (const aiConnection of ['unknown', 'absent'] as const) {
      assert.match(
        renderComposer({ text: '2 fried eggs', aiConnection }),
        DISABLED_ATTRIBUTE,
        `the composer offers to send with the connection ${aiConnection}`,
      );
    }
    assert.doesNotMatch(renderComposer({ text: '2 fried eggs', aiConnection: 'connected' }), DISABLED_ATTRIBUTE);
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
  it('sends a signed-out person to sign in, never to a settings page that is not there', () => {
    const markup = renderComposer({ aiConnection: 'absent', door: 'sign-in' });
    assert.ok(markup.includes(MANAGED_COPY.signedOut), 'the screen does not say why nothing can be sent');
    assert.ok(markup.includes(MANAGED_COPY.signIn), 'the way back in is gone');
    assert.match(markup, /href="\/sign-in"/, 'the notice points nowhere');
    // THE BLOCKER ITSELF. `/settings/ai` redirects to `/settings` on a managed
    // instance, and `/settings` has no AI row: this link was a dead end.
    assert.doesNotMatch(markup, /href="\/settings\/ai/, 'the notice still points at the BYOK settings page');
    assert.ok(!markup.includes(COPY.connect), 'a managed instance still offers to connect a provider');
  });

  it('names the administrator once they are signed in, because no page raises an allowance', () => {
    const markup = renderComposer({ aiConnection: 'absent', door: 'ask-admin' });
    assert.ok(markup.includes(MANAGED_COPY.noAllowance), 'the account with no allowance is told nothing');
    assert.doesNotMatch(markup, /href="\/settings\/ai/, 'a settings link appeared for an allowance');
    assert.doesNotMatch(markup, /href="\/sign-in"/, 'a signed-in person is told to sign in');
  });

  it('still offers the provider settings on an open instance', () => {
    // THE CONTROL for both cases above: without it, a notice that had simply
    // dropped the BYOK branch would pass them and break every self-hoster.
    const markup = renderComposer({ aiConnection: 'absent', door: 'byok' });
    assert.match(markup, /href="\/settings\/ai\?next=describe"/);
    assert.ok(markup.includes(COPY.needsProvider));
    assert.ok(!markup.includes(MANAGED_COPY.signedOut), 'an open instance is told it is signed out of something');
    assert.ok(!markup.includes(MANAGED_COPY.noAllowance), 'an open instance is sent to an administrator');
  });

  it('says none of it while the AI answer is still unknown', () => {
    for (const door of ['byok', 'sign-in', 'ask-admin'] as const) {
      const markup = renderComposer({ aiConnection: 'unknown', door });
      assert.ok(!markup.includes(MANAGED_COPY.signedOut));
      assert.ok(!markup.includes(MANAGED_COPY.noAllowance));
      assert.ok(!markup.includes(COPY.needsProvider));
    }
  });
});

describe('the microphone', () => {
  it('renders only once hydration confirms a recogniser', () => {
    assert.ok(
      !renderComposer({ speechAvailable: null }).includes('lucide-mic'),
      'a microphone rendered before the answer',
    );
    assert.ok(
      !renderComposer({ speechAvailable: false }).includes('lucide-mic'),
      'a browser with no recogniser sees one',
    );
    assert.ok(
      renderComposer({ speechAvailable: true }).includes('lucide-mic'),
      'the microphone is gone where a recogniser exists, so the two checks above prove nothing',
    );
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

/** What a spoken meal was sent as, so the SOURCE can be asserted and not just the words. */
interface SentIntake {
  text: string;
  source: TypedIntakeSource;
}

/** The two sinks `applyDescribeTranscript` writes to, each recording what it received. */
interface TranscriptSinks {
  filled: string[];
  sent: SentIntake[];
  fill: (text: string) => void;
  send: (text: string, source: TypedIntakeSource) => void;
}

function recordTranscriptSinks(): TranscriptSinks {
  const filled: string[] = [];
  const sent: SentIntake[] = [];
  return {
    filled,
    sent,
    fill: (text) => void filled.push(text),
    send: (text, source) => void sent.push({ text, source }),
  };
}

describe('a finished transcript', () => {
  it('goes to the AI under the SPEECH source, not the typed one', () => {
    const spy = recordTranscriptSinks();
    applyDescribeTranscript({
      transcript: 'a banana and a coffee',
      hasAiProvider: true,
      fill: spy.fill,
      send: spy.send,
    });

    assert.deepStrictEqual(spy.sent, [{ text: 'a banana and a coffee', source: 'speech' }]);
    // The control: filing a spoken meal as typed would keep the pipeline
    // working and quietly destroy the one fact that says which way in is worth
    // improving.
    assert.notEqual(spy.sent[0]?.source, 'text');
    // And it lands in the box either way, so nothing heard is lost.
    assert.deepStrictEqual(spy.filled, ['a banana and a coffee']);
  });

  it('fills the box and stops when this device has no provider', () => {
    const spy = recordTranscriptSinks();
    applyDescribeTranscript({ transcript: 'a banana', hasAiProvider: false, fill: spy.fill, send: spy.send });

    assert.deepStrictEqual(spy.filled, ['a banana'], 'the words were discarded');
    assert.deepStrictEqual(spy.sent, [], 'the words were sent to a provider that does not exist');
  });

  it('sends nothing when nothing was heard', () => {
    const spy = recordTranscriptSinks();
    applyDescribeTranscript({ transcript: '   ', hasAiProvider: true, fill: spy.fill, send: spy.send });

    assert.deepStrictEqual(spy.sent, []);
  });
});
