/**
 * The trial countdown's rules (M250/03): the number it says, when it shows,
 * and "closed for the day".
 *
 * Every date is built from LOCAL calendar fields, because the countdown counts
 * the device's calendar days and the suite must hold in whatever time zone it
 * runs in. Every refusal below has a control beside it that shows, so a rule
 * that answered `null` for everything would fail.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { PlanStanding } from '../../app/lib/plans/plan-standing';
import {
  closeCountdownForDay,
  readCountdownClosedDay,
  resolveTrialCountdown,
  trialCountdownDaysLeft,
  TRIAL_COUNTDOWN_STORAGE_KEY,
  type CountdownStorage,
} from '../../app/lib/plans/trial-countdown';
import { clearStatus, publishStatus, readStatus, resetStatusChannel } from '../../app/lib/status';

/** Noon on 23 September 2026, local time. */
const NOW = new Date(2026, 8, 23, 12, 0, 0);
const TODAY = '2026-09-23';
const YESTERDAY = '2026-09-22';

/** An ISO instant for a local calendar time. */
function localIso(day: number, hour: number, minute = 0, ms = 0): string {
  return new Date(2026, 8, day, hour, minute, 0, ms).toISOString();
}

function trial(endsAt: string): PlanStanding {
  return { kind: 'trial', basis: 'days', endsAt, daysLeft: 99 };
}

function memoryStorage(initial: Record<string, string> = {}): CountdownStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const BROKEN_STORAGE: CountdownStorage = {
  getItem: () => {
    throw new Error('storage is off');
  },
  setItem: () => {
    throw new Error('storage is full');
  },
};

describe('the days the countdown says', () => {
  it('says one on the last day, even with hours to go', () => {
    assert.equal(trialCountdownDaysLeft({ endsAt: localIso(23, 18), now: NOW }), 1);
  });

  it('counts today and tomorrow for an end tomorrow morning, where elapsed hours would say one', () => {
    // 21 hours left. `planStanding` rounds that to one day; the sentence
    // "ends today" would be false, so the calendar count is two.
    assert.equal(trialCountdownDaysLeft({ endsAt: localIso(24, 9), now: NOW }), 2);
  });

  it('does not count a day the allowance ends at the first instant of', () => {
    // Ends at local midnight starting the 25th: the 25th has no usable second.
    assert.equal(trialCountdownDaysLeft({ endsAt: localIso(25, 0), now: NOW }), 2);
    // THE CONTROL: one millisecond later, the 25th is usable and counts.
    assert.equal(trialCountdownDaysLeft({ endsAt: localIso(25, 0, 0, 1), now: NOW }), 3);
  });

  it('says nothing for an end that has passed, at the boundary instant, or that cannot be read', () => {
    assert.equal(trialCountdownDaysLeft({ endsAt: localIso(23, 11), now: NOW }), null);
    assert.equal(trialCountdownDaysLeft({ endsAt: NOW.toISOString(), now: NOW }), null);
    assert.equal(trialCountdownDaysLeft({ endsAt: 'not a date', now: NOW }), null);
  });
});

