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
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

import { Link } from '#app/components/link';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#app/components/ui/collapsible';
import { SECTION_EYEBROW_CLASS, SectionEyebrow } from '#app/components/typography';
import { cn } from '#app/lib/utils';

/**
 * The one inset-container recipe: both variants below compose it, nothing else
 * re-types it. It is the ladder's card step (8px, `tests/design-contract.ts`),
 * because an inset group IS a card, one with rows in it instead of a title.
 */
export const SETTINGS_INSET_CLASS = 'rounded-lg border bg-card';

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
      {/* THE ICON LOST ITS TILE, not the row its icon (M243 spec 03). It used
          to be a teal glyph on a grey `size-9` tile, so a hub of fifteen rows
          spent fifteen brand moments on decoration and had none left for the
          one thing a person came to do. The glyph stays, grey, because a hub of
          fifteen rows in six languages is scanned by shape before it is read.
          The box keeps its size so the rows still line up with each other. */}
      <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
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
 * grouped-list pattern): one `SETTINGS_INSET_CLASS` container, rows separated
 * by hairline dividers, no border or radius on the row itself. The label is a
 * real heading, so the page keeps an outline.
 */
export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow as="h2" className="px-4">
        {label}
      </SectionEyebrow>
      <div data-slot="settings-inset" className={cn(SETTINGS_INSET_CLASS, 'divide-y divide-border overflow-hidden')}>
        {children}
      </div>
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
      <div data-slot="settings-inset" className={cn(SETTINGS_INSET_CLASS, 'space-y-4 px-4 py-4', contentClassName)}>
        {children}
      </div>
    </section>
  );
}

/**
 * The reference variant of {@link SettingsSection}: same inset box, same label,
 * but the label is the control that opens it, and it starts closed.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `/settings/ai` ended with about ten paragraphs of small grey prose under the
 * save button: what happens to a photo, what a scan costs, what to try when one
 * fails. All of it is true and none of it is what a first-time visitor came for,
 * and at equal weight it pushed the save button off the bottom of a phone. Prose
 * that answers a question nobody has asked yet is the definition of a thing to
 * put behind a disclosure.
 *
 * ── WHY THE HEADING IS THE TRIGGER ───────────────────────────────────────
 *
 * There is no "Show more" label anywhere below, on purpose. A second string
 * would have to be written, judged and bought in six languages to say what the
 * section's own heading already says, and a disclosure whose trigger is its
 * heading is the plainer control anyway. The `<h2>` stays a real heading so the
 * page keeps its outline; the `<button>` lives inside it, which is the nesting
 * the HTML allows (a heading may contain a button, never the other way round).
 *
 * ── THE BOX ONLY EXISTS WHILE IT IS OPEN ─────────────────────────────────
 *
 * No `forceMount` here, unlike the key fields on `/settings/ai`: this variant
 * carries reference text and never a form control, so nothing is lost by
 * leaving the DOM while closed, and a closed section costs the page no height
 * at all. Do not put a field in one.
 */
export function SettingsDisclosure({
  label,
  children,
  contentClassName,
}: {
  label: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="space-y-2" data-slot="settings-disclosure">
      <Collapsible>
        <h2 className="px-4">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                SECTION_EYEBROW_CLASS,
                // `group`, because Radix writes `data-state` on the TRIGGER and
                // the chevron that has to turn is its child.
                'group flex min-h-11 w-full items-center gap-1.5 text-left transition-colors hover:text-foreground',
              )}
            >
              {label}
              <ChevronDown
                className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent>
          <div data-slot="settings-inset" className={cn(SETTINGS_INSET_CLASS, 'space-y-4 px-4 py-4', contentClassName)}>
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
