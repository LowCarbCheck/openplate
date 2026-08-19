/**
 * Terse model output → `PlateIdentification`. Pure, no I/O, no LLM: this is the
 * mechanical half of the pipeline and it is where every "the model didn't
 * actually say that" risk gets decided.
 *
 * Four decisions worth reading before changing anything here:
 *
 * 1. **`macrosPer100g` is ALWAYS `null`.** Not "null when the model omitted it" —
 *    always. Locked decision 13: the vision model's sole job is confident food
 *    identification plus portion grams; macros are resolved downstream from a
 *    real food database (spec 04). A carb number guessed from pixels is the one
 *    thing a small model is least able to do and the one number a user acts on.
 *    The grammar cannot even express a macro field, so `null` here is not a
 *    fallback, it is the contract.
 *
 * 2. **`confidence` is a flat `'medium'`.** The high/medium/low ladder in
 *    `V3-DESIGN.md` is derived from ENSEMBLE AGREEMENT — how many independent
 *    candidates named the item. This spec runs ONE call, so there is no
 *    agreement signal to derive from, and emitting `'high'` would be a
 *    confidence claim nothing measured supports. Spec 03 (fan-out + merge) is
 *    what earns the right to vary this; until then the honest value is the middle
 *    one, and it is a single named constant so spec 03 has one place to change.
 *
 * 3. **`portionHint` is FORMATTED from the grams, never invented.** The terse
 *    schema carries only a name and a number, so the hint is a rendering of the
 *    number the model gave — no "about half the plate", because nothing in the
 *    payload knows how big the plate is.
 *
 * 4. **Items are deduped case-insensitively by name.** This is a measured
 *    failure mode, not a hypothetical: gold-set image 45 degenerated to
 *    "kimchi" × 5 in a benchmarked run. Dedup is CODE, not grammar — a grammar
 *    can bound how many items there are but not whether two of them are the same
 *    food. The FIRST occurrence's grams win; they are not summed, because the
 *    repetition is a decoding artifact and summing it would inflate a 5× stutter
 *    into a 5× portion.
 */
import type { IdentifiedFood, PlateIdentification } from '../contract/plate-identification.js';
import type { TerseCandidate, TerseItem } from './terse-contract.js';

/** See decision 2 in the module header. Spec 03 replaces this with agreement-derived confidence. */
export const SINGLE_CALL_CONFIDENCE = 'medium' as const;

export interface MappedPlate {
  plate: PlateIdentification;
  /** How many items the dedup pass removed. Metadata only — safe to log. */
  duplicatesDropped: number;
}

/** Grams → a short human phrase. A rendering of the model's number, nothing more. */
export function formatPortionHint(grams: number): string | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return `about ${Math.round(grams)} g`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toIdentifiedFood(item: TerseItem): IdentifiedFood {
  return {
    name: item.n.trim(),
    estimatedGrams: item.g,
    confidence: SINGLE_CALL_CONFIDENCE,
    portionHint: formatPortionHint(item.g),
    // Always null — see decision 1. Spec 04 fills this from the food corpus and
    // sets `provenance`/`attribution` at the same time; both are omitted here.
    macrosPer100g: null,
  };
}

export function mapTerseToPlate(candidate: TerseCandidate): MappedPlate {
  const seen = new Set<string>();
  const foods: IdentifiedFood[] = [];
  let duplicatesDropped = 0;

  for (const item of candidate.f) {
    const name = item.n.trim();
    if (name.length === 0) {
      duplicatesDropped += 1;
      continue;
    }
    if (!Number.isFinite(item.g) || item.g <= 0) {
      // A zero- or negative-gram item is not a portion. Dropping it is more
      // honest than logging a food the user cannot possibly have eaten.
      duplicatesDropped += 1;
      continue;
    }
    const key = normalizeName(name);
    if (seen.has(key)) {
      duplicatesDropped += 1;
      continue;
    }
    seen.add(key);
    foods.push(toIdentifiedFood({ n: name, g: item.g }));
  }

  return {
    plate: {
      foods,
      // No `notes`: prose is pure decode cost, the terse grammar has no field
      // for it, and a note written by this mapper would be our words presented
      // as the model's.
      notes: null,
    },
    duplicatesDropped,
  };
}
