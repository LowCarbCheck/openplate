/**
 * Everybody on this instance: a filter, and one compact row each.
 *
 * ── A list is for finding somebody ───────────────────────────────────────
 *
 * It used to be a stack of fat cards carrying five buttons apiece, so an
 * operator with twenty people could not see them at once and every dangerous
 * action was one click away from a scroll. Every action moved to
 * `/admin/people/:id`. What is left is the smallest set of facts that answers
 * "which of these is the person I am looking for, and are they all right":
 * name, address, when they joined, today's usage against the allowance, last
 * sign in, and a seven day strip.
 *
 * ── Newest first, and the question it answers ────────────────────────────
 *
 * The list opens with the newest sign-ups at the top (operator decision,
 * 2026-10-11), because the question an operator comes with most is "who is new
 * and are they all right". Somebody who joined in the last week carries a "New"
 * badge, and while the order is by sign-up date the rows sit under "This
 * week", "This month" and "Earlier" headings. The columns Person, Joined, Used
 * today and Last seen sort the list when their heading is pressed.
 *
 * ── The whole row is a real link ─────────────────────────────────────────
 *
 * An `<a>`, not a div with an `onClick`, so middle click opens a second tab,
 * the back button returns to the list, and the address is one an operator can
 * send to a colleague. That is also why the row carries no button any more:
 * a button inside a link is a target that swallows the click it is nested in.
 *
 * ── The filter runs here, on the list already in hand ────────────────────
 *
 * `AdminClient.listAccounts` pages internally and resolves with everybody, so
 * there is nothing to fetch per keystroke. The decision worth being careful
 * about is what an empty result says, and that lives in `people-filter.ts`
 * where a test can reach it without a render. The filter itself is the route's:
 * it lives in the address, and this component takes it and reports changes.
 *
 * ── A missing strip is not a quiet one ───────────────────────────────────
 *
 * `activity` is `null` when the batch request failed, which is what an
 * instance whose service predates the endpoint looks like. The rows are drawn
 * without strips. Drawing empty strips instead would tell an operator that
 * everybody had stopped.
 *
 * ── NO WIDTH LEAVES A NUMBER UNNAMED ─────────────────────────────────────
 *
 * A row ends in figures and dates, and "5 of 200" beside "9/6/2026" says
 * nothing about which is the allowance and which is the last sign in. Wide
 * enough, a header row names the columns. Below that the row reflows into two
 * columns of cells, where a header would sit over nothing, so each value
 * carries its own short label above itself instead. Both are always in the
 * markup; which one is readable is the container's business.
 *
 * The switch is a CONTAINER query, not a viewport one: what decides whether the
 * columns fit is the width the list is given, and the sidebar takes 256 px of
 * the viewport from `md` up. A viewport breakpoint drew the header over rows
 * that had already wrapped, between 640 and about 1000 px.
 *
 * ── Two figures ride under their text ────────────────────────────────────
 *
 * Used today carries a thin bar under its sentence: the share of the allowance
 * spent, in the primary colour and in the amber token from 80 percent. Somebody
 * who never signed in is told so in amber in the Last seen column: it is the
 * one state in that column that asks the operator to do something.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';

import { AccountLabelChip } from '#app/components/admin/account-label-chip';
import { ActivityStrip } from '#app/components/admin/activity-strip';
import { DayAge } from '#app/components/admin/day-age';
import { Link } from '#app/components/link';
import { PeopleToolbar, VIEW_LABEL_KEY } from '#app/components/admin/people-toolbar';
import { Badge } from '#app/components/ui/badge';
import type { ActivityByAccount } from '#app/lib/admin/activity-strip';
import type { AdminAccountView, AdminActivityDay } from '#app/lib/admin/admin-wire';
import { adminUsage, adminUsageFigures } from '#app/lib/admin/admin-usage';
import { formatNumericDate } from '#app/i18n/date-locale';
import { NEW_WITHIN_DAYS, ageInDays, type PeopleBand } from '#app/lib/admin/people-age';
import {
  bandPeople,
  countByView,
  emptyReasonFor,
  isActiveColumn,
  labelsOf,
  QUIET_AFTER_DAYS,
  selectPeople,
  sortArrow,
  sortForColumn,
  type PeopleFilter,
  type SortableColumn,
} from '#app/lib/admin/people-filter';

/**
 * How many days the strip beside a row covers. A week is what "are they still
 * here" looks like at a glance.
 *
 * It lives HERE, and the route imports it, because the column header states
 * the number. A second copy on the route would let the header say seven over a
 * strip of thirty.
 */
export const ROW_STRIP_DAYS = 7;

/** A used-up share from here on is drawn in amber: the allowance is nearly gone. */
const NEARLY_USED_UP_FROM = 0.8;

