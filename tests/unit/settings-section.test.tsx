/**
 * The settings chrome primitive (`app/components/settings/settings-section.tsx`).
 *
 * The hub was redesigned as a native phone-style inset grouped list while the
 * sub-pages still wore the desktop `Card`, so the whole point of this module is
 * that ONE class string decides what an inset container looks like. These
 * tests therefore assert composition, not appearance: that both variants carry
 * `SETTINGS_INSET_CLASS`, that the list variant adds its dividers on top of it,
 * and that the label is a real `h2` so a settings page keeps its outline.
 *
 * THE SOURCE SWEEP AT THE BOTTOM IS THE CONVERSION LEDGER. It freezes the set
 * of settings routes still importing `#app/components/ui/card`, so a page
 * converted without updating the list fails here, and so does a page that
 * quietly goes back to Card chrome. Two more workers shrink that set; the last
 * one empties it.
 *
 * No DOM library in this repo (see `openplate-static-render-assertions`): this
 * is `renderToStaticMarkup` over prop-driven components, exactly what a server
 * render puts on the wire. Neither component reads a hook, so no i18n harness
 * and no router are needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';

import { SETTINGS_INSET_CLASS, SettingsGroup, SettingsSection } from '../../app/components/settings/settings-section';

/** The section, with whatever props the assertion is about. */
function renderSection(props: { label: string; description?: string; contentClassName?: string }): string {
  return renderToStaticMarkup(
    <SettingsSection {...props}>
      <span>the control</span>
    </SettingsSection>,
  );
}

describe('SettingsSection', () => {
  it('renders its label as a real h2, so the page keeps an outline', () => {
    const markup = renderSection({ label: 'Display language' });
    // The label is IN the h2, not merely somewhere in the markup: an eyebrow
    // rendered as the default `<p>` would pass a bare `includes` check.
    assert.match(markup, /<h2[^>]*>Display language<\/h2>/);
  });

  it('renders the description under the label when there is one', () => {
    const markup = renderSection({ label: 'Display language', description: 'Which language the app speaks.' });
    assert.match(markup, /<p class="[^"]*text-muted-foreground[^"]*">Which language the app speaks\.<\/p>/);
  });

  it('the control: renders no description paragraph when none is given', () => {
    const markup = renderSection({ label: 'Display language' });
    assert.equal(markup.includes('Which language the app speaks.'), false);
    // CONTROL for the control: the same render really did produce the heading
    // and the children, so the absence above is about the description alone.
    assert.ok(markup.includes('Display language'));
    assert.ok(markup.includes('the control'));
  });

  it('draws its content in the shared inset container', () => {
    const markup = renderSection({ label: 'Display language' });
    assert.ok(
      markup.includes(SETTINGS_INSET_CLASS),
      `no "${SETTINGS_INSET_CLASS}" container in the section: ${markup}`,
    );
  });

  it('adds a caller class to the container without dropping the shared recipe', () => {
    const markup = renderSection({ label: 'Display language', contentClassName: 'space-y-0' });
    assert.ok(markup.includes(SETTINGS_INSET_CLASS), markup);
    assert.ok(markup.includes('space-y-0'), markup);
  });
});

describe('SettingsGroup', () => {
  const markup = renderToStaticMarkup(
    <SettingsGroup label="Account and plan">
      <span>a row</span>
    </SettingsGroup>,
  );

  it('renders its label as a real h2 too', () => {
    assert.match(markup, /<h2[^>]*>Account and plan<\/h2>/);
  });

  it('wears the same inset recipe as a section, plus the row dividers', () => {
    assert.ok(markup.includes(SETTINGS_INSET_CLASS), markup);
    // The list variant is the inset container AND hairlines between rows. A
    // group that lost `divide-y` reads as one undivided block of text.
    assert.match(markup, /class="[^"]*divide-y[^"]*"/);
  });

  it('the control: a section is not a list, so it carries no dividers', () => {
    assert.equal(renderSection({ label: 'Display language' }).includes('divide-y'), false);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The conversion ledger
////////////////////////////////////////////////////////////////////////////////

const ROUTES_DIR = fileURLToPath(new URL('../../app/routes/', import.meta.url));

/**
 * The settings pages still wearing the desktop `Card` chrome, frozen as a set.
 *
 * Empty is the destination. Remove a name here in the same change that
 * converts that page; do NOT relax this into a count, because a count passes
 * while one page converts and another regresses.
 */
const PAGES_STILL_ON_CARD = new Set([
]);

/** Every `app/routes/settings.*.tsx`, which is every page the hub can reach under `/settings`. */
function settingsRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.startsWith('settings.') && name.endsWith('.tsx'))
    .toSorted();
}

describe('the settings pages and the Card chrome', () => {
  it('leaves exactly the pages that are not converted yet importing ui/card', () => {
    const files = settingsRouteFiles();
    // NON-VACUITY: an empty directory read would make the set comparison below
    // pass against a frozen list of eight.
    assert.ok(files.length > 10, `expected the settings routes, found ${files.length}`);
    const onCard = files.filter((name) =>
      readFileSync(`${ROUTES_DIR}${name}`, 'utf8').includes('#app/components/ui/card'),
    );
    assert.deepEqual(onCard.toSorted(), [...PAGES_STILL_ON_CARD].toSorted());
  });
});
