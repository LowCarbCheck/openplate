/**
 * Plate-shaped ring progress (M129/02) — replaces the diary hero's flat
 * linear bar. A track circle in a muted color plus a progress arc whose
 * color the CALLER controls via `progressClassName` (the diary passes the
 * same under/over-goal teal-vs-amber logic the old `CarbGoalBar` used).
 *
 * The SVG is rotated -90deg so the arc starts at 12 o'clock and fills
 * clockwise, matching the plate-glyph's circular rim. Dashoffset changes
 * animate via a CSS transition, but ONLY under `motion-safe:` — see
 * `prefers-reduced-motion` handling below — so a goal edit or a fresh
 * day's ring doesn't force motion on someone who has asked for less of it.
 *
 * Accessibility: a visually-hidden `<progress>` element carries the real
 * (unclamped) value/max — not the clamped arc geometry — so assistive tech
 * still reports "120 of 100" rather than silently capping at the ceiling. The
 * SVG and the centered stat are `aria-hidden`, since both are redundant with
 * it. `label` is required (the linear bar it replaces had no accessible name
 * at all).
 */
import type { CSSProperties, ReactNode } from 'react';
import { computeRingGeometry } from '#app/lib/ring-progress';
import { cn } from '#app/lib/utils';

export function RingProgress({
  value,
  animatedValue,
  max,
  size = 112,
  strokeWidth = 10,
  trackClassName,
  progressClassName,
  label,
  children,
  className,
}: {
  value: number;
  /**
   * The value the ARC draws, when it differs from the true one — the diary
   * feeds this a count-up tween so the arc sweeps old→new on an add (M129/03).
   * `value` still owns `aria-valuenow`: assistive tech reports the real figure,
   * not a mid-animation frame. Defaults to `value`.
   */
  animatedValue?: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  /** Text color class for the muted track circle (defaults to a neutral border tone). */
  trackClassName?: string;
  /** Text color class for the progress arc — the caller decides under/over-goal coloring. */
  progressClassName?: string;
  /** Accessible name — states the value in words (e.g. "42 of 100 grams net carbs"). */
  label: string;
  /** Rendered centered inside the ring — the hero stat this ring decorates. */
  children?: ReactNode;
  className?: string;
}) {
  const { radius, circumference, dashoffset } = computeRingGeometry({
    value: animatedValue ?? value,
    max,
    size,
    strokeWidth,
  });
  const center = size / 2;

  return (
    <div
      className={cn(
        'relative inline-flex h-[var(--ring-box,var(--ring-box-default))] w-[var(--ring-box,var(--ring-box-default))] shrink-0 items-center justify-center',
        className,
      )}
      // `size` is the SVG's COORDINATE space; the rendered box comes from
      // `--ring-box`, falling back to the `--ring-box-default` this inline
      // style seeds from `size`. The two-property dance matters: an inline
      // style beats a class-declared custom property, so seeding `--ring-box`
      // directly would make a caller's `[--ring-box:112px]` silently lose.
      // With the fallback indirection, a caller can size the ring responsively
      // with ordinary Tailwind variants (`sm:[--ring-box:132px]`) and the
      // viewBox scales the whole drawing — stroke included — to match.
      // SAFETY: `CSSProperties` has no index signature for custom properties,
      // but React passes `--*` keys straight through to the inline style, and
      // the value is a `px` string this component builds itself.
      style={{ '--ring-box-default': `${size}px` } as CSSProperties}
    >
      {/*
        The semantics live on a real, visually-hidden `progress` element while
        the SVG draws the arc. `value`/`max` are the REAL (unclamped) figures —
        not the clamped arc geometry — so assistive tech still reports
        "120 of 100" rather than silently capping at the ceiling.
      */}
      <progress className="sr-only" value={Math.round(value)} max={Math.round(max)} aria-label={label} />
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          className={cn('text-muted', trackClassName)}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          className={cn(
            'text-primary motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500 motion-safe:ease-out',
            progressClassName,
          )}
        />
      </svg>
      {/* The centered stat is inset by the stroke plus a little air, so a long
          value ("142.1") lays out against the ring's INNER diameter rather
          than its bounding box and can never collide with the arc. */}
      {children && (
        <div
          aria-hidden="true"
          className="absolute inset-[14%] flex flex-col items-center justify-center text-center"
        >
          {children}
        </div>
      )}
    </div>
  );
}
