/**
 * The playground's layout pieces and its address.
 *
 * ── The address ──────────────────────────────────────────────────────────
 *
 * Everything the page remembers about where you are lives in the URL hash, so a
 * link names a state:
 *
 *   #admin-people                  a section (its own page, loaded lazily)
 *   #admin-people:filters          one group of that section (a sub-page)
 *   #admin-people/people-mixed     one card, scrolled into view
 *
 * The hash is read with `useSyncExternalStore`, so there is no effect that
 * copies it into state and no frame in which the two disagree. It is
 * independent of the memory router the cards sit in (`./providers.tsx`).
 *
 * ── The pieces ───────────────────────────────────────────────────────────
 *
 * `Section` and `Group` give a section its heading and its sub-pages. `Card` is
 * one labelled state. `Segmented` is the control the chrome is made of.
 */
import {
  Children,
  Component,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '#app/lib/utils';
import { PHONE_FRAME_PX, type WidthChoice } from './prefs';

////////////////////////////////////////////////////////////////////////////////
// The address
////////////////////////////////////////////////////////////////////////////////

/** What the hash names. Every part is null when the hash does not say it. */
export interface HashRoute {
  section: string | null;
  group: string | null;
  card: string | null;
}

/** `#section`, `#section:group`, `#section/card`, `#section:group/card`. Lowercase words and dashes only. */
const HASH_PATTERN = /^#([a-z0-9-]+)(?::([a-z0-9-]+))?(?:\/([a-z0-9-]+))?$/;

/**
 * Reads a hash into its three parts.
 *
 * @param hash - `window.location.hash`, with its leading `#`.
 * @returns the parts; a hash that is not in the grammar names nothing.
 */
export function parseHash(hash: string): HashRoute {
  const match = HASH_PATTERN.exec(hash);
  return { section: match?.[1] ?? null, group: match?.[2] ?? null, card: match?.[3] ?? null };
}

/**
 * Writes the parts back into a hash. The inverse of {@link parseHash}.
 *
 * @param route - the parts to name.
 * @returns the hash, or the empty string for a route with no section.
 */
export function formatHash(route: HashRoute): string {
  if (route.section === null) return '';
  const group = route.group === null ? '' : `:${route.group}`;
  const card = route.card === null ? '' : `/${route.card}`;
  return `#${route.section}${group}${card}`;
}

/** A group's title as it sits in the address: `Needs a look` becomes `needs-a-look`. */
export function groupSlug(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = (): string => window.location.hash;
const readServerHash = (): string => '';

/** One section, as both the nav and the body know it. */
export interface SectionDef {
  readonly id: string;
  readonly title: string;
  /** One line: what this section is for. Printed under the heading. */
  readonly intent: string;
}

/** The page's position and the ways to move it. */
export interface PageRoute {
  readonly activeId: string;
  readonly group: string | null;
  readonly cardHandle: string | null;
  readonly selectSection: (id: string) => void;
  readonly selectGroup: (slug: string | null) => void;
}

/**
 * Where the page is, read from the hash.
 *
 * @param sectionIds - the registry's ids, first is the default.
 * @returns the active section (the first one when the hash names none we know), the group, the card, and the movers.
 */
export function useHashRoute(sectionIds: readonly string[]): PageRoute {
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const parsed = parseHash(hash);
  const fallbackId = sectionIds[0];
  if (fallbackId === undefined) throw new Error('The playground has no sections');
  const activeId = sectionIds.find((id) => id === parsed.section) ?? fallbackId;
  return {
    activeId,
    group: parsed.group,
    cardHandle: parsed.card,
    selectSection: (id) => {
      window.location.hash = formatHash({ section: id, group: null, card: null });
    },
    selectGroup: (slug) => {
      window.location.hash = formatHash({ section: activeId, group: slug, card: null });
    },
  };
}

////////////////////////////////////////////////////////////////////////////////
// Contexts the pieces share
////////////////////////////////////////////////////////////////////////////////

/** The route, for `Section` (sub-page bar, scroll to a card). Null in a test, where every group shows. */
export const PageRouteContext = createContext<PageRoute | null>(null);

/** The width control's value, for `Card` (the phone frame) and `Group` (the grid). */
export const WidthContext = createContext<WidthChoice>('full');

/** The id of the section being drawn, so a card can name its own address. */
const SectionIdContext = createContext<string | null>(null);

////////////////////////////////////////////////////////////////////////////////
// Section and Group
////////////////////////////////////////////////////////////////////////////////

/** The titles of the `Group` elements that are direct children. */
function groupTitlesOf(items: readonly ReactNode[]): string[] {
  return items.flatMap((item) => (isValidElement<GroupProps>(item) && item.type === Group ? [item.props.title] : []));
}

/** The children to draw: all of them, or only the groups of the sub-page asked for. */
function visibleChildren({ items, only }: { items: readonly ReactNode[]; only: string | null }): readonly ReactNode[] {
  if (only === null) return items;
  return items.filter((item) => {
    if (!isValidElement<GroupProps>(item) || item.type !== Group) return true;
    return groupSlug(item.props.title) === only;
  });
}

/** The `data-slot` that marks a card, so a card is told apart from any other element with a `data-state`. */
export const CARD_SLOT = 'playground-card';

/** Scrolls the card the address names into view, once the section's cards are in the page. */
function useScrollToCard(handle: string | null): void {
  useEffect(() => {
    if (handle === null) return;
    const scrollToCard = (): void => {
      // Not every `[data-state]` is a card: Radix primitives set `data-state="open"` and the like.
      for (const card of document.querySelectorAll(`[data-slot="${CARD_SLOT}"]`)) {
        if (card.getAttribute('data-state') !== handle) continue;
        card.scrollIntoView({ block: 'start' });
        return;
      }
    };
    scrollToCard();
    // The fonts swap in after the first paint and change line heights above the card, so look again once they are in.
    let isCancelled = false;
    void (async () => {
      await document.fonts.ready;
      if (!isCancelled) scrollToCard();
    })();
    return () => {
      isCancelled = true;
    };
  }, [handle]);
}

export interface SectionProps {
  def: SectionDef;
  children: ReactNode;
}

/**
 * One section, drawn as its own page.
 *
 * Each `Group` that is a DIRECT child is also a sub-page. With two or more, a
 * bar under the intent offers All plus one link per group, and
 * `#<section>:<group>` mounts only that group's cards. A card address
 * (`#<section>/<card>`) always shows everything, so the card is there to be
 * found. The groups are read off the children, not registered by an effect, so
 * the bar is in the first paint and a group that is not shown is never mounted.
 */
export function Section({ def, children }: SectionProps): ReactElement {
  const route = useContext(PageRouteContext);
  useScrollToCard(route?.cardHandle ?? null);
  const items = Children.toArray(children);
  const groups = groupTitlesOf(items);
  // A card address shows every group, so the card is there to be found. Without one, the group asked for.
  const asked = route === null || route.cardHandle !== null ? null : route.group;
  const only = asked !== null && groups.some((title) => groupSlug(title) === asked) ? asked : null;
  return (
    <SectionIdContext.Provider value={def.id}>
      <section id={def.id} className="scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight">{def.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{def.intent}</p>
        {route !== null && groups.length >= 2 && (
          <SubPageBar sectionDef={def} groups={groups} only={only} selectGroup={route.selectGroup} />
        )}
        <div className="mt-4 space-y-8">{visibleChildren({ items, only })}</div>
      </section>
    </SectionIdContext.Provider>
  );
}

function SubPageBar({
  sectionDef,
  groups,
  only,
  selectGroup,
}: {
  sectionDef: SectionDef;
  groups: readonly string[];
  only: string | null;
  selectGroup: (slug: string | null) => void;
}): ReactElement {
  const entries = [null, ...groups];
  return (
    <nav aria-label={`${sectionDef.title} pages`} className="mt-3 flex flex-wrap gap-1">
      {entries.map((title) => {
        const slug = title === null ? null : groupSlug(title);
        const isCurrent = slug === only;
        return (
          <a
            key={slug ?? 'all'}
            href={slug === null ? `#${sectionDef.id}` : `#${sectionDef.id}:${slug}`}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              selectGroup(slug);
            }}
            className={cn(
              'border px-2 py-0.5 text-xs font-medium',
              isCurrent ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {title ?? 'All'}
          </a>
        );
      })}
    </nav>
  );
}

interface GroupProps {
  title: string;
  children: ReactNode;
}

/** The grid each width mode lays its cards in. Phone frames pack by the column; full width stacks, two across when wide. */
const GRID_CLASS = {
  full: 'grid grid-cols-1 gap-4 2xl:grid-cols-2',
  phone: 'grid grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] gap-4',
} satisfies Record<WidthChoice, string>;

/** One named group of cards. Its title is also its sub-page address. */
export function Group({ title, children }: GroupProps): ReactElement {
  const width = useContext(WidthContext);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className={cn('mt-2', GRID_CLASS[width])}>{children}</div>
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Card
////////////////////////////////////////////////////////////////////////////////

/**
 * Catches a render error inside ONE card, so a component that cannot draw a
 * state shows that on its card instead of blanking the page. The page exists to
 * find such states, so the message is printed in full.
 */
interface CrashBoundaryState {
  error: Error | null;
}

class CardCrashBoundary extends Component<{ children: ReactNode }, CrashBoundaryState> {
  state: CrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('playground card crashed', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <p role="alert" className="border border-accent-amber-border bg-accent-amber-surface p-3 text-sm text-accent-amber">
        This card crashed while drawing: {error.message}
      </p>
    );
  }
}

export interface CardProps {
  /**
   * The card's stable handle, drawn as `data-state`. Flat kebab-case, naming
   * what the card SHOWS: `people-filter-no-match`. Required so the compiler
   * finds a card without one; the sections test refuses a repeat on the page.
   * A browser check addresses `[data-state="..."]`. The label is prose that
   * gets reworded, so it is not a key.
   */
  state: string;
  label: string;
  /** One sentence: how a person reaches this state in the real app. Printed after "Reach it for real:". */
  reach: string;
  /** What is stood in or driven by the playground, when it is not the real thing (a stub handler, local state for the address). */
  note?: string;
  /** Two columns where the grid has them. */
  span?: 1 | 2;
  children: ReactNode;
}

/** One labelled state: label, handle, the reach-it line, then the stage with the real component in it. */
export function Card({ state, label, reach, note, span = 1, children }: CardProps): ReactElement {
  const width = useContext(WidthContext);
  const route = useContext(PageRouteContext);
  const sectionId = useContext(SectionIdContext);
  const isTarget = route?.cardHandle === state;
  return (
    <div
      data-slot={CARD_SLOT}
      data-state={state}
      className={cn(
        'min-w-0 border bg-card p-4 text-card-foreground',
        span === 2 && '2xl:col-span-2',
        isTarget && 'outline outline-2 outline-ring',
      )}
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {sectionId === null ?
          <code>{state}</code>
        : <a href={`#${sectionId}/${state}`} className="underline underline-offset-2 hover:text-foreground">
            <code>{state}</code>
          </a>
        }
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Reach it for real:</span> {reach}
      </p>
      {note !== undefined && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>}
      <div className="mt-3">
        <CardCrashBoundary>
          <Stage width={width}>{children}</Stage>
        </CardCrashBoundary>
      </div>
    </div>
  );
}

/** The box the real component sits in. In phone mode it is a 375 px frame, so container queries see a phone column. */
function Stage({ width, children }: { width: WidthChoice; children: ReactNode }): ReactElement {
  if (width === 'full') return <div data-slot="playground-stage">{children}</div>;
  return (
    <div
      data-slot="playground-stage"
      data-frame="phone"
      className="mx-auto max-w-full overflow-x-auto border bg-background"
      style={{ width: PHONE_FRAME_PX }}
    >
      {children}
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Segmented control
////////////////////////////////////////////////////////////////////////////////

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  /** Longer name for the tooltip, when the label is a code. */
  title?: string;
}

export interface SegmentedProps<Value extends string> {
  label: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (next: Value) => void;
}

/** A row of buttons where exactly one is pressed. */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<Value>): ReactElement {
  return (
    <fieldset className="inline-flex flex-wrap border">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2 py-1 text-xs font-medium',
            option.value === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
