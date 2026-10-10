/**
 * Everything above the list of people: the search, the label and sort menus,
 * the quick-view chips and the result line.
 *
 * ── Nothing in here moves when a filter changes ──────────────────────────
 *
 * Typing, pressing a chip and picking a sort change the rows below and nothing
 * above them (DESIGN.md section 7). So every part has its box from the first
 * paint: the chips are a fixed height and their numbers sit inside fixed-size
 * buttons, the result line is always one line tall, and "Clear filters" is
 * always in it and merely `invisible` while nothing is filtered, instead of
 * being added when the first filter lands. `tests/e2e/admin-people-find.spec.ts`
 * reads the list's top edge before and after each of them.
 *

 * ── One baseline, one top, one height ────────────────────────────────────
 *
 * The three labels and the three controls (search, label menu, sort menu) line
 * up. The `Input` primitive is `h-11` on a phone and `md:h-9` from 768 px, so
 * the search box passed the menus' 44 px and sat 12 px lower with its label
 * dragged down with it. It is `md:h-11` here, and
 * `admin-people-find.spec.ts` reads the three tops at 1280 px.
 *
 * ── The label menu exists only where there is a label ────────────────────
 *
 * An instance whose operator never labelled anybody would get a menu whose
 * only choices are "any label" and "no label", which are the same list. It is
 * drawn when at least one person carries a label.
 *
 * ── "/" jumps to the search ──────────────────────────────────────────────
 *
 * The usual place for it. It does nothing while focus is in a field, a menu or
 * an editable area, where a slash is a character the person typed. The key
 * hint inside the box says so and goes invisible (not away) once something is
 * typed, so the browser's own clear button has the corner to itself.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { FilterChips, type FilterChip } from '#app/components/admin/filter-chips';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import {
  EMPTY_PEOPLE_FILTER,
  isPeopleFiltered,
  PEOPLE_SORTS,
  PEOPLE_VIEWS,
  type PeopleFilter,
  type PeopleLabelFilter,
  type PeopleSort,
  type PeopleView,
  type PeopleViewCounts,
} from '#app/lib/admin/people-filter';

/** The copy key for each quick view. */
export const VIEW_LABEL_KEY = {
  all: 'admin.filter.views.all',
  new: 'admin.filter.views.new',
  seen: 'admin.filter.views.seen',
  quiet: 'admin.filter.views.quiet',
  never: 'admin.filter.views.never',
  suspended: 'admin.filter.views.suspended',
  administrators: 'admin.filter.views.administrators',
} satisfies Record<PeopleView, string>;

/** The copy key for each sort. */
export const SORT_LABEL_KEY = {
  newest: 'admin.filter.sorts.newest',
  oldest: 'admin.filter.sorts.oldest',
  seen: 'admin.filter.sorts.seen',
  usage: 'admin.filter.sorts.usage',
  name: 'admin.filter.sorts.name',
} satisfies Record<PeopleSort, string>;

export interface PeopleToolbarProps {
  filter: PeopleFilter;
  onFilterChange: (next: PeopleFilter) => void;
  /** The labels present on the instance. With none, there is no label menu. */
  labels: readonly string[];
  /** How many people each view would leave, given the search and the label. */
  counts: PeopleViewCounts;
  /** How many rows are on screen, and how many people the instance has. */
  shown: number;
  total: number;
}

