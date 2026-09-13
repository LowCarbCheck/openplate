/**
 * The settings chrome, in one place: the inset container every settings
 * surface draws itself in, the labelled row list the hub is made of, and the
 * labelled block a settings sub-page is made of (M225).
 *
 * ── WHY ONE CLASS STRING AND NOT TWO ─────────────────────────────────────
 *
 * The hub was redesigned as a native phone-style inset grouped list, and the
 * sub-pages still wore the desktop `Card` chrome: `p-6` padding, a serif
 * title, a shadow. Two looks for one idea is a bug in one of them
 * (DESIGN.md §10.7), so `SETTINGS_INSET_CLASS` is the single recipe both
 * variants compose, and a test pins it once rather than per component.
 *
 * `SettingsGroup` is a list of destinations, so its container adds hairline
 * dividers and clips them at the radius; `SettingsSection` is one block of
 * content, so its container adds padding. A page that wants rows uses
 * `SettingsGroup`; there is deliberately no `variant` prop choosing between
 * them.
 *
 * NO ICON SLOT on either label. The hub shows an icon per ROW, because a row
 * is a thing you are scanning for; a sub-page heading is the thing you already
 * found.
 */
import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { Link } from '#app/components/link';
import { SectionEyebrow } from '#app/components/typography';
import { cn } from '#app/lib/utils';

/** The one inset-container recipe: both variants below compose it, nothing else re-types it. */
export const SETTINGS_INSET_CLASS = 'rounded-2xl border bg-card';

/**
 * One settings destination. The whole row is the link (not a trailing "Open"
 * action) so the touch target is the full width, and the status line is
 * `null`, rather than a placeholder string, while the device read that
 * feeds it is still in flight, so the row never flashes a wrong value.
 */
export function SettingsRow({
  to,
  icon: Icon,
  title,
  status,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  status: string | null;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-13 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 active:bg-muted/70 focus-visible:bg-muted/50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-tight">{title}</span>
        {/* `line-clamp-2`, not a single-line `truncate`: German subtitles are
            roughly a third longer than the English ones, and at 390px the
            "Data & backup" row lost most of its sentence to an ellipsis. Two
            lines fit every current subtitle in both languages. */}
        {status !== null && <span className="block line-clamp-2 text-xs text-muted-foreground">{status}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </Link>
  );
}

/**
 * A labelled group of rows, drawn as one inset list (the native iOS/Android
 * grouped-list pattern): one `rounded-2xl border bg-card` container, rows
 * separated by hairline dividers, no border or radius on the row itself. The
 * label is a real heading, so the page keeps an outline.
 */
export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow as="h2" className="px-4">
        {label}
      </SectionEyebrow>
      <div className={cn(SETTINGS_INSET_CLASS, 'divide-y divide-border overflow-hidden')}>{children}</div>
    </section>
  );
}

/**
 * A labelled block of content on a settings sub-page: the same inset container
 * the hub's groups wear, with the label above it as a real heading and the
 * optional description under the label rather than inside the box.
 *
 * The description sits OUTSIDE the container on purpose: it explains what the
 * box is for, so it reads as a caption on the heading and the box keeps
 * holding only the controls.
 *
 * `label` is a string and not a `ReactNode`: it is a heading, and a heading
 * that can carry markup is a heading somebody will put an icon and a live
 * figure into.
 */
export function SettingsSection({
  label,
  description,
  children,
  contentClassName,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="space-y-2">
      <SectionEyebrow as="h2" className="px-4">
        {label}
      </SectionEyebrow>
      {description !== undefined && <p className="px-4 text-sm text-muted-foreground">{description}</p>}
      <div className={cn(SETTINGS_INSET_CLASS, 'space-y-4 px-4 py-4', contentClassName)}>{children}</div>
    </section>
  );
}
