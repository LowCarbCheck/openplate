/**
 * THE CONTRIBUTION TIERS (`PROTOCOL.md` §3.5, `openplate-sync` ADR-0003
 * prohibition 1).
 *
 * A study chooses a TIER BY NAME and a date window. It never supplies a field
 * list, and there is no code path by which one could: the fields are the
 * frozen tuple below, the row type is bound to it in both directions, and a
 * unit test asserts the reducer's emitted key set against a list written
 * literally in the test file. Adding a field means changing all three, and one
 * of them is a human review gate.
 *
 * That is not ceremony. A study-supplied field list would turn this client
 * into a remotely configurable exfiltration engine and the consent screen into
 * UI generated from researcher-controlled input. The window is the one
 * study-supplied parameter, and it is safe because a window can only NARROW a
 * fixed schema — it cannot refine below the day floor or widen the field set.
 *
 * ── Why `loggedEntryCount` is not decoration ─────────────────────────────
 *
 * A researcher cannot otherwise tell "ate nothing" from "did not log". Both
 * would arrive as a row of zeros, and the difference is the whole difference
 * between a fasting day and a missing day. It is a COUNT, never the entries.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 *
 * Nothing finer than a calendar day, ever, in this tier. No food names, no
 * free text, no photos, no meal times, and no timestamp of any kind — `dayKey`
 * is the only temporal field a row carries, and `reduce.ts` buckets by it
 * alone. Weight trajectory is a plausible SECOND tier, separately consented,
 * defined when a study actually needs it — not a field added here.
 */

/** The one tier v1 defines. The server validates this name too (§5.18), so prohibition 1 has teeth on both sides of the wire. */
export const DAILY_INTAKE_V1 = 'daily-intake:v1';

/**
 * One reduced day. Seven fields, and the seventh is a count.
 *
 * `date` is the device-local calendar day (`YYYY-MM-DD`) the diary already
 * buckets by. It is NOT derived from an instant here — deriving it would put
 * this client's time zone into the reduction, and the diary's own answer is
 * the one the person actually saw on screen.
 */
export interface DailyIntakeV1Row {
  /** `YYYY-MM-DD`, device-local. The ONLY temporal field in this tier. */
  date: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  /** How many diary entries this day held. Zero on a day inside the window with nothing logged — see this module's header. */
  loggedEntryCount: number;
}

/**
 * THE FROZEN FIELD LIST, in `PROTOCOL.md` §3.5's order.
 *
 * `satisfies` binds it to {@link DailyIntakeV1Row} in one direction: a name
 * here that is not a field on the row fails the typecheck.
 * {@link DAILY_INTAKE_V1_FIELDS_ARE_TOTAL} binds the other.
 */
export const DAILY_INTAKE_V1_FIELDS = [
  'date',
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'loggedEntryCount',
] as const satisfies readonly (keyof DailyIntakeV1Row)[];

/** One field name from the frozen tuple. */
export type DailyIntakeV1Field = (typeof DAILY_INTAKE_V1_FIELDS)[number];

/**
 * The OTHER direction of the interlock: `true` only while every field on
 * {@link DailyIntakeV1Row} is named in {@link DAILY_INTAKE_V1_FIELDS}.
 *
 * Add a field to the row and forget the tuple, and the constant below stops
 * compiling with the unnamed field in the error text. Without this, `satisfies`
 * alone would happily accept a row type that had grown a field the frozen list
 * does not mention — which is precisely the field that would then ship.
 */
type FieldsAreTotal =
  Exclude<keyof DailyIntakeV1Row, DailyIntakeV1Field> extends never
    ? true
    : ['unlisted DailyIntakeV1Row field(s):', Exclude<keyof DailyIntakeV1Row, DailyIntakeV1Field>];

/** The type-level interlock, realised as a value so it cannot be dropped as unused. */
export const DAILY_INTAKE_V1_FIELDS_ARE_TOTAL: FieldsAreTotal = true;
