/**
 * The `fastingSettings` record end to end: what an untouched device reads,
 * what a write does to the fields it did not name, what the routine form
 * accepts, and that the three agree.
 *
 * THE INVARIANT WORTH THE FILE is that a routine edit must never re-ask the
 * care sheet. `extendedAcknowledgedAt` is the fourth field of a four-field
 * record and it is on no form, so it survives only because the store MERGES a
 * patch instead of replacing the record. A `put` that replaced would pass
 * every "the routine saved" assertion and quietly hand somebody the long-fast
 * sheet again every time they changed their eating window.
 *
 * The store harness is `fasting-store.test.ts`: a real in-memory TinyBase
 * store from `createPrimaryStore()`, no IndexedDB persister, passed to every
 * call as `{ store }`.
 *
 * The schema half drives `makeFastingRoutineSchema` with a key-echo translator
 * (`add-route.test.ts`'s double), so the assertions are about which submission
 * is accepted, never about the wording of a message.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { getLocalFastingSettings, putLocalFastingSettings } from '../../app/lib/local-store/primary-store';
import { makeFastingRoutineSchema } from '../../app/routes/settings.fasting';
import { needsCareSheet } from '../../app/models/fasting-care';
import type { Translate } from '../../app/routes/add';

const HOUR = 3_600_000;
const ACKNOWLEDGED_AT = 1_750_000_000_000;

/** Key-echo translator: catalog independent, so no assertion here pins a sentence. */
const echo: Translate = (key) => key;

const schema = makeFastingRoutineSchema(echo);

/** One routine submission, the three fields the form posts. */
function submission(overrides: { protocol?: string; hours?: string; time?: string } = {}) {
  return {
    routineProtocolId: overrides.protocol ?? '16:8',
    routineCustomHours: overrides.hours ?? '',
    routineStartMinute: overrides.time ?? '20:00',
  };
}

describe('the fasting settings record on a fresh device', () => {
  it('reads every field as null with updatedAt 0', async () => {
    const store = createPrimaryStore();

    const settings = await getLocalFastingSettings({ store });

    assert.deepEqual(settings, {
      routineProtocolId: null,
      routineStartMinute: null,
      routineCustomHours: null,
      extendedAcknowledgedAt: null,
      updatedAt: 0,
    });
    // The control: those nulls are the DEFAULT, not a row of nulls somebody
    // wrote. A write moves updatedAt off zero.
    const written = await putLocalFastingSettings({ routineStartMinute: 1_200 }, { store });
    assert.ok(written.updatedAt > 0, 'a write no longer stamps the record');
  });
});

describe('a fasting settings write merges, it does not replace', () => {
  it('persists extendedAcknowledgedAt through a later routine write', async () => {
    const store = createPrimaryStore();

    await putLocalFastingSettings({ extendedAcknowledgedAt: 1_000 }, { store });
    const afterFirst = await getLocalFastingSettings({ store });
    assert.equal(afterFirst.extendedAcknowledgedAt, 1_000, 'the acknowledgement did not persist at all');

    await putLocalFastingSettings({ routineProtocolId: '16:8' }, { store });

    const afterSecond = await getLocalFastingSettings({ store });
    assert.equal(afterSecond.extendedAcknowledgedAt, 1_000, 'a routine edit re-asks the care sheet');
    assert.equal(afterSecond.routineProtocolId, '16:8', 'the second write did not land');
    // The control that the second write really touched the record, so the
    // surviving acknowledgement is a merge and not a no-op.
    assert.notEqual(afterSecond.routineProtocolId, afterFirst.routineProtocolId);
  });

  it('clears a field only when it is passed as null, never by omission', async () => {
    const store = createPrimaryStore();
    await putLocalFastingSettings({ routineProtocolId: 'custom', routineCustomHours: 30 }, { store });

    const untouched = await putLocalFastingSettings({ routineStartMinute: 1_200 }, { store });
    assert.equal(untouched.routineCustomHours, 30, 'an omitted field was cleared');

    const cleared = await putLocalFastingSettings({ routineCustomHours: null }, { store });
    assert.equal(cleared.routineCustomHours, null, 'an explicit null did not clear the field');
  });
});

describe('the routine form schema', () => {
  it('refuses minute 1440, which is the hour that does not exist', () => {
    const parsed = schema.safeParse(submission({ time: '24:00' }));

    assert.equal(parsed.success, false, '24:00 was accepted as a start time');
  });

  it('accepts 23:59, the last real minute of the day', () => {
    const parsed = schema.safeParse(submission({ time: '23:59' }));

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.routineStartMinute, 23 * 60 + 59);
  });

  it('accepts an empty start time, which is how the routine hour is cleared', () => {
    const parsed = schema.safeParse(submission({ time: '' }));

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.routineStartMinute, null);
  });

  it('refuses 73 custom hours, one past the ceiling', () => {
    const parsed = schema.safeParse(submission({ protocol: 'custom', hours: '73' }));

    assert.equal(parsed.success, false, '73 hours was accepted');
  });

  it('accepts 72 custom hours, the ceiling itself', () => {
    const parsed = schema.safeParse(submission({ protocol: 'custom', hours: '72' }));

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.routineCustomHours, 72);
  });

  it('refuses a custom window with no hour count behind it', () => {
    // The superRefine, and the control on "72 was accepted": the custom chip
    // needs a number, so a passing parse above was really about the number.
    const parsed = schema.safeParse(submission({ protocol: 'custom', hours: '' }));

    assert.equal(parsed.success, false);
  });

  it('refuses a window it has never heard of', () => {
    assert.equal(schema.safeParse(submission({ protocol: '96h' })).success, false);
    // The control: the seven real ids and none do parse.
    for (const id of ['16:8', '18:6', '20:4', '24h', '36h', '48h', '72h', 'none']) {
      assert.equal(schema.safeParse(submission({ protocol: id })).success, true, `${id} was refused`);
    }
  });
});

describe('the store, the schema and the care decision agree', () => {
  it('a stored acknowledgement makes a 72 h target need no sheet', async () => {
    const store = createPrimaryStore();
    // A routine saved through the schema first, exactly as `/settings/fasting`
    // would: the form carries no acknowledgement field at all.
    const parsed = schema.safeParse(submission({ protocol: 'custom', hours: '72', time: '20:00' }));
    assert.equal(parsed.success, true);
    await putLocalFastingSettings({ extendedAcknowledgedAt: ACKNOWLEDGED_AT }, { store });
    await putLocalFastingSettings({ routineProtocolId: 'custom', routineCustomHours: 72 }, { store });

    const settings = await getLocalFastingSettings({ store });

    assert.equal(
      needsCareSheet({ targetMs: 72 * HOUR, extendedAcknowledgedAt: settings.extendedAcknowledgedAt }),
      false,
      'the sheet is due again after a routine save',
    );
    // The control, the same target read off a device that never acknowledged.
    const fresh = await getLocalFastingSettings({ store: createPrimaryStore() });
    assert.equal(needsCareSheet({ targetMs: 72 * HOUR, extendedAcknowledgedAt: fresh.extendedAcknowledgedAt }), true);
  });
});
