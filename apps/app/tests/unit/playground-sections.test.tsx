/**
 * EVERY SECTION OF THE STATES PLAYGROUND DRAWS, AND EVERY CARD IS ADDRESSABLE.
 *
 * ── WHAT THIS PINS ───────────────────────────────────────────────────────
 *
 * The playground exists so that a state can be looked at without provoking it.
 * That only works while three things hold, and none of them is visible from the
 * type checker:
 *
 * 1. A section draws at all. A fixture that drifts from a component's props, a
 *    builder that now throws for a day a card feeds it, or a translation key
 *    that was renamed turns one card into a crash. A real browser shows that on
 *    the card (the card has its own error boundary), but a person has to look.
 *    Here each section is rendered with `renderToString`, inside the same
 *    providers the page uses, so the throw fails the push instead.
 * 2. Every card carries a handle (`data-state`) and no two cards on the page
 *    share one. A browser check and `#section/<handle>` both address a card by
 *    it, and a repeat would send two of them to the same place.
 * 3. A section's own `DEF` equals its registry row, so the nav and the page
 *    heading cannot disagree.
 *
 * ── A CARD IS NOT EVERY `data-state` ─────────────────────────────────────
 *
 * Radix primitives put `data-state="open"` and `"closed"` on their own
 * elements, and the admin cards mount some. Cards are found by their
 * `data-slot`, which is `CARD_SLOT` in `layout.tsx`. The control below holds
 * that: a Radix attribute is not counted as a card.
 *
 * ── EVERY ASSERTION HAS A CONTROL ────────────────────────────────────────
 *
 * "No raw translation key" and "no duplicate handle" are absences, which pass
 * trivially on empty output. Each reader is run on input that is wrong on
 * purpose first, and must see it.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import i18next from '../../app/i18n/i18n';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { PlaygroundApp, SECTIONS, type SectionModule } from '../../app/playground/app';
import { CARD_SLOT, formatHash, groupSlug, parseHash } from '../../app/playground/layout';
import { PlaygroundProviders } from '../../app/playground/providers';

////////////////////////////////////////////////////////////////////////////////
// Readers, each with a control below
////////////////////////////////////////////////////////////////////////////////

/** The handle of every card in some markup. A card is an element with the card's `data-slot`. */
function cardHandlesOf(html: string): string[] {
  const tags = html.match(new RegExp(`<[a-z]+\\b[^>]*\\bdata-slot="${CARD_SLOT}"[^>]*>`, 'g')) ?? [];
  return tags.flatMap((tag) => {
    const handle = /\bdata-state="([^"]*)"/.exec(tag)?.[1];
    return handle === undefined ? [] : [handle];
  });
}

/** The values that appear more than once. */
function findDuplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

/** The visible text of some markup: tags removed, so an attribute value is not read as copy. */
function textOf(html: string): string {
  return html.replaceAll(/<[^>]*>/g, ' ');
}

/** Translation keys shown as text, which is what i18next prints for a key it cannot find. */
function findRawKeys(html: string): string[] {
  return textOf(html).match(/\b(?:admin|diary|dashboard|settings|account|common|mainGoal)\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+/g) ?? [];
}

