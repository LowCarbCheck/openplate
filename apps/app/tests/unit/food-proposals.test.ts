/**
 * Food proposals to LowCarbCheck (M251 spec 04).
 *
 * Every claim below has a control that goes red:
 *   1. The switch defaults off and needs the key: `FOOD_DB_BACKFILL=true`
 *      without a key stays off.
 *   2. The skip rule LowCarbCheck imposes: a `new` proposal without an English
 *      name or without all four macros is not built.
 *   3. A food without translations (typed or renamed by hand) is never
 *      proposed.
 *   4. The forwarded body carries the FoodProposal keys and nothing else, and
 *      an item carrying an identifier never reaches it.
 *   5. The relay retries once for weather and never for a refusal.
 *   6. A LowCarbCheck row with origin `proposal` is stored as an estimate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithZod } from '@conform-to/zod/v4';

import { parseFoodDbConfig, resolveFoodDbBackfill } from '../../app/config';
import {
  MAX_FOOD_PROPOSALS_PER_REQUEST,
  buildFoodProposal,
  parseFoodProposalBatch,
  toWireProposal,
  type FoodProposal,
} from '../../app/services/food-db/proposals';
import { forwardFoodProposals, type ProposalFetch } from '../../app/services/food-db/proposals.server';
import { buildConfirmedProposals } from '../../app/lib/food-proposals-client';
import { isEstimatedFoodOrigin } from '../../app/services/food-resolution/apply-match';
import { carbBasisForOrigin } from '../../app/lib/net-carbs';
import { localCuratedMatchToCandidate } from '../../app/lib/local-store/local-quick-add';
import { ConfirmDraftSchema, buildConfirmedBatch } from '../../app/routes/add.photo';
import type { FoodMatch } from '../../app/services/food-resolution';

const NAMES = { en: 'Kale bowl', de: 'Grünkohlschale', fr: 'Bol de chou kale', it: 'Ciotola di cavolo', es: 'Bol de col rizada', tr: 'Kara lahana kasesi' };
const MACROS = { carbs: 6, fat: 4, protein: 8, kcal: 95, fiber: 2 };

describe('FOOD_DB_BACKFILL', () => {
  it('is on with true, the integration on and a key', () => {
    assert.equal(resolveFoodDbBackfill({ raw: 'true', isEnabled: true, apiKey: 'lcc_live_x' }), true);
    assert.equal(parseFoodDbConfig({ apiUrl: undefined, apiKey: 'lcc_live_x', backfill: 'TRUE' }).backfill, true);
  });

  it('control: true WITHOUT a key stays off, and so do unset, false and a disabled integration', () => {
    assert.equal(resolveFoodDbBackfill({ raw: 'true', isEnabled: true, apiKey: null }), false);
    assert.equal(parseFoodDbConfig({ apiUrl: 'https://lcc.test', apiKey: undefined, backfill: 'true' }).backfill, false);
    assert.equal(parseFoodDbConfig({ apiUrl: 'https://lcc.test', apiKey: 'lcc_live_x', backfill: undefined }).backfill, false);
    assert.equal(parseFoodDbConfig({ apiUrl: 'https://lcc.test', apiKey: 'lcc_live_x', backfill: 'false' }).backfill, false);
    assert.equal(parseFoodDbConfig({ apiUrl: '', apiKey: 'lcc_live_x', backfill: 'true' }).backfill, false);
  });

  it('stops the boot on a word that is neither true nor false', () => {
    assert.throws(() => resolveFoodDbBackfill({ raw: 'ture', isEnabled: true, apiKey: 'k' }), /FOOD_DB_BACKFILL/);
  });
});

/** The builder's input for an unmatched, fully named, fully measured food. */
function newFoodInput(overrides: Partial<Parameters<typeof buildFoodProposal>[0]> = {}) {
  return {
    nameTranslations: NAMES,
    adoptedSlug: null,
    macrosPer100g: MACROS,
    carbBasis: undefined,
    via: 'photo' as const,
    ...overrides,
  };
}

describe('the skip rule', () => {
  it('builds a new proposal with an English name and all four macros', () => {
    assert.deepEqual(buildFoodProposal(newFoodInput()), {
      kind: 'new',
      translations: NAMES,
      macrosPer100g: MACROS,
      via: 'photo',
    });
  });

  it('control: skips a new proposal without an English name', () => {
    const { en: _dropped, ...withoutEnglish } = NAMES;
    assert.equal(buildFoodProposal(newFoodInput({ nameTranslations: withoutEnglish })), null);
  });

  it('control: skips a new proposal without all four macros, or with one out of range', () => {
    assert.equal(buildFoodProposal(newFoodInput({ macrosPer100g: { ...MACROS, fat: null } })), null);
    assert.equal(buildFoodProposal(newFoodInput({ macrosPer100g: { ...MACROS, kcal: null } })), null);
    assert.equal(buildFoodProposal(newFoodInput({ macrosPer100g: { ...MACROS, carbs: 140 } })), null);
  });

  it('builds a translate for an adopted row, with no macros and without needing English', () => {
    const { en: _dropped, ...withoutEnglish } = NAMES;
    assert.deepEqual(buildFoodProposal(newFoodInput({ adoptedSlug: 'kale-bowl', nameTranslations: withoutEnglish })), {
      kind: 'translate',
      slug: 'kale-bowl',
      translations: withoutEnglish,
      via: 'photo',
    });
  });

  it('sends the carb basis only when it is total', () => {
    assert.equal(buildFoodProposal(newFoodInput({ carbBasis: 'total' }))?.carbBasis, 'total');
    assert.equal(buildFoodProposal(newFoodInput({ carbBasis: 'available' }))?.carbBasis, undefined);
  });
});

