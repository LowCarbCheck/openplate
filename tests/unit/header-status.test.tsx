/**
 * Unit tests for `#app/components/header-status`, where the app now says
 * everything it used to say in a toast.
 *
 * The contract has two halves. While a status is live the header's title block
 * is REPLACED by it, so the `h1` is not in the tree at all; with nothing to say
 * the component is transparent and the title block renders untouched. There is
 * no DOM library in this repo (`tests/unit/*` are node:test), so this renders
 * with `renderToStaticMarkup` and reads the markup, which is exactly what a
 * server render puts on the wire.
 *
 * `useStatus` is `useSyncExternalStore` over a module-scoped slot, and its
 * server snapshot reads that same slot, so publishing before the render is a
 * real drive of the component, not a prop injected past it.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HeaderStatus } from '../../app/components/header-status';
import { publishStatus, resetStatusChannel } from '../../app/lib/status';
import { withI18n } from './trends-i18n-harness';

/** Stands in for the header's own two-line block: a decorative wordmark and the page title. */
const TITLE_BLOCK = createElement(
  'div',
  null,
  createElement('span', { 'aria-hidden': 'true' }, 'openplate'),
  createElement('h1', null, 'Diary'),
);

function render(): string {
  return renderToStaticMarkup(withI18n(createElement(HeaderStatus, null, TITLE_BLOCK)));
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

describe('HeaderStatus', () => {
  beforeEach(() => resetStatusChannel());
  afterEach(() => resetStatusChannel());

  it('renders the page title untouched when there is nothing to say', () => {
    const markup = render();
    assert.match(markup, /<h1>Diary<\/h1>/, 'the header lost its title with no status published');
    assert.equal(countOf(markup, '<output'), 0, 'an empty channel still rendered a live region');
  });

  it('replaces the title while a status shows', () => {
    publishStatus({ text: 'Entry saved', tone: 'success' });
    const markup = render();
    assert.ok(markup.includes('Entry saved'), 'the status text is not in the header');
    // The CONTROL for this file: the previous test proves the `h1` IS rendered
    // through the same path, so its absence here is the swap and not a broken
    // harness.
    assert.equal(countOf(markup, '<h1'), 0, 'the h1 stayed while a status was showing');
  });

  it('lets a long error wrap to three lines at a smaller size, not two at the full size (M225 follow-up)', () => {
    publishStatus({
      text: 'Notifications are blocked in your browser settings. Allow them there, then come back.',
      tone: 'error',
    });
    const markup = render();
    assert.ok(
      markup.includes('line-clamp-3 text-balance break-words">Notifications are blocked'),
      'an error with no description lost its line-clamp-3 wrap treatment',
    );
    // CONTROL: an error with no description must not still carry the two-line
    // clamp from the previous round, or the fix regressed to the case this
    // follow-up exists to close.
    assert.equal(
      countOf(markup, 'line-clamp-2 text-balance break-words">Notifications are blocked'),
      0,
      'the error text span is still clamped to two lines instead of three',
    );
    // CONTROL: the markup before M225 wrapped this same text in a `truncate`
    // span, which is exactly what made a persisting error unreadable on a
    // narrow phone. That class must not still be on the text span.
    //
    // `text-balance` joined the class list in the mobile pass (2026-09-20), so
    // the literals above name it: it is what stops a wrapped sentence leaving
    // one word alone on the last line. Nothing else about this row moved.
    assert.equal(
      countOf(markup, 'truncate">Notifications are blocked'),
      0,
      'the status text span still truncates to one line',
    );
  });

  it('clamps an error WITH a description to two lines, not three', () => {
    publishStatus({
      text: 'Notifications are blocked in your browser settings. Allow them there, then come back.',
      description: 'The instance refused the registration (401).',
      tone: 'error',
    });
    const markup = render();
    assert.ok(
      markup.includes('line-clamp-2 text-balance break-words">Notifications are blocked'),
      'an error carrying a description did not drop to line-clamp-2',
    );
    // CONTROL: without a description the same text gets a third line (the
    // test above), so this asserting line-clamp-2 is a real branch, not the
    // only value this component ever renders.
    assert.equal(
      countOf(markup, 'line-clamp-3 text-balance break-words">Notifications are blocked'),
      0,
      'an error with a description still clamped to three lines',
    );
  });

  it('keeps a non-error status at the full text size, clamped to two lines', () => {
    publishStatus({ text: 'Entry saved', tone: 'success' });
    const markup = render();
    assert.ok(
      markup.includes('line-clamp-2 text-balance break-words">Entry saved'),
      'a success status lost its line-clamp-2 wrap treatment',
    );
    // CONTROL: a success status must not drop to the error tone's smaller,
    // three-line treatment.
    assert.equal(
      countOf(markup, 'line-clamp-3 text-balance break-words">Entry saved'),
      0,
      'a success status is clamped to three lines, the error-only treatment',
    );
    assert.ok(markup.includes('text-sm font-semibold'), 'a success status lost the full text-sm size');
  });

  it('gives a status that carries an action the compact three-line treatment, like an error', () => {
    publishStatus({ text: 'Removed Greek yogurt', tone: 'success', action: { label: 'Undo', onClick: () => {} } });
    const markup = render();
    assert.ok(
      markup.includes('line-clamp-3 text-balance break-words">Removed Greek yogurt'),
      'a status with an action did not get the third line the button costs it',
    );
    assert.ok(markup.includes('text-xs font-semibold leading-4'), 'a status with an action stayed at text-sm');
    // CONTROL: the same text with no action keeps the full-size two-line row,
    // which the case above this one asserts directly.
    assert.equal(countOf(markup, 'line-clamp-2 text-balance break-words">Removed Greek yogurt'), 0);
  });

  it('renders the description as a second line', () => {
    publishStatus({ text: 'Added Greek yogurt', description: 'To Breakfast, 12 g net carbs so far today.' });
    const markup = render();
    assert.ok(markup.includes('To Breakfast, 12 g net carbs so far today.') || markup.includes('To Breakfast'));
    assert.ok(
      markup.includes('text-xs leading-4 text-muted-foreground'),
      'the second line lost its smaller treatment',
    );
  });

  it('omits the second line when there is no description', () => {
    publishStatus({ text: 'Report queued' });
    const markup = render();
    assert.equal(
      countOf(markup, 'text-xs leading-4 text-muted-foreground'),
      0,
      'a one-line status still rendered the description span',
    );
  });

  it('announces through exactly one <output> and adds no second live-region declaration', () => {
    publishStatus({ text: 'Import failed', tone: 'error' });
    const markup = render();
    assert.equal(countOf(markup, '<output'), 1, 'expected exactly one live region');
    assert.equal(countOf(markup, 'aria-live'), 0, '<output> already carries role=status, aria-live is a second one');
    assert.equal(countOf(markup, 'role="status"'), 0, 'the implicit role was restated');
  });

  it('gives an error a dismiss control, and a plain confirmation none', () => {
    publishStatus({ text: 'Import failed', tone: 'error' });
    const withError = render();
    assert.ok(withError.includes('Dismiss this message'), 'a persisting error had no way out');
    // The 44px floor: `size-11`, not a bare icon button.
    assert.ok(withError.includes('size-11'), 'the dismiss control is under the tap-target floor');

    resetStatusChannel();
    publishStatus({ text: 'Saved', tone: 'success' });
    const withSuccess = render();
    assert.equal(
      countOf(withSuccess, 'Dismiss this message'),
      0,
      'a self-clearing confirmation grew a dismiss button',
    );
  });

  it('renders an action label, and gives that status a dismiss control too', () => {
    publishStatus({ text: 'Removed Greek yogurt', action: { label: 'Undo', onClick: () => {} } });
    const markup = render();
    assert.ok(markup.includes('>Undo</button>'), 'the action button did not render its label');
    assert.ok(markup.includes('Dismiss this message'), 'a status offering a choice must also offer neither');
  });

  it('carries the tone through to a palette class the app already paints with', () => {
    publishStatus({ text: 'Import failed', tone: 'error' });
    assert.ok(render().includes('text-destructive'), 'an error is not in the destructive token');
    resetStatusChannel();
    publishStatus({ text: 'Could not verify', tone: 'warning' });
    assert.ok(render().includes('text-accent-amber'), 'a warning is not in the amber token');
  });
});

describe('the app header hosts it', () => {
  const WRAPPER = readFileSync(
    fileURLToPath(new URL('../../app/components/app-wrapper.tsx', import.meta.url)),
    'utf8',
  );

  it('wraps the wordmark and the h1, so a status replaces both', () => {
    const opened = WRAPPER.indexOf('<HeaderStatus>');
    const closed = WRAPPER.indexOf('</HeaderStatus>');
    assert.ok(opened > 0 && closed > opened, 'the app header stopped mounting HeaderStatus');
    const wrapped = WRAPPER.slice(opened, closed);
    assert.match(wrapped, /<h1/, 'the page title is outside the status slot');
    assert.match(wrapped, /<Wordmark\b/, 'the wordmark is outside the status slot');
    // CONTROL: the read is really about the `Wordmark` element. Take it out of the slot's
    // source and the same pattern must stop matching, so it cannot pass on a comment or on
    // some other mention of the word.
    const withoutTheKicker = wrapped.replace(/<Wordmark[\s\S]*?\/>/, '');
    assert.doesNotMatch(withoutTheKicker, /<Wordmark\b/, 'the slot must hold exactly one wordmark');
  });

  it('leaves the device menu outside it, so nothing on the bar moves', () => {
    const closed = WRAPPER.indexOf('</HeaderStatus>');
    assert.ok(WRAPPER.indexOf('<AvatarMenu />') > closed, 'the device menu is inside the status slot');
  });
});
