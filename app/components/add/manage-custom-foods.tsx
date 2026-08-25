/**
 * "Your foods" management sheet — makes locally-created foods visible and
 * editable. Before this, a custom food was write-only: `ManualAddForm`
 * created one (via `_intent=manual`'s `putLocalFood` call in
 * `app/routes/add.tsx`) whenever carbs were entered, but nothing ever listed,
 * edited, or deleted it (`deleteLocalFood` had zero call sites anywhere in
 * the app).
 *
 * Every write here goes through `/add`'s own `clientAction`
 * (`_intent=editFood`/`deleteFood`) via this component's own fetchers, so a
 * change is reflected the next time that route's `clientLoader` re-runs —
 * React Router revalidates the current route automatically after a fetcher
 * submission targets it, which is why `foods` (passed down from
 * `loaderData.customFoods`) stays live without any extra plumbing here.
 *
 * Deliberately parses the fetcher's result with its own local schemas
 * (`deleteFoodResultSchema`/`editFoodResultSchema`) rather than importing
 * `add.tsx`'s result types — mirrors
 * `SearchResultCandidate`'s "decoupled from any one source shape" precedent
 * in the sibling `search-result-row.tsx`, and matches
 * `#app/hooks/use-toast.tsx`'s `useFetcherWithToast`, which does the same
 * runtime-shape check rather than a compile-time import from the action's
 * owning route.
 */
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Macros } from '#app/lib/macros';
import type { LocalPersonalFood } from '#app/lib/local-store';
import type { MacroEntryBasis } from '#app/lib/portions';
import type { CarbBasis } from '#app/lib/net-carbs';
import { CARB_BASIS_NOT_SURE_VALUE, CarbBasisField } from '#app/components/carb-basis-field';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { cn } from '#app/lib/utils';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { SubmitButton } from '#app/components/submit-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#app/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { Pencil, Trash2 } from 'lucide-react';

/**
 * The narrow slice of i18next's `t` this module's pure helpers depend on —
 * threaded in as a parameter so each stays directly callable from a test with
 * a stub translator rather than reaching for the shared instance.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * The seven macro fields, in the same order the manual-add form uses them.
 * Shares the `add.macros.*` keys with `app/routes/add.tsx`'s own
 * `MACRO_FIELD_LABEL_KEYS` so the two forms can never drift apart — the
 * English behind them uses plain words a first-time visitor recognizes rather
 * than the raw macro key ("kcal" → "Calories", "polyols" → "Sugar alcohols").
 */
const MACRO_FIELD_LABEL_KEYS: readonly (readonly [keyof Macros, string])[] = [
  ['carbs', 'add.macros.carbs'],
  ['fiber', 'add.macros.fiber'],
  ['sugars', 'add.macros.sugars'],
  ['polyols', 'add.macros.polyols'],
  ['protein', 'add.macros.protein'],
  ['fat', 'add.macros.fat'],
  ['kcal', 'add.macros.kcal'],
];

/**
 * A host route's `_intent=deleteFood` reply, as this component needs to read
 * it. Exported so `/foods` (the other host, see this file's header) can type
 * its own `handleDeleteFood` result against the exact shape this component
 * parses, rather than the two silently drifting apart.
 */
const deleteFoodResultSchema = z.object({
  intent: z.literal('deleteFood'),
  foodId: z.string(),
  name: z.string(),
});
export type DeleteFoodResult = z.infer<typeof deleteFoodResultSchema>;

/** A host route's `_intent=editFood` reply — same exported-for-both-hosts reasoning as `DeleteFoodResult` above. */
const editFoodResultSchema = z.object({
  intent: z.literal('editFood'),
  ok: z.boolean(),
  name: z.string().optional(),
  reason: z.enum(['invalid', 'carbs-required']).optional(),
});

export type EditFoodResult = z.infer<typeof editFoodResultSchema>;

