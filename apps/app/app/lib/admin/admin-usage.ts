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
 */
import type { AdminAccountView } from '#app/lib/admin/admin-wire';
import { shownDailyAiLimit } from '#app/lib/plans/free-grant';

/** The translate function the two screens hand in, narrowed to what this line needs. */
type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The used-today line: `admin.usageNone` with no limit, otherwise `admin.usage` against the limit that binds. */
export function adminUsage({
  person,
  t,
  now = new Date(),
}: {
  person: Pick<AdminAccountView, 'dailyAiLimit' | 'freeDailyAiLimit' | 'allowanceExpiresAt' | 'aiUsedToday'>;
  t: Translate;
  now?: Date;
}): string {
  const limit =
    shownDailyAiLimit({
      dailyAiLimit: person.dailyAiLimit,
      freeDailyAiLimit: person.freeDailyAiLimit,
      allowanceExpiresAt: person.allowanceExpiresAt,
      now,
    }) ?? 0;
  if (limit === 0) return t('admin.usageNone');
  return t('admin.usage', { used: person.aiUsedToday, limit });
}
