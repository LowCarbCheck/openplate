/**
 * THE PAYLOAD CODEC — the bytes `contribution-wrap.ts` seals, and the rows the
 * study side gets back (`PROTOCOL.md` §3.5).
 *
 * `sealContribution` and `openContribution` take and return BYTES on purpose:
 * that module owns the crypto and nothing else. Something still has to decide
 * what those bytes are, and if that decision lived at each call site the
 * contributor and the study would eventually serialize differently — a
 * disagreement that surfaces as rows that decrypt perfectly and then parse
 * into nothing.
 *
 * ── Why the decode validates rather than casts ───────────────────────────
 *
 * The plaintext is AAD-bound and tag-checked, so it is authentic — but
 * authentic is not the same as well-formed. It was produced by a client whose
 * version this device does not know, and the schema is frozen by protocol
 * revision, so a payload that does not match the tier is a fact worth
 * surfacing rather than a shape to assume. Zod at the boundary, exactly as
 * everywhere else in this app.
 *
 * ── Why the row schema is written out here ───────────────────────────────
 *
 * `DAILY_INTAKE_V1_FIELDS` is the frozen NAME list and `tiers.ts` owns it. The
 * schema below is the frozen WIRE shape, and it is `.strict()`: a payload
 * carrying a field nobody classified is rejected, not passed through. That is
 * ADR-0003 prohibition 11 on the reading side — the reduction fails closed on
 * the way out, and this fails closed on the way in.
 */
import { z } from 'zod';
import type { DailyIntakeV1Row } from './tiers';

/** The wire shape of one `daily-intake:v1` row. Strict: an unclassified field is a rejection, never a pass-through. */
const dailyIntakeV1RowSchema = z
  .object({
    date: z.string(),
    energyKcal: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
    fiberG: z.number(),
    loggedEntryCount: z.number(),
  })
  .strict() satisfies z.ZodType<DailyIntakeV1Row>;

const dailyIntakeV1PayloadSchema = z.array(dailyIntakeV1RowSchema);

/** Serializes the reduced rows into the bytes a contribution seals. UTF-8 JSON — readable by a self-hoster debugging their own instance, per §4's transport rule. */
export function encodeDailyIntakeV1Payload(rows: readonly DailyIntakeV1Row[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(rows));
}

/**
 * Parses an opened payload back into rows.
 *
 * @returns the rows, or `null` when the bytes are not a well-formed
 *   `daily-intake:v1` payload. `null` rather than a throw because the study
 *   client counts what it could not use — a cohort that silently shrinks is
 *   worse than one that says how much it lost.
 */
export function decodeDailyIntakeV1Payload(payload: Uint8Array): DailyIntakeV1Row[] | null {
  try {
    // The parse and the validation sit in ONE try because their failures are
    // the same fact to a caller: these bytes are not this tier. Splitting them
    // would need a helper handing an unparsed value across a boundary, which
    // is the shape zod exists here to avoid.
    const parsed = dailyIntakeV1PayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(payload)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
