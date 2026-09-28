/**
 * One award on the awards screen (M235/06), earned or not yet.
 *
 * ── NO NEW BADGE OR CARD COMBO ───────────────────────────────────────────
 *
 * DESIGN.md §11 bans a one-off card/badge class combo where a recipe fits, so
 * the pill is `app/components/ui/badge.tsx` with its shipped variants and
 * nothing else: `default` (the brand fill) for an award a person holds,
 * `outline` for one they do not. There is no colour decision here at all,
 * which is the point. Red is reserved for carb quality and delete, amber says
 * "over goal", and an award that has not arrived yet is not any of those
 * things, it is simply quiet.
 *
 * ── A TIER IS A NUMBER, SO IT IS DRAWN AS ONE ────────────────────────────
 *
 * The streak and on-plan families are LADDERS: 3, 7, 14, 30, 100 days. Their
 * rows used to be identical in every respect but the title, so "three days" and
 * "a hundred days" were the same object on the screen and the only way to tell
 * the near goal from the far one was to read five sentences. The catalog
 * already carries the number (`AwardDefinition.threshold`), so the row prints
 * it in a fixed, right-aligned, `tabular-nums` column and the family reads as
 * the ladder it is at a glance.
 *
 * It is a FIGURE and not a size, a weight or a hue, for the reason above: five
 * escalating treatments would be five decisions about how loud a hundred days
 * is allowed to be, and a number needs none. An explorer award has no
 * threshold, so it prints nothing and its family keeps the shape it had, which
 * is also what separates "you tried a thing" from "you kept at it".
 *
 * ── THE NOTE IS ONLY SHOWN ONCE IT IS TRUE ───────────────────────────────
 *
 * Every note in the catalog is written in the past tense ("You logged your
 * first food."), because that is the sentence a person reads the moment they
 * earn it. Rendering it under an unearned award would state as fact something
 * that has not happened, so an unearned row is the title and the pill and
 * nothing else. That also keeps the screen from reading as a list of chores.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '#app/components/ui/badge';
import type { AwardDefinition } from '#app/lib/gamification/catalog';
import { formatDayLabel } from '#app/lib/format-day-label';
import { cn } from '#app/lib/utils';

/** A bare `YYYY-MM-DD`. `formatDayLabel` THROWS on anything else, and see {@link earnedDateLabel}. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day an award was earned, as a person reads it.
 *
 * Falls back to the stored string when it is not a day key, because
 * `formatDayLabel` throws on one and an award row written by a build this one
 * does not fully understand must not be able to take the screen down. The
 * fallback is still readable, and it cannot be reached by anything this build
 * writes: `evaluateAwards` stamps the day key it was handed.
 *
 * @param earnedOnDay - the stored day.
 * @param language - the active UI language.
 * @returns the label to interpolate into the pill.
 */
function earnedDateLabel(earnedOnDay: string, language: string): string {
  if (!DAY_KEY_PATTERN.test(earnedOnDay)) return earnedOnDay;
  return formatDayLabel(earnedOnDay, language);
}

/**
 * One award row.
 *
 * @param award - the catalog definition, which carries the two copy keys.
 * @param earnedOnDay - the local day it was earned (`YYYY-MM-DD`), or null while it is not held.
 * @returns the row.
 */
export function AwardTile({
  award,
  earnedOnDay,
}: {
  award: AwardDefinition;
  earnedOnDay: string | null;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isEarned = earnedOnDay !== null;

  return (
    // The badge drops UNDER the title below 400px. Beside it, a 147px German
    // date badge left the title and its note about 120px to wrap into while
    // the space under the badge stayed empty.
    <div
      data-slot="award-tile"
      data-earned={isEarned ? 'yes' : 'no'}
      className="flex flex-col gap-1.5 py-3 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between min-[400px]:gap-3"
    >
      {/* The numeral and the words stay a ROW at every width. The wrapper above
          turns into a column under 400px so the date badge can drop, and
          without this the tier figure would drop with it and sit on its own
          line above the title. */}
      <div className="flex min-w-0 items-baseline gap-3">
        {award.threshold !== undefined && (
          <span
            data-slot="award-threshold"
            className={cn(
              'w-7 shrink-0 text-right text-sm tabular-nums',
              isEarned ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {award.threshold}
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          <p className={cn('text-sm font-medium', isEarned ? 'text-foreground' : 'text-muted-foreground')}>
            {t(award.titleKey)}
          </p>
          {isEarned && <p className="text-xs text-muted-foreground">{t(award.noteKey)}</p>}
        </div>
      </div>
      <Badge variant={isEarned ? 'default' : 'outline'} className="w-fit">
        {isEarned ? t('awards.earnedOn', { date: earnedDateLabel(earnedOnDay, i18n.language) }) : t('awards.notYet')}
      </Badge>
    </div>
  );
}
