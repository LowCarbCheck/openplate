/**
 * The three little drawings on the ways-to-log cards, and nothing else.
 *
 * WHY IT IS ITS OWN MODULE. This is first-run decoration: a returning person
 * never sees it again, and an offline-first PWA should not carry it in the
 * bundle that boots the diary. `FirstFoodStep` reaches it through `lazy()`, so
 * the check "is this the first-food step" happens before the import does, and
 * `tests/unit/ways-to-log-bundle.test.ts` fails the push if a later refactor
 * turns that back into a static import.
 *
 * WHY NO ANIMATION LIBRARY. Three icons are not worth a runtime. These are
 * plain SVG elements carrying class names, and every moving part is a CSS
 * keyframe in `app/app.css` under `prefers-reduced-motion: no-preference`.
 * The consequence is the point: with motion turned off the browser renders
 * these files exactly as written, and as written they are already complete
 * drawings. Nothing here uses SMIL, the SVG element that animates itself,
 * because no media query can switch that off.
 *
 * The geometry is deliberately dull: one 48-unit box, `currentColor`, lucide's
 * stroke weight, so a card reads as a button with an icon rather than as an
 * illustration.
 */
import type { ReactNode } from 'react';

import type { WayToLogId } from '#app/lib/ways-to-log';

/** Shared frame: same box, same stroke, never focusable, never announced. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className="size-10 shrink-0 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A plate inside a viewfinder that pulls focus, then a shutter flash. */
function PlateGlyph() {
  return (
    <Glyph>
      <g className="wtl-focus">
        <path d="M5 15V8a3 3 0 0 1 3-3h7" />
        <path d="M43 15V8a3 3 0 0 0-3-3h-7" />
        <path d="M5 33v7a3 3 0 0 0 3 3h7" />
        <path d="M43 33v7a3 3 0 0 1-3 3h-7" />
      </g>
      <circle cx="24" cy="24" r="12" />
      <circle cx="24" cy="24" r="5.5" />
      {/* The shutter. Invisible at rest, which is the static first frame. */}
      <rect
        className="wtl-flash"
        x="4"
        y="4"
        width="40"
        height="40"
        rx="5"
        fill="currentColor"
        stroke="none"
        opacity="0"
      />
    </Glyph>
  );
}

/** A package's printed panel, with one bar travelling down it. */
function LabelGlyph() {
  return (
    <Glyph>
      <rect x="12" y="4" width="24" height="40" rx="3" />
      <path d="M17 14h14" />
      <path d="M17 21h14" />
      <path d="M17 28h9" />
      <path d="M17 35h14" />
      <rect
        className="wtl-scanline"
        x="13"
        y="10"
        width="22"
        height="2"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.45"
      />
    </Glyph>
  );
}

/** A search field over three result rows that settle in sequence. */
function SearchGlyph() {
  return (
    <Glyph>
      <rect x="4" y="5" width="40" height="13" rx="6.5" />
      <circle cx="13" cy="11.5" r="3" />
      <path d="M15.4 13.9 18 16.5" />
      <path d="M23 11.5h14" />
      <path className="wtl-row wtl-row-1" d="M6 28h36" />
      <path className="wtl-row wtl-row-2" d="M6 35h28" />
      <path className="wtl-row wtl-row-3" d="M6 42h33" />
    </Glyph>
  );
}

/**
 * The drawing for one way in.
 *
 * @param way - which of the three ways this card teaches.
 * @returns the card's glyph.
 */
export default function WayToLogAnimation({ way }: { way: WayToLogId }) {
  if (way === 'plate') return <PlateGlyph />;
  if (way === 'label') return <LabelGlyph />;
  return <SearchGlyph />;
}
