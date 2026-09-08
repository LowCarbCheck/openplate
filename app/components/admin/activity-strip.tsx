/**
 * The strip itself: one square per day, in the order the service sent them.
 *
 * ── One drawing, three places ────────────────────────────────────────────
 *
 * A person's detail page, a row in the people list and a row on the activity
 * page all draw the same thing over different windows. A seven day strip is
 * not a different picture from a ninety day one, it is the same picture with
 * fewer squares, so it is the same component with a smaller `size`. A second
 * implementation would have been the place the "a quiet day is still a square"
 * rule got quietly dropped.
 *
 * ── A LIST, not a canvas ─────────────────────────────────────────────────
 *
 * Each square carries its day and its count as text, so the strip is readable
 * by somebody who cannot see the shading, and ninety of them are ninety `<li>`s
 * rather than a charting dependency.
 */
import { useTranslation } from 'react-i18next';

import { activityLevel, type ActivityLevel } from '#app/lib/admin/activity-strip';
import type { AdminActivityDay } from '#app/lib/admin/admin-wire';

/** How big the squares are drawn. `row` is the density a list of people needs; `full` is the detail page. */
export type ActivityStripSize = 'row' | 'full';

export interface ActivityStripProps {
  days: readonly AdminActivityDay[];
  size?: ActivityStripSize;
}

export function ActivityStrip({ days, size = 'full' }: ActivityStripProps) {
  const { t } = useTranslation();

  return (
    <ul className={`flex gap-0.5 ${size === 'full' ? 'flex-wrap gap-1' : ''}`}>
      {days.map((entry) => (
        <li
          key={entry.day}
          className={`${SIZE_CLASS[size]} rounded-sm ${LEVEL_CLASS[activityLevel(entry.count)]}`}
          title={t('admin.person.day', { day: entry.day, photos: entry.count })}
        >
          <span className="sr-only">{t('admin.person.day', { day: entry.day, photos: entry.count })}</span>
        </li>
      ))}
    </ul>
  );
}

/** How wide a square is drawn at each size. A row's squares are smaller so a strip fits beside a name. */
const SIZE_CLASS = {
  row: 'h-3 w-3',
  full: 'h-4 w-4',
} satisfies Record<ActivityStripSize, string>;

/**
 * How each level is painted.
 *
 * LEVEL 0 IS AN OUTLINE, not nothing. An empty square is what tells an operator
 * that the day is inside the window and was quiet, and a level that painted
 * nothing at all would put a hole in the strip in exactly the place the feature
 * exists to describe.
 */
const LEVEL_CLASS = {
  0: 'border border-border bg-muted',
  1: 'bg-primary/25',
  2: 'bg-primary/50',
  3: 'bg-primary/75',
  4: 'bg-primary',
} satisfies Record<ActivityLevel, string>;
