/**
 * WHAT THE CONSOLE SAYS ABOUT A PULLED COHORT — the export's own sentences,
 * each with the register it must be read in.
 *
 * ── One wording, not two ─────────────────────────────────────────────────
 *
 * `buildExportHeaderLines` is exported so a screen can show the SAME sentences
 * the file is about to carry. This module pairs those lines with a register
 * and adds nothing to the text: a second on-screen wording is a second wording to get wrong, and the
 * one in the file is the one that has to survive being read a year later by
 * somebody who was not in the room.
 *
 * ── Three registers, and confusing them is the defect ────────────────────
 *
 *  - `information` — including the un-openable count. "4 of 31 are sealed to a
 *    key this device does not hold" is the NORMAL state after a rotation or a
 *    restore from an older snapshot; `study.ts` reports it precisely so the
 *    cohort does not shrink in silence. Styling it as a failure would teach a
 *    researcher that a working console is broken.
 *  - `bug` — `malformedCount`, and only that. Every key failed identically on
 *    a body this protocol revision cannot parse: there is nothing to retry and
 *    it is worth reporting.
 *  - `operator-warning` — a non-zero `serverRetainedWithdrawnCount`. Addressed
 *    to whoever runs the deployment, not to the researcher: the service handed
 *    over a contribution it had already been instructed to delete. Different
 *    audience, different register.
 *
 * ── The pairing is checked, not assumed ──────────────────────────────────
 *
 * The tones are a tuple in the header's own order, so {@link toneCohortLines}
 * REFUSES rather than mislabels if the header ever grows or drops a line — a
 * silently shifted tone would style the malformed count as information.
 */
import type { StudyCohort } from './study';

/** How a line is to be read. There is no fourth value, and `information` is not a euphemism for `bug`. */
export type CohortLineTone = 'information' | 'bug' | 'operator-warning';

/**
 * The header's lines, in the order {@link buildExportHeaderLines} emits them.
 *
 * The anomaly line is deliberately absent: it is CONDITIONAL, appended only
 * when there is an anomaly, and {@link toneCohortLines} appends its id in the
 * same branch.
 */
export const COHORT_LINE_IDS = [
  'pseudonymisedNotice',
  'tier',
  'window',
  'participants',
  'withdrawn',
  'unopenable',
  'malformed',
  'unknownMacroCaveat',
] as const;

/** One line's identity — every unconditional line, plus the conditional anomaly. */
export type CohortLineId = (typeof COHORT_LINE_IDS)[number] | 'serverRetainedWithdrawn';

/** The register each line is read in. `satisfies` so a new line cannot be added without deciding one. */
export const COHORT_LINE_TONES = {
  pseudonymisedNotice: 'information',
  tier: 'information',
  window: 'information',
  participants: 'information',
  withdrawn: 'information',
  unopenable: 'information',
  malformed: 'bug',
  unknownMacroCaveat: 'information',
  serverRetainedWithdrawn: 'operator-warning',
} as const satisfies Record<CohortLineId, CohortLineTone>;

/** One line of the summary: the export's own text, and how to read it. */
export interface CohortSummaryLine {
  id: CohortLineId;
  tone: CohortLineTone;
  /** Verbatim from {@link buildExportHeaderLines}. Never paraphrased, never re-interpolated here. */
  text: string;
}

/**
 * Pairs the export's header lines with their registers.
 *
 * Takes the lines rather than building them, so the ONE call to
 * `buildExportHeaderLines` sits at the screen that shows them and beside the
 * `exportStudyCohortCsv` call that writes them — visibly the same sentences,
 * from the same builder, in the same frame.
 *
 * @param lines - the output of `buildExportHeaderLines`, in its own order.
 * @param cohort - the cohort those lines describe. Read for one thing only: whether the conditional anomaly line is among them.
 * @throws when the line count and the id list disagree — see this module's header.
 */
export function toneCohortLines({ lines, cohort }: { lines: string[]; cohort: StudyCohort }): CohortSummaryLine[] {
  const ids: CohortLineId[] =
    cohort.serverRetainedWithdrawnCount > 0 ? [...COHORT_LINE_IDS, 'serverRetainedWithdrawn'] : [...COHORT_LINE_IDS];

  if (lines.length !== ids.length) {
    throw new Error(
      `the export header emitted ${lines.length} lines and this view knows ${ids.length} — pair the new line with a tone in COHORT_LINE_TONES before showing it`,
    );
  }

  return ids.map((id, index) => ({ id, tone: COHORT_LINE_TONES[id], text: lines[index] ?? '' }));
}
