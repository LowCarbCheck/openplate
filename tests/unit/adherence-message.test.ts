/**
 * Unit tests for `#app/lib/adherence-message` — the ONE builder behind the
 * adherence grid's tooltip, its caption row and each cell's `aria-label`.
 *
 * These resolve against the REAL shipped catalogs (English AND German) rather
 * than a key-echoing fake, because the defect they pin only exists in real
 * copy: a headline that legitimately ends in a period ("You logged something.")
 * met the '. ' that `trends.grid.aria.day` puts after it, and a screen reader
 * was told "You logged something.. Today, still going.". The fix is at the
 * join, so the assertions are on rendered sentences — a translator ending a
 * string with a period must stay correct copy, not a regression.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { describeAdherenceDay, type Translate } from '../../app/lib/adherence-message';
import { resolveAdherenceDay } from '../../app/models/adherence-grid';
import type { AdherenceDay, AdherenceDayTotal, AdherenceGoals, AdherenceMode } from '../../app/models/adherence-grid';

/** The fixture goals — all three configured. */
const GOALS: AdherenceGoals = { netCarbsCeilingG: 20, proteinFloorG: 100, kcalTarget: 1800 };

/** No goal configured at all, which is what puts the grid in `activity` mode. */
const NO_GOALS: AdherenceGoals = { netCarbsCeilingG: null, proteinFloorG: null, kcalTarget: null };

/** A nested i18next JSON catalog: leaves are copy strings, branches are namespaces. */
type TranslationCatalog = { [key: string]: string | TranslationCatalog };

const copyLeafSchema = z.string();

/** Flattens a catalog into `a.b.c` -> copy, which is how the app addresses keys. */
function flattenCatalog(node: TranslationCatalog, prefix: string, out: Map<string, string>): void {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const leaf = copyLeafSchema.safeParse(value);
    if (leaf.success) {
      out.set(path, leaf.data);
      continue;
    }
    // SAFETY: `value` is `string | TranslationCatalog` and the leaf parse just rejected the
    // string arm, so the only remaining member of the union is a nested branch.
    flattenCatalog(value as TranslationCatalog, path, out);
  }
}

/** A translator over the shipped catalog, with i18next's `{{name}}` interpolation. */
function translatorFor(language: 'en' | 'de'): Translate {
  const url = new URL(`../../app/i18n/locales/${language}/common.json`, import.meta.url);
  const catalog: TranslationCatalog = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  const copy = new Map<string, string>();
  flattenCatalog(catalog, '', copy);
  return (key, params) => {
    const value = copy.get(key);
    assert.ok(value !== undefined, `missing ${language} catalog key: ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params?.[name] ?? ''));
  };
}

const en = translatorFor('en');
const de = translatorFor('de');

/** A windowed day's totals; every macro defaults to null (nothing computable). */
function total(overrides: Partial<AdherenceDayTotal> = {}): AdherenceDayTotal {
  return { date: '2026-07-14', hasLogs: true, netCarbs: null, protein: null, kcal: null, ...overrides };
}

function resolve(day: AdherenceDayTotal, goals: AdherenceGoals, isToday: boolean): AdherenceDay {
  return resolveAdherenceDay({ total: day, goals, isToday, isFuture: false });
}

/** The accessible name for one day, in one language. */
function ariaLabelFor({
  day,
  goals,
  mode,
  t,
  language,
}: {
  day: AdherenceDay;
  goals: AdherenceGoals;
  mode: AdherenceMode;
  t: Translate;
  language: 'en' | 'de';
}): string {
  return describeAdherenceDay({ day, goals, mode, t, language }).ariaLabel;
}

describe('describeAdherenceDay — sentence joins', () => {
  it('does not double the period when a headline already ends in one and the today-note follows', () => {
    const day = resolve(total(), NO_GOALS, true);

    const label = ariaLabelFor({ day, goals: NO_GOALS, mode: 'activity', t: en, language: 'en' });

    assert.ok(!label.includes('..'), `doubled period in: ${label}`);
    assert.ok(label.includes('You logged something. Today, still going.'), label);
  });

  it('does not double the period in German either', () => {
    const day = resolve(total(), NO_GOALS, true);

    const label = ariaLabelFor({ day, goals: NO_GOALS, mode: 'activity', t: de, language: 'de' });

    assert.ok(!label.includes('..'), `doubled period in: ${label}`);
    assert.ok(label.includes('Du hast etwas eingetragen. Heute, läuft noch.'), label);
  });

  it('keeps a single separator after a headline that does NOT end in a period', () => {
    const day = resolve(total({ netCarbs: 18, protein: 112, kcal: 1740 }), GOALS, true);

    const label = ariaLabelFor({ day, goals: GOALS, mode: 'adherence', t: en, language: 'en' });

    assert.ok(!label.includes('..'), `doubled period in: ${label}`);
    assert.ok(label.includes('3 of 3 goals met. 18 g net carbs under 20 g, met'), label);
    assert.ok(label.endsWith('Today, still going.'), label);
  });

  it('normalises a period-terminated headline that carries no rows (unrated)', () => {
    const day = resolve(total(), GOALS, true);

    const label = ariaLabelFor({ day, goals: GOALS, mode: 'adherence', t: en, language: 'en' });

    assert.equal(day.status, 'unrated');
    assert.ok(!label.includes('..'), `doubled period in: ${label}`);
    assert.ok(label.includes('check your goals. Today, still going.'), label);
  });

  it('leaves no dangling separator on a note-less day', () => {
    const day = resolve(total(), NO_GOALS, false);

    const label = ariaLabelFor({ day, goals: NO_GOALS, mode: 'activity', t: en, language: 'en' });

    assert.equal(label, 'Tue 14 Jul: You logged something.');
  });

  it('leaves no dangling separator on a note-less rated day', () => {
    const day = resolve(total({ netCarbs: 18, protein: 112, kcal: 1740 }), GOALS, false);

    const label = ariaLabelFor({ day, goals: GOALS, mode: 'adherence', t: en, language: 'en' });

    assert.ok(!label.includes('..'), `doubled period in: ${label}`);
    assert.ok(label.endsWith('1,740 calories under 1,800, met'), label);
  });

  it('uses the no-data headline verbatim, so the date is never said twice', () => {
    const day = resolve(total({ hasLogs: false }), GOALS, false);

    const label = ariaLabelFor({ day, goals: GOALS, mode: 'adherence', t: en, language: 'en' });

    assert.equal(label, 'Tue 14 Jul: nothing logged');
  });
});
