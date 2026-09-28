/**
 * How a person started a log.
 *
 * WHY A SOURCE AT ALL. Three ways in reach the same review screen: a photo, a
 * typed sentence, and a dictated one. They are the same pipeline on purpose, so
 * the only place the difference survives is the diary's own record of which
 * path was used (`LogInputPath` in `#app/lib/matomo-events`), which is what
 * says whether a way in is worth improving. It carries nothing about the food.
 *
 * WHY `speech` IS STILL HERE with no microphone in the app. The in-app Web
 * Speech microphone was removed in M203: a person dictates with the keyboard's
 * own dictation key now, which reaches this app as ordinary typing. The
 * literal stays because it is a RECORDED VALUE: diary entries and analytics
 * events written before the removal carry it, and a union that dropped it
 * would make old, valid data unreadable. Nothing produces it any more.
 *
 * Pure and dependency-free.
 */

/** Every way an intake can start. `speech` is historic; see this module's header. */
export const INTAKE_SOURCES = ['photo', 'text', 'speech'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

/**
 * The sources that produce WORDS rather than a picture.
 *
 * A separate type rather than `Exclude<IntakeSource, 'photo'>` so a text
 * hand-off's own field says what it accepts at its declaration site.
 */
export type TypedIntakeSource = 'text' | 'speech';
