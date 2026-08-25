/**
 * meals.tsx — "Saved meals" (`/meals`), M123/07 item 1.
 *
 * A saved meal is a named, reusable BUNDLE of foods — the diary's "save as
 * meal" action (`diary.tsx`'s `handleSaveMeal`) snapshots a set of currently-
 * logged entries into one, and this route is where it's re-logged or deleted.
 * The bundle is a TEMPLATE, never a live reference: re-logging creates fresh
 * `LocalFoodLog` rows (one per item, sharing a batch id so the re-log undoes
 * as one unit — the exact `logBatchId` precedent copy-yesterday established),
 * and deleting a saved meal never touches any entry already logged from it.
 *
 * NO SERVER LOADER, by design (AGENTS.md, local-first): saved meals live in
 * the on-device primary store (`LocalSavedMeal`, schema v11).
 */
import { useEffect, useRef } from 'react';
import type { Route } from './+types/meals';
import { z } from 'zod';
import { parseWithZod } from '@conform-to/zod/v4';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import i18n from '#app/i18n/i18n';
import { BookMarked, Trash2, Utensils } from 'lucide-react';
import { randomUuid } from '#app/lib/uuid';
import { mealTypeForTime } from '#app/lib/meal-time';
import { todayInTimezone } from '#app/lib/user-days';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import {
  buildLogsFromSavedMeal,
  deleteLocalSavedMeal,
  getLocalProfileGoals,
  getLocalSavedMeal,
  listLocalSavedMeals,
  putLocalFoodLog,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalSavedMeal } from '#app/lib/local-store';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent } from '#app/components/ui/card';
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
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.meals') }];

export const handle = {
  title: 'Saved meals',
  titleKey: 'settings.rows.meals.title',
  backTo: '/settings',
};

////////////////////////////////////////////////////////////////////////////////
// Action schemas
////////////////////////////////////////////////////////////////////////////////

const LogMealSchema = z.object({ mealId: z.string().min(1) });
const DeleteMealSchema = z.object({ mealId: z.string().min(1) });

/** `_intent=delete-meal`'s reply, as `SavedMealRow`'s own fetcher needs to read it back. */
const deleteMealResultSchema = z.object({ intent: z.literal('delete-meal'), mealId: z.string(), name: z.string() });

/**
 * Translation lookup for `clientAction`, which runs outside React and
 * therefore has no `useTranslation` — same precedent as `fasting.tsx`'s
 * `actionT`. Safe because `clientAction` only ever executes in the browser,
 * where the i18next singleton IS the live, language-synced instance.
 */
function actionT(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params ?? {});
}

////////////////////////////////////////////////////////////////////////////////
// Action handlers
////////////////////////////////////////////////////////////////////////////////

/**
 * Re-logs a saved meal onto TODAY, at the current instant, with a meal type
 * derived from the time of day (the same heuristic `/add`'s portion step
 * seeds its meal select from) — this route offers no date/meal picker of its
 * own, on the theory that "log the usual, right now" is the case a saved meal
 * exists to make one tap; correcting the meal slot or back-dating the result
 * afterward is exactly what the entry-detail edit (item 4, same milestone)
 * is for.
 */
async function handleLogMeal(formData: FormData): Promise<Response> {
  const submission = parseWithZod(formData, { schema: LogMealSchema });
  if (submission.status !== 'success') throw new Response('Invalid log payload', { status: 400 });

  const meal = await getLocalSavedMeal(submission.value.mealId);
  if (!meal) throw new Response('Saved meal not found', { status: 404 });

  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const now = Date.now();
  const dayKey = todayInTimezone(timezone, new Date(now));
  const mealType = mealTypeForTime({ at: new Date(now), timezone });
  const logBatchId = randomUuid();

  const logs = buildLogsFromSavedMeal({
    meal,
    makeId: randomUuid,
    dayKey,
    loggedAtMs: now,
    mealType,
    logBatchId,
    createdAtMs: now,
  });
  for (const log of logs) await putLocalFoodLog(log);

  return redirectWithLocalToast('/diary', {
    type: 'success',
    description: actionT('meals.toast.logged', { name: meal.name, count: logs.length }),
  });
}

async function handleDeleteMeal(formData: FormData): Promise<{ intent: 'delete-meal'; mealId: string; name: string }> {
  const submission = parseWithZod(formData, { schema: DeleteMealSchema });
  if (submission.status !== 'success') throw new Response('Invalid delete payload', { status: 400 });
  const existing = await getLocalSavedMeal(submission.value.mealId);
  await deleteLocalSavedMeal(submission.value.mealId);
  return { intent: 'delete-meal', mealId: submission.value.mealId, name: existing?.name ?? '' };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  if (intent === 'log-meal') return handleLogMeal(formData);
  if (intent === 'delete-meal') return handleDeleteMeal(formData);
  throw new Response('Invalid intent', { status: 400 });
}

export async function clientLoader() {
  return { meals: await listLocalSavedMeals() };
}
clientLoader.hydrate = true as const;

////////////////////////////////////////////////////////////////////////////////
// Rendering
////////////////////////////////////////////////////////////////////////////////

function SavedMealRow({ meal }: { meal: LocalSavedMeal }) {
  const { t } = useTranslation();
  const logFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const shownDelete = useRef(false);
  const isLogging = logFetcher.state !== 'idle';

  useEffect(() => {
    const parsed = deleteMealResultSchema.safeParse(deleteFetcher.data);
    if (!parsed.success || shownDelete.current) return;
    shownDelete.current = true;
    toast.success(t('meals.toast.deleted', { name: parsed.data.name || meal.name }));
  }, [deleteFetcher.data, meal.name, t]);

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{meal.name}</p>
          <p className="text-xs text-muted-foreground">{t('meals.itemCount', { count: meal.items.length })}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <logFetcher.Form method="post">
            <input type="hidden" name="_intent" value="log-meal" />
            <input type="hidden" name="mealId" value={meal.id} />
            <Button type="submit" variant="outline" size="sm" disabled={isLogging}>
              <Utensils className="h-4 w-4" />
              {isLogging ? t('meals.logging') : t('meals.logNow')}
            </Button>
          </logFetcher.Form>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('meals.removeAria', { name: meal.name })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('meals.removeTitle', { name: meal.name })}</AlertDialogTitle>
                <AlertDialogDescription>{t('meals.removeDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('add.custom.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteFetcher.submit({ _intent: 'delete-meal', mealId: meal.id }, { method: 'post' })}
                >
                  {t('add.custom.remove')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Meals({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { meals } = loaderData;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* No own heading: the app chrome already renders this route's title
          from `handle.title` — see `settings.data.tsx` for the same pattern. */}
      <p className="text-sm text-muted-foreground">{t('meals.description')}</p>
      {meals.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <BookMarked className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('meals.empty')}</p>
        </div>
      )}
      <div className="space-y-2">
        {meals.map((meal) => (
          <SavedMealRow key={meal.id} meal={meal} />
        ))}
      </div>
    </div>
  );
}
