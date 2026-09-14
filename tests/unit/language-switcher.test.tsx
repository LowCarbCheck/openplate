/**
 * The language strip in the device menu (M230).
 *
 * Three things, each with a control. The strip lists EVERY language in
 * `SUPPORTED_LANGUAGES`, each named in its own language and marked `lang`, so a
 * seventh language reaches the menu the day it reaches the list. The active
 * language is the one checked, so the same markup rendered in another language
 * checks a different cell. And a pick calls the ONE mechanism the app has,
 * `selectLanguage`'s cookie-then-storage-then-reload, through `switchLanguage`,
 * counted only on a real change.
 *
 * Rendered the way `avatar-menu-door.test.ts` renders the menu: the Radix
 * primitive `Root` open, the primitive `Content` force-mounted, no portal.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { LANGUAGE_STRIP_SLOT, LanguageRow } from '../../app/components/language-switcher';

/** The strip rendered as if the UI were in `language`. The catalog is empty on purpose: the strip prints no copy. */
function renderStrip(language: LanguageCode): string {
  const instance = createInstance();
  void instance.init({ lng: language, fallbackLng: 'en', resources: { [language]: { common: {} } } });
  const content: ReactElement = createElement(
    DropdownMenuPrimitive.Root,
    { open: true },
    createElement(DropdownMenuPrimitive.Content, { forceMount: true }, createElement(LanguageRow)),
  );
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, content));
}

/** The `<div role="menuitemradio" ...>` opening tag of the cell for `code`, found by its `lang`. */
function cellTag(markup: string, code: LanguageCode): string {
  const match = markup.match(new RegExp(`<div[^>]*lang="${code}"[^>]*>`, 'u'));
  assert.ok(match !== null, `no cell for ${code}`);
  return match[0];
}

describe('LanguageRow', () => {
  it('lists every supported language once, named in its own language', () => {
    const markup = renderStrip('en');
    assert.ok(markup.includes(`data-slot="${LANGUAGE_STRIP_SLOT}"`));
    assert.equal(markup.split('role="menuitemradio"').length - 1, SUPPORTED_LANGUAGES.length);
    for (const code of SUPPORTED_LANGUAGES) {
      assert.ok(cellTag(markup, code).includes('role="menuitemradio"'));
      assert.ok(markup.includes(`>${LANGUAGE_LABELS[code]}<`), `${code} is not named ${LANGUAGE_LABELS[code]}`);
    }
    // CONTROL: a code the app does not ship has no cell.
    assert.doesNotMatch(markup, /lang="xx"/u);
  });

  it('checks the active language and only that one, in either language', () => {
    for (const active of ['en', 'tr'] as const) {
      const markup = renderStrip(active);
      assert.equal(markup.split('aria-checked="true"').length - 1, 1, `${active}: exactly one checked cell`);
      assert.ok(cellTag(markup, active).includes('aria-checked="true"'));
      const other = active === 'en' ? 'tr' : 'en';
      assert.ok(cellTag(markup, other).includes('aria-checked="false"'));
    }
  });

  it('lays the cells out as a grid, never a single overflowing row', () => {
    const markup = renderStrip('en');
    const group = markup.match(new RegExp(`<div[^>]*data-slot="${LANGUAGE_STRIP_SLOT}"[^>]*>`, 'u'));
    assert.ok(group !== null);
    assert.match(group[0], /grid-cols-/u);
    // CONTROL: the theme strip's `flex` row grammar is what this must NOT be.
    assert.doesNotMatch(group[0], /class="[^"]*\bflex\b/u);
  });
});
