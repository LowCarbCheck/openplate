/**
 * The Overview hero's LEAD: the person's main goal as one large figure, its
 * unit, a caption, an 8 px meter and a scale line (layout F, "main goal
 * first", operator decision 2026-10-11).
 *
 * Presentational only. `buildHeroLead` (`#app/lib/day-hero-lead`) decides every
 * word and every number, so this file owns four things: the colour of the
 * figure, the caption and the meter per state, the meter, and the accessible
 * reading. The rows below it are `DayBudgetRows` with `density="ledger"`.
 *
 * THREE RULES CARRY OVER FROM THE ROWS, and one is new:
 *
 * 1. **Colour never carries meaning alone.** The caption names the state in
 *    words, and a reached floor wears a check mark, so it survives greyscale.
 *    Amber is the only warning colour and never `--destructive`; a floor can
 *    not be over, so protein is never amber.
 * 2. **The meter is decoration; the `progress` element is the fact.** Assistive
 *    tech reads the real, unclamped figures (`RowSemantics`).
 * 3. **No target, no meter.** A dashed line of the same height stands in, so the
 *    block is as tall as it is with a meter and an empty track is never drawn:
 *    it would read as a goal sitting at zero percent.
 * 4. **The block is the same size in every state** (DESIGN.md section 7). The
 *    figure row is as tall as the figure, whatever the caption says; the scale
 *    line keeps two lines of height; the meter or its stand-in is 8 px. An
 *    empty day, a logged day, over, reached and no target are one box.
 */
import { Check } from 'lucide-react';

import { ROW_FILL_CLASS, ROW_TRACK_CLASS, ReferenceTag, RowSemantics } from '#app/components/day-budget-rows';
import { UNIT_SPACE } from '#app/lib/format-macro-number';
import type { HeroLead } from '#app/lib/day-hero-lead';
import { cn } from '#app/lib/utils';

/** The figure's ink: amber over a limit, brand once a floor is reached, plain otherwise. */
function figureInkClass(tone: HeroLead['tone']): string {
  if (tone === 'over') return 'text-accent-amber';
  if (tone === 'met') return 'text-primary';
  return 'text-foreground';
}

/** The caption's ink: the figure's colour when the state is a warning or a success, quiet otherwise. */
function captionInkClass(tone: HeroLead['tone']): string {
  if (tone === 'over') return 'text-accent-amber';
  if (tone === 'met') return 'text-primary';
  return 'text-muted-foreground';
}

/** The two class lists a meter is painted with. */
interface MeterClasses {
  fill: string;
  track: string;
}

/** The meter's fill and track: amber over a limit, brand once a floor is reached, the metric's own colour otherwise. */
function meterClasses(lead: HeroLead): MeterClasses {
  if (lead.tone === 'over') return { fill: 'bg-accent-amber', track: ROW_TRACK_CLASS[lead.row.key] };
  if (lead.tone === 'met') return { fill: 'bg-primary', track: 'bg-primary/15' };
  return { fill: ROW_FILL_CLASS[lead.row.key], track: ROW_TRACK_CLASS[lead.row.key] };
}

/** The 8 px meter, or a dashed line in a box of the same height where there is no target. */
function LeadMeter({ lead }: { lead: HeroLead }) {
  if (lead.fraction === null) {
    return (
      <div data-slot="budget-track-none" aria-hidden="true" className="mt-3.5 flex h-2 items-center">
        <div className="w-full border-t-2 border-dashed border-border" />
      </div>
    );
  }
  const { fill, track } = meterClasses(lead);
  return (
    <div data-slot="budget-track" aria-hidden="true" className={cn('mt-3.5 h-2 overflow-hidden', track)}>
      <div
        className={cn('h-full motion-safe:transition-[width] motion-safe:duration-500', fill)}
        style={{ width: `${lead.fraction * 100}%` }}
      />
    </div>
  );
}

/**
 * The lead block.
 *
 * @param lead - the final figure, words and fraction from `buildHeroLead`.
 */
export function DayBudgetLead({ lead }: { lead: HeroLead }) {
  const { row } = lead;
  const isMet = lead.tone === 'met';
  return (
    <div data-slot="budget-lead" data-metric={row.key} data-tone={lead.tone}>
      {/*
        The caption sits at the figure's baseline edge (`items-end`) and wraps
        UPWARD inside the figure's own height, so a caption of one line or two
        never makes this row taller than the 46 px figure. A third line would;
        `tests/e2e/dashboard-lead.spec.ts` walks the longest captions in three
        languages at 360 px to keep that from happening unseen.
      */}
      <div className="flex items-end gap-x-2.5">
        <p
          data-slot="budget-lead-figure"
          className={cn(
            'shrink-0 text-[2.875rem] font-semibold leading-none tracking-tight tabular-nums',
            figureInkClass(lead.tone),
          )}
        >
          {lead.figure}
          <span className="text-xl font-medium">
            {UNIT_SPACE}
            {lead.unit}
          </span>
        </p>
        <p
          data-slot="budget-lead-caption"
          className={cn('min-w-0 pb-1 text-sm leading-tight tabular-nums', captionInkClass(lead.tone))}
        >
          {lead.caption}
          {isMet && <Check className="ms-1 inline size-4 align-text-bottom" aria-hidden="true" />}
        </p>
      </div>
      <LeadMeter lead={lead} />
      {/*
        TWO LINES OF HEIGHT, kept whatever the text. "1,640 kcal so far, 5
        entries" and "limit 1,950 kcal" together are wider than a 296 px
        column in a mono face, so on a phone the line may wrap; the empty day's
        short line does not. Reserving the second line is what keeps the box
        one size between the two.
      */}
      <div className="mt-1.5 flex min-h-8 justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
        <span data-slot="budget-lead-scale-start" className="min-w-0">
          {lead.scaleStart}
        </span>
        <span data-slot="budget-lead-scale-end" className="min-w-0 text-right">
          {lead.scaleEnd}
          {row.targetSource === 'default' && row.referenceDateMissing && (
            <ReferenceTag row={row} className="block text-xs text-muted-foreground" />
          )}
        </span>
      </div>
      <RowSemantics row={row} />
    </div>
  );
}
