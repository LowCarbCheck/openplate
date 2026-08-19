import { cn } from '#app/lib/utils';

/**
 * Three brand-colored dots breathing in sequence — the app's inline "waiting"
 * mark. Timing and the reduced-motion opt-in live in `app.css`'s
 * `.loading-dots` rule; this component owns only the geometry.
 *
 * Decorative by construction: it is never the only thing on screen saying
 * "waiting", so it carries `aria-hidden` and leaves the announcement to the
 * `role="status"` region around it. Two sizes: `sm` for a dot row that sits
 * inline beside text, `md` for the boot screen.
 */
export function LoadingDots({ size = 'sm', className }: { size?: 'sm' | 'md'; className?: string }) {
  const dotSize = size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5';

  return (
    <span
      aria-hidden="true"
      className={cn('loading-dots inline-flex items-center', size === 'md' ? 'gap-2' : 'gap-1', className)}
    >
      <span className={cn('rounded-full bg-primary', dotSize)} />
      <span className={cn('rounded-full bg-primary', dotSize)} />
      <span className={cn('rounded-full bg-primary', dotSize)} />
    </span>
  );
}

/**
 * The boot screen — what the app shows between "HTML has arrived" and "the
 * device's own data has been read".
 *
 * Every tracker route is client-only (`clientLoader` over IndexedDB), so the
 * server can't render their content at all and React Router paints a
 * `HydrateFallback` for the first hydration only (never on a client-side nav).
 * That used to be the bare word "Loading…" on an otherwise empty page, which
 * reads like a stalled page rather than an app starting up.
 *
 * The mark is the app icon rather than `PlateGlyph`: at this moment the user
 * has just tapped a home-screen icon or a bookmark, and seeing the same icon
 * they tapped is the reassurance the screen is for. It breathes with
 * `pulse-soft`, and the dots underneath carry the sense of progress that a
 * single static mark can't.
 *
 * Copy-free on purpose — there is no honest sentence to write here (we don't
 * know yet whether it's a diary, a scan or settings that's coming), and a
 * label would have to be translated for the sake of one word. The
 * `role="status"` region carries an `aria-label` instead, so screen readers
 * hear something while sighted users read nothing.
 */
export function AppLoading({ label }: { label: string }) {
  return (
    <output
      aria-live="polite"
      aria-label={label}
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6"
    >
      {/* `alt=""` + the labelled status region above: the icon is decoration,
          the region is the announcement. */}
      <img src="/icons/icon-192.png?v=2" alt="" className="pulse-soft h-16 w-16 rounded-2xl" />
      <LoadingDots size="md" />
    </output>
  );
}
