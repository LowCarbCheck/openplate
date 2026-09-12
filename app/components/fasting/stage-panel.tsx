/**
 * "What is happening in my body right now", the two renderings of
 * `models/fasting-stages`: the three lines under the elapsed figure on the
 * active card, and the collapsed list of all six stages under it.
 *
 * BOTH ARE PROP-DRIVEN. No clock, no store, no hook beyond `useTranslation`,
 * so `tests/unit/fasting-route.test.ts` can render either one under
 * `renderToStaticMarkup` and read the copy back.
 *
 * THE HEDGE IS NOT DECORATION. It appears under the stage name AND again at
 * the top of the list, because the hours are population averages and someone
 * eating low carb moves through the early stages sooner, sometimes by hours.
 * Saying it once, far from the figure it qualifies, is how a screen ends up
 * implying a measurement it never took (DESIGN.md section 10.1).
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClockTime } from '#app/lib/format-clock-time';
import { cn } from '#app/lib/utils';
import {
  FASTING_STAGES,
  HEDGE_KEY,
  isFreshStage,
  nextStageAfter,
  stageAt,
  stageEnteredAtMs,
} from '#app/models/fasting-stages';

export interface StageLinesProps {
  /** ms fasted so far, the one input that picks the stage. */
  elapsedMs: number;
  /** The instant the fast counts from, used to date the stage boundary. */
  startAtMs: number;
  /** The profile time zone the clock label is written in. */
  timezone: string;
  /** The active language, for the clock format. */
  language: string;
}

/**
 * The stage block on the active card: a name line, the hedge, and what comes
 * next.
 *
 * The name line becomes "Entered rising ketones at 12:04" for the first hour
 * of a stage and then settles back to the bare name. `fed` is never fresh (see
 * `isFreshStage`), so the flourish cannot fire on the opening hour of every
 * single fast and thereby mean nothing.
 */
export function StageLines({ elapsedMs, startAtMs, timezone, language }: StageLinesProps): ReactElement {
  const { t } = useTranslation();
  const stage = stageAt(elapsedMs);
  const next = nextStageAfter(stage);
  const name = t(stage.nameKey);

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {isFreshStage(elapsedMs, stage) ?
          t('fasting.stages.entered', {
            name,
            time: formatClockTime(stageEnteredAtMs(startAtMs, stage), { timezone, language }),
          })
        : name}
      </p>
      <p className="text-xs text-muted-foreground">{t(HEDGE_KEY)}</p>
      {/* Nothing after `extended`: `nextStageAfter` returns null there, so the
          card never promises a stage that does not exist. */}
      {next !== null && (
        <p className="text-xs text-muted-foreground">
          {t('fasting.stages.next', { name: t(next.nameKey), hours: next.startsAtHours })}
        </p>
      )}
    </div>
  );
}

export interface StageListProps {
  /** ms fasted so far; the stage containing it is the one marked current. */
  elapsedMs: number;
}

/**
 * The whole ladder, as a `<details>` that is CLOSED by default.
 *
 * Closed because the six sentences are reference material, not the screen's
 * job: the person came to see a clock. A native disclosure rather than React
 * state so it works before hydration and carries its own keyboard and
 * assistive-technology behaviour.
 */
export function StageList({ elapsedMs }: StageListProps): ReactElement {
  const { t } = useTranslation();
  const current = stageAt(elapsedMs);

  return (
    <details className="rounded-2xl border border-border/60 bg-card px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-medium">{t('fasting.stages.listTitle')}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{t(HEDGE_KEY)}</p>
      <ul className="mt-3 space-y-3">
        {FASTING_STAGES.map((stage) => (
          <li
            key={stage.id}
            // `aria-current` is how the list says "you are here" without
            // relying on the colour alone, which is the whole point of marking
            // it at all.
            aria-current={stage.id === current.id ? 'true' : undefined}
            className="space-y-0.5"
          >
            <p className="text-xs tabular-nums text-muted-foreground">
              {t('fasting.stages.fromHours', { hours: stage.startsAtHours })}
            </p>
            <p className={cn('text-sm font-medium', stage.id === current.id && 'text-primary')}>{t(stage.nameKey)}</p>
            <p className="text-xs text-muted-foreground">{t(stage.sentenceKey)}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
