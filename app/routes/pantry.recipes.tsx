/**
 * `/pantry/recipes`, two or three things to cook next out of what is on the
 * shelf and what is still open in the day (M233/04).
 *
 * ── The screen is one question asked once per slot ───────────────────────
 *
 * Arriving here spends an allowance unit, exactly as a plate scan does, and so
 * does every change of the meal select at the top. That is the only control on
 * the page, and it is the only thing that re-asks: nothing else here can spend
 * anything. The guard is a ref holding the slot the current answer was bought
 * for, so a re-render, a StrictMode double effect or a revalidation can never
 * buy the same answer twice.
 *
 * ── Why the slot lives in the URL ────────────────────────────────────────
 *
 * `?meal=` is where every other intake screen carries a slot
 * (`buildIntakeHref`), so a link into these recipes for a particular meal
 * already works, and Back behaves. It is parsed against the closed list, never
 * asserted: a hand-typed `?meal=brunch` is simply the default slot.
 *
 * ── Nothing is removed from the pantry ───────────────────────────────────
 *
 * Logging a recipe writes a food and a log and touches the shelf not at all. A
 * proposal is not a receipt: the person may cook it, halve it or ignore it,
 * and an app that quietly ate their eggs would be wrong more often than right.
 *
 * ── Client-only, like every tracker surface ──────────────────────────────
 *
 * The provider call is this browser's own and the day it reasons about is the
 * on-device diary, so there is nothing for a server loader to do. The
 * not-connected card and the failure alert are `/scan`'s, shared through
 * `components/intake/` rather than copied.
 */