describe('a name the person typed is never proposed', () => {
  it('a food with no translations builds nothing, a food with them builds one (the control)', () => {
    assert.equal(buildFoodProposal(newFoodInput({ nameTranslations: undefined })), null);
    assert.notEqual(buildFoodProposal(newFoodInput()), null);
  });

  it('fewer than two names after the length cap build nothing', () => {
    const long = 'x'.repeat(81);
    const onlyEnglishSurvives = { en: 'Kale bowl', de: long, fr: long, it: long, es: long, tr: long };
    assert.equal(buildFoodProposal(newFoodInput({ nameTranslations: onlyEnglishSurvives })), null);
  });

  it('a confirmed scan proposes its untouched items and skips a renamed one', () => {
    const proposals = buildConfirmedProposals({
      intakeSource: 'speech',
      items: [
        { entry: { nameTranslations: NAMES }, curatedSource: undefined, macrosPer100g: MACROS },
        { entry: {}, curatedSource: undefined, macrosPer100g: MACROS },
        { entry: { nameTranslations: NAMES }, curatedSource: 'lowcarbcheck:kale-bowl', macrosPer100g: MACROS },
      ],
    });
    assert.deepEqual(
      proposals.map((proposal) => [proposal.kind, proposal.via]),
      [
        ['new', 'text'],
        ['translate', 'text'],
      ],
    );
  });
});

/** Every key a proposal may carry. Adding a key to the wire shape must change this line on purpose. */
const WIRE_KEYS = new Set(['carbBasis', 'kind', 'macrosPer100g', 'slug', 'translations', 'via']);

/** A fetch that records every call and answers with the given statuses in turn. */
function recordingFetch(statuses: readonly (number | 'network')[]) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const fetchImpl: ProposalFetch = async (url, init) => {
    // SAFETY: `forwardFoodProposals` always passes a `Headers` and a string body.
    calls.push({ url, headers: init.headers as Headers, body: init.body as string });
    const status = statuses[calls.length - 1] ?? 202;
    if (status === 'network') throw new TypeError('fetch failed');
    return new Response(null, { status });
  };
  return { calls, fetchImpl };
}

describe('the forwarded body', () => {
  it('holds the FoodProposal keys and nothing else', async () => {
    const parsed = [
      ...parseFoodProposalBatch({
        proposals: [{ kind: 'new', translations: NAMES, macrosPer100g: MACROS, carbBasis: 'total', via: 'photo' }],
      }),
      ...parseFoodProposalBatch({ proposals: [{ kind: 'translate', slug: 'kale-bowl', translations: NAMES, via: 'text' }] }),
    ];
    const { calls, fetchImpl } = recordingFetch([202]);
    await forwardFoodProposals({ proposals: parsed, apiUrl: 'https://lcc.test', apiKey: 'k', fetchImpl });
    const sent = JSON.parse(calls[0]?.body ?? '{}');
    assert.deepEqual(Object.keys(sent), ['proposals']);
    for (const proposal of sent.proposals) {
      for (const key of Object.keys(proposal)) assert.ok(WIRE_KEYS.has(key), `the forwarded proposal carries ${key}`);
    }
    assert.deepEqual(Object.keys(sent.proposals[0]).toSorted(), ['carbBasis', 'kind', 'macrosPer100g', 'translations', 'via']);
    assert.deepEqual(Object.keys(sent.proposals[1]).toSorted(), ['kind', 'slug', 'translations', 'via']);
  });

  it('control: an item carrying an identifier never reaches the upstream', () => {
    const forwarded = parseFoodProposalBatch({
      proposals: [
        { kind: 'new', translations: NAMES, macrosPer100g: MACROS, via: 'photo', logId: 'log-1' },
        { kind: 'new', translations: NAMES, macrosPer100g: { ...MACROS, accountId: 7 }, via: 'photo' },
        { kind: 'new', translations: { ...NAMES, nl: 'Boerenkool' }, macrosPer100g: MACROS, via: 'photo' },
      ],
    });
    assert.deepEqual(forwarded, []);
    assert.ok(!JSON.stringify(forwarded).includes('log-1'));
  });

  it('toWireProposal copies nothing past the wire keys', () => {
    // SAFETY: the extra key is the point: it stands for a field that reached a proposal by accident.
    const leaky = { kind: 'new', translations: NAMES, macrosPer100g: MACROS, via: 'photo', accountId: 7 } as FoodProposal;
    assert.deepEqual(Object.keys(toWireProposal(leaky)).toSorted(), ['kind', 'macrosPer100g', 'translations', 'via']);
  });

  it('caps a batch at the limit and drops what LowCarbCheck would refuse', () => {
    const one = { kind: 'new', translations: NAMES, macrosPer100g: MACROS, via: 'photo' };
    const batch = parseFoodProposalBatch({ proposals: [...Array.from({ length: 25 }, () => one), { kind: 'translate', translations: NAMES, via: 'photo' }] });
    assert.equal(batch.length, MAX_FOOD_PROPOSALS_PER_REQUEST);
  });
});

