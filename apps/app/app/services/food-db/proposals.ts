/**
 * A food proposal to LowCarbCheck (M251 spec 04, LowCarbCheck M205 spec 01).
 *
 * ── What a proposal is ───────────────────────────────────────────────────
 *
 * When LowCarbCheck is this instance's food database and the operator turned
 * backfill on (`FOOD_DB_BACKFILL`), every AI-named food a person saves is
 * offered to LowCarbCheck, which judges it with a model on arrival and
 * publishes what passes:
 *
 *  - `translate`: the person adopted a LowCarbCheck row, and the proposal
 *    carries that row's slug and the model's name for the food in every app
 *    language, so the row gains the titles it lacks.
 *  - `new`: nothing was adopted, and the proposal carries the names and the
 *    macros per 100 g, so LowCarbCheck can add the food.
 *
 * ── THE WIRE SHAPE IS SHARED ─────────────────────────────────────────────
 *
 * LowCarbCheck's `apps/remix-lcc/app/lib/food-proposals/schema.ts` parses the
 * same object with STRICT schemas: an unknown key is a 400 for the whole
 * batch. Change one side and change the other, in the same week.
 *
 * ── NOTHING THAT NAMES A PERSON ──────────────────────────────────────────
 *
 * No account id, no log id, no photo, no free text other than the names.
 * {@link toWireProposal} rebuilds every object key by key, so a field that
 * reaches a proposal by accident is dropped rather than forwarded, and the
 * unit test asserts the exact key set.
 *
 * Pure and browser-safe: the page builds proposals, the server re-parses and
 * forwards them (`./proposals.server`).
 */
import { z } from 'zod';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '#app/i18n/language-prefs';
import type { CarbBasis } from '#app/lib/net-carbs';
import type { FoodTranslations } from '#app/services/vision/translations';

/** A batch holds at most this many proposals; LowCarbCheck refuses a longer one whole. */
export const MAX_FOOD_PROPOSALS_PER_REQUEST = 20;

/** A name longer than this is left out of a proposal, never cut: a cut name is a wrong name. */
export const MAX_FOOD_PROPOSAL_NAME_LENGTH = 80;

/** A proposal with fewer names than this carries no translation worth judging. */
export const MIN_FOOD_PROPOSAL_NAMES = 2;

/** How the food reached the diary. `pantry` is on the wire for LowCarbCheck's sake; see {@link buildFoodProposal}. */
export const FOOD_PROPOSAL_VIAS = ['photo', 'text', 'pantry'] as const;
export type FoodProposalVia = (typeof FOOD_PROPOSAL_VIAS)[number];

/** A name as LowCarbCheck accepts it: trimmed, whitespace collapsed, 1 to 80 characters. */
const proposalNameSchema = z
  .string()
  .transform((value) => value.replaceAll(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(MAX_FOOD_PROPOSAL_NAME_LENGTH));

/** One optional name per app language; strict, so a key LowCarbCheck would refuse is refused here first. */
const translationsSchema = z
  .object(Object.fromEntries(SUPPORTED_LANGUAGES.map((code) => [code, proposalNameSchema.optional()])))
  .strict()
  .refine((translations) => Object.values(translations).filter((name) => name !== undefined).length >= MIN_FOOD_PROPOSAL_NAMES, {
    message: `A proposal needs at least ${MIN_FOOD_PROPOSAL_NAMES} names.`,
  });

/** Grams per 100 g never exceed 100; energy per 100 g never exceeds pure fat's 900 kcal. */
const gramsPer100g = z.number().finite().min(0).max(100);

const macrosSchema = z
  .object({
    carbs: gramsPer100g,
    fat: gramsPer100g,
    protein: gramsPer100g,
    kcal: z.number().finite().min(0).max(900),
    fiber: gramsPer100g.optional(),
  })
  .strict();

/**
 * THE WIRE SHAPE, as the openplate server re-parses what the page sent. The
 * same rules LowCarbCheck applies, so an item it would refuse is dropped here
 * and cannot take the rest of the batch down with it.
 */
export const FoodProposalSchema = z
  .object({
    kind: z.enum(['new', 'translate']),
    slug: z.string().trim().min(1).max(255).optional(),
    translations: translationsSchema,
    macrosPer100g: macrosSchema.optional(),
    carbBasis: z.enum(['net', 'total']).optional(),
    via: z.enum(FOOD_PROPOSAL_VIAS),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.kind === 'translate' && proposal.slug === undefined) {
      context.addIssue({ code: 'custom', path: ['slug'], message: 'A translate proposal needs the slug.' });
    }
    if (proposal.kind === 'new' && proposal.translations.en === undefined) {
      context.addIssue({ code: 'custom', path: ['translations', 'en'], message: 'A new food needs its English name.' });
    }
    if (proposal.kind === 'new' && proposal.macrosPer100g === undefined) {
      context.addIssue({ code: 'custom', path: ['macrosPer100g'], message: 'A new food needs its macros per 100 g.' });
    }
  });

export type FoodProposal = z.infer<typeof FoodProposalSchema>;

/** The macros a proposal carries: the four LowCarbCheck needs, and fibre when it is known. */
export interface FoodProposalMacros {
  carbs: number;
  fat: number;
  protein: number;
  kcal: number;
  fiber?: number;
}