describe('when the countdown shows', () => {
  const inAWeek = localIso(30, 12);

  it('shows during a trial, on any page but the plan page', () => {
    assert.deepEqual(
      resolveTrialCountdown({ standing: trial(inAWeek), now: NOW, closedDay: null, pathname: '/diary' }),
      { basis: 'days', daysLeft: 8 },
    );
  });

  it('does not show for any standing that is not a trial', () => {
    const others: PlanStanding[] = [
      { kind: 'no-plans' },
      { kind: 'trial-ended', basis: 'days', endedAt: localIso(22, 12) },
      { kind: 'lapsed' },
      { kind: 'subscribed', planKey: 'yearly', interval: 'year', periodEnd: inAWeek, renews: true, isPastDue: false },
    ];
    for (const standing of others) {
      assert.equal(
        resolveTrialCountdown({ standing, now: NOW, closedDay: null, pathname: '/diary' }),
        null,
        `${standing.kind} showed a countdown`,
      );
    }
  });

  it('stays closed on the day it was closed, and comes back the next day', () => {
    assert.equal(
      resolveTrialCountdown({ standing: trial(inAWeek), now: NOW, closedDay: TODAY, pathname: '/diary' }),
      null,
    );
    // THE CONTROL: closed yesterday is not closed today.
    assert.notEqual(
      resolveTrialCountdown({ standing: trial(inAWeek), now: NOW, closedDay: YESTERDAY, pathname: '/diary' }),
      null,
    );
  });

  it('does not link the plan page to itself', () => {
    for (const pathname of ['/settings/plan', '/settings/plan/']) {
      assert.equal(resolveTrialCountdown({ standing: trial(inAWeek), now: NOW, closedDay: null, pathname }), null);
    }
    // THE CONTROL: a neighbouring settings page shows it.
    assert.notEqual(
      resolveTrialCountdown({ standing: trial(inAWeek), now: NOW, closedDay: null, pathname: '/settings' }),
      null,
    );
  });
});

describe('closed for the day', () => {
  it('records the day it was closed, and reads it back', () => {
    const storage = memoryStorage();
    assert.equal(readCountdownClosedDay(storage), null);
    closeCountdownForDay({ storage, dayKey: TODAY });
    assert.equal(storage.data[TRIAL_COUNTDOWN_STORAGE_KEY], TODAY);
    assert.equal(readCountdownClosedDay(storage), TODAY);
  });

  it('reads a broken storage as never closed and swallows a failed write', () => {
    assert.equal(readCountdownClosedDay(BROKEN_STORAGE), null);
    assert.doesNotThrow(() => closeCountdownForDay({ storage: BROKEN_STORAGE, dayKey: TODAY }));
  });
});

describe('the status channel reports a close', () => {
  beforeEach(() => resetStatusChannel());
  afterEach(() => resetStatusChannel());

  it('carries the close callback of the status that asked for one, and null for one that did not', () => {
    let closes = 0;
    publishStatus({ text: 'countdown', ttlMs: null, onDismiss: () => (closes += 1) });
    readStatus()?.onDismiss?.();
    assert.equal(closes, 1);
    // THE CONTROL: a plain status carries no callback, so the header's
    // dismiss control reports nothing for it.
    publishStatus({ text: 'saved', tone: 'success' });
    assert.equal(readStatus()?.onDismiss, null);
  });

  it('does not report a close when the status is cleared by anything else', () => {
    let closes = 0;
    publishStatus({ text: 'countdown', ttlMs: null, onDismiss: () => (closes += 1) });
    clearStatus();
    publishStatus({ text: 'countdown', ttlMs: null, onDismiss: () => (closes += 1) });
    publishStatus({ text: 'something else' });
    assert.equal(closes, 0);
  });
});

describe('a scan trial countdown (M253/05)', () => {
  const scans: PlanStanding = { kind: 'trial', basis: 'scans', scansLeft: 7, scansGranted: 10 };

  it('says the scans left, not days, on a scan trial', () => {
    assert.deepEqual(resolveTrialCountdown({ standing: scans, now: NOW, closedDay: null, pathname: '/diary' }), {
      basis: 'scans',
      scansLeft: 7,
    });
  });

  it('keeps the same close-for-the-day and plan-page rules', () => {
    assert.equal(resolveTrialCountdown({ standing: scans, now: NOW, closedDay: TODAY, pathname: '/diary' }), null);
    assert.equal(
      resolveTrialCountdown({ standing: scans, now: NOW, closedDay: null, pathname: '/settings/plan' }),
      null,
    );
  });

  it('shows nothing once the free scans are used', () => {
    const spent: PlanStanding = { kind: 'trial-ended', basis: 'scans', endedAt: null };
    assert.equal(resolveTrialCountdown({ standing: spent, now: NOW, closedDay: null, pathname: '/diary' }), null);
  });
});
