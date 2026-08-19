/**
 * Unit tests for `#app/lib/celebration` — the one-time celebrations for
 * genuine firsts (M129/03).
 *
 * The two properties worth defending: a milestone fires at most ONCE per
 * device (that's what stops the feature becoming wallpaper), and it only fires
 * when it is actually TRUE — a device that already holds a hundred entries
 * when this shipped must never be congratulated on its first log.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import i18next from '../../app/i18n/i18n';

import {
  CELEBRATIONS_STORAGE_KEY,
  celebrationMessage,
  markCelebrationsSeen,
  readSeenCelebrations,
  resolveCelebration,
} from '../../app/lib/celebration';
import type { CelebrationId } from '../../app/lib/celebration';

/** Resolves a key against the real shipped catalog. */
const t = (key: string): string => i18next.t(key);

const ALL_CELEBRATION_IDS: CelebrationId[] = ['first-log', 'first-scan', 'streak-7', 'target-weight'];

function fakeStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(CELEBRATIONS_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    raw: () => store.get(CELEBRATIONS_STORAGE_KEY) ?? null,
  };
}

const NOTHING = {
  totalLogCount: 0,
  aiEstimatedLogCount: 0,
  loggedDaysInWindow: 0,
  windowDays: 7,
  weighInCount: 0,
  crossedTargetOnLatest: false,
};

describe('resolveCelebration', () => {
  it('celebrates the very first logged food', () => {
    const decision = resolveCelebration({ facts: { ...NOTHING, totalLogCount: 1 }, seen: new Set() });
    assert.equal(decision.celebrate, 'first-log');
  });

  it('does NOT celebrate a first log on a device that already had entries', () => {
    const decision = resolveCelebration({ facts: { ...NOTHING, totalLogCount: 42 }, seen: new Set() });
    assert.equal(decision.celebrate, null);
  });

  it('celebrates the first AI-identified plate', () => {
    const decision = resolveCelebration({
      facts: { ...NOTHING, totalLogCount: 9, aiEstimatedLogCount: 1 },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, 'first-scan');
  });

  it('celebrates a full seven-day window', () => {
    const decision = resolveCelebration({
      facts: { ...NOTHING, totalLogCount: 20, loggedDaysInWindow: 7 },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, 'streak-7');
  });

  it('does not fire on a partial window', () => {
    const decision = resolveCelebration({
      facts: { ...NOTHING, totalLogCount: 20, loggedDaysInWindow: 6 },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, null);
  });

  it('shows one at a time but banks every milestone crossed at once', () => {
    const decision = resolveCelebration({
      facts: { ...NOTHING, totalLogCount: 1, aiEstimatedLogCount: 1 },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, 'first-log');
    assert.deepEqual(decision.newlySatisfied, ['first-log', 'first-scan']);
  });

  it('celebrates the weigh-in that first crossed the target weight', () => {
    const decision = resolveCelebration({
      facts: { ...NOTHING, weighInCount: 2, crossedTargetOnLatest: true },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, 'target-weight');
  });

  it('does NOT celebrate a target weight that was already standing when the window opened', () => {
    // `crossedTargetOnLatest` is false for a standing state — a device that
    // installs already at target must never be congratulated for holding still.
    const decision = resolveCelebration({
      facts: { ...NOTHING, weighInCount: 9, crossedTargetOnLatest: false },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, null);
  });

  it('needs a real series, not one reading, before the target weight counts', () => {
    const decision = resolveCelebration({
      facts: { ...NOTHING, weighInCount: 1, crossedTargetOnLatest: true },
      seen: new Set(),
    });
    assert.equal(decision.celebrate, null);
  });

  it('never repeats a milestone already banked', () => {
    const seen = new Set<CelebrationId>(['first-log']);
    const decision = resolveCelebration({ facts: { ...NOTHING, totalLogCount: 1 }, seen });
    assert.equal(decision.celebrate, null);
    assert.deepEqual(decision.newlySatisfied, []);
  });

  it('has a warm, score-free message for every milestone', () => {
    // Drives the real shipped catalog (M129/05) rather than a fixture, so this
    // still asserts the actual product copy after the strings moved out of the
    // module — including that none of them shouts.
    for (const id of ALL_CELEBRATION_IDS) {
      const message = celebrationMessage(id, t);
      assert.ok(message.length > 0);
      assert.ok(!message.startsWith('diary.celebration.'), `${id} has no English translation`);
      assert.ok(!message.includes('!'), `"${message}" should not shout`);
    }
  });
});

describe('celebration storage', () => {
  it('round-trips the banked ids', () => {
    const storage = fakeStorage();
    markCelebrationsSeen(storage, ['first-log', 'streak-7']);
    assert.deepEqual([...readSeenCelebrations(storage)].toSorted(), ['first-log', 'streak-7']);
  });

  it('is additive — banking one id keeps the others', () => {
    const storage = fakeStorage();
    markCelebrationsSeen(storage, ['first-log']);
    markCelebrationsSeen(storage, ['first-scan']);
    assert.equal(readSeenCelebrations(storage).size, 2);
  });

  it('treats corrupt storage as "nothing seen" rather than throwing', () => {
    assert.equal(readSeenCelebrations(fakeStorage('not json')).size, 0);
    assert.equal(readSeenCelebrations(fakeStorage('{"a":1}')).size, 0);
    assert.equal(readSeenCelebrations(fakeStorage('["bogus-id"]')).size, 0);
  });

  it('writes nothing for an empty id list', () => {
    const storage = fakeStorage();
    markCelebrationsSeen(storage, []);
    assert.equal(storage.raw(), null);
  });
});
