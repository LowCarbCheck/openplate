/**
 * How a person started a log, and the one decision the speech path has to make.
 *
 * WHY A SOURCE AT ALL. Three ways in reach the same review screen: a photo, a
 * typed sentence, and a spoken one. They are the same pipeline on purpose, so
 * the only place the difference survives is the diary's own record of which
 * path was used (`LogInputPath` in `#app/lib/matomo-events`), which is what
 * says whether a way in is worth improving. It carries nothing about the food.
 *
 * Pure and dependency-free, so the speech rule below is provable without a
 * microphone, a DOM, or a provider.
 */

/** Every way an intake can start. */
export const INTAKE_SOURCES = ['photo', 'text', 'speech'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

/**
 * The two sources that produce WORDS rather than a picture.
 *
 * A separate type rather than `Exclude<IntakeSource, 'photo'>` so a text
 * hand-off's own field says what it accepts at its declaration site.
 */
export type TypedIntakeSource = 'text' | 'speech';

/**
 * What to do with a finished transcript.
 *
 * `submit` runs the AI intake at once, which is the whole point of the change:
 * somebody who tapped Speak wants to LOG, not to read a search list. Two
 * things stop that, and only two:
 *
 * - Nothing was heard. There is no intake to run, and a paid call about an
 *   empty string is worse than useless.
 * - There is no AI provider on this device. The call cannot happen, so the
 *   words go in the field and the database search still answers, exactly as
 *   speech has always behaved.
 *
 * `fill-only` never discards the transcript: the caller puts it in the search
 * box either way, so a person whose provider is missing still sees what was
 * heard and can search or correct it.
 */
export type SpeechIntakeAction = 'submit' | 'fill-only';

export function resolveSpeechIntakeAction({
  transcript,
  hasAiProvider,
}: {
  transcript: string;
  /** Whether this device has an AI connection ready. `false` while the answer is still unknown. */
  hasAiProvider: boolean;
}): SpeechIntakeAction {
  if (transcript.trim() === '') return 'fill-only';
  if (!hasAiProvider) return 'fill-only';
  return 'submit';
}
