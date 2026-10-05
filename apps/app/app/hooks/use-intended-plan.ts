/**
 * The plan a person chose before they had an account, and the tier linked
 * beside it, for a screen that shows or sends them: `/sign-up`
 * (`app/lib/plans/intended-plan.ts`).
 *
 * The address is read, and a plan it names is stored, in an EFFECT: storage
 * does not exist while the server renders, and reading it in render would
 * hydrate a different tree than the server sent. Both are `null` until the
 * effect has run, which on `/sign-up` is before the form is drawn, because the
 * form waits for the handshake. The tier is read back from the record the
 * capture just wrote, so it can only be the one stored beside this plan.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { captureIntendedPlan, readIntendedTier } from '#app/lib/plans/intended-plan';
import type { PlanKey } from '#app/lib/sync/engine/client/plans-wire';

/** What the address and the device remember of the pricing page's choice. */
export interface IntendedChoice {
  plan: PlanKey | null;
  /** The tier id stored beside `plan`, or `null`. Never set while `plan` is `null`. */
  tier: string | null;
}

const NO_CHOICE: IntendedChoice = { plan: null, tier: null };

export function useIntendedChoiceFromLink(): IntendedChoice {
  const { search } = useLocation();
  const [choice, setChoice] = useState<IntendedChoice>(NO_CHOICE);

  useEffect(() => {
    // The query string only: on `/sign-up` the fragment carries nothing.
    const plan = captureIntendedPlan({ search, hash: '' });
    setChoice(plan === null ? NO_CHOICE : { plan, tier: readIntendedTier() });
  }, [search]);

  return choice;
}

/**
 * The tier stored beside the chosen plan, for the plan page, or `null`.
 *
 * Read ONCE, in the state's initializer, and not in an effect: the page holds
 * back its tier list until the offer has arrived, so a value that came one
 * render later would put the order block under a list that is already drawn.
 * The server has no storage and answers `null`, and while the offer is unread
 * nothing on the page depends on the answer, so the server's markup and the
 * browser's first render agree.
 */
export function useStoredIntendedTier(): string | null {
  const [tier] = useState<string | null>(() => readIntendedTier());
  return tier;
}
