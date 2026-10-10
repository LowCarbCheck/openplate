/**
 * "Used today" for one person on the admin screens, the list row and the
 * detail page alike.
 *
 * THE LIMIT THE PROXY HOLDS THEM TO TODAY (2026-09-30), not the paid column
 * alone. An operator's invite writes its number into the standing free grant
 * and leaves the paid limit at zero, and a Beta supporter whose plan ended
 * keeps a paid limit the proxy no longer reads. Either read off the paid
 * column would show "No photos" for somebody who has them, or a limit they are
 * not held to. `shownDailyAiLimit` is the one rule for that, shared with the
 * person's own account page.
 *
 * AND THE WINDOW IT COUNTS OVER (2026-10-07). A paid limit may count per week
 * (`aiLimitPeriod`), and then the number beside it is the week's count
 * (`aiUsedThisWeek`), never today's against a week's limit. The standing free
 * grant of an account is always per day, so it is read with `aiUsedToday`.
 */
import type { AdminAccountView } from '#app/lib/admin/admin-wire';
import { shownAiLimit } from '#app/lib/plans/free-grant';

/** The translate function the two screens hand in, narrowed to what this line needs. */
type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The fields of an account the usage reads, shared by the sentence and the figures. */
type UsagePerson = Pick<
  AdminAccountView,
  'dailyAiLimit' | 'freeDailyAiLimit' | 'allowanceExpiresAt' | 'aiUsedToday'
> &
  Partial<Pick<AdminAccountView, 'aiLimitPeriod' | 'aiUsedThisWeek'>>;

/**
 * The limit that binds, its window and the count in THAT window.
 *
 * `used` is `null` for a weekly limit read from a core that sent no week
 * count: today's count beside a week's limit would be a number nobody measured.
 */
interface ReadUsage {
  limit: number;
  period: 'day' | 'week';
  used: number | null;
}

function readUsage({ person, now }: { person: UsagePerson; now: Date }): ReadUsage {
  const shown = shownAiLimit({
    dailyAiLimit: person.dailyAiLimit,
    aiLimitPeriod: person.aiLimitPeriod,
    freeDailyAiLimit: person.freeDailyAiLimit,
    allowanceExpiresAt: person.allowanceExpiresAt,
    now,
  });
  const limit = shown?.limit ?? 0;
  if (shown?.period !== 'week') return { limit, period: 'day', used: person.aiUsedToday };
  return { limit, period: 'week', used: person.aiUsedThisWeek ?? null };
}

/**
 * The usage line: `admin.usageNone` with no limit, `admin.usageWeek` against a
 * weekly limit, otherwise `admin.usage` against the daily one that binds.
 */
export function adminUsage({
  person,
  t,
  now = new Date(),
}: {
  person: UsagePerson;
  t: Translate;
  now?: Date;
}): string {
  const { limit, period, used } = readUsage({ person, now });
  if (limit === 0) return t('admin.usageNone');
  if (period !== 'week') return t('admin.usage', { used: person.aiUsedToday, limit });
  // A WEEKLY LIMIT WITH NO WEEK COUNT (a core that sent none) names the limit
  // alone: today's count beside a week's limit would be a number nobody measured.
  if (used === null) return t('account.allowance.limitWeek', { count: limit });
  return t('admin.usageWeek', { used, limit });
}

/**
 * The count and the limit behind the usage line, for a bar and for a sort, or
 * `null` when the line names no pair: no limit at all, or a weekly limit with
 * no week count.
 *
 * ONE READING OF THE LIMIT, shared with {@link adminUsage}. A bar drawn from
 * the paid column while the line beside it names the free grant would be full
 * next to a number that says it is not.
 */
export function adminUsageFigures({
  person,
  now = new Date(),
}: {
  person: UsagePerson;
  now?: Date;
}): { used: number; limit: number } | null {
  const { limit, used } = readUsage({ person, now });
  if (limit === 0 || used === null) return null;
  return { used, limit };
}