import type { Route } from './+types/pantry.recipes';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { redirect, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Clock, ShoppingBasket } from 'lucide-react';

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { ConnectCard, ScanLoading } from '#app/components/intake/intake-connect-card';
import { IntakeFailureAlert } from '#app/components/intake/intake-failure-alert';
import { MealSelectField } from '#app/components/meal-select-field';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { useEffectiveAiSettings } from '#app/hooks/use-effective-ai-settings';
import { managedAiCredential, type EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import { resolveProviderTriple } from '#app/lib/ai/provider-triple';
import { MEAL_TYPES } from '#app/lib/meal-choice';
import { mealTypeForTime } from '#app/lib/meal-time';
import { trackFoodLogged } from '#app/lib/matomo-events';
import { buildRecipeLogEntry } from '#app/lib/recipe-log';
import { dayTotalsFromLogs } from '#app/lib/day-totals-from-logs';
import { computeRemainingDay, describeRemainingDayForPrompt } from '#app/lib/remaining-day';
import type { Remaining, RemainingDay } from '#app/lib/remaining-day';
import { todayInTimezone } from '#app/lib/user-days';
import { randomUuid } from '#app/lib/uuid';
import {
  getLocalAiSettings,
  getLocalProfileGoals,
  listLocalFoodLogsForDay,
  listLocalPantryItems,
  putLocalFood,
  putLocalFoodLog,
  recordLocalAiUsageEvent,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalPantryItem } from '#app/lib/local-store';
import {
  createVisionProvider,
  RECIPE_PROPOSAL_TASK,
  VisionProviderError,
  type RecipeProposal,
  type RecipeProposals,
  type ScanTokenUsage,
} from '#app/services/vision';
import { buildRecipeProposalUserPrompt } from '#app/services/vision/recipe-prompt';
import { estimateScanCostUsd } from '#app/services/vision/cost';
import type { MealType } from '#types/enums';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.recipes') }];

export const handle = {
  title: 'Recipes',
  titleKey: 'recipes.title',
  backTo: '/pantry',
};

////////////////////////////////////////////////////////////////////////////////
// Pure helpers
////////////////////////////////////////////////////////////////////////////////

/**
 * The slot named in `?meal=`, or null when there is none to read.
 *
 * A lookup against the closed list rather than an assertion, the same rule the
 * pantry's unit select follows: anything outside the four slots is a URL
 * nobody in the app wrote, and the screen falls back to the clock.
 */
export function parseSlotParam(value: string | null): MealType | null {
  return MEAL_TYPES.find((meal) => meal === value) ?? null;
}

/**
 * Main slots still to come, counting from `slot` to the end of the day.
 *
 * Breakfast, lunch and dinner are the three the day's budget is divided by. A
 * SNACK IS NOT ONE OF THEM and never reduces the count: it is an extra meal in
 * a day whose main slots are already accounted for, so it is given the share a
 * single meal would get at the end of the day, which is the smallest share on
 * offer and the right one for a meal nobody planned the budget around.
 */
export function mainSlotsLeft(slot: MealType): number {
  return SLOTS_LEFT_BY_SLOT[slot];
}

/** The table {@link mainSlotsLeft} reads. `satisfies`, so a fifth slot is a compile error here. */
const SLOTS_LEFT_BY_SLOT = { breakfast: 3, lunch: 2, dinner: 1, snack: 1 } satisfies Record<MealType, number>;

////////////////////////////////////////////////////////////////////////////////
// The loader
////////////////////////////////////////////////////////////////////////////////

export async function clientLoader() {
  const [settings, items, profile] = await Promise.all([
    getLocalAiSettings(),
    listLocalPantryItems(),
    getLocalProfileGoals(),
  ]);
  // AN EMPTY SHELF HAS NO RECIPES. `/pantry`'s own door is already disabled in
  // that state, so this is the belt to that braces: a deep link, a bookmark or
  // a list emptied in another tab lands on the list rather than on a screen
  // that would buy an answer about nothing.
  if (items.length === 0) throw redirect('/pantry');

  const timezone = resolveLocalTimezone(profile);
  const dayKey = todayInTimezone(timezone);
  const logs = await listLocalFoodLogsForDay(dayKey);
  return { settings, items, goals: profile, timezone, dayKey, totals: dayTotalsFromLogs(logs) };
}
clientLoader.hydrate = true as const;

export function HydrateFallback(): ReactElement {
  return <ScanLoading />;
}

////////////////////////////////////////////////////////////////////////////////
// The provider call
////////////////////////////////////////////////////////////////////////////////

/** What one proposal attempt answers with: recipes, or a sentence saying why not. */
type RecipeReadResult = { ok: true; proposals: RecipeProposals } | { ok: false; error: string };

/**
 * Runs ONE recipe task against the person's provider and records the usage.
 *
 * The usage row is written on every outcome, including a failure that billed
 * tokens, the same rule `/scan` and `/pantry` follow: a paid attempt that
 * produced nothing is still a paid attempt, and dropping it would make the
 * settings page's monthly figure quietly wrong.
 */
async function proposeRecipes({
  pantry,
  day,
  language,
  effective,
  failedMessage,
}: {
  pantry: readonly LocalPantryItem[];
  day: RemainingDay;
  language: string;
  effective: EffectiveAiSettings;
  /** The generic "that did not work" sentence, already translated by the caller. */
  failedMessage: string;
}): Promise<RecipeReadResult> {
  const triple = resolveProviderTriple(effective);
  if (triple === null) return { ok: false, error: failedMessage };

  const record = async (usage: ScanTokenUsage | undefined, outcome: 'identified' | 'error') => {
    await recordLocalAiUsageEvent({
      provider: triple.provider,
      model: triple.model,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      // `null` for a managed call, the honest answer rather than a missing
      // feature: the catalog prices a person's OWN provider key, and a managed
      // call is spent against an allowance their organization pays for.
      estimatedCostUsd:
        effective.source === 'managed' || usage === undefined ?
          null
        : (estimateScanCostUsd(triple.provider, triple.model, usage) ?? null),
      outcome,
    });
  };

  try {
    const provider = createVisionProvider({
      provider: triple.provider,
      model: triple.model,
      baseUrl: triple.baseUrl,
      credential:
        effective.source === 'managed' ? managedAiCredential() : { apiKey: effective.settings.apiKey ?? '' },
    });
    const proposals = await provider.runTextIntake({
      task: RECIPE_PROPOSAL_TASK,
      text: buildRecipeProposalUserPrompt({
        pantry,
        remainingDayBlock: describeRemainingDayForPrompt(day, language),
        slot: day.slot,
        language,
      }),
    });
    await record(proposals.usage, 'identified');
    return { ok: true, proposals };
  } catch (error) {
    const usage = error instanceof VisionProviderError ? error.usage : undefined;
    await record(usage, 'error');
    // A `VisionProviderError`'s own message is authored provider-neutrally in
    // the adapter layer and is already the actionable detail; anything else is
    // a throw this screen cannot explain, so it gets the generic sentence.
    return { ok: false, error: error instanceof VisionProviderError ? error.message : failedMessage };
  }
}

////////////////////////////////////////////////////////////////////////////////
// The card
////////////////////////////////////////////////////////////////////////////////

/** One per-serving figure, beside what is left of the day's target for it. */
interface MacroLine {
  /** The already-translated nutrient name. */
  label: string;
  /** The serving's own figure. */
  value: number;
  /** What is left of the day's target, or null when the person set none. */
  remaining: number | null;
}

/** Whole numbers everywhere on the card: these are estimates, and decimals would dress them up. */
function whole(value: number): number {
  return Math.round(value);
}

/** What is left of one nutrient's target, or null when the person set none. */
function leftOf(row: Remaining | null): number | null {
  return row === null ? null : row.remaining;
}

/** The five lines, in the order the diary reads its macros. */
function macroLines(recipe: RecipeProposal, day: RemainingDay, t: (key: string) => string): MacroLine[] {
  return [
    { label: t('recipes.macros.kcal'), value: recipe.perServing.kcal, remaining: leftOf(day.kcal) },
    { label: t('recipes.macros.protein'), value: recipe.perServing.proteinG, remaining: leftOf(day.protein) },
    { label: t('recipes.macros.netCarbs'), value: recipe.perServing.carbsG, remaining: leftOf(day.netCarbs) },
    { label: t('recipes.macros.fiber'), value: recipe.perServing.fiberG, remaining: leftOf(day.fiber) },
    { label: t('recipes.macros.fat'), value: recipe.perServing.fatG, remaining: leftOf(day.fat) },
  ];
}

/**
 * One proposal, as a card.
 *
 * PRESENTATIONAL AND PROP-DRIVEN, exported so every state of it is renderable
 * in a test without a store, a provider or a router: what a person sees is
 * decided by `recipe`, `day` and `isLogging`, never by a hook read.
 */
export function RecipeCard({
  recipe,
  day,
  isLogging,
  onLog,
}: {
  recipe: RecipeProposal;
  day: RemainingDay;
  isLogging: boolean;
  onLog: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{recipe.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{recipe.whyItFits}</p>
        {recipe.prepMinutes !== null && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {t('recipes.prepMinutes', { minutes: whole(recipe.prepMinutes) })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {macroLines(recipe, day, t).map((line) => (
            <div key={line.label} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{line.label}</dt>
              <dd>
                {whole(line.value)}
                {/* A NUTRIENT WITH NO TARGET GETS THE BARE FIGURE, and that is
                    why the serving's own number is never inside the sentence:
                    "12 of null left" is nonsense, a zero in its place would be
                    a claim the person never made, and a phrase carrying both
                    figures was read backwards by two of the five translators. */}
                {line.remaining !== null && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {t('recipes.macros.ofLeft', { left: whole(line.remaining) })}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">{t('recipes.ingredients')}</h3>
          <ul className="space-y-0.5 text-sm">
            {recipe.ingredients.map((ingredient) => (
              <li key={`${ingredient.name}-${ingredient.amount ?? 'none'}`} className="flex items-center gap-1">
                <span>
                  {ingredient.amount === null || ingredient.unit === null ?
                    ingredient.name
                  : `${ingredient.name}, ${ingredient.amount} ${ingredient.unit}`}
                </span>
                {/* WHAT IS NOT ON THE SHELF, said plainly. A recipe that
                    quietly assumed an ingredient would send somebody to a shop
                    they did not know they needed. */}
                {!ingredient.fromPantry && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ShoppingBasket className="h-3 w-3" aria-hidden="true" />
                    {t('recipes.notInPantry')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {t('recipes.steps')}
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {recipe.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>

        <Button type="button" className="w-full" onClick={onLog} disabled={isLogging}>
          {isLogging ? t('recipes.logging') : t('recipes.logThis')}
        </Button>
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The route
////////////////////////////////////////////////////////////////////////////////

/** What the screen is doing right now. One value, so "asking" and "failed" cannot both be true. */
type RecipePhase =
  | { kind: 'asking' }
  | { kind: 'ready'; recipes: RecipeProposal[] }
  | { kind: 'failed'; message: string };

export default function PantryRecipes({ loaderData }: Route.ComponentProps): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useAppNavigate();
  const effective = useEffectiveAiSettings(loaderData.settings);
  const [searchParams, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<RecipePhase>({ kind: 'asking' });
  const [isLogging, setIsLogging] = useState(false);

  // The clock's own slot, read ONCE: a screen that re-read it every render
  // would move the person's default under them as the hour turned.
  const [clockSlot] = useState<MealType>(() => mealTypeForTime({ at: new Date(), timezone: loaderData.timezone }));
  const slot = parseSlotParam(searchParams.get('meal')) ?? clockSlot;

  const day = useMemo(
    () =>
      computeRemainingDay({
        totals: loaderData.totals,
        goals: loaderData.goals,
        slot,
        slotsLeft: mainSlotsLeft(slot),
      }),
    [loaderData.totals, loaderData.goals, slot],
  );

  // THE SLOT THE CURRENT ANSWER WAS BOUGHT FOR. Every run costs an allowance
  // unit, so the effect below asks once per slot and never again: a re-render,
  // a revalidation or a StrictMode double effect all find their own slot here.
  const boughtForRef = useRef<MealType | null>(null);
  const dayRef = useRef(day);
  dayRef.current = day;
  const itemsRef = useRef(loaderData.items);
  itemsRef.current = loaderData.items;

  useEffect(() => {
    // NO CONNECTION, so nothing was spent and nothing can be: the screen falls
    // back to the connect card below, and the ref stays empty so the answer is
    // bought the moment a connection resolves.
    if (effective === null) return;
    if (boughtForRef.current === slot) return;
    boughtForRef.current = slot;
    setPhase({ kind: 'asking' });
    void (async () => {
      const result = await proposeRecipes({
        pantry: itemsRef.current,
        day: dayRef.current,
        language: i18n.language,
        effective,
        failedMessage: t('recipes.errors.failed'),
      });
      if (!result.ok) {
        setPhase({ kind: 'failed', message: result.error });
        return;
      }
      setPhase({ kind: 'ready', recipes: result.proposals.recipes });
    })();
  }, [effective, slot, i18n.language, t]);

  const logRecipe = useCallback(
    async (recipe: RecipeProposal): Promise<void> => {
      setIsLogging(true);
      try {
        const { food, log } = buildRecipeLogEntry({
          recipe,
          slot,
          dayKey: loaderData.dayKey,
          now: Date.now(),
          ids: { foodId: randomUuid(), logId: randomUuid(), logBatchId: randomUuid() },
        });
        // The SAME two store functions `/scan`'s confirm calls, in the same
        // order: the food exists before anything points at it.
        await putLocalFood(food);
        await putLocalFoodLog(log);
        trackFoodLogged('recipe');
        void navigate('/diary');
      } finally {
        setIsLogging(false);
      }
    },
    [loaderData.dayKey, navigate, slot],
  );

  if (effective === null) {
    return <ConnectCard logDate={null} />;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">{t('recipes.lead')}</p>
      <MealSelectField
        id="recipes-meal"
        name="meal"
        label={t('recipes.slotLabel')}
        value={slot}
        onChange={(value) => {
          // "NO MEAL" IS NOT AN ANSWER HERE. The shared picker offers it
          // because a diary entry may have no slot, but a proposal is built
          // FOR a slot: the share of the day and the whole prompt depend on
          // one. Choosing it changes nothing, and the select falls back to the
          // slot it already showed, which is the honest refusal.
          const next = parseSlotParam(value);
          if (next === null) return;
          // REPLACE, not push: changing the slot is a correction to this
          // screen, not a step deeper, so Back still leaves for the pantry.
          setSearchParams({ meal: next }, { replace: true });
        }}
      />

      {phase.kind === 'asking' && (
        <output className="block py-16 text-center text-sm text-muted-foreground" aria-live="polite">
          {t('recipes.asking')}
        </output>
      )}

      {phase.kind === 'failed' && (
        <IntakeFailureAlert subject="text" title={t('recipes.errors.title')}>
          {phase.message}
        </IntakeFailureAlert>
      )}

      {phase.kind === 'ready' &&
        phase.recipes.map((recipe) => (
          <RecipeCard
            key={recipe.title}
            recipe={recipe}
            day={day}
            isLogging={isLogging}
            onLog={() => void logRecipe(recipe)}
          />
        ))}
    </div>
  );
}
