/**
 * The published reference amounts this instance shows, read in the browser.
 *
 * ONE resolution for every screen that ranks vitamins and minerals: `/nutrients`
 * and the overview panes on the diary and Insights call this, so the panes and
 * the deep dive cannot show one body's numbers on one screen and another's on
 * the next.
 *
 * The basis is the one the core server's `/health` handshake publishes
 * (`InstanceDescriptor.nutrientReferenceBasis`, M234 spec 07), read once per tab
 * through `readCachedServerInstance`. ABSENT IS NOT A DEFAULT: with no core
 * server, or a service older than the field, the request names no basis and this
 * app's own server answers with its configured one. A basis invented here would
 * put one body's numbers under another body's name.
 *
 * Fail-open, like the client underneath: `[]` (offline, the food database not
 * configured, upstream down) is the normal degraded answer, never a rejection.
 */
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import type { NutrientReference } from '#app/lib/nutrient-reference';
import { fetchNutrientReferenceList } from '#app/lib/nutrient-reference-client';

/**
 * The reference list for this instance's basis.
 *
 * @param input.syncServerUrl - the core server to ask for the basis, or null on an instance with none.
 * @returns the references, or `[]` when none could be read. Never rejects.
 */
export async function loadInstanceNutrientReferences({
  syncServerUrl,
}: {
  syncServerUrl: string | null;
}): Promise<NutrientReference[]> {
  const instance = syncServerUrl === null ? null : await readCachedServerInstance(syncServerUrl);
  return fetchNutrientReferenceList({ basis: instance?.nutrientReferenceBasis ?? null });
}
