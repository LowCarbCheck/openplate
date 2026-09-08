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
 * name, address, standing, today's usage against the allowance, last sign in,
 * and a seven day strip.
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
 * where a test can reach it without a render.
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
 * A row ends in two figures and a date, and "5 of 200" beside "9/6/2026" says
 * nothing about which is the allowance and which is the last sign in. Wide
 * enough, a header row names the four columns. Below that breakpoint the row
 * reflows onto several lines, where a header would sit over nothing, so each
 * value carries its own short label beside itself instead. Both are always in
 * the markup; which one is readable is the breakpoint's business.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Search } from 'lucide-react';

import { ActivityStrip } from '#app/components/admin/activity-strip';
import { LastSeenValue } from '#app/components/admin/last-seen';
import { Link } from '#app/components/link';
import { Badge } from '#app/components/ui/badge';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import type { ActivityByAccount } from '#app/lib/admin/activity-strip';
import type { AdminAccountView, AdminActivityDay } from '#app/lib/admin/admin-wire';
import {
  emptyReasonFor,
  filterPeople,
  PEOPLE_GROUPS,
  type PeopleFilter,
  type PeopleGroup,
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

/**
 * The widths the header and the rows share.
 *
 * ONE MAP, because a header is a promise that the value under it is the one it
 * names. Two independent width lists drift, and the first thing that goes
 * wrong is a column sitting over the wrong number.
 *
 * Below `sm` every cell is a flex line carrying its own label; at `sm` and up
 * the labels are hidden and the cells become the columns the header names.
 */
const COLUMN_CLASS = {
  person: 'min-w-0 flex-1 basis-56',
  strip: 'flex shrink-0 items-center gap-2 sm:w-24',
  usedToday: 'flex shrink-0 items-center gap-2 sm:block sm:w-24 sm:text-right',
  lastSeen: 'flex shrink-0 items-center gap-2 sm:block sm:w-28 sm:text-right',
};

export interface PeopleTableProps {
  people: AdminAccountView[];
  /** The signed-in administrator. Their own row is marked, and it links to the same detail page as any other. */
  currentAccountId: number;
  /** Everybody's seven day strip, or `null` when this client could not read them. */
  activity: ActivityByAccount | null;
  filter: PeopleFilter;
  onFilterChange: (next: PeopleFilter) => void;
}

export function PeopleTable({ people, currentAccountId, activity, filter, onFilterChange }: PeopleTableProps) {
  const visible = filterPeople({ people, filter });
  const reason = emptyReasonFor({ people, filter, visible });

  return (
    <div className="space-y-3">
      <PeopleFilterBar filter={filter} onFilterChange={onFilterChange} />
      {reason === 'not-empty' ?
        <div className="rounded-lg border">
          <PeopleHeader hasStrips={activity !== null} />
          <ul className="divide-y">
            {visible.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                isSelf={person.id === currentAccountId}
                days={activity?.get(person.id) ?? null}
              />
            ))}
          </ul>
        </div>
      : <EmptyList filter={filter} reason={reason} />}
    </div>
  );
}

