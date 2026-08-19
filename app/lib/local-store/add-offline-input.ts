/**
 * Pure translation from a submitted `/add` form to an outbox enqueue input —
 * the offline counterpart to the online action handlers (`handleLog`/
 * `handleManual` in `app/routes/add.tsx`). Operates on the standard `FormData`
 * Web API (not an `HTMLFormElement`), so it needs no DOM and is directly
 * unit-testable under `node:test`.
 */
import { z } from 'zod';
import { scaleMacrosPer100gToServing, type Macros } from '#app/lib/macros';
import { randomUuid } from '#app/lib/uuid';
import type { EnqueueLogInput, PendingLogDisplay } from './types';

/** A `FormData` entry that is a text field rather than an uploaded `File`. */
const textFieldSchema = z.string();

/** The meal-type field as submitted; anything else is treated as "no meal selected". */
const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

/** Reads the seven per-100g macro fields back off a submitted add form, as a Macros. */
function readMacrosFromForm(formData: FormData): Macros {
  const read = (key: string): number | null => {
    const raw = textFieldSchema.safeParse(formData.get(key));
    if (!raw.success || raw.data.trim() === '') return null;
    const parsed = Number(raw.data);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    carbs: read('carbs'),
    fiber: read('fiber'),
    sugars: read('sugars'),
    polyols: read('polyols'),
    protein: read('protein'),
    fat: read('fat'),
    kcal: read('kcal'),
  };
}

/**
 * Builds an outbox enqueue input from a submitted add form (the offline path).
 * The verbatim string field-set becomes the replay `payload`; a per-serving
 * snapshot (scaled from the form's per-100g macros) powers the provisional
 * diary card. A fresh `clientId` makes the eventual replay exactly-once.
 *
 * `dayKey` is ALWAYS written into `payload.date` — even for a plain "log to
 * today" submit, whose DOM form has no `date` hidden input (that only renders
 * when explicitly back-dating). Without this, a replay with no `date` field
 * falls through to the server's `defaultNow()`, which is the FLUSH instant —
 * wrong whenever the flush happens on a different calendar day than the
 * original offline log (e.g. logged at 23:50, flushed after midnight lands the
 * entry on the wrong day).
 *
 * @param formData - the submitted add form, read verbatim into the replay payload.
 * @param dayKey - the local calendar day (`YYYY-MM-DD`) this entry belongs to.
 */
export function buildOfflineLogInput(formData: FormData, dayKey: string): EnqueueLogInput {
  const clientId = randomUuid();
  const payload: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    const text = textFieldSchema.safeParse(value);
    if (text.success) payload[key] = text.data;
  }
  payload.clientId = clientId;
  payload.date = dayKey;

  const intent = payload._intent === 'manual' ? 'manual' : 'log';
  const grams = Number(payload.quantityGrams);
  const safeGrams = Number.isFinite(grams) && grams > 0 ? grams : 0;
  const mealType = mealTypeSchema.safeParse(payload.mealType);
  const curatedSource = payload.curatedSource?.trim() ? payload.curatedSource.trim() : null;
  const display: PendingLogDisplay = {
    name: payload.name ?? '',
    quantityGrams: safeGrams,
    mealType: mealType.success ? mealType.data : null,
    macros: scaleMacrosPer100gToServing(readMacrosFromForm(formData), safeGrams),
    aiEstimated: payload.aiEstimated === 'true',
    curatedSource,
  };
  return { intent, clientId, dayKey, payload, display };
}
