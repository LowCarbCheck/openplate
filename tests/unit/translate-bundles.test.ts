/**
 * The app's own decisions in the UI translation pipeline: which namespace speaks in which voice,
 * and a memory keyed by path and English rather than by English alone. The library underneath is
 * the website's, tested there; nothing here calls it across the network.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * The bundle cases name a namespace that is NOT legal beside the one that is. The keying cases
 * assert two keys with the same English get two entries, and then that the same key with an edited
 * English gets a new one, so the property is "path and English", not "path" and not "English".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { type Unit } from '../../scripts/lib/translate-shims/docs-i18n.server';
import { type Usage, style } from '../../scripts/lib/translate';
import { type CatalogTree, type TranslateFn, bundleForNamespace } from '../../scripts/lib/translate-ui';
import {
  buyByBundle,
  collectByPath,
  groupByBundle,
  memoAt,
  pathOf,
  rebuildByPath,
  unitKey,
} from '../../scripts/lib/translate-bundles';

const ENGLISH: CatalogTree = {
  nav: { fasting: 'Fasting' },
  fasting: { active: { eyebrow: 'Fasting' }, plan: { year: '2026', name: 'openplate' } },
  errors: { tryAgain: 'Try again' },
};

/** The German as a person wrote it: the same English word, two jobs, two words. */
const GERMAN: CatalogTree = {
  nav: { fasting: 'Fasten' },
  fasting: { active: { eyebrow: 'Fasten läuft' }, plan: { year: '2026', name: 'openplate' } },
  errors: { tryAgain: 'Nochmal versuchen' },
};

describe('the bundles', () => {
  it('puts legal in the formal bundle and everything else in the other', () => {
    assert.equal(bundleForNamespace('legal'), 'legal');
    assert.equal(bundleForNamespace('common'), 'common');
    assert.equal(bundleForNamespace('settings'), 'common');
  });

  it('groups namespaces by bundle, keeping the order given and omitting an empty bundle', () => {
    assert.deepEqual(
      [...groupByBundle(['common', 'legal', 'settings'])],
      [
        ['common', ['common', 'settings']],
        ['legal', ['legal']],
      ],
    );
    assert.deepEqual([...groupByBundle(['common'])], [['common', ['common']]]);
  });
});

describe('the memory key', () => {
  it('gives two keys holding the same English two entries', () => {
    const units = collectByPath('common', ENGLISH);
    const fasting = units.filter((unit) => unit.source === 'Fasting');
    assert.equal(fasting.length, 2);
    assert.notEqual(fasting[0]?.hash, fasting[1]?.hash);
    assert.deepEqual(
      fasting.map((unit) => unit.key),
      ['common:nav.fasting', 'common:fasting.active.eyebrow'],
    );
  });

  it('changes when the English under a path changes, and only then', () => {
    const path = pathOf('common', 'nav.fasting');
    assert.equal(unitKey(path, 'Fasting'), unitKey(path, 'Fasting'));
    assert.notEqual(unitKey(path, 'Fasting'), unitKey(path, 'Fasting now'));
    assert.notEqual(unitKey(path, 'Fasting'), unitKey(pathOf('legal', 'nav.fasting'), 'Fasting'));
  });

  it('leaves a name and a number out, and keeps the prose', () => {
    const keys = new Set(collectByPath('common', ENGLISH).map((unit) => unit.leaf));
    assert.ok(!keys.has('fasting.plan.year'));
    assert.ok(!keys.has('fasting.plan.name'));
    assert.ok(keys.has('errors.tryAgain'));
  });

  it('remembers the path beside the English, so a person can find the entry', () => {
    const [unit] = collectByPath('common', ENGLISH);
    assert.ok(unit !== undefined);
    const entry = memoAt({ unit, target: 'Fasten', locale: 'de', at: '2026-09-14', model: 'hand-written' });
    assert.equal(entry.path, 'common:nav.fasting');
    assert.equal(entry.en, 'Fasting');
    assert.equal(entry.de, 'Fasten');
    assert.equal(entry.model, 'hand-written');
  });
});

