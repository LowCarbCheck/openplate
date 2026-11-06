/**
 * Drizzle implementation of `InstanceSettingsStore`: one row, read and
 * upserted.
 *
 * THE ID IS A LITERAL `1` IN BOTH STATEMENTS, and the check constraint in
 * `db/schema.ts` says the same thing. That is what makes the upsert below an
 * upsert rather than an insert that sometimes duplicates: the conflict target
 * is the primary key, and there is only ever one value it can hold.
 *
 * NOTHING HERE IS ON A REQUEST PATH THAT MATTERS. The read runs at boot and
 * on a 60 second timer, the write runs when an administrator changes the
 * setting. `/health` serves a process-local copy and never calls either, see
 * `instance/instance-settings.ts`.
 */
import { eq } from 'drizzle-orm';
import type {
  InstanceSettingsChange,
  InstanceSettingsRecord,
  InstanceSettingsStore,
  InstanceSettingsValues,
} from '../instance/instance-settings.js';
import type { Database } from './client.js';
import { instanceSettings } from './schema.js';

/** The primary key of the one row, named once so the two statements below cannot disagree. */
const SETTINGS_ROW_ID = 1;

type SettingsRow = typeof instanceSettings.$inferSelect;
type SettingsColumns = Partial<typeof instanceSettings.$inferInsert>;

function mapSettingsRow(row: SettingsRow): InstanceSettingsRecord {
  return {
    nutrientReferenceBasis: row.nutrientReferenceBasis,
    activityMail: {
      firstScan: { enabled: row.activityMailFirstScanEnabled, days: row.activityMailFirstScanDays },
      quiet: { enabled: row.activityMailQuietEnabled, days: row.activityMailQuietDays },
    },
    updatedAt: row.updatedAt,
  };
}

/** Every column of a full set of values, for the row an upsert creates. */
function columnsOfValues(values: InstanceSettingsValues): SettingsColumns {
  return {
    nutrientReferenceBasis: values.nutrientReferenceBasis,
    activityMailFirstScanEnabled: values.activityMail.firstScan.enabled,
    activityMailFirstScanDays: values.activityMail.firstScan.days,
    activityMailQuietEnabled: values.activityMail.quiet.enabled,
    activityMailQuietDays: values.activityMail.quiet.days,
  };
}

/**
 * Only the columns a change names, for the row an upsert updates. An absent
 * field is absent from the SET list, which is how "leave it alone" is said.
 */
function columnsOfChange(change: InstanceSettingsChange): SettingsColumns {
  const columns: SettingsColumns = {};
  if (change.nutrientReferenceBasis !== undefined) columns.nutrientReferenceBasis = change.nutrientReferenceBasis;
  const firstScan = change.activityMail?.firstScan;
  if (firstScan?.enabled !== undefined) columns.activityMailFirstScanEnabled = firstScan.enabled;
  if (firstScan?.days !== undefined) columns.activityMailFirstScanDays = firstScan.days;
  const quiet = change.activityMail?.quiet;
  if (quiet?.enabled !== undefined) columns.activityMailQuietEnabled = quiet.enabled;
  if (quiet?.days !== undefined) columns.activityMailQuietDays = quiet.days;
  return columns;
}

export function createDrizzleInstanceSettingsStore(db: Database): InstanceSettingsStore {
  return {
    async read(): Promise<InstanceSettingsRecord | null> {
      const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, SETTINGS_ROW_ID)).limit(1);

      // An instance nobody has changed anything on has no row, which is not an
      // error: the caller falls back to the environment default.
      return row === undefined ? null : mapSettingsRow(row);
    },

    async write(input: {
      values: InstanceSettingsValues;
      change: InstanceSettingsChange;
      now: Date;
    }): Promise<InstanceSettingsRecord> {
      const [row] = await db
        .insert(instanceSettings)
        .values({
          id: SETTINGS_ROW_ID,
          nutrientReferenceBasis: input.values.nutrientReferenceBasis,
          ...columnsOfValues(input.values),
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: { ...columnsOfChange(input.change), updatedAt: input.now },
        })
        .returning();

      // `RETURNING` on an upsert always yields the row it wrote; an absence
      // here would mean the statement did nothing, which is a bug rather than
      // a state to carry on from.
      if (row === undefined) throw new Error('instance_settings write returned no row');
      return mapSettingsRow(row);
    },
  };
}
