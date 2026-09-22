/**
 * One labelled figure in a row of stats: the recipe the weight card and the
 * range summary share.
 *
 * ── THE LADDER INSIDE A TILE ─────────────────────────────────────────────
 * A label, a figure and a note used to be 12px, 20px and 12px in one grey and
 * one case, so the label read as more of the same prose that sat around it.
 * The label now wears the section label recipe (`SECTION_EYEBROW_CLASS`, grey
 * capitals), which is what the rest of the app already means by "a name for
 * the thing below". The figure is the loudest thing in the tile, and a note
 * under it is quiet prose. Three tiers, three looks.
 *
 * ── A TILE HOLDS A FIGURE, NEVER A SENTENCE ──────────────────────────────
 * A sentence in the figure slot wrapped to five lines in a third of a card and
 * stretched the two tiles beside it to match. A stat that has no figure yet
 * does not get a tile: the caller says why in one line under the row.
 *
 * ── A ROW ON A PHONE, THREE COLUMNS FROM 560px ───────────────────────────
 * Three tiles across a phone leave about 75px of content each, and a signed
 * figure with its unit does not fit that at 20px. So below 560px a tile is one
 * row, label left and figure right, and from 560px the tiles stand side by
 * side with the label on top. The tiles draw no radius, corners are square
 * app-wide (DESIGN.md section 5).
 */
import type { HTMLAttributes, ReactNode } from 'react';

import { SECTION_EYEBROW_CLASS } from '#app/components/typography';
import { cn } from '#app/lib/utils';

/** The grid a run of tiles sits in. */
export const STAT_GRID_CLASS = 'grid grid-cols-1 gap-2 min-[560px]:grid-cols-3';

/** A stat figure: the loudest thing in its tile, and lined up digit under digit. */
export const STAT_FIGURE_CLASS = 'text-xl font-semibold tabular-nums';

/** The unit beside a figure, and the note under one. */
export const STAT_UNIT_CLASS = 'text-sm font-normal text-muted-foreground';
export const STAT_NOTE_CLASS = 'text-xs text-muted-foreground';

type StatTileProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** What the figure measures, already translated. */
  label: string;
  /** The figure, and under it an optional note. */
  children: ReactNode;
};

/**
 * @param props - the label and the figure; anything else lands on the tile's own element.
 */
export function StatTile({ label, children, className, ...rest }: StatTileProps) {
  return (
    <div
      data-slot="stat-tile"
      className={cn(
        'flex min-h-11 items-center justify-between gap-3 border bg-card p-3 min-[560px]:block',
        className,
      )}
      {...rest}
    >
      <p className={cn(SECTION_EYEBROW_CLASS, 'min-[560px]:mb-1')}>{label}</p>
      <div className="min-w-0 text-right min-[560px]:text-left">{children}</div>
    </div>
  );
}
