/**
 * "Entries imported from YAZIO" on "Data & backup" (M254/05).
 *
 * Takes a YAZIO import back in one step: every diary entry and weigh-in whose
 * id carries the import's prefix (`isYazioImportId`), and nothing else. The
 * deletes go through `deleteLocalFoodLog` and `deleteLocalWeightEntry`, which
 * write the delete journal (M225), so sync removes the same rows on the
 * person's other devices instead of bringing them back.
 *
 * SHOWN ONLY WHEN THERE IS SOMETHING TO REMOVE, and that is known only after
 * an asynchronous store read, so the section always arrives after the first
 * paint. NO LAYOUT SHIFT: the route renders it as the LAST block on the page,
 * so nothing sits below it for its arrival to push. Moving it above another
 * block needs a reserved box first (DESIGN.md section 7).
 * `tests/e2e/yazio-import.spec.ts` measures the page as it appears.
 *
 * The counts follow the store: a table listener re-reads the ids after every
 * write, so the section appears right after an import on this page, and
 * leaves once the removal emptied it.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

import { SettingsSection } from '#app/components/settings/settings-section';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { Button } from '#app/components/ui/button';
import { numberLocale } from '#app/i18n/date-locale';
import {
  deleteLocalFoodLog,
  deleteLocalWeightEntry,
  listLocalFoodLogIds,
  listLocalWeightEntryIds,
} from '#app/lib/local-store';
import { getPrimaryStore } from '#app/lib/local-store/persist';
import { FOOD_LOGS_TABLE, WEIGHT_ENTRIES_TABLE } from '#app/lib/local-store/store';
import { publishStatus } from '#app/lib/status';
import { isYazioImportId } from '#app/lib/yazio-ids';

/** The id the section carries; `tests/e2e/yazio-import.spec.ts` names it too. */
const YAZIO_REMOVE_ANCHOR = 'remove-yazio';

/** The rows a YAZIO import wrote, by id. */
interface YazioRows {
  foodLogIds: string[];
  weightEntryIds: string[];
}

/** Reads the import's rows off the store by id alone, so no diary row is parsed. */
async function readYazioRows(): Promise<YazioRows> {
  const [foodLogIds, weightEntryIds] = await Promise.all([listLocalFoodLogIds(), listLocalWeightEntryIds()]);
  return { foodLogIds: foodLogIds.filter(isYazioImportId), weightEntryIds: weightEntryIds.filter(isYazioImportId) };
}

/**
 * Removes every row a YAZIO import wrote. Reads the ids again rather than
 * trusting the counts on screen, so a row written since is removed too.
 */
async function removeYazioRows(): Promise<void> {
  const { foodLogIds, weightEntryIds } = await readYazioRows();
  for (const id of foodLogIds) await deleteLocalFoodLog(id);
  for (const id of weightEntryIds) await deleteLocalWeightEntry(id);
}

/**
 * Calls `listener` after every write to the food log or the weight log.
 * Best effort, like `use-current-fast.ts`: on the server, and in a browser
 * with no usable IndexedDB, there is no store to listen to.
 *
 * @returns a function that removes the listeners, safe to call before they attached.
 */
function subscribeToImportTables(listener: () => void): () => void {
  let isCancelled = false;
  let remove: (() => void) | null = null;
  void (async () => {
    try {
      const store = await getPrimaryStore();
      if (isCancelled) return;
      const listenerIds = [FOOD_LOGS_TABLE, WEIGHT_ENTRIES_TABLE].map((table) =>
        store.addTableListener(table, () => listener()),
      );
      remove = () => {
        for (const listenerId of listenerIds) store.delListener(listenerId);
      };
    } catch {
      // No store to listen to, so there are no imported rows to show.
    }
  })();
  return () => {
    isCancelled = true;
    if (remove) remove();
  };
}

/**
 * The counts of imported rows, re-read after every write to either table.
 * Null until the first read has landed, and while there is no store.
 */
function useYazioRowCounts(): { entries: number; weighIns: number } | null {
  const [counts, setCounts] = useState<{ entries: number; weighIns: number } | null>(null);
  const [writeCount, setWriteCount] = useState(0);

  useEffect(() => subscribeToImportTables(() => setWriteCount((count) => count + 1)), []);

  useEffect(() => {
    let isActive = true;
    void (async () => {
      try {
        const rows = await readYazioRows();
        if (isActive) setCounts({ entries: rows.foodLogIds.length, weighIns: rows.weightEntryIds.length });
      } catch {
        // No store (server render, no IndexedDB): nothing imported can be shown or removed.
      }
    })();
    return () => {
      isActive = false;
    };
  }, [writeCount]);

  return counts;
}

export function YazioRemoveSection() {
  const { t, i18n } = useTranslation();
  const counts = useYazioRowCounts();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  if (counts === null || (counts.entries === 0 && counts.weighIns === 0)) return null;

  const formatCount = (count: number): string => count.toLocaleString(numberLocale(i18n.language));

  async function handleRemove(): Promise<void> {
    setIsRemoving(true);
    try {
      await removeYazioRows();
      publishStatus({ text: t('settings.data.yazio.remove.success'), tone: 'success' });
    } catch {
      publishStatus({ text: t('settings.data.yazio.remove.error'), tone: 'error' });
    } finally {
      setIsRemoving(false);
      setIsDialogOpen(false);
    }
  }

  // `scroll-mt-20`: the pinned app header (see `app-wrapper.tsx`) would
  // otherwise cover the heading when a link lands here by hash.
  return (
    <div id={YAZIO_REMOVE_ANCHOR} className="scroll-mt-20">
      <SettingsSection
        label={t('settings.data.yazio.remove.heading')}
        description={t('settings.data.yazio.remove.description')}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('settings.data.yazio.remove.entries')}</dt>
          <dd data-slot="yazio-remove-entry-count" className="tabular-nums">
            {formatCount(counts.entries)}
          </dd>
          <dt className="text-muted-foreground">{t('settings.data.yazio.remove.weighIns')}</dt>
          <dd data-slot="yazio-remove-weigh-in-count" className="tabular-nums">
            {formatCount(counts.weighIns)}
          </dd>
        </dl>
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full justify-center sm:h-10 sm:w-auto"
              disabled={isRemoving}
              data-slot="yazio-remove"
            >
              <Trash2 />
              {t('settings.data.yazio.remove.button')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('settings.data.yazio.remove.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('settings.data.yazio.remove.confirmDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRemoving}>{t('settings.data.yazio.remove.cancel')}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isRemoving}
                data-slot="yazio-remove-confirm"
                onClick={() => void handleRemove()}
              >
                {isRemoving ? t('settings.data.yazio.remove.removing') : t('settings.data.yazio.remove.confirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsSection>
    </div>
  );
}
