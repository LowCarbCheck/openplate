/**
 * A weigh-in the person logs on a day that holds an IMPORTED weigh-in is
 * their own measurement, not an edit of the import (M254/05).
 *
 * `upsertLocalWeightEntryForDay` used to reuse whatever row the day held, so
 * a weight typed over a `yazio-weight-<day>` row kept the import's id, and
 * "Remove YAZIO entries" or a re-import of the same file then took the
 * person's own number. These run against a real in-memory primary store, the
 * way `had-data-marker.test.ts` does.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import {
  listDeletedEntityKeys,
  listLocalWeightEntries,
  putLocalWeightEntry,
  upsertLocalWeightEntryForDay,
} from '../../app/lib/local-store/primary-store';
import { entityKey } from '../../app/lib/local-store/schema';
import { isYazioImportId } from '../../app/lib/yazio-ids';

const DAY = '2026-09-20';
const IMPORTED_ID = `yazio-weight-${DAY}`;
const IMPORTED_AT = Date.UTC(2026, 8, 1);

/** A store holding one imported weigh-in on {@link DAY}, as the YAZIO import writes it. */
async function storeWithImportedWeighIn() {
  const store = createPrimaryStore();
  await putLocalWeightEntry(
    { id: IMPORTED_ID, dayKey: DAY, weightKg: 81.2, loggedAt: IMPORTED_AT, createdAt: IMPORTED_AT },
    { store },
  );
  return store;
}

describe('upsertLocalWeightEntryForDay over an imported weigh-in', () => {
  it('writes the person weigh-in as a new row with its own id and createdAt', async () => {
    const store = await storeWithImportedWeighIn();
    const written = await upsertLocalWeightEntryForDay({ dayKey: DAY, weightKg: 80 }, { store });

    assert.ok(!isYazioImportId(written.id), `the new weigh-in must not carry the import id, got ${written.id}`);
    assert.ok(written.createdAt > IMPORTED_AT, 'the new weigh-in takes a fresh createdAt');
    const onDay = (await listLocalWeightEntries({ store })).filter((entry) => entry.dayKey === DAY);
    assert.deepStrictEqual(onDay, [written], 'the day holds exactly the person weigh-in');
  });

  it('removes the imported row through the delete journal', async () => {
    const store = await storeWithImportedWeighIn();
    // CONTROL: before the upsert, the journal does not name the imported row.
    assert.ok(!(await listDeletedEntityKeys({ store })).includes(entityKey('weightEntry', IMPORTED_ID)));
    await upsertLocalWeightEntryForDay({ dayKey: DAY, weightKg: 80 }, { store });
    assert.ok((await listDeletedEntityKeys({ store })).includes(entityKey('weightEntry', IMPORTED_ID)));
  });

  it('still updates a native weigh-in in place, keeping its id and createdAt, and journals nothing', async () => {
    const store = createPrimaryStore();
    const first = await upsertLocalWeightEntryForDay({ dayKey: DAY, weightKg: 82 }, { store });
    const second = await upsertLocalWeightEntryForDay({ dayKey: DAY, weightKg: 81 }, { store });

    assert.strictEqual(second.id, first.id);
    assert.strictEqual(second.createdAt, first.createdAt);
    assert.strictEqual(second.weightKg, 81);
    assert.strictEqual((await listLocalWeightEntries({ store })).length, 1);
    assert.deepStrictEqual(await listDeletedEntityKeys({ store }), []);
  });
});
