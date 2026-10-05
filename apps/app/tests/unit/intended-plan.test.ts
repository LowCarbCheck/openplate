/**
 * The plan a person chose before they had an account (`app/lib/plans/intended-plan.ts`).
 *
 * Four rules, each with the case that would pass a module that ignored it:
 *
 *  1. SOURCES: the address first (query, then fragment), storage second.
 *  2. EXPIRY: a stored choice counts for seven days and is removed after.
 *  3. VALIDITY: only `monthly` and `yearly`; anything else is ignored and
 *     leaves an earlier valid choice alone.
 *  4. CLEAR: gone after the order, and a storage that throws never throws here.
 *  5. THE TIER beside the plan (M2/06): a label, kept only with a plan, kept
 *     through the mailed join link, and never invented.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  INTENDED_PLAN_STORAGE_KEY,
  INTENDED_PLAN_TTL_MS,
  captureIntendedPlan,
  clearIntendedPlan,
  decodeIntendedPlan,
  encodeIntendedPlan,
  planParamOf,
  readIntendedPlan,
  readIntendedTier,
  readPlanKey,
  readTierId,
  rememberIntendedPlan,
  tierParamOf,
  decodeIntendedTier,
  TIER_ID_PATTERN,
  type IntendedPlanStorage,
} from '../../app/lib/plans/intended-plan';

/** A fixed instant, so every age below is exact. */
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

/** An in-memory storage, with its contents readable by the test. */
function memoryStorage(initial: ReadonlyArray<readonly [string, string]> = []) {
  const items = new Map<string, string>(initial);
  const storage: IntendedPlanStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
  return { storage, items };
}

/** What a sandboxed frame's storage does with every call. */
function refuse(): never {
  throw new Error('SecurityError');
}

