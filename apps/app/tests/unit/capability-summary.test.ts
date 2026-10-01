/**
 * The settings line that says what a connected server does not do
 * (`capability-summary.ts` and `provider-capability-summary.tsx`).
 *
 * Two facts. The line is built from KEYS, one per shortfall, so a translator
 * owns every clause; and the box it sits in is the same box whether or not
 * there is a line, so the page under it never moves.
 *
 * Every assertion has a control: the narrowed answer against the full one, and
 * each key against the shipped English catalog, so a renamed key fails here
 * and does not ship as a raw `settingsAi.capabilities.tasks`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { z } from 'zod';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CAPABILITY_LEAD_KEY,
  CAPABILITY_TASKS_KEY,
  capabilityTaskKey,
  summarizeCapabilities,
} from '../../app/lib/ai/capability-summary';
import {
  FLAGS_CAPABILITY_VALUES,
  FULL_PROVIDER_CAPABILITIES,
  PROVIDER_TASKS,
  TRANSLATIONS_CAPABILITY_VALUES,
  type ProviderCapabilities,
} from '../../app/lib/ai/provider-capabilities';
import { ProviderCapabilitySummary } from '../../app/components/settings/provider-capability-summary';
import { withI18n } from './trends-i18n-harness';

const CATALOG: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8'),
);

/** A catalog branch: any object whose values are read one key at a time. */
const branchSchema = z.record(z.string(), z.unknown());

/** The catalog string at a dotted key, or `undefined` when the path leads nowhere. */
function lookup(key: string): string | undefined {
  let node: unknown = CATALOG;
  for (const part of key.split('.')) {
    const branch = branchSchema.safeParse(node);
    if (!branch.success) return undefined;
    node = branch.data[part];
  }
  const leaf = z.string().safeParse(node);
  return leaf.success ? leaf.data : undefined;
}

/** An en dash or an em dash, written as escapes so this file carries neither. */
const DASHES = new RegExp('[\\u2013\\u2014]', 'u');

/** What a plate-only server sends, the case this line exists for. */
const PLATE_ONLY: ProviderCapabilities = {
  tasks: { plateImage: true, describe: false, pantryImage: false, pantryText: false, recipes: false },
  flags: 'partial',
  translations: 'request-language',
  labels: true,
};

describe('summarizeCapabilities', () => {
  it('says nothing for a server with nothing missing', () => {
    assert.equal(summarizeCapabilities(FULL_PROVIDER_CAPABILITIES), null);
  });

  it('names the missing tasks in task order and one sentence per other shortfall', () => {
    assert.deepEqual(summarizeCapabilities(PLATE_ONLY), {
      tasks: ['describe', 'pantryImage', 'pantryText', 'recipes'],
      sentenceKeys: ['settingsAi.capabilities.flagsPartial', 'settingsAi.capabilities.translationsRequestLanguage'],
    });
  });

  it('tells a partial answer from none at all, which is the control for the level', () => {
    const none = summarizeCapabilities({
      ...FULL_PROVIDER_CAPABILITIES,
      flags: 'none',
      translations: 'none',
      labels: false,
    });
    assert.deepEqual(none?.sentenceKeys, [
      'settingsAi.capabilities.flagsNone',
      'settingsAi.capabilities.translationsNone',
      'settingsAi.capabilities.labelsNone',
    ]);
    assert.deepEqual(none?.tasks, []);
  });

  it('has a sentence in the shipped catalog for every key it can answer', () => {
    const everyKey = new Set<string>([CAPABILITY_LEAD_KEY, CAPABILITY_TASKS_KEY]);
    for (const task of PROVIDER_TASKS) everyKey.add(capabilityTaskKey(task));
    for (const flags of FLAGS_CAPABILITY_VALUES) {
      for (const translations of TRANSLATIONS_CAPABILITY_VALUES) {
        for (const labels of [true, false]) {
          const summary = summarizeCapabilities({ ...FULL_PROVIDER_CAPABILITIES, flags, translations, labels });
          for (const key of summary?.sentenceKeys ?? []) everyKey.add(key);
        }
      }
    }
    for (const key of everyKey) assert.notEqual(lookup(key), undefined, `${key} is not in the English catalog`);
    // The control: the lookup can fail.
    assert.equal(lookup('settingsAi.capabilities.notAKey'), undefined);
  });
});

function render(capabilities: ProviderCapabilities): string {
  return renderToStaticMarkup(withI18n(createElement(ProviderCapabilitySummary, { capabilities })));
}
const slotClass = (markup: string): string =>
  /<div data-slot="provider-capability-summary" class="([^"]*)"/u.exec(markup)?.[1] ?? '';

describe('the line and its box', () => {
  it('opens with the tasks sentence, the missing tasks as one list, then the other sentences', () => {
    const markup = render(PLATE_ONLY);
    // The four tasks are formatted into ONE list by the i18n layer, not joined here.
    for (const task of ['describe', 'pantryImage', 'pantryText', 'recipes'] as const) {
      assert.ok(markup.includes(lookup(capabilityTaskKey(task)) ?? 'MISSING'), `${task} is not named`);
    }
    // The task that runs is not named as missing, which is the control for the four above.
    assert.ok(
      !markup.includes(lookup(capabilityTaskKey('plateImage')) ?? 'MISSING'),
      'plate photos are named as missing',
    );
    assert.ok(markup.includes(lookup('settingsAi.capabilities.flagsPartial') ?? 'MISSING'));
    // The lead only stands in when no task is missing, so it is not in front of the tasks sentence.
    assert.ok(!markup.includes(lookup(CAPABILITY_LEAD_KEY) ?? 'MISSING'), 'the lead is drawn in front of the tasks');
  });

  it('opens with the lead when every task runs and the server falls short elsewhere', () => {
    const markup = render({ ...FULL_PROVIDER_CAPABILITIES, labels: false });
    assert.ok(markup.includes(lookup(CAPABILITY_LEAD_KEY) ?? 'MISSING'), 'the lead is not drawn');
    assert.ok(markup.includes(lookup('settingsAi.capabilities.labelsNone') ?? 'MISSING'));
    // The control: no task sentence, because no task is missing.
    assert.ok(!markup.includes(lookup(capabilityTaskKey('describe')) ?? 'MISSING'));
  });

  it('draws no line for a full server, and the same box either way', () => {
    const full = render(FULL_PROVIDER_CAPABILITIES);
    assert.ok(!full.includes('<p>'), 'a full server gets a line');
    assert.ok(render(PLATE_ONLY).includes('<p>'), 'a short server gets no line');
    assert.match(slotClass(full), /\bmin-h-20\b/, 'the box holds no height');
    assert.equal(slotClass(full), slotClass(render(PLATE_ONLY)), 'the box differs between the two');
  });

  it('does not use a dash anywhere in the shipped sentences', () => {
    // The control: the pattern can fail, against an em dash written as an escape.
    assert.ok(DASHES.test('a\u2014b'));
    for (const key of [CAPABILITY_LEAD_KEY, CAPABILITY_TASKS_KEY, 'settingsAi.capabilities.flagsPartial']) {
      assert.ok(!DASHES.test(lookup(key) ?? ''), `${key} carries a dash`);
    }
  });
});