/** Compact per-100g carbs/calorie summary; null fields are skipped, never shown as 0. Exported for direct testability. */
export function formatPer100gLine(macros: Macros, t: Translate, language: string): string {
  const parts: string[] = [];
  if (macros.carbs !== null) parts.push(t('add.custom.carbsSummary', { value: formatMacroNumberIn(language, macros.carbs) }));
  if (macros.kcal !== null) parts.push(t('add.custom.caloriesSummary', { value: formatMacroNumberIn(language, macros.kcal) }));
  return parts.join(' · ');
}

/** Small selected/unselected pill, matching the portion/basis chips used elsewhere in the add flow. */
function toggleButtonClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-9 items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
  );
}

/** Turns an edit failure reason into a plain sentence — never a raw error code. */
function editFailureMessage(reason: EditFoodResult['reason'], t: Translate): string {
  if (reason === 'carbs-required') return t('add.errors.carbsRequired');
  return t('add.errors.saveFailed');
}

/** The inline edit form for one custom food: name + per-100g/per-serving macro entry, same convention as `ManualAddForm`. */
function EditFoodForm({
  food,
  onCancel,
  onSaved,
}: {
  food: LocalPersonalFood;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const [basis, setBasis] = useState<MacroEntryBasis>('per100g');
  const [servingGrams, setServingGrams] = useState('');
  // Pre-filled from the food's own stored basis (spec 13, M123) — absent
  // (UNKNOWN) starts the control on "not sure", never a guess.
  const [carbBasis, setCarbBasis] = useState<CarbBasis | typeof CARB_BASIS_NOT_SURE_VALUE>(
    food.carbBasis ?? CARB_BASIS_NOT_SURE_VALUE,
  );
  const isSaving = fetcher.state !== 'idle';
  const shownResult = useRef<unknown>(null);

  useEffect(() => {
    const parsed = editFoodResultSchema.safeParse(fetcher.data);
    if (!parsed.success || fetcher.data === shownResult.current) return;
    const data = parsed.data;
    shownResult.current = fetcher.data;
    if (data.ok) {
      toast.success(t('add.custom.updated', { name: data.name ?? food.name }));
      onSaved();
      return;
    }
    toast.error(editFailureMessage(data.reason, t));
  }, [fetcher.data, food.name, onSaved, t]);

  return (
    <fetcher.Form method="post" className="space-y-3 rounded-lg border bg-card p-3">
      <input type="hidden" name="_intent" value="editFood" />
      <input type="hidden" name="foodId" value={food.id} />
      <input type="hidden" name="macroBasis" value={basis} />
      <div className="grid gap-1">
        <Label htmlFor={`edit-name-${food.id}`}>{t('add.custom.name')}</Label>
        <Input id={`edit-name-${food.id}`} name="name" defaultValue={food.name} className="h-10" />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={basis === 'per100g'}
          onClick={() => setBasis('per100g')}
          className={toggleButtonClass(basis === 'per100g')}
        >
          {t('add.custom.per100gToggle')}
        </button>
        <button
          type="button"
          aria-pressed={basis === 'perServing'}
          onClick={() => setBasis('perServing')}
          className={toggleButtonClass(basis === 'perServing')}
        >
          {t('add.custom.perServingToggle')}
        </button>
      </div>
      {basis === 'perServing' && (
        <div className="grid max-w-32 gap-1">
          <Label htmlFor={`edit-serving-${food.id}`}>{t('add.custom.servingSize')}</Label>
          <Input
            id={`edit-serving-${food.id}`}
            name="servingGrams"
            type="number"
            step="0.1"
            value={servingGrams}
            onChange={(event) => setServingGrams(event.target.value)}
            className="h-10"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {MACRO_FIELD_LABEL_KEYS.map(([key, labelKey]) => (
          <div key={key} className="grid gap-1">
            <Label htmlFor={`edit-${key}-${food.id}`}>{t(labelKey)}</Label>
            <Input
              id={`edit-${key}-${food.id}`}
              name={key}
              type="number"
              step="0.1"
              defaultValue={food.macrosPer100g[key] ?? ''}
              className="h-10"
            />
          </div>
        ))}
      </div>
      <CarbBasisField
        name="carbBasis"
        legend={t('add.custom.carbBasis.legend')}
        hint={t('add.custom.carbBasis.hint')}
        selected={carbBasis}
        onSelect={setCarbBasis}
        totalLabel={t('add.custom.carbBasis.total')}
        availableLabel={t('add.custom.carbBasis.available')}
        notSureLabel={t('add.custom.carbBasis.notSure')}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          {t('add.custom.cancel')}
        </Button>
        <SubmitButton pending={isSaving} pendingLabel={t('add.custom.savePending')} size="sm">
          {t('add.custom.save')}
        </SubmitButton>
      </div>
    </fetcher.Form>
  );
}

/** One row in the "Your foods" list: view mode (name + summary + edit/delete) or the inline edit form. */
function CustomFoodRow({
  food,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaved,
}: {
  food: LocalPersonalFood;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const deleteFetcher = useFetcher();
  const shownDelete = useRef(false);

  useEffect(() => {
    const parsed = deleteFoodResultSchema.safeParse(deleteFetcher.data);
    if (!parsed.success || shownDelete.current) return;
    shownDelete.current = true;
    toast.success(t('add.custom.removed', { name: parsed.data.name }));
  }, [deleteFetcher.data, t]);

  if (isEditing) {
    return <EditFoodForm food={food} onCancel={onCancelEdit} onSaved={onSaved} />;
  }

  const summary = formatPer100gLine(food.macrosPer100g, t, i18n.language);

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{food.name}</p>
        {summary && <p className="text-xs text-muted-foreground">{t('add.custom.per100g', { summary })}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t('add.custom.editAria', { name: food.name })}>
          <Pencil className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('add.custom.removeAria', { name: food.name })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('add.custom.removeTitle', { name: food.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('add.custom.removeDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('add.custom.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteFetcher.submit({ _intent: 'deleteFood', foodId: food.id }, { method: 'post' })}
              >
                {t('add.custom.remove')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/**
 * The reusable list body — every locally-saved food, each editable or
 * removable in place. Split out (M123/07 item 5) so `/foods` can render the
 * exact same list as a full page instead of duplicating `CustomFoodRow`/
 * `EditFoodForm`: the only thing that differs between the `/add` sheet and
 * the `/foods` page is the chrome wrapped around this list, and each fetcher
 * inside a row posts to whichever ROUTE renders it (no `action` prop needed),
 * so both hosts just need their own `editFood`/`deleteFood` clientAction —
 * see `/foods`' route file for its (small, deliberate) duplicate of `/add`'s
 * handlers, following this app's own "your foods" precedent below.
 */
export function CustomFoodsList({ foods }: { foods: LocalPersonalFood[] }) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {foods.length === 0 && <p className="text-sm text-muted-foreground">{t('add.custom.empty')}</p>}
      {foods.map((food) => (
        <CustomFoodRow
          key={food.id}
          food={food}
          isEditing={editingId === food.id}
          onEdit={() => setEditingId(food.id)}
          onCancelEdit={() => setEditingId(null)}
          onSaved={() => setEditingId(null)}
        />
      ))}
    </div>
  );
}

/**
 * Trigger + slide-over listing every locally-saved food, each editable or
 * removable in place. Always rendered (even with zero foods yet) so the
 * capability is discoverable from the first visit to `/add`, not just after
 * someone happens to create a food.
 */
export function ManageCustomFoodsSheet({ foods }: { foods: LocalPersonalFood[] }) {
  const { t } = useTranslation();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="px-0 text-muted-foreground">
          {foods.length > 0 ? t('add.custom.triggerWithCount', { total: foods.length }) : t('add.custom.trigger')}
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('add.custom.title')}</SheetTitle>
          <SheetDescription>{t('add.custom.description')}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <CustomFoodsList foods={foods} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