/**
 * The column template the header and the rows share, from the container's
 * `@2xl` (672 px) up.
 *
 * ONE MAP, because a header is a promise that the value under it is the one it
 * names. Two independent width lists drift, and the first thing that goes
 * wrong is a column sitting over the wrong number. Person takes what is left;
 * the others are fixed, so the strip's seven squares (96 px) never wrap.
 *
 * Two templates, because the strip column is named and drawn only when there
 * are strips.
 */
const WIDE_GRID = {
  withStrips: '@2xl:grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_7rem_1rem]',
  withoutStrips: '@2xl:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem_1rem]',
};

/** The copy key for each band heading. */
const BAND_LABEL_KEY = {
  week: 'admin.bands.week',
  month: 'admin.bands.month',
  earlier: 'admin.bands.earlier',
} satisfies Record<PeopleBand, string>;

export interface PeopleTableProps {
  people: AdminAccountView[];
  /** The signed-in administrator. Their own row is marked, and it links to the same detail page as any other. */
  currentAccountId: number;
  /** Everybody's seven day strip, or `null` when this client could not read them. */
  activity: ActivityByAccount | null;
  filter: PeopleFilter;
  onFilterChange: (next: PeopleFilter) => void;
  /** The clock every age on this list is measured against. A parameter, so a render is reproducible. */
  now: Date;
}