describe('the rebuild', () => {
  /** The memory a `--adopt` over GERMAN produces. */
  function adopted(): Map<string, string> {
    const done = new Map<string, string>();
    const held = new Map<string, string>([
      ['nav.fasting', 'Fasten'],
      ['fasting.active.eyebrow', 'Fasten läuft'],
      ['errors.tryAgain', 'Nochmal versuchen'],
    ]);
    for (const unit of collectByPath('common', ENGLISH)) {
      const value = held.get(unit.leaf);
      if (value !== undefined) done.set(unit.hash, value);
    }
    return done;
  }

  it('gives every key back its own German, which the English-keyed rebuild could not', () => {
    assert.deepEqual(rebuildByPath('common', ENGLISH, adopted(), GERMAN), GERMAN);
  });

  it('answers an edited English string from the memory once it is bought, and from the held value until then', () => {
    const edited: CatalogTree = { ...ENGLISH, errors: { tryAgain: 'Try once more' } };
    const done = adopted();
    assert.deepEqual(rebuildByPath('common', edited, done, GERMAN).errors, { tryAgain: 'Nochmal versuchen' });

    done.set(unitKey(pathOf('common', 'errors.tryAgain'), 'Try once more'), 'Noch einmal versuchen');
    assert.deepEqual(rebuildByPath('common', edited, done, GERMAN).errors, { tryAgain: 'Noch einmal versuchen' });
  });

  it('carries a brand new key across as its English, in the English order, and drops a key that left', () => {
    const grown: CatalogTree = { intro: { hello: 'Hello there' }, nav: { fasting: 'Fasting' } };
    const rebuilt = rebuildByPath('common', grown, adopted(), GERMAN);
    assert.deepEqual(Object.keys(rebuilt), ['intro', 'nav']);
    assert.deepEqual(rebuilt, { intro: { hello: 'Hello there' }, nav: { fasting: 'Fasten' } });
  });
});

describe('the buy loop, through the library seam', () => {
  /** A stub in place of the network: records what it was asked, answers with a marked copy of the source. */
  interface Call {
    bundle: string;
    locale: string;
    sources: string[];
  }
  interface Seam {
    calls: Call[];
    fn: TranslateFn;
  }
  function stub(): Seam {
    const calls: Call[] = [];
    return {
      calls,
      fn: (units: Unit[], locale: string, bundle: string, _key: string, total: Usage) => {
        calls.push({ bundle, locale, sources: units.map((unit) => unit.source) });
        total.cost += 0.001;
        return Promise.resolve(units.map((unit) => `[${bundle}] ${unit.source}`));
      },
    };
  }

  const LEGAL_INTRO = 'Information required under the German Digital Services Act.';
  const LEGAL: CatalogTree = { imprint: { intro: LEGAL_INTRO } };

  function pendingOf(): Map<string, ReturnType<typeof collectByPath>> {
    return new Map([
      ['common', collectByPath('common', ENGLISH)],
      ['legal', collectByPath('legal', LEGAL)],
    ]);
  }

  it('asks once per bundle, common then legal, never both in one request', async () => {
    const seam = stub();
    const done = new Map<string, string>();
    const reports: string[] = [];
    const outcome = await buyByBundle(pendingOf(), {
      locale: 'de',
      key: 'not-a-key',
      done,
      total: { prompt_tokens: 0, completion_tokens: 0, cost: 0 },
      notes: [],
      translateFn: seam.fn,
      afterChunk: ({ bundle, at, of }) => {
        reports.push(`${bundle} ${at}/${of}`);
        return 'continue';
      },
    });
    assert.equal(outcome, 'done');
    assert.deepEqual(
      seam.calls.map((call) => call.bundle),
      ['common', 'legal'],
    );
    assert.deepEqual(seam.calls[1]?.sources, [LEGAL_INTRO]);
    assert.equal(seam.calls[0]?.locale, 'de');
    assert.deepEqual(reports, ['common 1/1', 'legal 1/1']);
    assert.equal(done.get(unitKey(pathOf('legal', 'imprint.intro'), LEGAL_INTRO)), `[legal] ${LEGAL_INTRO}`);
    assert.equal(done.size, 4);
  });

  it('skips a bundle with nothing pending, so a quiet legal catalog costs no request', async () => {
    const seam = stub();
    const pending = pendingOf();
    pending.set('legal', []);
    await buyByBundle(pending, {
      locale: 'de',
      key: 'not-a-key',
      done: new Map(),
      total: { prompt_tokens: 0, completion_tokens: 0, cost: 0 },
      notes: [],
      translateFn: seam.fn,
      afterChunk: () => 'continue',
    });
    assert.deepEqual(
      seam.calls.map((call) => call.bundle),
      ['common'],
    );
  });

  it('stops when the caller says so, and keeps what the stopped-after chunk bought', async () => {
    const seam = stub();
    const done = new Map<string, string>();
    const outcome = await buyByBundle(pendingOf(), {
      locale: 'de',
      key: 'not-a-key',
      done,
      total: { prompt_tokens: 0, completion_tokens: 0, cost: 0 },
      notes: [],
      translateFn: seam.fn,
      afterChunk: () => 'stop',
    });
    assert.equal(outcome, 'stopped');
    assert.deepEqual(
      seam.calls.map((call) => call.bundle),
      ['common'],
    );
    assert.equal(done.size, 3);
  });

  it('asks the legal bundle for the formal register and the common bundle for the informal one', () => {
    const legal = style('de', 'legal');
    const common = style('de', 'common');
    assert.match(legal, /address the reader as "Sie"/);
    assert.doesNotMatch(legal, /address the reader as "du"/);
    assert.match(common, /address the reader as "du"/);
    assert.doesNotMatch(common, /address the reader as "Sie"/);
  });
});
