/**
 * The ONE copy-with-Undo announcement in the app.
 *
 * The diary's copy chips, its per-entry picker and the "Wie gestern" door on
 * the dashboard and the composer all post the same `copy-yesterday` intent to
 * `/diary` and all get the same batch id back. Announcing that batch, and
 * offering the Undo that deletes it, therefore happens in exactly one place:
 * two `shownRef` sets is two toasts for one copy, which is the duplicate M217
 * forbids.
 *
 * The caller keeps its own copy fetcher, because each caller submits a
 * different payload (a whole day, one meal, a picked selection). What it hands
 * over is that fetcher's data; the Undo fetcher, the de-duplication and the
 * toast are here.
 */
import { useEffect, useRef } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';

import { showFoodAddedToast } from '#app/lib/food-added-toast';

/**
 * What `/diary`'s `copy-yesterday` handler answers. Declared here rather than
 * imported from the route so this module stays a leaf: the route imports the
 * hook, never the other way round.
 */
export interface CopyYesterdayResult {
  intent: 'copy-yesterday';
  /** The batch every entry of this copy carries, or null when nothing was copied. */
  copiedBatchId: string | null;
  copiedCount: number;
  firstName: string;
  netCarbsTotal: number;
  hasEstimates: boolean;
  dayLabel: string | null;
}

/**
 * Anything a copy fetcher can be holding: the copy answer, another intent's
 * answer off the same route action, a raw `Response`, or nothing yet.
 */
export type CopyFetcherData = CopyYesterdayResult | { intent: string } | Response | undefined;

/** The copy answer, when there is one and it actually wrote something. */
function selectCopiedBatch(data: CopyFetcherData): CopyYesterdayResult | null {
  if (data === undefined) return null;
  if (!('intent' in data) || data.intent !== 'copy-yesterday') return null;
  // SAFETY: the literal `intent` above is unique to `handleCopyYesterday`'s
  // return, so the remaining fields are present.
  const result = data as CopyYesterdayResult;
  if (result.copiedBatchId === null || result.copiedCount === 0) return null;
  return result;
}

/**
 * Shows the "copied" toast with its Undo once per batch.
 *
 * @param data - the caller's copy fetcher's `data`.
 * @param onCopied - run after the toast, once per batch. The picker closes itself here.
 */
export function useCopyYesterdayToast({ data, onCopied }: { data: CopyFetcherData; onCopied?: () => void }): void {
  const { t, i18n } = useTranslation();
  const undoFetcher = useFetcher();
  const shownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const result = selectCopiedBatch(data);
    if (result === null) return;
    const batchId = result.copiedBatchId;
    if (batchId === null || shownRef.current.has(batchId)) return;
    shownRef.current.add(batchId);
    showFoodAddedToast({
      name: result.firstName,
      count: result.copiedCount,
      verb: 'copied',
      mealLabel: null,
      netCarbsTotal: result.netCarbsTotal,
      hasEstimates: result.hasEstimates,
      dayLabel: result.dayLabel,
      t,
      language: i18n.language,
      action: {
        label: t('diary.actions.undo'),
        // The Undo posts to `/diary` explicitly: this hook also runs on the
        // dashboard and on the composer, where a relative post would reach the
        // wrong route (or none at all).
        onClick: () => undoFetcher.submit({ _intent: 'copy-undo', batchId }, { method: 'post', action: '/diary' }),
      },
    });
    onCopied?.();
  }, [data, undoFetcher, t, i18n.language, onCopied]);
}
