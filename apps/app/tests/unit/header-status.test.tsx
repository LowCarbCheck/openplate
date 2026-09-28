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

/**
 * What sits between the text span's class list and the words: the sentence has
 * its own span (2026-09-28), so an action's label can follow it inline and a
 * reader can still take the sentence alone.
 */
const SENTENCE = '"><span data-slot="header-status-sentence">';

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
      markup.includes(`line-clamp-3 text-balance break-words${SENTENCE}Notifications are blocked`),
      'an error with no description lost its line-clamp-3 wrap treatment',
    );
    // CONTROL: an error with no description must not still carry the two-line
    // clamp from the previous round, or the fix regressed to the case this
    // follow-up exists to close.
    assert.equal(
      countOf(markup, `line-clamp-2 text-balance break-words${SENTENCE}Notifications are blocked`),
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
      countOf(markup, `truncate${SENTENCE}Notifications are blocked`),
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
      markup.includes(`line-clamp-2 text-balance break-words${SENTENCE}Notifications are blocked`),
      'an error carrying a description did not drop to line-clamp-2',
    );
    // CONTROL: without a description the same text gets a third line (the
    // test above), so this asserting line-clamp-2 is a real branch, not the
    // only value this component ever renders.
    assert.equal(
      countOf(markup, `line-clamp-3 text-balance break-words${SENTENCE}Notifications are blocked`),
      0,
      'an error with a description still clamped to three lines',
    );
  });

  it('keeps a non-error status at the full text size, clamped to two lines', () => {
    publishStatus({ text: 'Entry saved', tone: 'success' });
    const markup = render();
    assert.ok(
      markup.includes(`line-clamp-2 text-balance break-words${SENTENCE}Entry saved`),
      'a success status lost its line-clamp-2 wrap treatment',
    );
    // CONTROL: a success status must not drop to the error tone's smaller,
    // three-line treatment.
    assert.equal(
      countOf(markup, `line-clamp-3 text-balance break-words${SENTENCE}Entry saved`),
      0,
      'a success status is clamped to three lines, the error-only treatment',
    );
    assert.ok(markup.includes('text-sm font-semibold'), 'a success status lost the full text-sm size');
  });

  it('gives a status that carries an action the compact three-line treatment, like an error', () => {
    publishStatus({ text: 'Removed Greek yogurt', tone: 'success', action: { label: 'Undo', onClick: () => {} } });
    const markup = render();
    assert.ok(
      markup.includes(`line-clamp-3 text-balance break-words${SENTENCE}Removed Greek yogurt`),
      'a status with an action did not get the third line the button costs it',
    );
    assert.ok(markup.includes('text-xs font-semibold leading-4'), 'a status with an action stayed at text-sm');
    // CONTROL: the same text with no action keeps the full-size two-line row,
    // which the case above this one asserts directly.
    assert.equal(countOf(markup, `line-clamp-2 text-balance break-words${SENTENCE}Removed Greek yogurt`), 0);
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

  it('wraps the second line of a compact status to two lines, and all four lines share leading-tight (M265/08)', () => {
    // THE TRIAL COUNTDOWN NEAR ITS END: an action, so compact, and a recap
    // line. The recap used to be one `truncate` line and ended in an ellipsis
    // at 390 px in every language. The browser tier measures the fit; this
    // pins the two class lists that make it.
    publishStatus({
      text: '3 days of AI scans left in your trial.',
      description: 'In your trial you logged 28 meals with AI.',
      action: { label: 'See plans', onClick: () => {} },
    });
    const markup = render();
    assert.ok(
      markup.includes(
        'data-slot="header-status-description" class="line-clamp-2 text-balance break-words text-xs leading-tight text-muted-foreground"',
      ),
      'the recap line beside a compact sentence does not wrap to two lines',
    );
    assert.ok(markup.includes('text-xs font-semibold leading-tight'), 'the compact sentence kept its 16 px line height');
    assert.equal(countOf(markup, 'text-xs font-semibold leading-4'), 0, 'four lines of 16 px overflow the header');

    // CONTROL: a full-size sentence leaves its second line one line, so there
    // it still truncates, read through the same attribute.
    resetStatusChannel();
    publishStatus({ text: 'Added Greek yogurt', description: 'To Breakfast, 12 g net carbs so far today.' });
    assert.ok(
      render().includes(
        'data-slot="header-status-description" class="truncate text-xs leading-4 text-muted-foreground"',
      ),
      'the second line under a full-size sentence stopped truncating',
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

  it('draws the action as the last words of the sentence, inside the text span, not as a button beside it', () => {
    publishStatus({ text: 'Removed Greek yogurt', action: { label: 'Undo', onClick: () => {} } });
    const markup = render();
    // THE BUYER WALK (2026-09-28): a bordered button beside the text left the
    // German countdown about 40 px at 390 px. The label now follows the
    // sentence in the same clamped span, so it costs its words and no more.
    const textAt = markup.indexOf('data-slot="header-status-text"');
    const sentenceAt = markup.indexOf('>Removed Greek yogurt</span>');
    const actionAt = markup.indexOf('data-slot="header-status-action"');
    const textClosesAt = markup.indexOf('</span></span>', actionAt);
    assert.ok(textAt !== -1 && sentenceAt > textAt, 'the sentence is not inside the text span');
    assert.ok(actionAt > sentenceAt, 'the action label does not follow the sentence');
    assert.ok(textClosesAt > actionAt, 'the action label is outside the text span');
    // CONTROL: the old markup drew the label in the shared `ui/button`, whose
    // `data-slot="button"` is the handle this reads. It must be gone.
    assert.equal(countOf(markup, 'data-slot="button"'), 0, 'the action is still a bordered button beside the text');
  });

  it("stretches the action's tap area over the text column, never under the 44 px floor", () => {
    publishStatus({ text: 'Removed Greek yogurt', action: { label: 'Undo', onClick: () => {} } });
    const markup = render();
    // The label's own box is one line of text-xs. Its `after:` box fills the
    // nearest positioned ancestor, the column, which stretches to the row's
    // `min-h-11`. The browser tier hit-tests it; this pins the two halves.
    assert.match(markup, /data-slot="header-status-action" class="[^"]*after:absolute after:inset-0/);
    assert.match(markup, /<div class="relative flex min-w-0 flex-1 flex-col justify-center self-stretch /);
    assert.match(markup, /data-slot="header-status" class="flex min-h-11 /);
  });

  it('CONTROL: a status with no action draws no action label', () => {
    publishStatus({ text: 'Entry saved', tone: 'success' });
    assert.equal(countOf(render(), 'data-slot="header-status-action"'), 0);
  });

  it('gives the sentence the tone icon\'s width when it carries an action', () => {
    publishStatus({ text: 'Removed Greek yogurt', tone: 'success', action: { label: 'Undo', onClick: () => {} } });
    // The close control's X is the one icon left in the row.
    assert.equal(countOf(render(), 'lucide-circle-check'), 0, 'a status with an action still drew its tone icon');
    assert.equal(countOf(render(), 'lucide-x'), 1, 'the close control lost its icon');
    // CONTROL: the same tone with no action draws the icon, through the same read.
    resetStatusChannel();
    publishStatus({ text: 'Removed Greek yogurt', tone: 'success' });
    assert.equal(countOf(render(), 'lucide-circle-check'), 1, 'the tone icon read matches nothing');
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
    const menuAt = WRAPPER.search(/<AvatarMenu\b/);
    assert.notEqual(menuAt, -1, 'the header no longer draws the device menu');
    assert.ok(menuAt > closed, 'the device menu is inside the status slot');
  });
});
