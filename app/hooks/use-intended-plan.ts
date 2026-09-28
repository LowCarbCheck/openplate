/**
 * The plan a person chose before they had an account, for a screen that
 * shows it or sends it: `/sign-up` (`app/lib/plans/intended-plan.ts`).
 *
 * The address is read, and a plan it names is stored, in an EFFECT: storage
 * does not exist while the server renders, and reading it in render would
 * hydrate a different tree than the server sent. `null` until the effect has
 * run, which on `/sign-up` is before the form is drawn, because the form waits
 * for the handshake.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { captureIntendedPlan } from '#app/lib/plans/intended-plan';
import type { PlanKey } from '#app/lib/sync/engine/client/plans-wire';

export function useIntendedPlanFromLink(): PlanKey | null {
  const { search } = useLocation();
  const [plan, setPlan] = useState<PlanKey | null>(null);

  useEffect(() => {
    // The query string only: on `/sign-up` the fragment carries nothing.
    setPlan(captureIntendedPlan({ search, hash: '' }));
  }, [search]);

  return plan;
}