/** A storage whose every call throws. */
function throwingStorage(): IntendedPlanStorage {
  return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

/** A storage that already holds a choice made `ageMs` before {@link NOW}. */
function storedChoice(plan: 'monthly' | 'yearly', ageMs: number) {
  return memoryStorage([[INTENDED_PLAN_STORAGE_KEY, encodeIntendedPlan({ plan, now: NOW - ageMs })]]);
}

describe('readPlanKey', () => {
  it('names the two plans the biller sells', () => {
    assert.equal(readPlanKey('monthly'), 'monthly');
    assert.equal(readPlanKey('yearly'), 'yearly');
  });

  it('ignores anything else, including a near miss', () => {
    for (const value of ['weekly', 'Yearly', ' yearly', 'yearly ', '', null, undefined]) {
      assert.equal(readPlanKey(value), null, String(value));
    }
  });
});

describe('planParamOf', () => {
  it('reads the query string', () => {
    assert.equal(planParamOf({ search: '?plan=yearly&lang=fr', hash: '' }), 'yearly');
  });

  it('reads the fragment, where the mailed join link carries it', () => {
    assert.equal(
      planParamOf({ search: '', hash: '#server=https%3A%2F%2Fsync.example&invite=si_abc&plan=monthly' }),
      'monthly',
    );
  });

  it('prefers the query string when both name a plan', () => {
    assert.equal(planParamOf({ search: '?plan=monthly', hash: '#plan=yearly' }), 'monthly');
  });

  it('falls through an unknown query value to the fragment', () => {
    assert.equal(planParamOf({ search: '?plan=weekly', hash: '#plan=yearly' }), 'yearly');
  });

  it('answers nothing for an address with no plan in it', () => {
    assert.equal(planParamOf({ search: '?lang=fr', hash: '#invite=si_abc' }), null);
    assert.equal(planParamOf({ search: '', hash: '' }), null);
  });
});

describe('decodeIntendedPlan', () => {
  it('reads back what encodeIntendedPlan wrote', () => {
    assert.equal(decodeIntendedPlan({ raw: encodeIntendedPlan({ plan: 'yearly', now: NOW }), now: NOW }), 'yearly');
  });

  it('honours a choice for just under seven days, and not at seven days', () => {
    const raw = encodeIntendedPlan({ plan: 'monthly', now: NOW });
    assert.equal(decodeIntendedPlan({ raw, now: NOW + INTENDED_PLAN_TTL_MS - 1 }), 'monthly');
    assert.equal(decodeIntendedPlan({ raw, now: NOW + INTENDED_PLAN_TTL_MS }), null);
  });

  it('pins the lifetime at seven days', () => {
    assert.equal(INTENDED_PLAN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it('refuses a record that is not one', () => {
    for (const raw of ['yearly', '{"plan":"weekly","at":1}', '{"plan":"yearly"}', '{"plan":"yearly","at":"x"}', '[]']) {
      assert.equal(decodeIntendedPlan({ raw, now: NOW }), null, raw);
    }
    assert.equal(decodeIntendedPlan({ raw: null, now: NOW }), null);
  });
});

describe('captureIntendedPlan', () => {
  it('stores a plan the address names, with the time it arrived', () => {
    const { storage, items } = memoryStorage();
    assert.equal(captureIntendedPlan({ search: '?plan=yearly', hash: '', now: NOW, storage }), 'yearly');
    assert.equal(items.get(INTENDED_PLAN_STORAGE_KEY), encodeIntendedPlan({ plan: 'yearly', now: NOW }));
  });

  it('reads storage when the address names no plan', () => {
    const { storage } = storedChoice('monthly', 60_000);
    assert.equal(captureIntendedPlan({ search: '', hash: '', now: NOW, storage }), 'monthly');
  });

  it('lets the address replace an earlier choice', () => {
    const { storage, items } = storedChoice('monthly', 60_000);
    assert.equal(captureIntendedPlan({ search: '?plan=yearly', hash: '', now: NOW, storage }), 'yearly');
    assert.equal(items.get(INTENDED_PLAN_STORAGE_KEY), encodeIntendedPlan({ plan: 'yearly', now: NOW }));
  });

  it('ignores an unknown plan and keeps the earlier valid one', () => {
    const { storage, items } = storedChoice('yearly', 60_000);
    const before = items.get(INTENDED_PLAN_STORAGE_KEY);
    assert.equal(captureIntendedPlan({ search: '?plan=weekly', hash: '', now: NOW, storage }), 'yearly');
    assert.equal(items.get(INTENDED_PLAN_STORAGE_KEY), before);
  });

  it('writes nothing for an unknown plan on a clean device', () => {
    const { storage, items } = memoryStorage();
    assert.equal(captureIntendedPlan({ search: '?plan=weekly', hash: '', now: NOW, storage }), null);
    assert.equal(items.size, 0);
  });

  it('reads the fragment of a join link on a device with no storage entry', () => {
    const { storage } = memoryStorage();
    assert.equal(captureIntendedPlan({ search: '', hash: '#invite=si_abc&plan=yearly', now: NOW, storage }), 'yearly');
    assert.equal(readIntendedPlan({ now: NOW + 1, storage }), 'yearly');
  });

  it('answers the address even where storage refuses every call', () => {
    assert.equal(
      captureIntendedPlan({ search: '?plan=monthly', hash: '', now: NOW, storage: throwingStorage() }),
      'monthly',
    );
    assert.equal(captureIntendedPlan({ search: '', hash: '', now: NOW, storage: throwingStorage() }), null);
  });

  it('answers the address where there is no storage at all', () => {
    assert.equal(captureIntendedPlan({ search: '?plan=yearly', hash: '', now: NOW, storage: null }), 'yearly');
  });
});

describe('readIntendedPlan', () => {
  it('reads a choice made six days ago', () => {
    const { storage } = storedChoice('yearly', 6 * 24 * 60 * 60 * 1000);
    assert.equal(readIntendedPlan({ now: NOW, storage }), 'yearly');
  });

  it('forgets and removes a choice made seven days ago', () => {
    const { storage, items } = storedChoice('yearly', INTENDED_PLAN_TTL_MS);
    assert.equal(readIntendedPlan({ now: NOW, storage }), null);
    assert.equal(items.has(INTENDED_PLAN_STORAGE_KEY), false);
  });

  it('removes a record it cannot read, so it never comes back', () => {
    const { storage, items } = memoryStorage([[INTENDED_PLAN_STORAGE_KEY, 'not json']]);
    assert.equal(readIntendedPlan({ now: NOW, storage }), null);
    assert.equal(items.has(INTENDED_PLAN_STORAGE_KEY), false);
  });

  it('leaves other keys alone', () => {
    const { storage, items } = memoryStorage([['openplate-language', 'fr']]);
    assert.equal(readIntendedPlan({ now: NOW, storage }), null);
    assert.equal(items.get('openplate-language'), 'fr');
  });
});

describe('clearIntendedPlan', () => {
  it('forgets a stored choice', () => {
    const { storage, items } = storedChoice('monthly', 0);
    rememberIntendedPlan({ plan: 'yearly', now: NOW, storage });
    assert.equal(readIntendedPlan({ now: NOW, storage }), 'yearly');
    clearIntendedPlan({ storage });
    assert.equal(items.has(INTENDED_PLAN_STORAGE_KEY), false);
    assert.equal(readIntendedPlan({ now: NOW, storage }), null);
  });

  it('never throws, not even on a storage that refuses', () => {
    assert.doesNotThrow(() => clearIntendedPlan({ storage: throwingStorage() }));
    assert.doesNotThrow(() => rememberIntendedPlan({ plan: 'yearly', now: NOW, storage: throwingStorage() }));
    assert.equal(readIntendedPlan({ now: NOW, storage: throwingStorage() }), null);
  });
});

/** The 32 characters the pattern allows, so the boundary is a fact and not a number copied from the source. */
const LONGEST_LABEL = `a${'b'.repeat(31)}`;

describe('readTierId', () => {
  it('accepts a label: lowercase letter first, then letters, digits and hyphens', () => {
    for (const label of ['alpha', 'tier-a', 'a1', 'a-1-b', 'x', LONGEST_LABEL]) {
      assert.equal(readTierId(label), label, label);
    }
  });

  it('refuses everything else, so the control above can fail', () => {
    const refused = [
      '',
      'Alpha',
      ' alpha',
      'alpha ',
      '1alpha',
      '-alpha',
      'a_b',
      'a.b',
      'a/b',
      'al pha',
      'alpha\n',
      `${LONGEST_LABEL}c`,
      '<script>',
    ];
    for (const value of refused) assert.equal(readTierId(value), null, JSON.stringify(value));
    assert.equal(readTierId(null), null);
    assert.equal(readTierId(undefined), null);
  });

  it('is the label pattern, with no tier name in it', () => {
    assert.equal(TIER_ID_PATTERN.source, '^[a-z][a-z0-9-]{0,31}$');
  });
});

describe('tierParamOf', () => {
  it('reads the query string first and the fragment second', () => {
    assert.equal(tierParamOf({ search: '?tier=tier-a&plan=yearly', hash: '' }), 'tier-a');
    assert.equal(tierParamOf({ search: '', hash: '#invite=si_abc&tier=tier-b&plan=yearly' }), 'tier-b');
    assert.equal(tierParamOf({ search: '?tier=tier-a', hash: '#tier=tier-b' }), 'tier-a');
  });

  it('is null for no parameter and for a value that is not a label', () => {
    assert.equal(tierParamOf({ search: '?plan=yearly', hash: '' }), null);
    assert.equal(tierParamOf({ search: '?tier=Tier-A', hash: '' }), null);
    assert.equal(tierParamOf({ search: '?tier=', hash: '' }), null);
  });
});

describe('captureIntendedPlan and the tier', () => {
  it('stores the tier with the plan, in the one record', () => {
    const { storage, items } = memoryStorage();
    assert.equal(captureIntendedPlan({ search: '?tier=tier-a&plan=yearly', hash: '', now: NOW, storage }), 'yearly');
    assert.equal(
      items.get(INTENDED_PLAN_STORAGE_KEY),
      encodeIntendedPlan({ plan: 'yearly', tier: 'tier-a', now: NOW }),
    );
    assert.equal(readIntendedTier({ now: NOW + 1, storage }), 'tier-a');
    assert.equal(readIntendedPlan({ now: NOW + 1, storage }), 'yearly');
  });

  it('CONTROL: a link with no tier stores none, and the record is the one it always was', () => {
    const { storage, items } = memoryStorage();
    captureIntendedPlan({ search: '?plan=yearly', hash: '', now: NOW, storage });
    assert.equal(items.get(INTENDED_PLAN_STORAGE_KEY), encodeIntendedPlan({ plan: 'yearly', now: NOW }));
    assert.equal(items.get(INTENDED_PLAN_STORAGE_KEY), JSON.stringify({ plan: 'yearly', at: NOW }));
    assert.equal(readIntendedTier({ now: NOW, storage }), null);
  });

  it('drops a tier that is not a label and keeps the plan', () => {
    const { storage } = memoryStorage();
    assert.equal(
      captureIntendedPlan({ search: '?tier=Not_A_Label&plan=monthly', hash: '', now: NOW, storage }),
      'monthly',
    );
    assert.equal(readIntendedTier({ now: NOW, storage }), null);
    assert.equal(readIntendedPlan({ now: NOW, storage }), 'monthly');
  });

  it('stores a tier only beside a valid plan', () => {
    const { storage, items } = memoryStorage();
    assert.equal(captureIntendedPlan({ search: '?tier=tier-a', hash: '', now: NOW, storage }), null);
    assert.equal(captureIntendedPlan({ search: '?tier=tier-a&plan=weekly', hash: '', now: NOW, storage }), null);
    assert.equal(items.size, 0);
  });

  it('lets a sign-up link with no tier replace the tier an older link left', () => {
    const { storage } = memoryStorage();
    captureIntendedPlan({ search: '?tier=tier-a&plan=yearly', hash: '', now: NOW, storage });
    captureIntendedPlan({ search: '?plan=yearly', hash: '', now: NOW + 1, storage });
    assert.equal(readIntendedTier({ now: NOW + 2, storage }), null);
  });

  it('keeps the tier through the mailed join link, which echoes the plan and not the tier', () => {
    const { storage } = memoryStorage();
    captureIntendedPlan({ search: '?tier=tier-a&plan=yearly', hash: '', now: NOW, storage });
    const hash = '#invite=si_abc&plan=yearly';
    assert.equal(captureIntendedPlan({ search: '', hash, isMailedLink: true, now: NOW + 1000, storage }), 'yearly');
    assert.equal(readIntendedTier({ now: NOW + 2000, storage }), 'tier-a');
    // A SECOND RUN of the join page's effect, the case the page comments name, changes nothing.
    captureIntendedPlan({ search: '', hash, isMailedLink: true, now: NOW + 3000, storage });
    assert.equal(readIntendedTier({ now: NOW + 4000, storage }), 'tier-a');
  });

  it('stores the tier a mailed link names, through the same capture as the plan', () => {
    const { storage } = memoryStorage();
    // A DEVICE THAT NEVER SAW THE PRICING PAGE: the mail was opened on a new phone.
    const hash = '#server=https%3A%2F%2Fsync.example&invite=si_abc&plan=yearly&tier=tier-a&lang=de';
    assert.equal(captureIntendedPlan({ search: '', hash, isMailedLink: true, now: NOW, storage }), 'yearly');
    assert.equal(readIntendedPlan({ now: NOW + 1, storage }), 'yearly');
    assert.equal(readIntendedTier({ now: NOW + 1, storage }), 'tier-a');
  });

  it('lets the tier in a mailed link replace a different stored one', () => {
    const { storage } = memoryStorage();
    captureIntendedPlan({ search: '?tier=tier-a&plan=yearly', hash: '', now: NOW, storage });
    captureIntendedPlan({ search: '', hash: '#invite=si_abc&plan=yearly&tier=tier-b', isMailedLink: true, now: NOW + 1, storage });
    assert.equal(readIntendedTier({ now: NOW + 2, storage }), 'tier-b');
  });

  it('ignores a tier in a mailed link that is not a label, and a tier with no plan beside it', () => {
    const { storage } = memoryStorage();
    captureIntendedPlan({ search: '', hash: '#invite=si_abc&plan=yearly&tier=Tier-A', isMailedLink: true, now: NOW, storage });
    assert.equal(readIntendedPlan({ now: NOW + 1, storage }), 'yearly');
    assert.equal(readIntendedTier({ now: NOW + 1, storage }), null);
    const other = memoryStorage().storage;
    assert.equal(captureIntendedPlan({ search: '', hash: '#invite=si_abc&tier=tier-a', isMailedLink: true, now: NOW, storage: other }), null);
    assert.equal(readIntendedTier({ now: NOW + 1, storage: other }), null);
  });

  it('drops the stored tier when the mailed link names another plan, or when no tier was stored', () => {
    const { storage } = memoryStorage();
    captureIntendedPlan({ search: '?tier=tier-a&plan=yearly', hash: '', now: NOW, storage });
    captureIntendedPlan({ search: '', hash: '#invite=si_abc&plan=monthly', isMailedLink: true, now: NOW + 1, storage });
    assert.equal(readIntendedTier({ now: NOW + 2, storage }), null);
    assert.equal(readIntendedPlan({ now: NOW + 2, storage }), 'monthly');

    const clean = memoryStorage();
    captureIntendedPlan({
      search: '',
      hash: '#invite=si_abc&plan=yearly',
      isMailedLink: true,
      now: NOW,
      storage: clean.storage,
    });
    assert.equal(readIntendedTier({ now: NOW, storage: clean.storage }), null);
  });

  it('lets a tier in the mailed link win over the stored one', () => {
    const { storage } = memoryStorage();
    captureIntendedPlan({ search: '?tier=tier-a&plan=yearly', hash: '', now: NOW, storage });
    captureIntendedPlan({
      search: '',
      hash: '#invite=si_abc&tier=tier-b&plan=yearly',
      isMailedLink: true,
      now: NOW + 1,
      storage,
    });
    assert.equal(readIntendedTier({ now: NOW + 2, storage }), 'tier-b');
  });

  it('reads storage for the tier when the address names nothing', () => {
    const { storage } = memoryStorage();
    rememberIntendedPlan({ plan: 'monthly', tier: 'tier-a', now: NOW, storage });
    assert.equal(captureIntendedPlan({ search: '', hash: '', now: NOW + 1, storage }), 'monthly');
    assert.equal(readIntendedTier({ now: NOW + 1, storage }), 'tier-a');
  });
});

describe('the stored tier', () => {
  it('expires with the plan, after seven days', () => {
    const { storage, items } = memoryStorage([
      [
        INTENDED_PLAN_STORAGE_KEY,
        encodeIntendedPlan({ plan: 'yearly', tier: 'tier-a', now: NOW - INTENDED_PLAN_TTL_MS }),
      ],
    ]);
    assert.equal(readIntendedTier({ now: NOW, storage }), null);
    assert.equal(items.has(INTENDED_PLAN_STORAGE_KEY), false);
    // THE CONTROL: a day younger, it still counts.
    const young = memoryStorage([
      [
        INTENDED_PLAN_STORAGE_KEY,
        encodeIntendedPlan({ plan: 'yearly', tier: 'tier-a', now: NOW - INTENDED_PLAN_TTL_MS + 1 }),
      ],
    ]);
    assert.equal(readIntendedTier({ now: NOW, storage: young.storage }), 'tier-a');
  });

  it('drops a hand-written tier that is not a label and keeps the plan', () => {
    const raw = JSON.stringify({ plan: 'yearly', tier: 'Not A Label', at: NOW });
    assert.equal(decodeIntendedTier({ raw, now: NOW }), null);
    assert.equal(decodeIntendedPlan({ raw, now: NOW }), 'yearly');
  });

  it('is gone once the choice is cleared, and a refusing storage never throws', () => {
    const { storage } = memoryStorage();
    rememberIntendedPlan({ plan: 'yearly', tier: 'tier-a', now: NOW, storage });
    clearIntendedPlan({ storage });
    assert.equal(readIntendedTier({ now: NOW, storage }), null);
    assert.equal(readIntendedTier({ now: NOW, storage: throwingStorage() }), null);
    assert.equal(readIntendedTier({ now: NOW, storage: null }), null);
  });
});
