/**
 * foods.tsx — "Your foods" (`/foods`), M123/07 item 5.
 *
 * Before this route existed, a custom food was write-only: `/add`'s manual
 * entry created one (via `putLocalFood`), but nothing outside the `/add`
 * sheet ever listed, edited, or deleted it — `deleteLocalFood` had a real
 * call site (the sheet's delete action), but no page you could reach it from
 * except mid-search on `/add`. This route hosts the SAME list — reusing
 * `CustomFoodsList` from `#app/components/add/manage-custom-foods` rather
 * than re-implementing the row/edit-form UI — as a standalone destination
 * linked from `/settings`.
 *
 * Its `editFood`/`deleteFood` intents are a deliberate, small duplicate of
 * `/add`'s own handlers (same schemas, same pure helpers, same result
 * shapes) rather than an import from that route module: `CustomFoodsList`'s
 * rows post to whichever ROUTE renders them (no `action` prop), so each host
 * needs its own action, and `/add` is out of scope for this change. Keeping
 * the two in lockstep is exactly the kind of small, deliberate duplication
 * this app already accepts elsewhere (see `diary.tsx`'s own note on its
 * favorites-storage duplication with `diary.entry.$id.tsx`).
 *
 * NO SERVER LOADER, by design (AGENTS.md, local-first): custom foods live in
 * the on-device primary store.
 */
import type { Route } from './+types/foods';
import { z } from 'zod';
import { parseWithZod } from '@conform-to/zod/v4';
import { useTranslation } from 'react-i18next';
import type { Macros } from '#app/lib/macros';
import { macrosDiffer, resolveEditedNetCarbsPer100g } from '#app/lib/log-edit';
import { resolveMacrosPer100gFromEntry } from '#app/lib/portions';
import { parseCarbBasis } from '#app/lib/net-carbs';
import { createOptionalNonNegativeNumberSchema } from '#app/lib/zod-numeric';
import { deleteLocalFood, getLocalFood, listLocalFoods, putLocalFood } from '#app/lib/local-store';
import type { DeleteFoodResult, EditFoodResult } from '#app/components/add/manage-custom-foods';
import { CustomFoodsList } from '#app/components/add/manage-custom-foods';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.foods') }];

export const handle = {
  title: 'Your foods',
  titleKey: 'settings.rows.foods.title',
  backTo: '/settings',
};

////////////////////////////////////////////////////////////////////////////////
// Action schemas — deliberate duplicates of `/add`'s own (see the module doc)
////////////////////////////////////////////////////////////////////////////////

const macroBasisField = z.enum(['per100g', 'perServing']).catch('per100g');

const EditFoodSchema = z.object({
  foodId: z.string().min(1, 'Missing food'),
  name: z.string().min(1, 'Name is required'),
  macroBasis: macroBasisField,
  servingGrams: createOptionalNonNegativeNumberSchema(),
  carbs: createOptionalNonNegativeNumberSchema(),
  fiber: createOptionalNonNegativeNumberSchema(),
  sugars: createOptionalNonNegativeNumberSchema(),
  polyols: createOptionalNonNegativeNumberSchema(),
  protein: createOptionalNonNegativeNumberSchema(),
  fat: createOptionalNonNegativeNumberSchema(),
  kcal: createOptionalNonNegativeNumberSchema(),
  // Same convention as `/add`'s identical duplicate — see this module's header.
  carbBasis: z.string().optional(),
});

const DeleteFoodSchema = z.object({ foodId: z.string().min(1, 'Missing food') });

/** Builds the per-100g macro set from the optional numeric form fields — mirrors `/add`'s identical helper. */
function macrosFromFields(data: {
  carbs?: number;
  fiber?: number;
  sugars?: number;
  polyols?: number;
  protein?: number;
  fat?: number;
  kcal?: number;
}): Macros {
  return {
    carbs: data.carbs ?? null,
    fiber: data.fiber ?? null,
    sugars: data.sugars ?? null,
    polyols: data.polyols ?? null,
    protein: data.protein ?? null,
    fat: data.fat ?? null,
    kcal: data.kcal ?? null,
  };
}

async function handleDeleteFood({ formData }: { formData: FormData }): Promise<DeleteFoodResult> {
  const submission = parseWithZod(formData, { schema: DeleteFoodSchema });
  if (submission.status !== 'success') throw new Response('Invalid delete payload', { status: 400 });
  const existing = await getLocalFood(submission.value.foodId);
  await deleteLocalFood(submission.value.foodId);
  return { intent: 'deleteFood', foodId: submission.value.foodId, name: existing?.name ?? '' };
}

async function handleEditFood({ formData }: { formData: FormData }): Promise<EditFoodResult> {
  const submission = parseWithZod(formData, { schema: EditFoodSchema });
  if (submission.status !== 'success') return { intent: 'editFood', ok: false, reason: 'invalid' };
  const data = submission.value;
  const enteredMacros = macrosFromFields(data);
  const macrosPer100g = resolveMacrosPer100gFromEntry({
    basis: data.macroBasis,
    macros: enteredMacros,
    servingGrams: data.servingGrams ?? 0,
  });
  // Same invariant `/add`'s `handleEditFood` enforces: every existing personal
  // food was created with carbs known, so an edit must preserve that rather
  // than silently saving an incomplete food.
  if (macrosPer100g.carbs === null) return { intent: 'editFood', ok: false, reason: 'carbs-required' };
  const existing = await getLocalFood(data.foodId);
  if (!existing) throw new Response('Food not found', { status: 404 });
  const netCarbsPer100g = resolveEditedNetCarbsPer100g({
    macrosChanged: macrosDiffer(existing.macrosPer100g, macrosPer100g),
    current: existing.netCarbsPer100g,
  });
  // `micronutrientsPer100g` rides the `...existing` spread — same rule as
  // `/add`'s handler: net carbs are derived from the very macros being
  // edited, a vitamin measurement is not. `carbBasis` (spec 13, M123) is NOT
  // cleared by a macro edit either — same reasoning, and same "the submitted
  // value wins outright" rule as `/add`'s duplicate handler.
  const carbBasis = parseCarbBasis(data.carbBasis);
  await putLocalFood({
    ...existing,
    name: data.name,
    macrosPer100g: { ...macrosPer100g, carbs: macrosPer100g.carbs },
    netCarbsPer100g,
    carbBasis: carbBasis ?? undefined,
  });
  return { intent: 'editFood', ok: true, name: data.name };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  if (intent === 'deleteFood') return handleDeleteFood({ formData });
  if (intent === 'editFood') return handleEditFood({ formData });
  throw new Response('Invalid intent', { status: 400 });
}

export async function clientLoader() {
  return { foods: await listLocalFoods() };
}
clientLoader.hydrate = true as const;

export default function Foods({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { foods } = loaderData;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* No own heading: the app chrome already renders this route's title
          from `handle.title` — see `settings.data.tsx` for the same pattern. */}
      <p className="text-sm text-muted-foreground">{t('add.custom.description')}</p>
      <CustomFoodsList foods={foods} />
    </div>
  );
}