/** A section's module, drawn in the providers the page uses. */
function renderSection(module: SectionModule): string {
  const section: ReactElement = createElement(module.default);
  return renderToString(createElement(PlaygroundProviders, null, section));
}

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('the readers can see what they are looking for', () => {
  it('cardHandlesOf finds a card and ignores a Radix data-state', () => {
    const html =
      '<div data-slot="playground-card" data-state="a"></div><button data-state="closed"></button><div data-state="b"></div>';
    assert.deepEqual(cardHandlesOf(html), ['a']);
    assert.deepEqual(cardHandlesOf('<div></div>'), []);
  });

  it('findDuplicates reports a repeat and nothing else', () => {
    assert.deepEqual(findDuplicates(['a', 'b', 'a']), ['a']);
    assert.deepEqual(findDuplicates(['a', 'b']), []);
  });

  it('findRawKeys sees a key printed as text, and not a key in an attribute or a sentence', () => {
    assert.deepEqual(findRawKeys('<p>admin.people.empty</p>'), ['admin.people.empty']);
    assert.deepEqual(findRawKeys('<p title="admin.person.day">Nobody has an account here yet.</p>'), []);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The sections
////////////////////////////////////////////////////////////////////////////////

describe('the registry', () => {
  it('has sections, and no id twice', () => {
    assert.ok(SECTIONS.length >= 5);
    assert.deepEqual(findDuplicates(SECTIONS.map((entry) => entry.def.id)), []);
  });

  it('gives every row the same id and title as the DEF of its own file', async () => {
    for (const entry of SECTIONS) {
      const module = await entry.load();
      assert.equal(module.DEF.id, entry.def.id);
      assert.equal(module.DEF.title, entry.def.title);
    }
  });
});

describe('every section draws', () => {
  it('draws non-empty markup with at least one card and no raw translation key', async () => {
    for (const entry of SECTIONS) {
      const html = renderSection(await entry.load());
      assert.ok(html.length > 500, `${entry.def.id} drew almost nothing`);
      assert.ok(cardHandlesOf(html).length >= 1, `${entry.def.id} has no card`);
      assert.deepEqual(findRawKeys(html), [], `${entry.def.id} shows a raw translation key`);
      assert.ok(!html.includes('role="alert"'), `${entry.def.id} drew an error`);
    }
  });

  it('prints the "Reach it for real" line on every card', async () => {
    for (const entry of SECTIONS) {
      const html = renderSection(await entry.load());
      const cards = cardHandlesOf(html).length;
      const reaches = html.match(/Reach it for real:/g)?.length ?? 0;
      assert.equal(reaches, cards, `${entry.def.id}: ${cards} cards but ${reaches} reach-it lines`);
    }
  });

  it('has no handle twice anywhere on the page', async () => {
    const handles: string[] = [];
    for (const entry of SECTIONS) handles.push(...cardHandlesOf(renderSection(await entry.load())));
    assert.ok(handles.length >= 30, `only ${handles.length} cards in all`);
    assert.deepEqual(findDuplicates(handles), []);
  });

  it('writes every handle as a flat kebab-case word, so it fits the address grammar', async () => {
    for (const entry of SECTIONS) {
      for (const handle of cardHandlesOf(renderSection(await entry.load()))) {
        assert.match(handle, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${entry.def.id}/${handle}`);
        assert.equal(parseHash(`#${entry.def.id}/${handle}`).card, handle);
      }
    }
  });

  it('draws in every language, with the same cards and no raw key', async () => {
    for (const entry of SECTIONS) {
      const module = await entry.load();
      const english = cardHandlesOf(renderSection(module));
      for (const code of SUPPORTED_LANGUAGES) {
        await i18next.changeLanguage(code);
        const html = renderSection(module);
        assert.deepEqual(cardHandlesOf(html), english, `${entry.def.id} in ${code}`);
        assert.deepEqual(findRawKeys(html), [], `${entry.def.id} in ${code} shows a raw translation key`);
      }
    }
  });

  it('control: the language switch really changes what is drawn', async () => {
    const stats = SECTIONS.find((entry) => entry.def.id === 'admin-stats');
    assert.ok(stats !== undefined);
    const module = await stats.load();
    // The label of one stats cell in each language, read from the catalogs rather than typed in. Only
    // the German word can tell the two renders apart: the section's own English copy names the
    // cells in its intro, so the English word is on the page in every language.
    const englishLabel = i18next.t('admin.stats.admins', { lng: 'en' });
    const germanLabel = i18next.t('admin.stats.admins', { lng: 'de' });
    assert.notEqual(englishLabel, germanLabel, 'the two catalogs word the cell alike, so this control proves nothing');
    const english = textOf(renderSection(module));
    await i18next.changeLanguage('de');
    const german = textOf(renderSection(module));
    assert.ok(!english.includes(germanLabel), 'the German label is on the English page');
    assert.ok(german.includes(germanLabel), 'the German label is not on the German page');
  });
});

describe('the page chrome', () => {
  it('draws the title, every section in the nav and the three controls', () => {
    const html = renderToString(createElement(PlaygroundApp));
    assert.ok(html.includes('openplate states'));
    for (const entry of SECTIONS) assert.ok(html.includes(entry.def.title), `nav lacks ${entry.def.title}`);
    for (const control of ['Theme', 'Language', 'Width']) assert.ok(html.includes(control), `no ${control} control`);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The address
////////////////////////////////////////////////////////////////////////////////

describe('the hash address', () => {
  it('reads a section, a group and a card', () => {
    assert.deepEqual(parseHash('#admin-people'), { section: 'admin-people', group: null, card: null });
    assert.deepEqual(parseHash('#admin-people:filters'), { section: 'admin-people', group: 'filters', card: null });
    assert.deepEqual(parseHash('#admin-people/people-mixed'), {
      section: 'admin-people',
      group: null,
      card: 'people-mixed',
    });
    assert.deepEqual(parseHash('#a:b/c'), { section: 'a', group: 'b', card: 'c' });
  });

  it('control: a hash outside the grammar names nothing', () => {
    for (const hash of ['', '#', '#Admin-People', '#a/b/c', '#a:b:c', '#a b']) {
      assert.deepEqual(parseHash(hash), { section: null, group: null, card: null }, JSON.stringify(hash));
    }
  });

  it('writes what it reads', () => {
    for (const hash of ['#admin-people', '#admin-people:filters', '#admin-people/people-mixed', '#a:b/c']) {
      assert.equal(formatHash(parseHash(hash)), hash);
    }
    assert.equal(formatHash({ section: null, group: 'x', card: 'y' }), '');
  });

  it('turns a group title into the slug its sub-page address uses', () => {
    assert.equal(groupSlug('Net carbs lead'), 'net-carbs-lead');
    assert.equal(groupSlug('Empty and failing'), 'empty-and-failing');
    assert.equal(groupSlug('  Odd -- title! '), 'odd-title');
  });
});
