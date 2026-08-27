/**
 * A QR code, rendered as inline SVG from a matrix computed on this device.
 *
 * `uqr` returns the module matrix and nothing else — no canvas, no image, no
 * network. That matters here: the only thing this app puts in a QR code is a
 * clinician's connect link (`app/lib/clinician-link.ts`), and a QR service that
 * rendered it elsewhere would be a third party holding a share public key,
 * which is the thing `openplate-sync` ADR-0002 prohibition 1 forbids the
 * app's OWN server from doing.
 *
 * SVG rather than a canvas so it prints, scales and survives a screenshot at
 * any zoom, and so it needs no ref, no effect and no device-pixel-ratio maths.
 */
import { useId, useMemo } from 'react';
import { encode } from 'uqr';

/** Modules of white margin around the code. Four is the spec's quiet zone; scanners rely on it. */
const QUIET_ZONE_MODULES = 4;

export function QrCode({
  value,
  /** Read by a screen reader in place of the picture — a QR code is meaningless to one otherwise. */
  title,
  className,
}: {
  value: string;
  title: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => toMatrixPath(value), [value]);
  const extent = size + QUIET_ZONE_MODULES * 2;
  const titleId = useId();

  return (
    <svg aria-labelledby={titleId} viewBox={`0 0 ${extent} ${extent}`} className={className}>
      <title id={titleId}>{title}</title>
      {/* An explicit white ground, not the card's background: a QR code on a
          dark theme's surface does not scan, and this is the one element in the
          app that has to stay light in both themes. */}
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/** The dark modules as one SVG path — one `<path>` beats a few hundred `<rect>` nodes for the same picture. */
function toMatrixPath(value: string) {
  const { size, data } = encode(value);
  const segments: string[] = [];
  for (const [row, modules] of data.entries()) {
    for (const [column, isDark] of modules.entries()) {
      if (isDark) segments.push(`M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`);
    }
  }
  return { size, path: segments.join('') };
}