/** The search box and the group control, above the rows. Both are controlled; the route owns the values. */
function PeopleFilterBar({
  filter,
  onFilterChange,
}: {
  filter: PeopleFilter;
  onFilterChange: (next: PeopleFilter) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1">
        <Label htmlFor="admin-people-search">{t('admin.filter.searchLabel')}</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="admin-people-search"
            type="search"
            autoComplete="off"
            className="h-11 pl-9"
            placeholder={t('admin.filter.searchPlaceholder')}
            value={filter.query}
            onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1 sm:w-52">
        <Label htmlFor="admin-people-group">{t('admin.filter.groupLabel')}</Label>
        <select
          id="admin-people-group"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={filter.group}
          onChange={(event) => onFilterChange({ ...filter, group: readGroup(event.target.value) })}
        >
          {PEOPLE_GROUPS.map((group) => (
            <option key={group} value={group}>
              {t(GROUP_LABEL_KEY[group])}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * What an empty list says.
 *
 * NEVER A BARE "NO RESULTS". Four different facts end here, and the sentence
 * names which one: an instance with nobody on it, a search that matched
 * nobody, a group nobody is in, or both together. An operator who has
 * forgotten that a group is still selected is exactly the person this sentence
 * is for.
 */
function EmptyList({ filter, reason }: { filter: PeopleFilter; reason: 'nobody-here' | 'query' | 'group' | 'both' }) {
  const { t } = useTranslation();
  const group = t(GROUP_LABEL_KEY[filter.group]);
  const query = filter.query.trim();

  if (reason === 'nobody-here') return <p className="text-sm text-muted-foreground">{t('admin.people.empty')}</p>;

  return (
    <p className="text-sm text-muted-foreground">
      {reason === 'query' && t('admin.filter.noneQuery', { query })}
      {reason === 'group' && t('admin.filter.noneGroup', { group })}
      {reason === 'both' && t('admin.filter.noneBoth', { query, group })}
    </p>
  );
}

/**
 * The names of the columns, for the widths that can carry them.
 *
 * Hidden below `sm`, where the row is no longer a row: the labels inside each
 * cell take over there. The strip column is named only when there are strips,
 * so a service that answered nothing gets no heading over an absence.
 */
function PeopleHeader({ hasStrips }: { hasStrips: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="hidden items-center gap-x-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
      <span className={COLUMN_CLASS.person}>{t('admin.columns.person')}</span>
      {hasStrips && (
        <span className={COLUMN_CLASS.strip}>{t('admin.columns.recentDays', { days: ROW_STRIP_DAYS })}</span>
      )}
      <span className={COLUMN_CLASS.usedToday}>{t('admin.columns.usedToday')}</span>
      <span className={COLUMN_CLASS.lastSeen}>{t('admin.columns.lastSeen')}</span>
      {/* The chevron's own width, so the columns above the rows line up with them. */}
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
    </div>
  );
}

/**
 * The name a value carries when the header cannot be drawn over it.
 *
 * `sm:hidden` rather than a second render path: the label is in the markup at
 * every width, so a reader on a narrow screen and a search of the page both
 * find it, and there is no width at which the number is alone.
 */
function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground sm:hidden">{children}</span>;
}

/** One person, compact, and the whole thing is the link to their page. */
function PersonRow({
  person,
  isSelf,
  days,
}: {
  person: AdminAccountView;
  isSelf: boolean;
  days: readonly AdminActivityDay[] | null;
}) {
  const { t } = useTranslation();
  const isSuspended = person.suspendedAt !== null;

  return (
    <li>
      <Link
        to={`/admin/people/${person.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <div className={COLUMN_CLASS.person}>
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
          </p>
          <p className="truncate text-sm text-muted-foreground">{person.email}</p>
        </div>

        {days !== null && (
          <div className={COLUMN_CLASS.strip}>
            <InlineLabel>{t('admin.columns.recentDays', { days: ROW_STRIP_DAYS })}</InlineLabel>
            <ActivityStrip days={days} size="row" />
          </div>
        )}

        <div className={`${COLUMN_CLASS.usedToday} text-sm tabular-nums`}>
          <InlineLabel>{t('admin.columns.usedToday')}</InlineLabel>
          <span>
            {person.dailyAiLimit === 0 ?
              t('admin.usageNone')
            : t('admin.usage', { used: person.aiUsedToday, limit: person.dailyAiLimit })}
          </span>
        </div>

        <div className={`${COLUMN_CLASS.lastSeen} text-sm tabular-nums`}>
          <InlineLabel>{t('admin.columns.lastSeen')}</InlineLabel>
          <span className="text-muted-foreground">
            <LastSeenValue lastSeenAt={person.lastSeenAt} />
          </span>
        </div>

        {/* A row that goes somewhere has to look like it does. The hover
            background is the one the app's own list rows use; this is the part
            of it a pointerless screen can also see. */}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** The copy key for each group, used both by the control and by the sentence an empty list shows. */
const GROUP_LABEL_KEY = {
  everybody: 'admin.filter.everybody',
  active: 'admin.filter.active',
  suspended: 'admin.filter.suspended',
  administrators: 'admin.filter.administrators',
} satisfies Record<PeopleGroup, string>;

/** A `<select>` value read back as a group. Anything unrecognised is "everybody", which hides nobody. */
function readGroup(raw: string): PeopleGroup {
  const found = PEOPLE_GROUPS.find((group) => group === raw);
  return found ?? 'everybody';
}
