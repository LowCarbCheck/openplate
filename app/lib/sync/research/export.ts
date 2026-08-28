/**
 * THE COHORT EXPORT (`openplate-sync` ADR-0003, prohibitions 5 and 8).
 *
 * A CSV built from a PURGED cohort and nothing else. Its input type is
 * {@link StudyCohort}, which only {@link pullStudyCohort} produces and which
 * has no unpurged counterpart anywhere — so "did this export honour the
 * withdrawals?" is answered by the type, not by a reviewer reading the call
 * site.
 *
 * ── The header is not decoration ─────────────────────────────────────────
 *
 * Two things ride above the table, and both are load-bearing.
 *
 * 1. **The word is pseudonymised, never anonymous** (prohibition 5). A
 *    pseudonymous longitudinal series re-identifies against any auxiliary
 *    dataset the holder happens to have; ADR-0003 ranks that as the attack
 *    this design does not defeat, and the file that leaves this app says so in
 *    its first line rather than in a policy nobody exports.
 * 2. **What is missing is counted.** Rows sealed to a key this device does not
 *    hold, rows this revision cannot parse, and contributions dropped because
 *    somebody withdrew — each has a number in the header. A file that silently
 *    contained fewer people than the study enrolled would be analysed as if it
 *    were complete.
 *
 * ── Wording lives in one object, on purpose ──────────────────────────────
 *
 * Slice 05 finalises the sentences and translates them. Every string in this
 * file is in {@link RESEARCH_EXPORT_STRINGS} so that pass moves prose and
 * touches no logic. The FIELDS are fixed here: which numbers appear, and which
 * columns the table has.
 */
import { encodeCsv, type CsvRow } from '#app/lib/csv';
import type { StudyCohort } from './study';
import { DAILY_INTAKE_V1, DAILY_INTAKE_V1_FIELDS } from './tiers';

/** Preamble lines are CSV comments: a leading `#`, which every spreadsheet and every `read_csv` can be told to skip. */
const COMMENT_PREFIX = '# ';

/** RFC 4180 record separator, matching `encodeCsv`'s. */
const RECORD_SEPARATOR = '\r\n';

/**
 * Every sentence this export writes, in one place for slice 05's wording and
 * i18n pass. Nothing below builds a string by concatenation at its use site.
 */
export const RESEARCH_EXPORT_STRINGS = {
  /** Prohibition 5, in the first line of the file, with the auxiliary-join caveat in one sentence. */
  pseudonymisedNotice:
    'This data is PSEUDONYMISED, not anonymous: each participant is a stable pseudonym rather than a name, and anyone holding a second dataset about the same people may be able to re-identify them by joining on it.',
  tier: (tier: string): string => `Schema tier: ${tier}`,
  window: (fromDayKey: string, toDayKey: string): string => `Window: ${fromDayKey} to ${toDayKey} (inclusive)`,
  participants: (count: number): string => `Participants in this file: ${count}`,
  withdrawn: (count: number): string =>
    `Withdrawn and purged before this export: ${count}. Their rows are not in this file and must not be recovered from an earlier one.`,
  /** Printed ONLY when non-zero — see {@link buildExportHeaderLines}. A line that always says "0" is a line nobody reads. */
  serverRetainedWithdrawn: (count: number): string =>
    `ANOMALY: the server returned ${count} contribution(s) it had already been instructed to delete. They were purged here, and the deployment should be investigated.`,
  unopenable: (unopenable: number, total: number): string =>
    `Sealed to a key this device does not hold: ${unopenable} of ${total} contributions. They are not in this file. This is a key problem, not a data problem.`,
  malformed: (count: number): string =>
    `Not readable by this version: ${count} contributions. A non-zero number here is a bug worth reporting.`,
  /** The reduction sums only what was known; a low total can therefore mean "unknown", and `loggedEntryCount` alone does not distinguish the two. */
  unknownMacroCaveat:
    'A macro that was unknown for an entry contributes nothing to that day total, so a low total may mean unknown rather than low intake. Read loggedEntryCount alongside every total, and treat a zero total with a non-zero count as unquantified.',
} as const;

/** The table's columns: the participant's pseudonym, then the frozen tier fields in `PROTOCOL.md` §3.5's order. */
const EXPORT_COLUMNS: readonly string[] = ['pseudonym', ...DAILY_INTAKE_V1_FIELDS];

/**
 * Renders a purged cohort as a CSV document.
 *
 * @param cohort - the output of {@link pullStudyCohort}. There is no other way to obtain this type, and that is the point.
 * @param fromDayKey - the window's inclusive start, as the study requested it. Echoed, never inferred from the rows: an empty cohort still has a window.
 * @param toDayKey - the window's inclusive end.
 * @param tier - the tier the study asked for. Defaults to the one tier v1 defines.
 * @returns the whole document: comment preamble, header row, one row per participant per day.
 */
export function exportStudyCohortCsv({
  cohort,
  fromDayKey,
  toDayKey,
  tier = DAILY_INTAKE_V1,
}: {
  cohort: StudyCohort;
  fromDayKey: string;
  toDayKey: string;
  tier?: string;
}): string {
  const preamble = buildExportHeaderLines({ cohort, fromDayKey, toDayKey, tier });
  const table = encodeCsv({ header: EXPORT_COLUMNS, rows: buildRows(cohort) });
  return [...preamble.map((line) => `${COMMENT_PREFIX}${line}`), table].join(RECORD_SEPARATOR);
}

/**
 * The header lines, in order — exported so a screen can show the SAME
 * sentences it is about to write into a file. A second wording for the on-screen
 * summary is a second wording to get wrong.
 */
export function buildExportHeaderLines({
  cohort,
  fromDayKey,
  toDayKey,
  tier = DAILY_INTAKE_V1,
}: {
  cohort: StudyCohort;
  fromDayKey: string;
  toDayKey: string;
  tier?: string;
}): string[] {
  const strings = RESEARCH_EXPORT_STRINGS;
  // The denominator is what the pull actually considered after the purge:
  // opened rows plus the two it could not use. Adding the withdrawn ones back
  // in would put purged people into a ratio printed on a research artifact.
  const considered = cohort.rows.length + cohort.unopenableCount + cohort.malformedCount;
  const lines = [
    strings.pseudonymisedNotice,
    strings.tier(tier),
    strings.window(fromDayKey, toDayKey),
    strings.participants(cohort.rows.length),
    strings.withdrawn(cohort.withdrawnCount),
    strings.unopenable(cohort.unopenableCount, considered),
    strings.malformed(cohort.malformedCount),
    strings.unknownMacroCaveat,
  ];
  // CONDITIONAL, and the only conditional line in this header. Every other
  // number is a fact about a normal pull and belongs on every file; this one
  // is an incident report, and printing "0 anomalies" on every export is how a
  // reader learns to skip the line that one day says 3.
  if (cohort.serverRetainedWithdrawnCount > 0) {
    lines.push(strings.serverRetainedWithdrawn(cohort.serverRetainedWithdrawnCount));
  }
  return lines;
}

/** One row per participant per day, in the order the pull returned them and the reduction emitted them. */
function buildRows(cohort: StudyCohort): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const participant of cohort.rows) {
    for (const day of participant.days) {
      rows.push([
        participant.pseudonym,
        day.date,
        day.energyKcal,
        day.proteinG,
        day.carbsG,
        day.fatG,
        day.fiberG,
        day.loggedEntryCount,
      ]);
    }
  }
  return rows;
}
