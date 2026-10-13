/**
 * The reading half of the vitamins and minerals block: it takes a window's
 * intake, which the route's loader already computed from the on-device log,
 * fetches the reference amounts after the first paint, and hands the snapshot
 * to `MicronutrientSnapshotCard`.
 *
 * ── THE ROUTE'S LOADER NEVER WAITS FOR IT ─────────────────────────────────
 *
 * The intake is pure arithmetic on logs the loader holds anyway, so it is part
 * of the loader's data. The reference list is the one network read, and it is
 * done here, in an effect, so the diary and Insights render on their own clock
 * and the block fills in under them. Its box is reserved from the first paint
 * (see the card), so the arrival moves nothing.
 *
 * It fails open like every reader of that list: offline or with no food
 * database, the block shows the count and says the references could not be
 * loaded. The list is cached per tab (`nutrient-reference-client.ts`), so the
 * second screen to ask pays nothing.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { MicronutrientSnapshotCard, type SnapshotScope } from '#app/components/micronutrient-snapshot-card';
import { getCoreUrl } from '#app/config/public-config';
import { usePublicConfig } from '#app/hooks/use-public-config';
import { loadInstanceNutrientReferences } from '#app/lib/instance-nutrient-references';
import type { WindowMicronutrients } from '#app/lib/local-store';
import { buildMicronutrientSnapshot } from '#app/lib/micronutrient-snapshot';
import type { MicronutrientSnapshot } from '#app/lib/micronutrient-snapshot';
import { buildNutrientRows } from '#app/lib/nutrient-reference';
import type { NutrientReference } from '#app/lib/nutrient-reference';
import type { BodyMetrics } from '#app/models/body-metrics';

/** What the block reads from its route: the window's intake and the body facts a reference amount is looked up by. */
export interface MicronutrientSnapshotInputs {
  /** The window's per-nutrient intake, from `computeMicronutrientsInWindow`. */
  intake: WindowMicronutrients;
  metrics: BodyMetrics;
  /** The person's local calendar year, to measure age against. */
  currentYear: number;
}

/** The snapshot to draw, and whether its gaps are still waiting on the reference list. */
export interface MicronutrientSnapshotRead {
  snapshot: MicronutrientSnapshot;
  isLoading: boolean;
}

/** One answer of the reference read, tagged with the server it asked about. */
interface ReferencesAnswer {
  syncServerUrl: string | null;
  references: NutrientReference[];
}

/**
 * The snapshot for a window, with the reference list read after mount.
 *
 * @param inputs - the intake, the body metrics and the current year.
 * @returns the snapshot and whether the gaps are still loading.
 */
export function useMicronutrientSnapshot({ intake, metrics, currentYear }: MicronutrientSnapshotInputs): MicronutrientSnapshotRead {
  const syncServerUrl = getCoreUrl(usePublicConfig());
  const [answer, setAnswer] = useState<ReferencesAnswer | null>(null);

  useEffect(() => {
    let isMounted = true;
    const read = async (): Promise<void> => {
      // Never rejects: an unreachable list is `[]`, which is an answer.
      const references = await loadInstanceNutrientReferences({ syncServerUrl });
      if (isMounted) setAnswer({ syncServerUrl, references });
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [syncServerUrl]);

  // An answer about another server is no answer about this one.
  const references = answer !== null && answer.syncServerUrl === syncServerUrl ? answer.references : null;
  const hasBodyMetrics = metrics.biologicalSex !== null && metrics.birthYear !== null;
  const rows = buildNutrientRows({
    byNutrient: intake.byNutrient,
    loggedDays: intake.loggedDays,
    references: references ?? [],
    metrics,
    currentYear,
  });
  return {
    snapshot: buildMicronutrientSnapshot({
      rows,
      totalEntries: intake.totalEntries,
      // While the list is on its way it is not known to be unreachable; the
      // card shows its loading layer instead of any answer that depends on it.
      referencesReachable: references === null || references.length > 0,
      hasBodyMetrics,
    }),
    // Without body metrics the answer is already known, and it does not wait.
    isLoading: references === null && hasBodyMetrics,
  };
}

/**
 * The block, read and drawn.
 *
 * @param props - the window's inputs, the deep link, and the window it describes.
 */
export function MicronutrientSnapshotBlock({
  to,
  scope,
  ...inputs
}: MicronutrientSnapshotInputs & { to: string; scope: SnapshotScope }): ReactElement {
  const { snapshot, isLoading } = useMicronutrientSnapshot(inputs);
  return <MicronutrientSnapshotCard snapshot={snapshot} to={to} scope={scope} isLoading={isLoading} />;
}
