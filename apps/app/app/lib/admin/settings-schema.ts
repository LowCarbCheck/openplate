/**
 * The instance-settings form's rules, in one place the form and its test both
 * read, exactly as `invite-schema.ts` is.
 *
 * ── ONE FIELD, AND IT IS A CLOSED SET ────────────────────────────────────
 *
 * The three names are the wire's (`admin-wire.ts`, transcribed from
 * `apps/core/PROTOCOL.md` §5.20), so the form refuses a fourth here and
 * the service refuses it again at the column. What this setting decides is a
 * set of numbers a person is shown beside their food, which is why both ends
 * check rather than one.
 *
 * ── WHY THE FORM VALIDATES AT ALL ────────────────────────────────────────
 *
 * A radio group cannot normally produce a bad value, so this looks like
 * ceremony. It is not: a submission with the field MISSING is the ordinary
 * result of a form somebody never touched, and a request that named no basis
 * is the one body `PATCH /v1/admin/settings` answers `400` to. Refusing it
 * here turns a failed request into a sentence beside the control.
 */
import { z } from 'zod';

import {
  ACTIVITY_MAIL_DAY_BOUNDS,
  type ActivityMailKind,
  type AdminActivityMailSettings,
  type NutrientReferenceBasis,
} from './admin-wire';
import type { Translate } from '../sync/setup-flow';

/**
 * The three choices as `z.enum` needs them: a non-empty tuple.
 *
 * Spelled out rather than derived from `NUTRIENT_REFERENCE_BASES` in
 * `admin-wire.ts`, because that one is a `readonly` array and the enum needs
 * the literal arity. The `satisfies` below is what keeps the two from
 * drifting: a name the wire drops, or renames, fails the build here.
 */
const BASIS_TUPLE = ['dge', 'efsa', 'us'] as const satisfies readonly NutrientReferenceBasis[];

export function makeInstanceSettingsSchema(t: Translate) {
  return z.object({
    nutrientReferenceBasis: z.enum(BASIS_TUPLE, { error: () => t('admin.settings.invalid') }),
  });
}

/** The one value a valid submission carries. */
export type InstanceSettingsFormValues = z.infer<ReturnType<typeof makeInstanceSettingsSchema>>;

/** The copy key for each choice's label. One entry per basis, so a new one cannot be drawn unlabelled. */
export const BASIS_LABEL_KEY = {
  dge: 'admin.settings.basis.dge',
  efsa: 'admin.settings.basis.efsa',
  us: 'admin.settings.basis.us',
} satisfies Record<NutrientReferenceBasis, string>;

// ─── The reminder emails (2026-11) ──────────────────────────────────────────
//
// Not a Conform form: each kind is a switch and a day count, the page keeps
// the two in plain state, and this is the one pure rule they share. The bounds
// are the wire's (`ACTIVITY_MAIL_DAY_BOUNDS`), so the page refuses a number the
// core would refuse before a request is made.

/** What the page holds for one kind while it is edited: the switch, and the day count as typed. */
export interface ActivityMailKindDraft {
  enabled: boolean;
  days: string;
}

/**
 * Reads a typed day count: a whole number inside the kind's bounds, or `null`.
 *
 * STRICT ON PURPOSE. `Number('7.5')`, `Number('1e1')` and `Number('')` are all
 * numbers or zero to JavaScript, and none of them is a number of days anybody
 * typed on purpose; only plain digits are read.
 *
 * @param input.kind - which reminder the count belongs to.
 * @param input.raw - the text of the days box.
 */
export function parseActivityMailDays({ kind, raw }: { kind: ActivityMailKind; raw: string }): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const days = Number(text);
  const { min, max } = ACTIVITY_MAIL_DAY_BOUNDS[kind];
  return days >= min && days <= max ? days : null;
}

/**
 * The draft as a wire value, or `null` when a day count is out of range.
 * Both kinds are checked, so one bad box never lets the other one be saved
 * alone.
 */
export function readActivityMailDrafts(
  drafts: Record<ActivityMailKind, ActivityMailKindDraft>,
): AdminActivityMailSettings | null {
  const firstScan = parseActivityMailDays({ kind: 'firstScan', raw: drafts.firstScan.days });
  const quiet = parseActivityMailDays({ kind: 'quiet', raw: drafts.quiet.days });
  if (firstScan === null || quiet === null) return null;
  return {
    firstScan: { enabled: drafts.firstScan.enabled, days: firstScan },
    quiet: { enabled: drafts.quiet.enabled, days: quiet },
  };
}