describe('the relay', () => {
  const proposals = parseFoodProposalBatch({ proposals: [{ kind: 'translate', slug: 'kale-bowl', translations: NAMES, via: 'photo' }] });

  it('posts to the proposal endpoint with the key and no browser Origin', async () => {
    const { calls, fetchImpl } = recordingFetch([202]);
    assert.equal(await forwardFoodProposals({ proposals, apiUrl: 'https://lcc.test', apiKey: 'lcc_live_abc', fetchImpl }), 'accepted');
    assert.equal(calls[0]?.url, 'https://lcc.test/api/v1/foods/proposals');
    assert.equal(calls[0]?.headers.get('authorization'), 'Bearer lcc_live_abc');
    assert.equal(calls[0]?.headers.get('origin'), null);
  });

  it('retries once on a server error, and on a network failure', async () => {
    const serverError = recordingFetch([503, 202]);
    assert.equal(await forwardFoodProposals({ proposals, apiUrl: 'https://lcc.test', apiKey: 'k', fetchImpl: serverError.fetchImpl }), 'accepted');
    assert.equal(serverError.calls.length, 2);
    const down = recordingFetch(['network', 'network', 'network']);
    assert.equal(await forwardFoodProposals({ proposals, apiUrl: 'https://lcc.test', apiKey: 'k', fetchImpl: down.fetchImpl }), 'failed');
    assert.equal(down.calls.length, 2, 'one retry at most');
  });

  it('control: never retries a refusal', async () => {
    const refused = recordingFetch([400, 202]);
    assert.equal(await forwardFoodProposals({ proposals, apiUrl: 'https://lcc.test', apiKey: 'k', fetchImpl: refused.fetchImpl }), 'refused');
    assert.equal(refused.calls.length, 1);
  });
});

/** A LowCarbCheck row, with its origin as the one variable. */
function match(origin: string): FoodMatch {
  return {
    slug: 'kale-bowl',
    locale: 'en',
    title: 'Kale bowl',
    canonicalName: 'Kale bowl',
    url: null,
    imageUrl: null,
    macrosPer100g: { kcal: 95, protein: 8, fat: 4, carbs: 6, fiber: 2, sugars: 1, polyols: null },
    netCarbsPer100g: 4,
    attribution: 'Estimated values, LowCarbCheck',
    score: 0.95,
    origin,
    portionSize: null,
  };
}

/** One confirmed plate item with an adopted row, parsed by the real schema, built into rows. */
function confirmedEntry(matchIsEstimate: 'true' | 'false') {
  const formData = new FormData();
  formData.set('items[0].include', 'on');
  formData.set('items[0].name', 'Kale bowl');
  formData.set('items[0].estimatedGrams', '100');
  formData.set('items[0].macros.carbs', '6');
  formData.set('items[0].curatedSource', 'lowcarbcheck:kale-bowl');
  formData.set('items[0].matchIsEstimate', matchIsEstimate);
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  if (submission.status !== 'success') throw new Error('the confirm schema refused the submission');
  const [pair] = buildConfirmedBatch({
    items: submission.value.items,
    mealType: null,
    loggedAtMs: 0,
    dayKey: '2026-09-23',
    createdAtMs: 0,
    logBatchId: 'b',
    newId: () => 'id',
  });
  if (pair === undefined) throw new Error('no row');
  return pair.entry;
}

describe('origin proposal is an estimate, never a curated source', () => {
  it('reads as an estimate, on the total basis', () => {
    assert.equal(isEstimatedFoodOrigin('proposal'), true);
    assert.equal(isEstimatedFoodOrigin('curated'), false);
    assert.equal(carbBasisForOrigin('proposal'), 'total');
  });

  it('an adopted proposal row logs as estimated with no curated source; a curated row (the control) does not', () => {
    const estimated = confirmedEntry('true');
    assert.equal(estimated.aiEstimated, true);
    assert.equal(estimated.curatedSource, null);
    const curated = confirmedEntry('false');
    assert.equal(curated.aiEstimated, false);
    assert.equal(curated.curatedSource, 'lowcarbcheck:kale-bowl');
  });

  it('a search candidate from a proposal row is estimated; a curated one (the control) is not', () => {
    const fromProposal = localCuratedMatchToCandidate(match('proposal'));
    assert.equal(fromProposal.aiEstimated, true);
    assert.equal(fromProposal.curatedSource, null);
    const fromCurated = localCuratedMatchToCandidate(match('curated'));
    assert.equal(fromCurated.aiEstimated, false);
    assert.equal(fromCurated.curatedSource, 'lowcarbcheck:kale-bowl');
  });
});
