/**
 * The three decisions the reported-estimate console makes, away from React.
 *
 * ── Whether this instance has the feature at all ─────────────────────────
 *
 * `SYNC_FEEDBACK` off means `/v1/admin/feedback*` answers the ordinary 404 to
 * an administrator as much as to anybody, on purpose: an empty list would tell
 * an operator the feature exists and is merely switched off. This console has
 * to say the same thing, so the route 404s rather than rendering an empty
 * queue, and the tab that leads to it is not drawn.
 *
 * IT IS READ FROM `/health`, NEVER FROM A CONSTANT HERE. The one signal a
 * client gets is `instance.feedback.retentionDays`, which a service with the
 * feature off does not send at all. That number is also the promise made to
 * the person who handed over the photograph, so this app must never invent
 * one: see `#app/hooks/use-server-instance`.
 *
 * ── When a report deletes itself ─────────────────────────────────────────
 *
 * The service sweeps on its own. The date below is that promise, arithmetic
 * rather than a field, because there is no such field on the wire and adding
 * a local default would be a promise nobody made.
 *
 * ── Which figures a report carries ───────────────────────────────────────
 *
 * Seven, in the order a label prints them, each with the label key the diary
 * already uses. Reusing `entry.macro.*` is not tidiness: those seven words are
 * already written and already translated, and a second set would let the
 * console call a nutrient something the diary does not.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import type { ReportedMeasurements } from '#app/lib/admin/admin-wire';

/**
 * The retention window this instance advertises, or a 404.
 *
 * @throws a 404 `Response` on an instance that advertises no window, which is
 * every instance with reports switched off, plus every service older than the
 * field. Both are instances where this console has nothing to show and no
 * promise it could print.
 */
export function requireFeedbackWindow(instance: InstanceDescriptor | null): number {
  const retentionDays = instance?.feedback?.retentionDays ?? null;
  if (retentionDays === null) throw new Response('Not Found', { status: 404 });
  return retentionDays;
}

/** Whether the console is reachable on this instance. The same one signal, without the throw, for the tab bar. */
export function hasFeedbackConsole(instance: InstanceDescriptor | null): boolean {
  return (instance?.feedback?.retentionDays ?? null) !== null;
}

/**
 * When the service deletes this report by itself, or `null` when the timestamp
 * cannot be read.
 *
 * `null` RATHER THAN A GUESS. A createdAt this app cannot parse is a row it
 * knows nothing about, and printing the first of January 1970 plus thirty days
 * would be worse than printing nothing.
 */
export function reportDeletesAt(input: { createdAt: string; retentionDays: number }): Date | null {
  const created = new Date(input.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  return new Date(created + input.retentionDays * MILLISECONDS_PER_DAY);
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** One figure the model produced, with the diary's own word for it. */
export interface ReportedFigure {
  /** The key under `entry.macro.*`. The diary's seven words, not a second set. */
  labelKey: string;
  /** `null` is "the model gave none for this one", which is a fact worth showing rather than a zero. */
  value: number | null;
  unit: 'gram' | 'calorie';
}

/** The seven figures, in the order a label prints them. Always seven, so a missing one is visible as missing. */
export function reportedFigures(measurements: ReportedMeasurements): ReportedFigure[] {
  return [
    { labelKey: 'entry.macro.carbs', value: measurements.carbs, unit: 'gram' },
    { labelKey: 'entry.macro.fiber', value: measurements.fiber, unit: 'gram' },
    { labelKey: 'entry.macro.sugars', value: measurements.sugars, unit: 'gram' },
    { labelKey: 'entry.macro.polyols', value: measurements.polyols, unit: 'gram' },
    { labelKey: 'entry.macro.protein', value: measurements.protein, unit: 'gram' },
    { labelKey: 'entry.macro.fat', value: measurements.fat, unit: 'gram' },
    { labelKey: 'entry.macro.kcal', value: measurements.kcal, unit: 'calorie' },
  ];
}
