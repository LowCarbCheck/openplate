/**
 * The header's fasting chip, present ONLY while a fast is scheduled or
 * running, on every route, as the app's one always-visible piece of live data.
 *
 * Why the header and not a page: a fast is the only fact in openplate that is
 * true while you are looking at some other screen. Putting it in the chrome is
 * what lets `/dashboard`'s `FastStrip` stay a dashboard concern rather than
 * becoming the only place the hours are visible.
 *
 * SIZE IS THE CONTRACT. The pill is `min-h-9` inside a `min-h-16` header, so it
 * cannot change the header's height, and it sits beside `AvatarMenu` in the
 * shrinking-last group so the `h1` truncates before this moves. A stage label
 * only appears from `md:` up, where there is room for it.
 *
 * Overtime is NOT amber. Fasting past the target is the normal, intended
 * outcome, and colouring it as a warning would turn a good outcome into an
 * alarm. The chip shows the elapsed figure and nothing else changes.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';

import { Link } from '#app/components/link';
import { useCurrentFast } from '#app/hooks/use-current-fast';
import { formatFastDuration, resolveFastTimeline } from '#app/models/fasting';
import { stageAt } from '#app/models/fasting-stages';
import type { LocalFast } from '#app/lib/local-store';

/** The chip's inputs. The PARENT owns the clock, so the chip is pure to render. */
export interface FastChipProps {
  /** The open fast. The caller decides visibility; there is no empty branch here. */
  fast: LocalFast;
  /** The clock reading every figure is derived against. */
  nowMs: number;
  /**
   * The fasting stage, e.g. "Fat burning", shown from `md:` up after a middle
   * dot. A STRING, not a stage id: the stage module is its own concern and the
   * chip should not grow an opinion about how stages are named.
   */
  stageLabel?: string;
}

/**
 * The chip. Tokens only, never a colour literal: the brand teal is defined in
 * `openplate-brand` and reaches this file as `primary`.
 */
export function FastChip({ fast, nowMs, stageLabel }: FastChipProps): ReactElement {
  const { t } = useTranslation();
  const timeline = resolveFastTimeline(fast, nowMs);

  // Terminal statuses are unreachable here, `selectCurrentFast` only ever
  // returns an open fast, so this is a two-arm branch, not a switch with dead
  // arms.
  const isScheduled = timeline.status === 'scheduled';
  const duration = formatFastDuration(isScheduled ? timeline.startsInMs : timeline.elapsedMs, t);
  const text = isScheduled ? t('fasting.chip.startsIn', { duration }) : duration;
  const label =
    isScheduled ? t('fasting.chip.scheduledLabel', { duration }) : t('fasting.chip.activeLabel', { duration });

  return (
    <Link
      to="/fasting"
      aria-label={label}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 text-xs font-medium tabular-nums text-primary hover:bg-primary/10"
    >
      <Timer className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
      {/* The `aria-label` on the anchor above already carries the whole
          sentence, so this is presentation only and needs no separator of its
          own for assistive tech. */}
      {stageLabel !== undefined && <span className="hidden md:inline">{`· ${stageLabel}`}</span>}
    </Link>
  );
}

/**
 * The chip's container: asks the device whether a fast is open and renders
 * nothing when none is. Separate from `FastChip` so the chip itself stays
 * prop-driven and testable under `renderToStaticMarkup`, which can never run
 * the hook's effects.
 */
export function FastChipSlot(): ReactElement | null {
  const { t } = useTranslation();
  const { fast, nowMs } = useCurrentFast();
  if (fast === null) return null;

  // A SCHEDULED fast carries no stage: nothing has started, so there is
  // nothing happening in the body to name, and `stageAt(0)` would confidently
  // report "Digesting" about a fast that begins tonight.
  const timeline = resolveFastTimeline(fast, nowMs);
  const stageLabel = timeline.status === 'scheduled' ? undefined : t(stageAt(timeline.elapsedMs).nameKey);

  return <FastChip fast={fast} nowMs={nowMs} stageLabel={stageLabel} />;
}
