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
 */
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

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
        <ul className="divide-y rounded-lg border">
          {visible.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              isSelf={person.id === currentAccountId}
              days={activity?.get(person.id) ?? null}
            />
          ))}
        </ul>
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
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <div className="min-w-0 flex-1 basis-56">
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

        {days !== null && <ActivityStrip days={days} size="row" />}

        <div className="text-right text-sm tabular-nums">
          <p>
            {person.dailyAiLimit === 0 ?
              t('admin.usageNone')
            : t('admin.usage', { used: person.aiUsedToday, limit: person.dailyAiLimit })}
          </p>
          <p className="text-xs text-muted-foreground">
            <LastSeenValue lastSeenAt={person.lastSeenAt} />
          </p>
        </div>
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
