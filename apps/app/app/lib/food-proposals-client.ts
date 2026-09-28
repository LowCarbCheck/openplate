/**
 * The page's half of food proposals (M251 spec 04): the person's switch, the
 * batch a confirmed scan becomes, and the one request that carries it.
 *
 * ── Two gates, both must be open ─────────────────────────────────────────
 *
 * The INSTANCE decides first: `PublicConfig.foodDbBackfill`, from the root
 * loader, is `false` unless the operator set `FOOD_DB_BACKFILL=true` with a
 * LowCarbCheck key. Then the PERSON: a switch in Settings, AI, on by default,
 * kept on this device like the weight unit. A person who turns it off sends
 * nothing from this device, whatever the instance allows.
 *
 * ── Fire and forget ──────────────────────────────────────────────────────
 *
 * The request leaves after the diary rows are written and nothing waits for
 * it. Every failure is swallowed: a proposal is a contribution to the food
 * database, never a step of logging a meal.
 */
import type { IntakeSource } from '#app/lib/intake-source';
import type { LocalFoodLog } from '#app/lib/local-store/schema';
import {
  MAX_FOOD_PROPOSALS_PER_REQUEST,
  buildFoodProposal,
  type FoodProposal,
  type FoodProposalVia,
} from '#app/services/food-db/proposals';

/** Device-local storage key for the person's switch. Absent means on. */
export const FOOD_DB_CONTRIBUTION_STORAGE_KEY = 'openplate:food-db-contribute';

/** The one stored value that means off. Anything else, including nothing, is on. */
const CONTRIBUTION_OFF = 'off';

/** The route the page posts to. */
export const FOOD_PROPOSALS_PATH = '/api/food-proposals';

/**
 * Whether this device contributes. On by default, and on outside a browser,
 * where nothing is ever sent anyway.
 *
 * @returns false only after the person switched it off here.
 */
export function isFoodDbContributionOn(): boolean {
  if (globalThis.window === undefined) return true;
  try {
    return window.localStorage.getItem(FOOD_DB_CONTRIBUTION_STORAGE_KEY) !== CONTRIBUTION_OFF;
  } catch {
    return true;
  }
}

/**
 * Stores the person's switch. A write failure (private mode, full quota) is
 * swallowed: the switch then keeps its old value on the next load.
 *
 * @param isOn - the new position.
 */
export function setFoodDbContribution(isOn: boolean): void {
  if (globalThis.window === undefined) return;
  try {
    if (isOn) window.localStorage.removeItem(FOOD_DB_CONTRIBUTION_STORAGE_KEY);
    else window.localStorage.setItem(FOOD_DB_CONTRIBUTION_STORAGE_KEY, CONTRIBUTION_OFF);
  } catch {
    // Ignored by design, see this function's doc.
  }
}

/** A typed or spoken meal is `text` on the wire; LowCarbCheck has no word for speech. */
const VIA_BY_INTAKE = { photo: 'photo', text: 'text', speech: 'text' } satisfies Record<IntakeSource, FoodProposalVia>;

/** One confirmed scan item, as the proposal builder needs it. */
export interface ConfirmedProposalItem {
  /** The row the save wrote; its `nameTranslations` is absent for a renamed food. */
  entry: Pick<LocalFoodLog, 'nameTranslations' | 'carbBasis'>;
  /** The form's `curatedSource` token (`lowcarbcheck:<slug>`), or blank when nothing was adopted. */
  curatedSource: string | undefined;
  /** The item's macros per 100 g as confirmed; absent for an unknown figure. */
  macrosPer100g: { carbs: number; fat?: number; protein?: number; kcal?: number; fiber?: number };
}

/** The slug an adopted row's `curatedSource` token names, or `null`. */
function adoptedSlug(curatedSource: string | undefined): string | null {
  const token = curatedSource?.trim() ?? '';
  if (!token.startsWith('lowcarbcheck:')) return null;
  const slug = token.slice('lowcarbcheck:'.length);
  return slug === '' ? null : slug;
}

/**
 * The proposals one confirmed scan becomes: one per item that qualifies, see
 * `buildFoodProposal` for which do. Capped at the batch limit.
 *
 * @param options.items - the included items, each with the row the save wrote.
 * @param options.intakeSource - how the scan arrived.
 * @returns the batch, possibly empty.
 */
export function buildConfirmedProposals(options: {
  items: readonly ConfirmedProposalItem[];
  intakeSource: IntakeSource;
}): FoodProposal[] {
  const via = VIA_BY_INTAKE[options.intakeSource];
  return options.items
    .flatMap((item) => {
      const proposal = buildFoodProposal({
        nameTranslations: item.entry.nameTranslations,
        adoptedSlug: adoptedSlug(item.curatedSource),
        macrosPer100g: {
          carbs: item.macrosPer100g.carbs,
          fat: item.macrosPer100g.fat ?? null,
          protein: item.macrosPer100g.protein ?? null,
          kcal: item.macrosPer100g.kcal ?? null,
          fiber: item.macrosPer100g.fiber ?? null,
        },
        carbBasis: item.entry.carbBasis,
        via,
      });
      return proposal === null ? [] : [proposal];
    })
    .slice(0, MAX_FOOD_PROPOSALS_PER_REQUEST);
}

/**
 * Sends a batch, when there is one and both gates are open. Never throws and
 * never waits on the answer.
 *
 * @param options.proposals - the batch.
 * @param options.isInstanceOn - `PublicConfig.foodDbBackfill`, as the page received it.
 */
export function sendFoodProposals(options: { proposals: readonly FoodProposal[]; isInstanceOn: boolean }): void {
  if (!options.isInstanceOn || options.proposals.length === 0 || !isFoodDbContributionOn()) return;
  void fetch(FOOD_PROPOSALS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposals: options.proposals }),
    // The confirm redirects at once; `keepalive` lets the request finish
    // after the page it started on has moved on.
    keepalive: true,
  }).catch(() => undefined);
}
