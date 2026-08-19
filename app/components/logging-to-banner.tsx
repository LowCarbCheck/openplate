import { Link } from '#app/components/link';
import { CalendarDays } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

/**
 * Informational context banner shown on /add and /scan when the user arrived
 * from a past diary day: it makes the non-"today" target obvious and offers a
 * one-tap escape back to today. A subtle teal-tinted surface (DESIGN.md §2
 * primary token) — informational, never a warning (no amber/red).
 *
 * @param label - human day label, e.g. "Sat 12 Jul".
 * @param switchToTodayHref - href that strips the date context (preserving any query).
 */
export function LoggingToBanner({ label, switchToTodayHref }: { label: string; switchToTodayHref: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
      <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {/* `Trans`, not plain interpolation: the day label carries its own
            emphasis, and a language that puts the date first must be able to
            move the whole marked-up span with it. */}
        <Trans i18nKey="banners.loggingTo" values={{ label }} components={{ day: <span className="font-medium" /> }} />
      </span>
      <Link to={switchToTodayHref} className="shrink-0 font-medium text-primary underline-offset-4 hover:underline">
        {t('banners.switchToToday')}
      </Link>
    </div>
  );
}
