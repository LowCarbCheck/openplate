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
 * ── What the three became (2026-09-08) ───────────────────────────────────
 *
 * They used to be PLATE PHOTO, NUTRITION PANEL PHOTO and SEARCH, with a
 * footnote saying the microphone only filled the search box. Two things
 * changed under that lesson on the same day and it now reads as written:
 *
 * 1. The label scan stopped being a mode of its own (amends ADR-0005). One
 *    photo path reads a plate, a single item or a printed panel and decides
 *    per item, so "photograph a nutrition panel" is no longer a separate way
 *    in, it is the same card.
 * 2. Speaking stopped being a way to type. Dictated words go to the same AI
 *    intake a typed sentence does and land on the same review screen, so it IS
 *    a way to log, and the footnote that said otherwise was a false sentence
 *    in the one place a person has nothing to check it against.
 *
 * So: PHOTO, TYPE, SPEAK. One card per way, no footnote, and each card starts
 * the action it describes.
 *
 * 3. Typing and speaking got a screen of their own (M203). Both cards used to
 *    land on `/add`, which is the database SEARCH: a box that wants one noun,
 *    shown to somebody who was just told to write a whole meal. They land on
 *    `/describe` now, which is the composer the lesson describes. The search is
 *    still in the product and the type card's copy still names it, as the way
 *    to add one exact item.
 *
 * 4. The app's own microphone is GONE (M203). It was a Web Speech button, it
 *    reported every failure to an `sr-only` region, so on a phone it read as a
 *    button that does nothing, and the audio went to Google or Apple anyway.
 *    A person dictates with the KEYBOARD's dictation key now, which reaches
 *    this app as ordinary typing. The speak card therefore leads to the
 *    composer with its field focused, and the note under it names the keyboard.
 *
 * WHAT IS STILL TRUE ABOUT DICTATION, and must stay in the copy: openplate has
 * no microphone, receives no audio, and stores none. The keyboard turns speech
 * into text (Google on an Android keyboard, Apple on iOS), and what leaves this
 * app is TEXT, exactly as if it had been typed. Nothing here may ever grow into
 * a claim that a recording is sent anywhere by openplate.
 *
 * Pure data plus i18n KEYS (never copy), so the route, the animated chunk and
 * the unit tests all read the same three rows.
 */
import type { OnboardingExitDestination } from '#app/lib/onboarding';

/** The three ways, in the order they are taught. */
export const WAY_TO_LOG_IDS = ['photo', 'type', 'speak'] as const;

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
 * Ordered photo, type, speak. Photography leads because it is the reason
 * someone installed this. Typing sits second because it is the one that works
 * with no camera and no keyboard dictation, and speaking last because it is
 * typing with a different key pressed.
 */
export const WAYS_TO_LOG: readonly WayToLog[] = WAY_TO_LOG_IDS.map((id) => ({
  id,
  destination: destinationFor(id),
  titleKey: `onboarding.waysToLog.${id}.title`,
  descriptionKey: `onboarding.waysToLog.${id}.description`,
}));

/** The real action behind each card. Exhaustive over `WayToLogId` by construction. */
function destinationFor(id: WayToLogId): OnboardingExitDestination {
  if (id === 'photo') return '/scan';
  // FOCUSES the composer's field and shows the dictation hint. Nothing starts
  // recording, because nothing in this app can: dictation is the keyboard's.
  if (id === 'speak') return '/describe?speak=1';
  return '/describe';
}

/**
 * The lesson's lead line. It is the STEP's own description rather than a
 * paragraph of its own: `StepShell` already renders it above the cards, and a
 * second lead under the first would be the same idea said twice
 * (DESIGN.md 10.7). Named here so the copy test covers it with the cards.
 */
export const WAYS_TO_LOG_LEAD_KEY = 'onboarding.step.firstFood.description';

/**
 * The privacy line, under the speak card. Its copy is load-bearing twice over:
 * it is the sentence that stops a first-time reader from believing openplate
 * records them, and since M203 it is also the sentence that tells them WHERE
 * the dictation key is, because this app no longer offers a microphone of its
 * own. It must name the keyboard and it must say that only text travels.
 */
export const WAYS_TO_LOG_SPEECH_PRIVACY_KEY = 'onboarding.waysToLog.speechPrivacyNote';

/** Every i18n key the lesson renders, for the parity and copy tests. */
export function waysToLogCopyKeys(): string[] {
  return [
    WAYS_TO_LOG_LEAD_KEY,
    WAYS_TO_LOG_SPEECH_PRIVACY_KEY,
    ...WAYS_TO_LOG.flatMap((way) => [way.titleKey, way.descriptionKey]),
  ];
}
