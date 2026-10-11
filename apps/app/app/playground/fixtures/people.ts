/**
 * People, as `GET /v1/admin/accounts` sends them, for the people table cards.
 *
 * Every value is a plain object that satisfies `AdminAccountView`, the type the
 * real wire parser produces. Dates are measured from `PLAYGROUND_NOW`, the same
 * instant the cards hand the table as `now`, so a "new this week" badge stays
 * true on any day.
 */
import type { ActivityByAccount } from '#app/lib/admin/activity-strip';
import type { AdminAccountView, AdminActivityDay } from '#app/lib/admin/admin-wire';
import { ROW_STRIP_DAYS } from '#app/components/admin/people-table';
import { PLAYGROUND_NOW, dayKeyOf, isoBefore } from './clock';

/** The signed-in administrator in every list. The table marks their row "You". */
export const CURRENT_ACCOUNT_ID = 1;

type PersonInput = Pick<AdminAccountView, 'id' | 'email' | 'createdAt'> & Partial<Omit<AdminAccountView, 'id' | 'email' | 'createdAt'>>;

/** One account with the quiet defaults filled in: a member on a 20 a day allowance who has used none. */
function makePerson(input: PersonInput): AdminAccountView {
  return {
    displayName: null,
    role: 'member',
    dailyAiLimit: 20,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    freeDailyAiLimit: 0,
    suspendedAt: null,
    invitesLeft: null,
    trialScans: null,
    lastSeenAt: null,
    label: null,
    ...input,
  };
}

const ADMINISTRATOR = makePerson({
  id: CURRENT_ACCOUNT_ID,
  email: 'ada@example.org',
  displayName: 'Ada Operator',
  role: 'admin',
  dailyAiLimit: 0,
  createdAt: isoBefore({ days: 140 }),
  lastSeenAt: isoBefore({ days: 0, hours: 1 }),
});

const NEWCOMER_TODAY = makePerson({
  id: 2,
  email: 'newcomer@example.org',
  displayName: 'Noor Newcomer',
  createdAt: isoBefore({ days: 0, hours: 2 }),
});

/** An instance with nobody on it. */
export const NO_PEOPLE: AdminAccountView[] = [];

/** The administrator, and one person who signed up this morning and has not opened the app. */
export const ONE_NEW_SIGN_UP: AdminAccountView[] = [ADMINISTRATOR, NEWCOMER_TODAY];

/**
 * Twelve people covering what the list has to tell apart: new this week, never
 * seen, labelled, nearly and fully through the allowance, suspended, gone
 * quiet, a weekly limit, no name, no allowance.
 */
export const MIXED_PEOPLE: AdminAccountView[] = [
  ADMINISTRATOR,
  NEWCOMER_TODAY,
  makePerson({
    id: 3,
    email: 'ben.weekly@example.org',
    displayName: 'Ben Weekly',
    createdAt: isoBefore({ days: 3 }),
    lastSeenAt: isoBefore({ days: 1 }),
    aiUsedToday: 4,
    aiUsedThisWeek: 11,
    dailyAiLimit: 30,
    aiLimitPeriod: 'week',
  }),
  makePerson({
    id: 4,
    email: 'invited.never.arrived@example.org',
    createdAt: isoBefore({ days: 5 }),
  }),
  makePerson({
    id: 5,
    email: 'carla.over@example.org',
    displayName: 'Carla Capped',
    createdAt: isoBefore({ days: 26 }),
    lastSeenAt: isoBefore({ days: 0, hours: 3 }),
    aiUsedToday: 20,
  }),
  makePerson({
    id: 6,
    email: 'dev.nearly@example.org',
    displayName: 'Dev Nearly',
    createdAt: isoBefore({ days: 41 }),
    lastSeenAt: isoBefore({ days: 2 }),
    aiUsedToday: 17,
  }),
  makePerson({
    id: 7,
    email: 'eli.supporter@example.org',
    displayName: 'Eli Supporter',
    createdAt: isoBefore({ days: 88 }),
    lastSeenAt: isoBefore({ days: 6 }),
    aiUsedToday: 2,
    dailyAiLimit: 10,
    label: 'Beta supporter',
  }),
  makePerson({
    id: 8,
    email: 'fran.supporter@example.org',
    displayName: 'Fran Supporter',
    createdAt: isoBefore({ days: 91 }),
    lastSeenAt: isoBefore({ days: 31 }),
    dailyAiLimit: 10,
    label: 'Beta supporter',
  }),
  makePerson({
    id: 9,
    email: 'gus.quiet@example.org',
    displayName: 'Gus Quiet',
    createdAt: isoBefore({ days: 120 }),
    lastSeenAt: isoBefore({ days: 52 }),
    aiUsedToday: 0,
  }),
  makePerson({
    id: 10,
    email: 'hana.suspended@example.org',
    displayName: 'Hana Held',
    createdAt: isoBefore({ days: 64 }),
    lastSeenAt: isoBefore({ days: 19 }),
    suspendedAt: isoBefore({ days: 4 }),
  }),
  makePerson({
    id: 11,
    email: 'no.name@example.org',
    createdAt: isoBefore({ days: 12 }),
    lastSeenAt: isoBefore({ days: 0, hours: 9 }),
    aiUsedToday: 6,
  }),
  makePerson({
    id: 12,
    email: 'ivo.no.allowance@example.org',
    displayName: 'Ivo Zero',
    createdAt: isoBefore({ days: 200 }),
    lastSeenAt: isoBefore({ days: 8 }),
    dailyAiLimit: 0,
  }),
];

/** Seven days of photo counts, oldest first, ending on the day of `PLAYGROUND_NOW`. */
function sevenDays(counts: readonly number[]): AdminActivityDay[] {
  return counts.map((count, index) => {
    const daysBack = ROW_STRIP_DAYS - 1 - index;
    const day = new Date(PLAYGROUND_NOW.getTime() - daysBack * 86_400_000);
    return { day: dayKeyOf(day), count };
  });
}

const QUIET_WEEK = [0, 0, 0, 0, 0, 0, 0];

/**
 * The strips the batch read answers with, one per account.
 *
 * A person nobody has seen gets a run of zeroes, not a missing entry: the
 * service zero-fills, and the table relies on it (a missing entry is drawn as
 * "no strip", which means something else).
 */
export const MIXED_ACTIVITY: ActivityByAccount = new Map([
  [1, sevenDays([0, 2, 0, 1, 0, 0, 3])],
  [2, sevenDays(QUIET_WEEK)],
  [3, sevenDays([0, 0, 0, 0, 5, 2, 4])],
  [4, sevenDays(QUIET_WEEK)],
  [5, sevenDays([6, 9, 12, 20, 20, 20, 20])],
  [6, sevenDays([3, 4, 8, 10, 12, 15, 17])],
  [7, sevenDays([1, 0, 0, 2, 0, 1, 2])],
  [8, sevenDays(QUIET_WEEK)],
  [9, sevenDays(QUIET_WEEK)],
  [10, sevenDays(QUIET_WEEK)],
  [11, sevenDays([0, 0, 1, 0, 3, 4, 6])],
  [12, sevenDays([0, 0, 0, 0, 0, 0, 0])],
]);

/** The strips of {@link ONE_NEW_SIGN_UP}. */
export const ONE_NEW_ACTIVITY: ActivityByAccount = new Map([
  [1, sevenDays([0, 1, 0, 0, 2, 0, 1])],
  [2, sevenDays(QUIET_WEEK)],
]);