/**
 * The proposal one saved food becomes, or `null` for none.
 *
 * NONE when the food carries no translations: a hand-typed name, and a name
 * the person edited, never has any (M251/03), so this is also the rule that
 * their own words are never proposed. NONE when fewer than two names survive
 * the length cap.
 *
 * `translate` for an ADOPTED row. The spec asks for a translate only when that
 * row lacks a title in some app language. openplate cannot see which titles a
 * row has, because the search answers one locale at a time; but LowCarbCheck
 * serves no Turkish title for any row today, so every adopted row lacks one,
 * and LowCarbCheck deduplicates a repeat before its judge runs.
 *
 * `new` when nothing was adopted, and only with an English name and all four
 * macros, because LowCarbCheck refuses a `new` proposal without them (M205
 * decision, 2026-09-23). An item missing either is skipped, not sent.
 *
 * The carb basis travels only when it is `total`: openplate's `available`
 * (the EU panel) is not LowCarbCheck's `net`, and an estimate has no basis.
 *
 * @param options.nameTranslations - the stored food's names per app language, or `undefined`.
 * @param options.adoptedSlug - the slug of the LowCarbCheck row the person adopted, or `null`.
 * @param options.macrosPer100g - the food's macros per 100 g as saved; `null` for an unknown figure.
 * @param options.carbBasis - the saved basis, or `undefined`.
 * @param options.via - how the food arrived.
 * @returns the proposal, or `null` when this food must not be proposed.
 */
export function buildFoodProposal(options: {
  nameTranslations: FoodTranslations | undefined;
  adoptedSlug: string | null;
  macrosPer100g: { carbs: number | null; fat: number | null; protein: number | null; kcal: number | null; fiber: number | null };
  carbBasis: CarbBasis | undefined;
  via: FoodProposalVia;
}): FoodProposal | null {
  const translations = proposalTranslations(options.nameTranslations);
  if (Object.keys(translations).length < MIN_FOOD_PROPOSAL_NAMES) return null;
  if (options.adoptedSlug !== null) {
    return { kind: 'translate', slug: options.adoptedSlug, translations, via: options.via };
  }
  const macros = completeMacros(options.macrosPer100g);
  if (translations.en === undefined || macros === null) return null;
  const proposal: FoodProposal = { kind: 'new', translations, macrosPer100g: macros, via: options.via };
  if (options.carbBasis === 'total') proposal.carbBasis = 'total';
  return proposal;
}

/** The names a proposal may carry: normalised, the ones over the cap left out. */
function proposalTranslations(nameTranslations: FoodTranslations | undefined): Partial<Record<LanguageCode, string>> {
  const entries = SUPPORTED_LANGUAGES.flatMap((code) => {
    const parsed = proposalNameSchema.safeParse(nameTranslations?.[code] ?? '');
    return parsed.success ? [[code, parsed.data] as const] : [];
  });
  return Object.fromEntries(entries);
}

/** All four macros inside LowCarbCheck's bounds, with fibre when known, or `null`. */
function completeMacros(macros: {
  carbs: number | null;
  fat: number | null;
  protein: number | null;
  kcal: number | null;
  fiber: number | null;
}): FoodProposalMacros | null {
  const { carbs, fat, protein, kcal, fiber } = macros;
  if (carbs === null || fat === null || protein === null || kcal === null) return null;
  const parsed = macrosSchema.safeParse(fiber === null ? { carbs, fat, protein, kcal } : { carbs, fat, protein, kcal, fiber });
  return parsed.success ? parsed.data : null;
}

/**
 * One proposal rebuilt key by key, so only the wire keys leave this server.
 *
 * @param proposal - a parsed proposal.
 * @returns the same proposal holding the wire keys and nothing else.
 */
export function toWireProposal(proposal: FoodProposal): FoodProposal {
  const wire: FoodProposal = { kind: proposal.kind, translations: { ...proposal.translations }, via: proposal.via };
  if (proposal.slug !== undefined) wire.slug = proposal.slug;
  if (proposal.macrosPer100g !== undefined) wire.macrosPer100g = { ...proposal.macrosPer100g };
  if (proposal.carbBasis !== undefined) wire.carbBasis = proposal.carbBasis;
  return wire;
}

/** The request body the page posts and the server forwards: `{ proposals }`. */
const batchSchema = z.object({ proposals: z.array(z.json()) });

/**
 * A posted batch, as the server forwards it: each item parsed on its own and
 * dropped when invalid, the rest rebuilt by {@link toWireProposal} and capped
 * at {@link MAX_FOOD_PROPOSALS_PER_REQUEST}.
 *
 * @param body - the request body, as `request.json()` returned it.
 * @returns the proposals to forward, possibly none.
 */
export function parseFoodProposalBatch(body: z.infer<ReturnType<typeof z.json>>): FoodProposal[] {
  const batch = batchSchema.safeParse(body);
  if (!batch.success) return [];
  return batch.data.proposals
    .flatMap((item) => {
      const parsed = FoodProposalSchema.safeParse(item);
      return parsed.success ? [toWireProposal(parsed.data)] : [];
    })
    .slice(0, MAX_FOOD_PROPOSALS_PER_REQUEST);
}
