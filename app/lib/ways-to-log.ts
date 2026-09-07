/**
 * The three ways a food actually gets into the diary, named once.
 *
 * WHY A LIST AND NOT THREE HARD-CODED CARDS. The wizard's last step teaches
 * these three (M200 spec 01), and a lesson that drifts from the product is
 * worse than no lesson: the person has nothing else to correct it against yet.
 * Keeping the ways here, typed against the wizard's own exit allowlist, makes
 * "each card starts the real action" a compile-time fact rather than a review
 * comment, and makes the copy testable without a DOM.
 *
 * WHY DICTATION IS NOT A FOURTH ENTRY. The microphone beside the add screen's
 * search field wraps the browser's Web Speech API (`app/lib/speech-input.ts`):
 * the audio goes to the browser's maker, never to openplate and never to a
 * model, and the transcript only fills the search box. It never creates a log
 * entry (`app/components/add/speech-input-button.tsx`). So it is a faster way
 * INTO the search, and it is taught as one line under that card. Nothing here
 * may ever grow into a claim that speaking sends a message or logs a food.
 *
 * Pure data plus i18n KEYS (never copy), so the route, the animated chunk and
 * the unit tests all read the same three rows.
 */
import type { OnboardingExitDestination } from '#app/lib/onboarding';

/** The three ways, in the order they are taught. */
export const WAY_TO_LOG_IDS = ['plate', 'label', 'search'] as const;

export type WayToLogId = (typeof WAY_TO_LOG_IDS)[number];

/** One way in, as the lesson presents it. */
export interface WayToLog {
  id: WayToLogId;
  /**
   * Where tapping the card goes. Typed as the wizard's exit allowlist, so a
   * card can never point somewhere the action would refuse and silently
   * rewrite to `/diary`.
   */
  destination: OnboardingExitDestination;
  titleKey: string;
  descriptionKey: string;
}

/**
 * Ordered plate, label, search. Photography leads because it is the reason
 * someone installed this, and the label scan sits directly under it because it
 * is the same gesture on a different subject, which is exactly the thing
 * people were not finding (M200 spec 04).
 */
export const WAYS_TO_LOG: readonly WayToLog[] = WAY_TO_LOG_IDS.map((id) => ({
  id,
  destination: destinationFor(id),
  titleKey: `onboarding.waysToLog.${id}.title`,
  descriptionKey: `onboarding.waysToLog.${id}.description`,
}));

/** The real action behind each card. Exhaustive over `WayToLogId` by construction. */
function destinationFor(id: WayToLogId): OnboardingExitDestination {
  if (id === 'plate') return '/scan';
  if (id === 'label') return '/scan?mode=label';
  return '/add';
}

/**
 * The lesson's lead line. It is the STEP's own description rather than a
 * paragraph of its own: `StepShell` already renders it above the cards, and a
 * second lead under the first would be the same idea said twice
 * (DESIGN.md 10.7). Named here so the copy test covers it with the cards.
 */
export const WAYS_TO_LOG_LEAD_KEY = 'onboarding.step.firstFood.description';

/**
 * The dictation line, under the search card. Its copy is load-bearing: it is
 * the sentence that stops a first-time reader from inventing a voice-message
 * feature this app does not have.
 */
export const WAYS_TO_LOG_DICTATION_KEY = 'onboarding.waysToLog.dictationNote';

/** Every i18n key the lesson renders, for the parity and copy tests. */
export function waysToLogCopyKeys(): string[] {
  return [
    WAYS_TO_LOG_LEAD_KEY,
    WAYS_TO_LOG_DICTATION_KEY,
    ...WAYS_TO_LOG.flatMap((way) => [way.titleKey, way.descriptionKey]),
  ];
}