export function PeopleTable({ people, currentAccountId, activity, filter, onFilterChange, now }: PeopleTableProps) {
  const visible = selectPeople({ people, filter, now });
  const reason = emptyReasonFor({ people, filter, visible });
  const groups = bandPeople({ people: visible, sort: filter.sort, now });

  return (
    <div className="space-y-3 @container">
      <PeopleToolbar
        filter={filter}
        onFilterChange={onFilterChange}
        labels={labelsOf(people)}
        counts={countByView({ people, filter, now })}
        shown={visible.length}
        total={people.length}
      />
      {reason === 'not-empty' ?
        <div className="divide-y border" data-people-list="">
          <PeopleHeader hasStrips={activity !== null} filter={filter} onFilterChange={onFilterChange} />
          {groups.map((group) => (
            <div key={group.band ?? 'all'}>
              {group.band !== null && <BandHeading band={group.band} />}
              <ul className="divide-y">
                {group.people.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    isSelf={person.id === currentAccountId}
                    days={activity?.get(person.id) ?? null}
                    hasStrips={activity !== null}
                    now={now}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      : <EmptyList filter={filter} reason={reason} />}
    </div>
  );
}

/** "This week", "This month", "Earlier": the heading over a run of rows. */
function BandHeading({ band }: { band: PeopleBand }) {
  const { t } = useTranslation();
  return (
    <h3 className="border-b bg-muted/45 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {t(BAND_LABEL_KEY[band])}
    </h3>
  );
}

/**
 * What an empty list says.
 *
 * NEVER A BARE "NO RESULTS". Several different facts end here, and the sentence
 * names which one: an instance with nobody on it, a search that matched
 * nobody, a view nobody is in, a label nobody carries, or a mix. An operator
 * who has forgotten that a chip is still pressed is exactly the person this
 * sentence is for.
 */
function EmptyList({
  filter,
  reason,
}: {
  filter: PeopleFilter;
  reason: 'nobody-here' | 'query' | 'view' | 'label' | 'query-and-view' | 'several';
}) {
  const { t } = useTranslation();
  const view = t(VIEW_LABEL_KEY[filter.view]);
  const query = filter.query.trim();

  if (reason === 'nobody-here') return <p className="text-sm text-muted-foreground">{t('admin.people.empty')}</p>;

  return (
    <p className="text-sm text-muted-foreground">
      {reason === 'query' && t('admin.filter.noneQuery', { query })}
      {reason === 'view' && t('admin.filter.noneGroup', { group: view })}
      {reason === 'query-and-view' && t('admin.filter.noneBoth', { query, group: view })}
      {reason === 'label' && <NoneLabel filter={filter} />}
      {reason === 'several' && <NoneSeveral filter={filter} />}
    </p>
  );
}

/** The sentence for a label nobody carries. "No label" being empty means everybody has one. */
function NoneLabel({ filter }: { filter: PeopleFilter }) {
  const { t } = useTranslation();
  if (filter.label.kind === 'named') return <>{t('admin.filter.noneLabel', { label: filter.label.label })}</>;
  return <>{t('admin.filter.noneNoLabel')}</>;
}

/** The sentence for any mix that has no sentence of its own: it lists what is set. */
function NoneSeveral({ filter }: { filter: PeopleFilter }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (filter.query.trim() !== '') parts.push(`"${filter.query.trim()}"`);
  if (filter.view !== 'all') parts.push(`"${t(VIEW_LABEL_KEY[filter.view])}"`);
  if (filter.label.kind === 'named') parts.push(t('admin.filter.labelPart', { label: filter.label.label }));
  if (filter.label.kind === 'none') parts.push(t('admin.filter.labelPartNone'));
  return <>{t('admin.filter.noneSeveral', { filters: parts.join(', ') })}</>;
}

/**
 * The names of the columns, for the widths that can carry them.
 *
 * Hidden below the container's `@2xl`, where the row is no longer a row: the
 * labels inside each cell take over there. The strip column is named only when
 * there are strips, so a service that answered nothing gets no heading over an
 * absence.
 *
 * FOUR OF THE HEADINGS ARE BUTTONS that sort the list. The arrow is always in
 * the box and `invisible` while its column is not the active one, so pressing
 * a heading never changes its width or its neighbours'.
 */
function PeopleHeader({
  hasStrips,
  filter,
  onFilterChange,
}: {
  hasStrips: boolean;
  filter: PeopleFilter;
  onFilterChange: (next: PeopleFilter) => void;
}) {
  const { t } = useTranslation();
  const sortHeading = (column: SortableColumn, text: string, align: 'left' | 'right'): ReactNode => (
    <SortHeading column={column} align={align} filter={filter} onFilterChange={onFilterChange}>
      {text}
    </SortHeading>
  );

  return (
    <div
      className={`hidden items-center gap-x-3 px-4 py-2 text-xs font-medium text-muted-foreground @2xl:grid ${
        hasStrips ? WIDE_GRID.withStrips : WIDE_GRID.withoutStrips
      }`}
    >
      {sortHeading('person', t('admin.columns.person'), 'left')}
      {sortHeading('joined', t('admin.columns.joined'), 'left')}
      {hasStrips && <span>{t('admin.columns.recentDays', { days: ROW_STRIP_DAYS })}</span>}
      {sortHeading('usedToday', t('admin.columns.usedToday'), 'right')}
      {sortHeading('lastSeen', t('admin.columns.lastSeen'), 'right')}
      {/* The chevron's own width, so the columns above the rows line up with them. */}
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
    </div>
  );
}

function SortHeading({
  column,
  align,
  filter,
  onFilterChange,
  children,
}: {
  column: SortableColumn;
  align: 'left' | 'right';
  filter: PeopleFilter;
  onFilterChange: (next: PeopleFilter) => void;
  children: ReactNode;
}) {
  const isActive = isActiveColumn({ column, sort: filter.sort });
  const Arrow = sortArrow(filter.sort) === 'up' ? ArrowUp : ArrowDown;
  const arrow = <Arrow className={`h-3 w-3 shrink-0 ${isActive ? '' : 'invisible'}`} aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      data-sort-column={column}
      onClick={() => onFilterChange({ ...filter, sort: sortForColumn({ column, current: filter.sort }) })}
      className={`inline-flex min-w-0 items-center gap-1 hover:text-foreground ${
        align === 'right' ? 'justify-end text-right' : 'text-left'
      } ${isActive ? 'text-foreground' : ''}`}
    >
      {align === 'right' && arrow}
      <span className="truncate">{children}</span>
      {align === 'left' && arrow}
    </button>
  );
}

/**
 * The name a value carries when the header cannot be drawn over it.
 *
 * `@2xl:hidden` rather than a second render path: the label is in the markup at
 * every width, so a reader on a narrow screen and a search of the page both
 * find it, and there is no width at which the number is alone.
 */
function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="block text-xs text-muted-foreground @2xl:hidden">{children}</span>;
}

/** One person, compact, and the whole thing is the link to their page. */
function PersonRow({
  person,
  isSelf,
  days,
  hasStrips,
  now,
}: {
  person: AdminAccountView;
  isSelf: boolean;
  days: readonly AdminActivityDay[] | null;
  hasStrips: boolean;
  now: Date;
}) {
  const { t, i18n } = useTranslation();
  const isSuspended = person.suspendedAt !== null;
  const isNew = ageInDays({ iso: person.createdAt, now }) < NEW_WITHIN_DAYS;

  return (
    <li>
      <Link
        to={`/admin/people/${person.id}`}
        className={`grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 @2xl:items-center ${
          hasStrips ? WIDE_GRID.withStrips : WIDE_GRID.withoutStrips
        }`}
      >
        <div className="col-span-2 min-w-0 @2xl:col-span-1">
          <p className="flex items-center gap-2 truncate font-medium">
            <span className="truncate">{person.displayName ?? t('admin.noName')}</span>
            {isSelf && (
              <Badge variant="outline" className="shrink-0">
                {t('admin.you')}
              </Badge>
            )}
            {person.role === 'admin' && <Badge className="shrink-0">{t('admin.role.admin')}</Badge>}
            {isSuspended && (
              <Badge variant="destructive" className="shrink-0">
                {t('admin.standing.suspended')}
              </Badge>
            )}
            {isNew && (
              <Badge variant="outline" className="shrink-0 border-primary/60 text-primary" data-new-badge="">
                {t('admin.badge.new')}
              </Badge>
            )}
          </p>
          {/* THE LABEL RIDES ON THE ADDRESS LINE, LAST, and that placement is
              the no-layout-shift argument. On the name line it took width
              from the name, so "Administrator" beside a long name sat at a
              different place with a label than without. Here nothing follows
              it: a label only moves where the address is cut, and the chip is
              kept under the line's own height (`py-0`, 18 px against 20), so
              the row is exactly as tall and every badge is exactly where it
              was (`tests/e2e/admin-account-label.spec.ts`). It keeps its width
              up to `max-w-40` and the address yields, because the address is
              on the person's page too and the label is what the operator came
              to read. */}
          <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="truncate">{person.email}</span>
            {person.label !== null && <AccountLabelChip label={person.label} className="max-w-40 py-0" />}
          </p>
        </div>

        <div className="min-w-0 text-sm tabular-nums" title={formatNumericDate(person.createdAt, i18n.language)}>
          <InlineLabel>{t('admin.columns.joined')}</InlineLabel>
          <DayAge iso={person.createdAt} now={now} relativeUntilDays={NEW_WITHIN_DAYS} />
        </div>

        {hasStrips && (
          <div className="min-w-0">
            <InlineLabel>{t('admin.columns.recentDays', { days: ROW_STRIP_DAYS })}</InlineLabel>
            {days !== null && <ActivityStrip days={days} size="row" />}
          </div>
        )}

        <div className="min-w-0 text-sm tabular-nums @2xl:text-right">
          <InlineLabel>{t('admin.columns.usedToday')}</InlineLabel>
          <span className="block">{adminUsage({ person, t, now })}</span>
          <UsageBar person={person} now={now} />
        </div>

        <div className="min-w-0 text-sm tabular-nums @2xl:text-right">
          <InlineLabel>{t('admin.columns.lastSeen')}</InlineLabel>
          <LastSeen person={person} now={now} />
        </div>

        {/* A row that goes somewhere has to look like it does. The hover
            background is the one the app's own list rows use; this is the part
            of it a pointerless screen can also see.

            Hidden below the wide form: the row is two columns of cells there,
            and a fixed-width chevron would land alone in a cell, pointing at
            nothing. The row is already the whole link at every width, so the
            chevron is a hint, never the only affordance. */}
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground @2xl:block" aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * Last sign in: a relative phrase while it is recent, a date once it is not,
 * and for somebody who never signed in the existing sentence in amber.
 *
 * `null` is not a quiet account but an account that has never arrived (see
 * `last-seen.tsx`), so it gets words, not a dash and not an epoch.
 */
function LastSeen({ person, now }: { person: AdminAccountView; now: Date }) {
  const { t, i18n } = useTranslation();
  if (person.lastSeenAt === null) {
    return (
      <span className="block text-accent-amber" data-last-seen="never">
        {/* ONE LINE IN THE WIDE COLUMN. The column is 7rem and the full
            sentence wrapped to two lines there, so the row grew. From the
            wide form on, the short word is drawn and the sentence stays in
            the accessibility tree as screen-reader-only text. In the narrow
            form the labelled cell has room and shows the sentence. */}
        <span className="@2xl:sr-only">{t('admin.lastSeen.never')}</span>
        <span className="hidden @2xl:inline" aria-hidden="true" data-last-seen-short="">
          {t('admin.lastSeen.neverShort')}
        </span>
      </span>
    );
  }
  return (
    <span className="block text-muted-foreground" title={formatNumericDate(person.lastSeenAt, i18n.language)}>
      <DayAge iso={person.lastSeenAt} now={now} relativeUntilDays={QUIET_AFTER_DAYS} />
    </span>
  );
}

/**
 * The thin bar under "5 of 200".
 *
 * ALWAYS DRAWN, EMPTY WHEN THERE IS NOTHING TO MEASURE. A person with no
 * allowance has the track and no fill: a row with a bar and a row without
 * would be two different heights in the narrow form, and the list would
 * stagger.
 */
function UsageBar({ person, now }: { person: AdminAccountView; now: Date }) {
  const figures = adminUsageFigures({ person, now });
  const share = figures === null ? 0 : Math.min(1, figures.used / figures.limit);
  const isNearlyUsedUp = share >= NEARLY_USED_UP_FROM;
  return (
    <span aria-hidden="true" className="mt-1 block h-[3px] w-full max-w-[4.5rem] bg-muted @2xl:ml-auto">
      <span
        data-usage-bar={isNearlyUsedUp ? 'hot' : 'ok'}
        className={`block h-full ${isNearlyUsedUp ? 'bg-accent-amber' : 'bg-primary'}`}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </span>
  );
}