export function PeopleToolbar({ filter, onFilterChange, labels, counts, shown, total }: PeopleToolbarProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocuses(searchRef);

  const chips: FilterChip<PeopleView>[] = PEOPLE_VIEWS.map((view) => ({
    id: view,
    label: t(VIEW_LABEL_KEY[view]),
    count: counts[view],
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 basis-full space-y-1 sm:flex-1 sm:basis-48">
          <Label htmlFor="admin-people-search">{t('admin.filter.searchLabel')}</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="admin-people-search"
              ref={searchRef}
              type="search"
              autoComplete="off"
              className="h-11 pl-9 pr-9 md:h-11"
              placeholder={t('admin.filter.searchPlaceholder')}
              value={filter.query}
              onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
            />
            <kbd
              aria-hidden="true"
              className={`pointer-events-none absolute right-2 top-1/2 hidden h-5 -translate-y-1/2 items-center border px-1.5 text-[11px] text-muted-foreground sm:flex ${
                filter.query === '' ? '' : 'invisible'
              }`}
            >
              /
            </kbd>
          </div>
        </div>

        {labels.length > 0 && (
          <div className="min-w-0 flex-1 space-y-1 sm:w-44 sm:flex-none">
            <Label htmlFor="admin-people-label">{t('admin.filter.labelLabel')}</Label>
            <select
              id="admin-people-label"
              className="h-11 w-full border border-input bg-background px-3 text-sm"
              value={labelOptionValue(filter.label)}
              onChange={(event) => onFilterChange({ ...filter, label: readLabelOption(event.target.value, labels) })}
            >
              <option value={ANY_OPTION}>{t('admin.filter.labelAny')}</option>
              {labels.map((label) => (
                <option key={label} value={`${NAMED_PREFIX}${label}`}>
                  {label}
                </option>
              ))}
              <option value={NONE_OPTION}>{t('admin.filter.labelNone')}</option>
            </select>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1 sm:w-48 sm:flex-none">
          <Label htmlFor="admin-people-sort">{t('admin.filter.sortLabel')}</Label>
          <select
            id="admin-people-sort"
            className="h-11 w-full border border-input bg-background px-3 text-sm"
            value={filter.sort}
            onChange={(event) => onFilterChange({ ...filter, sort: readSort(event.target.value) })}
          >
            {PEOPLE_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(SORT_LABEL_KEY[sort])}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FilterChips
        groupLabel={t('admin.filter.viewLabel')}
        chips={chips}
        value={filter.view}
        onChange={(view) => onFilterChange({ ...filter, view: view === filter.view ? 'all' : view })}
      />

      {/* ONE LINE, ALWAYS. "Clear filters" is in the box from the first paint
          and is invisible (so also unfocusable and out of the accessibility
          tree) while nothing is filtered. Adding it when the first filter
          landed would have moved the list by a line on the first keystroke. */}
      <div className="flex min-h-9 items-center justify-between gap-2 text-xs text-muted-foreground">
        <output className="tabular-nums">{t('admin.filter.result', { shown, total })}</output>
        <button
          type="button"
          className={`py-2 text-primary underline-offset-2 hover:underline ${isPeopleFiltered(filter) ? '' : 'invisible'}`}
          onClick={() =>
            onFilterChange({
              ...filter,
              query: EMPTY_PEOPLE_FILTER.query,
              view: EMPTY_PEOPLE_FILTER.view,
              label: EMPTY_PEOPLE_FILTER.label,
            })
          }
        >
          {t('admin.filter.clear')}
        </button>
      </div>
    </div>
  );
}

/**
 * Focuses the search on "/" when the key was not meant for a field.
 *
 * The document listener is the whole mechanism; the ref is the field's. A
 * modified slash (ctrl, meta, alt) belongs to the browser or the system, and a
 * key typed into an input, a select, a text area or an editable element is a
 * character, not a shortcut.
 */
function useSlashFocuses(ref: { current: HTMLInputElement | null }): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null) return;
      const field = ref.current;
      if (field === null) return;
      event.preventDefault();
      field.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}

/** Where a slash is a character the person is typing. */
const EDITABLE_SELECTOR = 'input, select, textarea, [contenteditable=""], [contenteditable="true"]';

// ─── The select values ─────────────────────────────────────────────────────

const ANY_OPTION = 'any';
const NONE_OPTION = 'none';
/** A named label's option value is this prefix and the label, so a label called "any" cannot be taken for the default. */
const NAMED_PREFIX = 'label:';

function labelOptionValue(label: PeopleLabelFilter): string {
  if (label.kind === 'any') return ANY_OPTION;
  if (label.kind === 'none') return NONE_OPTION;
  return `${NAMED_PREFIX}${label.label}`;
}

/** A `<select>` value read back as a label filter. Anything unrecognised is "any", which hides nobody. */
function readLabelOption(raw: string, labels: readonly string[]): PeopleLabelFilter {
  if (raw === NONE_OPTION) return { kind: 'none' };
  const found = labels.find((label) => `${NAMED_PREFIX}${label}` === raw);
  return found === undefined ? { kind: 'any' } : { kind: 'named', label: found };
}

/** A `<select>` value read back as a sort. Anything unrecognised is the default. */
function readSort(raw: string): PeopleSort {
  return PEOPLE_SORTS.find((sort) => sort === raw) ?? EMPTY_PEOPLE_FILTER.sort;
}
