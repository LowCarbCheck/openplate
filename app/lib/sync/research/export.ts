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
 * Slice 05 moved the sentences into the `research` i18n namespace, where both
 * shipped locales are walked by a test. What stayed here is the FIELD LIST —
 * {@link ResearchExportStrings} — and the two decisions that are protocol
 * rather than prose: which numbers appear, and which columns the table has.
 * The caller passes the words in; this module chooses the lines.
 */
import { encodeCsv, type CsvRow } from '#app/lib/csv';
import type { StudyCohort } from './study';
import { DAILY_INTAKE_V1, DAILY_INTAKE_V1_FIELDS } from './tiers';

/** Preamble lines are CSV comments: a leading `#`, which every spreadsheet and every `read_csv` can be told to skip. */
const COMMENT_PREFIX = '# ';

/** RFC 4180 record separator, matching `encodeCsv`'s. */
const RECORD_SEPARATOR = '\r\n';

/** How a translator is passed in — the repo's established `Translate` shape (`app/lib/streak-message.ts` and friends). */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Every sentence this export writes, as one object the caller supplies.
 *
 * THE FIELD LIST IS FIXED HERE and the WORDS ARE NOT: which numbers appear in
 * a research artifact is a protocol decision (prohibition 5's notice, and the
 * three counts that stop a file from shrinking silently), while the sentences
 * are copy and live in the `research` i18n namespace where both locales are
 * walked by `tests/unit/research-wording.test.ts`. Dropping a field breaks the
 * typecheck; softening a sentence breaks the wording test.
 */
export interface ResearchExportStrings {
  /** Prohibition 5, in the first line of the file, with the auxiliary-join caveat in one sentence. */
  pseudonymisedNotice: string;
  tier: (tier: string) => string;
  window: (fromDayKey: string, toDayKey: string) => string;
  participants: (count: number) => string;
  withdrawn: (count: number) => string;
  /** Printed ONLY when non-zero — see {@link buildExportHeaderLines}. A line that always says "0" is a line nobody reads. */
  serverRetainedWithdrawn: (count: number) => string;
  unopenable: (unopenable: number, total: number) => string;
  malformed: (count: number) => string;
  /** The reduction sums only what was known; a low total can therefore mean "unknown", and `loggedEntryCount` alone does not distinguish the two. */
  unknownMacroCaveat: string;
}

/**
 * Reads the export's sentences out of the `research` i18n namespace.
 *
 * The anomaly line is deliberately NOT under `research.export`: it is
 * addressed to an OPERATOR, not to a researcher — "the deployment handed over
 * a contribution it had been instructed to delete" is a thing to investigate,
 * not a fact about the cohort — so it sits in `research.anomaly` and reads as
 * a warning. It still rides in the header, because the person holding the file
 * is the person who can raise it.
 */
export function buildResearchExportStrings(t: Translate): ResearchExportStrings {
  return {
    pseudonymisedNotice: t('research.export.pseudonymisedNotice'),
    tier: (tier) => t('research.export.tier', { tier }),
    window: (fromDayKey, toDayKey) => t('research.export.window', { from: fromDayKey, to: toDayKey }),
    // NOT `count`: i18next reads that name as a plural selector, and these
    // keys have no plural forms. A selector with nothing to select is a silent
    // fallback waiting to become a missing sentence.
    participants: (participants) => t('research.export.participants', { participants }),
    withdrawn: (withdrawn) => t('research.export.withdrawn', { withdrawn }),
    serverRetainedWithdrawn: (retained) => t('research.anomaly.serverRetainedWithdrawn', { retained }),
    unopenable: (unopenable, total) => t('research.export.unopenable', { unopenable, total }),
    malformed: (malformed) => t('research.export.malformed', { malformed }),
    unknownMacroCaveat: t('research.export.unknownMacroCaveat'),
  };
}

/** The table's columns: the participant's pseudonym, then the frozen tier fields in `PROTOCOL.md` §3.5's order. */
const EXPORT_COLUMNS: readonly string[] = ['pseudonym', ...DAILY_INTAKE_V1_FIELDS];

/**
 * Renders a purged cohort as a CSV document.
 *
 * @param cohort - the output of {@link pullStudyCohort}. There is no other way to obtain this type, and that is the point.
 * @param fromDayKey - the window's inclusive start, as the study requested it. Echoed, never inferred from the rows: an empty cohort still has a window.
 * @param toDayKey - the window's inclusive end.
 * @param tier - the tier the study asked for. Defaults to the one tier v1 defines.
 * @param strings - the sentences, from {@link buildResearchExportStrings}. REQUIRED, and deliberately not defaulted to an English object: a default is a second English wording that no locale test walks.
 * @returns the whole document: comment preamble, header row, one row per participant per day.
 */
export function exportStudyCohortCsv({
  cohort,
  fromDayKey,
  toDayKey,
  tier = DAILY_INTAKE_V1,
  strings,
}: {
  cohort: StudyCohort;
  fromDayKey: string;
  toDayKey: string;
  tier?: string;
  strings: ResearchExportStrings;
}): string {
  const preamble = buildExportHeaderLines({ cohort, fromDayKey, toDayKey, tier, strings });
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
  strings,
}: {
  cohort: StudyCohort;
  fromDayKey: string;
  toDayKey: string;
  tier?: string;
  strings: ResearchExportStrings;
}): string[] {
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
