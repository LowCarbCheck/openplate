/**
 * The Overview page's fasting strip — present ONLY while a fast is scheduled
 * or running (M132). Deliberately the slimmest module on the page: the
 * Overview budget is one phone screen with no scroll and the shipped three
 * modules already spend it, so this costs ~73 px of scroll on a 375x667
 * phone and earns it by being the only time-sensitive fact on the screen.
 * That is why it sits ABOVE the glance row rather than below — the thing that
 * falls off the fold should be the thing that is not moving.
 *
 * Ticks at MINUTE resolution (60 s), because minutes are the smallest unit it
 * renders. The second-resolution countdown lives on `/fasting`, which is one
 * tap away through this very row.
 *
 * Not a `Card`: a `Card` would bring `p-6` plus a header/content split, and the
 * whole point is that this is ONE ROW. It borrows `Card`'s resting look
 * (`rounded-2xl border bg-card shadow-sm`) so it reads as a sibling of the
 * tiles below without paying their padding.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Timer } from 'lucide-react';
import { Link } from '#app/components/link';
import { useNow } from '#app/hooks/use-now';
import { formatFastDuration, formatFastOvertime, resolveFastTimeline } from '#app/models/fasting';
import type { LocalFast } from '#app/lib/local-store';

/** Minutes are the smallest unit this strip renders, so a faster tick buys nothing. */
const STRIP_TICK_MS = 60_000;

/**
 * The strip. The PARENT decides visibility (`currentFast !== null`); this
 * component takes a non-null fast, so there is no "nothing to show" branch to
 * keep in sync with the page.
 */
export function FastStrip({ fast }: { fast: LocalFast }): ReactElement {
  const { t } = useTranslation();
  const nowMs = useNow({ intervalMs: STRIP_TICK_MS });
  const timeline = resolveFastTimeline(fast, nowMs);

  // Terminal statuses are unreachable here — `selectCurrentFast` only ever
  // returns an open fast — so this is a two-arm branch, not a switch with dead
  // arms.
  const isScheduled = timeline.status === 'scheduled';
  const eyebrow = isScheduled ? t('fasting.strip.scheduled') : t('fasting.strip.fasting');
  const elapsed = formatFastDuration(timeline.elapsedMs, t);
  const line =
    isScheduled ? t('fasting.strip.scheduledLine', { duration: formatFastDuration(timeline.startsInMs, t) })
    : timeline.hasReachedTarget ?
      t('fasting.strip.overtimeLine', { elapsed, overtime: formatFastOvertime(timeline.overtimeMs, t) })
    : t('fasting.strip.activeLine', { elapsed, remaining: formatFastDuration(timeline.remainingMs, t) });

  return (
    <Link
      to="/fasting"
      className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <Timer className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {/*
          The `SectionEyebrow` recipe inlined rather than the component, because
          that primitive renders a block-level `<p>` and this needs a `<span>`
          inside an anchor. Keep the class string byte-identical to the
          component's so a token change lands in both.
        */}
        <span className="block text-[11px] font-semibold uppercase tracking-[0.11em] text-primary">{eyebrow}</span>
        <span className="block truncate text-sm font-medium tabular-nums">{line}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
