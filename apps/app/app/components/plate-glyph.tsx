/**
 * PlateGlyph (M129/02) — a reusable, ORIGINAL inline SVG that echoes the
 * brand mark's geometry without tracing it (no vector source exists; the app
 * icon is raster-only, see `public/icons/icon-192.png`). That icon is a solid
 * teal disc with three white shapes cut out of it: a tall pointed lens on the
 * left, a quarter-arc leaf up and to the right, and a low dome at the bottom
 * — three portions arranged on a plate.
 *
 * This is the LINE-ART reading of that same arrangement: an open plate rim
 * with the three portions drawn as outlines inside it. The first version of
 * this component filled a big blob in the middle of the rim, which at the low
 * opacities every caller uses (a muted empty-state mark, a landing watermark)
 * collapsed into an illegible dark smudge — a filled shape at 10% alpha is
 * just a grey rectangle-ish nothing, whereas strokes stay readable as strokes
 * all the way down. Everything here is `stroke`, nothing is `fill`.
 *
 * Scaling: the geometry lives in a 64-unit viewBox and the strokes scale with
 * the box, so the mark reads as a delicate 1.5px outline at 48–64px (empty
 * states) and as a confident ~10px outline at 400px+ (landing watermark) with
 * no per-call tuning. The portions are inset to ~82% of the rim radius, which
 * keeps a visible ring of "empty plate" around them at every size — that gap
 * is what makes it read as a plate rather than a logo blob.
 *
 * Decorative by default (`aria-hidden`) since every current usage sits next
 * to text that already says the same thing (empty-state copy, hero heading).
 * Pass `label` for the rare case where the glyph itself is the only thing
 * conveying meaning.
 */
export function PlateGlyph({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {/* Plate rim. */}
      <circle cx="32" cy="32" r="29" strokeWidth="2.4" />
      {/*
        The three portions, scaled up 15% about the plate's center so they
        fill the well without touching the rim. The group transform scales the
        stroke too, hence the 1.9 authored width landing at ~2.2 rendered —
        deliberately a hair lighter than the rim, so the rim stays the
        dominant shape and the portions sit inside its hierarchy.
      */}
      <g transform="translate(32 32) scale(1.15) translate(-32 -32)" strokeWidth="1.9">
        {/* Left portion — tall pointed lens (the icon's left cut-out). */}
        <path d="M23.2 21.5C28.4 25.6 29 37.4 23.2 42.5 17.4 37.4 18 25.6 23.2 21.5Z" />
        {/* Upper-right portion — a leaf: two quarter-arcs meeting at opposite
            points, with a midrib so it reads as a leaf and not a lozenge. */}
        <path d="M35.5 28.5C35.5 21.5 39.5 17.5 46.5 17.5 46.5 24.5 42.5 28.5 35.5 28.5Z" />
        <path d="M37.8 26.2 44.6 19.4" strokeWidth="1.4" />
        {/* Lower-right portion — the dome, flat side down. */}
        <path d="M31.3 44.2A8.2 8.2 0 0 1 47.7 44.2Z" />
      </g>
    </svg>
  );
}
