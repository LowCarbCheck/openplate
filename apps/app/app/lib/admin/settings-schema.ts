/**
 * The instance-settings form's rules, in one place the form and its test both
 * read, exactly as `invite-schema.ts` is.
 *
 * ── ONE FIELD, AND IT IS A CLOSED SET ────────────────────────────────────
 *
 * The three names are the wire's (`admin-wire.ts`, transcribed from
 * `openplate-core/PROTOCOL.md` §5.20), so the form refuses a fourth here and
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

import type { NutrientReferenceBasis } from './admin-wire';
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
