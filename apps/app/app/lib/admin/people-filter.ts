/**
 * Narrowing, ordering and banding the list of people, and nothing else.
 *
 * ── The filtering happens in the browser, on purpose ─────────────────────
 *
 * The whole list is already in hand: `AdminClient.listAccounts` follows the
 * service's paging itself and resolves with everybody. An instance here has a
 * handful of people to a few hundred, so a request per keystroke would buy
 * nothing and would make a search box that works offline into one that does
 * not work at all when the connection is poor.
 *
 * ── Pure, so every decision here is a test and not a render ──────────────
 *
 * Time is a parameter (`now`) and so is every list. Besides narrowing and
 * ordering, this module decides what an empty result says, how many people
 * each quick view would leave, and where the band headers go. Those are the
 * decisions worth getting wrong, and a component would only reach them through
 * a render.
 *
 * ── Four settings, and the URL is where they live ────────────────────────
 *
 * A view (a quick filter with a count), a sort, a label and a search. The
 * route keeps them in the address (`?view=new&sort=oldest&label=Family&q=anna`)
 * so a reload and a shared link land on the same list. {@link readPeopleFilter}
 * and {@link writePeopleFilter} are the two halves of that: a default is never
 * written, and a value this build does not know reads as the default, because
 * a link from a newer build must open a list and not a blank page.
 *
 * ── A view and a group are not the same thing ────────────────────────────
 *
 * The old "active" group meant "not suspended". It is gone: nobody asked
 * "show me everyone who is not suspended", and the new views answer the
 * questions operators do ask (who is new, who stopped coming, who never
 * arrived).
 */
import { ageInDays, bandOf, NEW_WITHIN_DAYS, type PeopleBand } from './people-age';
import { adminUsageFigures } from './admin-usage';
import type { AdminAccountView } from './admin-wire';

/** The quick views. `all` is the default and filters nothing. */
export type PeopleView = 'all' | 'new' | 'seen' | 'quiet' | 'never' | 'suspended' | 'administrators';

/** Every view, in the order the chips are drawn. */
export const PEOPLE_VIEWS: readonly PeopleView[] = [
  'all',
  'new',
  'seen',
  'quiet',
  'never',
  'suspended',
  'administrators',
];

/** How many people each view would leave. */
export interface PeopleViewCounts {
  all: number;
  new: number;
  seen: number;
  quiet: number;
  never: number;
  suspended: number;
  administrators: number;
}

/** The orders the list can be in. `newest` is the default. */
export type PeopleSort = 'newest' | 'oldest' | 'seen' | 'usage' | 'name';

/** Every sort, in the order the select offers them. */
export const PEOPLE_SORTS: readonly PeopleSort[] = ['newest', 'oldest', 'seen', 'usage', 'name'];

/** "Seen this week": the last sign-in is more recent than this many days. */
export const SEEN_WITHIN_DAYS = 7;

/** "Gone quiet": signed in once, and not for this many days or more. */
export const QUIET_AFTER_DAYS = 14;

/**
 * Which label the list is narrowed to. A discriminated union rather than a
 * string, because "no label" and "a label that happens to be called none" are
 * different questions and a sentinel string would conflate them.
 */
export type PeopleLabelFilter = { kind: 'any' } | { kind: 'none' } | { kind: 'named'; label: string };

/** What the filter bar is currently set to. Every part is always present; `query` is empty when nothing was typed. */
export interface PeopleFilter {
  query: string;
  view: PeopleView;
  label: PeopleLabelFilter;
  sort: PeopleSort;
}

/** The filter a freshly opened list starts with: everybody, newest first, nothing typed. */
export const EMPTY_PEOPLE_FILTER: PeopleFilter = {
  query: '',
  view: 'all',
  label: { kind: 'any' },
  sort: 'newest',
};

/** Whether anything narrows the list. The sort does not: it reorders and hides nobody. */
export function isPeopleFiltered(filter: PeopleFilter): boolean {
  return filter.view !== 'all' || filter.query.trim() !== '' || filter.label.kind !== 'any';
}

/** Whether two label filters mean the same thing. */
export function isSameLabelFilter(a: PeopleLabelFilter, b: PeopleLabelFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'named' || b.kind !== 'named') return true;
  return a.label === b.label;
}

// ─── Narrowing ─────────────────────────────────────────────────────────────

/**
 * The people a filter leaves on screen, in the order they arrived.
 *
 * The search is trimmed and case insensitive and reads the display name, the
 * address AND the label, because an operator looking for somebody knows one of
 * them and rarely knows which one this instance stored.
 */
export function filterPeople({
  people,
  filter,
  now,
}: {
  people: readonly AdminAccountView[];
  filter: PeopleFilter;
  now: Date;
}): AdminAccountView[] {
  return narrow({ people, filter, now, includeView: true });
}

/**
 * How many people each view would leave, given the search and the label as they
 * are NOW and ignoring which view is selected.
 *
 * That is what a chip's number promises: the answer to "if I click this".
 * Counting the selected view's own result for every chip would show zero on
 * every other chip the moment one was pressed.
 */
export function countByView({
  people,
  filter,
  now,
}: {
  people: readonly AdminAccountView[];
  filter: PeopleFilter;
  now: Date;
}): PeopleViewCounts {
  const base = narrow({ people, filter, now, includeView: false });
  const count = (view: PeopleView): number => base.filter((person) => isInView({ person, view, now })).length;
  return {
    all: count('all'),
    new: count('new'),
    seen: count('seen'),
    quiet: count('quiet'),
    never: count('never'),
    suspended: count('suspended'),
    administrators: count('administrators'),
  };
}

/** The distinct labels present, sorted, without the empty ones. */
export function labelsOf(people: readonly AdminAccountView[]): string[] {
  const labels = new Set<string>();
  for (const person of people) {
    if (person.label !== null && person.label !== '') labels.add(person.label);
  }
  return [...labels].toSorted(COLLATOR.compare);
}

function narrow({
  people,
  filter,
  now,
  includeView,
}: {
  people: readonly AdminAccountView[];
  filter: PeopleFilter;
  now: Date;
  includeView: boolean;
}): AdminAccountView[] {
  const needle = filter.query.trim().toLowerCase();
  return people.filter(
    (person) =>
      matchesQuery(person, needle) &&
      matchesLabel(person, filter.label) &&
      (!includeView || isInView({ person, view: filter.view, now })),
  );
}

/** Whether one person is in a view. */
function isInView({ person, view, now }: { person: AdminAccountView; view: PeopleView; now: Date }): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'new':
      return ageInDays({ iso: person.createdAt, now }) < NEW_WITHIN_DAYS;
    case 'seen':
      return person.lastSeenAt !== null && ageInDays({ iso: person.lastSeenAt, now }) < SEEN_WITHIN_DAYS;
    case 'quiet':
      // Signed in at least once. Somebody who never did is "never signed in",
      // not "gone quiet": they have not gone anywhere.
      return person.lastSeenAt !== null && ageInDays({ iso: person.lastSeenAt, now }) >= QUIET_AFTER_DAYS;
    case 'never':
      return person.lastSeenAt === null;
    case 'suspended':
      return person.suspendedAt !== null;
    case 'administrators':
      // A role, not a standing: a suspended administrator is still one.
      return person.role === 'admin';
  }
}

/** Whether a name, an address or a label contains what was typed. An empty needle matches everybody. */
function matchesQuery(person: AdminAccountView, needle: string): boolean {
  if (needle === '') return true;
  if (person.email.toLowerCase().includes(needle)) return true;
  if (person.displayName?.toLowerCase().includes(needle) === true) return true;
  return person.label?.toLowerCase().includes(needle) === true;
}

function matchesLabel(person: AdminAccountView, label: PeopleLabelFilter): boolean {
  if (label.kind === 'any') return true;
  const own = person.label === '' ? null : person.label;
  if (label.kind === 'none') return own === null;
  return own === label.label;
}

// ─── Ordering ──────────────────────────────────────────────────────────────

/**
 * An `Intl.Collator` with a fixed locale, so the order of names does not
 * depend on the machine that sorted them. `base` sensitivity puts "anna" next
 * to "Anna", and `numeric` puts "user2" before "user10".
 */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** An instant as milliseconds, with an unreadable one the oldest possible. */
function timeOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/**
 * Newest sign-up first. Ties go to the later account number, which is the later
 * sign-up in every real database, so the order is the same on every load and
 * never the order the service happened to send.
 */
function byNewest(a: AdminAccountView, b: AdminAccountView): number {
  return timeOf(b.createdAt) - timeOf(a.createdAt) || b.id - a.id;
}

/** Oldest sign-up first. The exact reverse of {@link byNewest}, ties included. */
function byOldest(a: AdminAccountView, b: AdminAccountView): number {
  return byNewest(b, a);
}

/** Most recent sign-in first, and somebody who never signed in after everybody who did. Ties fall back to newest. */
function bySeen(a: AdminAccountView, b: AdminAccountView): number {
  if (a.lastSeenAt === null && b.lastSeenAt === null) return byNewest(a, b);
  if (a.lastSeenAt === null) return 1;
  if (b.lastSeenAt === null) return -1;
  return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt) || byNewest(a, b);
}

/** A name, or the address when there is none, so a person without a name still has a place in the alphabet. */
function nameOf(person: AdminAccountView): string {
  return person.displayName ?? person.email;
}

function byName(a: AdminAccountView, b: AdminAccountView): number {
  return COLLATOR.compare(nameOf(a), nameOf(b)) || COLLATOR.compare(a.email, b.email) || a.id - b.id;
}

/** How much of an allowance somebody has spent: the share, then the count that breaks a tie. */
interface UsageShare {
  ratio: number;
  used: number;
}

/**
 * Most of their allowance used first: the share first, then the count.
 *
 * Somebody with no pair to compare (no allowance, or a weekly limit with no
 * week count) has a share of zero. The count breaks ties, so 9 of 10 sits above
 * 90 of 100 only when the share is equal, and then 90 sits above 9.
 */
function byUsage({ now }: { now: Date }): (a: AdminAccountView, b: AdminAccountView) => number {
  const share = (person: AdminAccountView): UsageShare => {
    const figures = adminUsageFigures({ person, now });
    if (figures === null) return { ratio: 0, used: 0 };
    return { ratio: figures.used / figures.limit, used: figures.used };
  };
  return (a, b) => {
    const left = share(a);
    const right = share(b);
    return right.ratio - left.ratio || right.used - left.used || byNewest(a, b);
  };
}

/** The people in the order a sort names. Never mutates its input. */
export function sortPeople({
  people,
  sort,
  now,
}: {
  people: readonly AdminAccountView[];
  sort: PeopleSort;
  now: Date;
}): AdminAccountView[] {
  const compare = {
    newest: byNewest,
    oldest: byOldest,
    seen: bySeen,
    usage: byUsage({ now }),
    name: byName,
  }[sort];
  return people.toSorted(compare);
}

/** What the list shows: the narrowed people, in the chosen order. */
export function selectPeople({
  people,
  filter,
  now,
}: {
  people: readonly AdminAccountView[];
  filter: PeopleFilter;
  now: Date;
}): AdminAccountView[] {
  return sortPeople({ people: filterPeople({ people, filter, now }), sort: filter.sort, now });
}

// ─── Banding ───────────────────────────────────────────────────────────────

/** One run of the list under one heading. `band` is `null` for a list that has no headings. */
export interface PeopleGroupOfRows {
  band: PeopleBand | null;
  people: AdminAccountView[];
}

/**
 * The list split under "this week", "this month" and "earlier".
 *
 * ONLY WHEN THE ORDER IS BY SIGN-UP DATE. Under any other sort the people of
 * one band are scattered, and a heading repeated every few rows would say
 * "this week" over somebody who joined in March. Those sorts get one group
 * with no heading.
 *
 * Bands are consecutive runs in the order the list already has, so "oldest
 * first" shows earlier, then this month, then this week, with no second sort.
 */
export function bandPeople({
  people,
  sort,
  now,
}: {
  people: readonly AdminAccountView[];
  sort: PeopleSort;
  now: Date;
}): PeopleGroupOfRows[] {
  if (sort !== 'newest' && sort !== 'oldest') return people.length === 0 ? [] : [{ band: null, people: [...people] }];
  const groups: PeopleGroupOfRows[] = [];
  for (const person of people) {
    const band = bandOf({ createdAt: person.createdAt, now });
    const last = groups[groups.length - 1];
    if (last !== undefined && last.band === band) last.people.push(person);
    else groups.push({ band, people: [person] });
  }
  return groups;
}

// ─── The sort a column header asks for ─────────────────────────────────────

/** The columns whose header sorts the list. */
export type SortableColumn = 'person' | 'joined' | 'usedToday' | 'lastSeen';

/**
 * The sort a click on a column header asks for.
 *
 * "Joined" is the one that toggles: a second click reverses it. The others have
 * one direction each, the one an operator wants first (most used, most recent,
 * A to Z), and a second click on them changes nothing.
 */
export function sortForColumn({ column, current }: { column: SortableColumn; current: PeopleSort }): PeopleSort {
  switch (column) {
    case 'person':
      return 'name';
    case 'joined':
      return current === 'newest' ? 'oldest' : 'newest';
    case 'usedToday':
      return 'usage';
    case 'lastSeen':
      return 'seen';
  }
}

/** Whether a column is the one the list is sorted by. */
export function isActiveColumn({ column, sort }: { column: SortableColumn; sort: PeopleSort }): boolean {
  switch (column) {
    case 'person':
      return sort === 'name';
    case 'joined':
      return sort === 'newest' || sort === 'oldest';
    case 'usedToday':
      return sort === 'usage';
    case 'lastSeen':
      return sort === 'seen';
  }
}

/** Which way the arrow on the active column points: `up` for the sorts that read upward (A to Z, oldest first). */
export function sortArrow(sort: PeopleSort): 'up' | 'down' {
  return sort === 'name' || sort === 'oldest' ? 'up' : 'down';
}

// ─── The empty result ──────────────────────────────────────────────────────

/**
 * Why the list is empty, so the screen can say it.
 *
 * `'nobody-here'` is the instance having no accounts at all, which is a
 * different sentence from a filter that matched nobody, and the two used to be
 * the same one. A filter that emptied the list is named: the search alone, the
 * view alone, the label alone, the search and the view together, or any other
 * mix.
 */
export type PeopleEmptyReason = 'nobody-here' | 'query' | 'view' | 'label' | 'query-and-view' | 'several' | 'not-empty';

export function emptyReasonFor({
  people,
  filter,
  visible,
}: {
  people: readonly AdminAccountView[];
  filter: PeopleFilter;
  visible: readonly AdminAccountView[];
}): PeopleEmptyReason {
  if (visible.length > 0) return 'not-empty';
  if (people.length === 0) return 'nobody-here';
  const hasQuery = filter.query.trim() !== '';
  const hasView = filter.view !== 'all';
  const hasLabel = filter.label.kind !== 'any';
  const count = Number(hasQuery) + Number(hasView) + Number(hasLabel);
  if (count === 0) {
    // Everybody is filtered out by a filter that filters nothing: unreachable
    // while `filterPeople` is the only narrowing, and reported as the plain
    // empty instance rather than as a sentence about a filter nobody set.
    return 'nobody-here';
  }
  if (count > 1) return hasQuery && hasView && !hasLabel ? 'query-and-view' : 'several';
  if (hasQuery) return 'query';
  return hasView ? 'view' : 'label';
}

// ─── The address ───────────────────────────────────────────────────────────

/** The query-string names. One place, so the reader and the writer cannot disagree about a spelling. */
const PARAM = { view: 'view', sort: 'sort', label: 'label', query: 'q' } as const;

/** The search a URL carries, or what it reads as: whitespace only is nothing, so it is never written. */
export function urlQueryOf(query: string): string {
  return query.trim() === '' ? '' : query;
}

/**
 * The filter an address describes.
 *
 * Every part falls back to its default on a value this build does not know.
 * A label the instance does not have also reads as "any label": a shared link
 * to a label that was since removed opens the list, with nothing selected in a
 * select that has no such option.
 *
 * `?label=` with an empty value is "no label"; a named label is its text.
 *
 * @param knownLabels - the labels present on the instance; with none at all
 *   there is no label control, and the label part reads as "any".
 */
export function readPeopleFilter({
  params,
  knownLabels,
}: {
  params: URLSearchParams;
  knownLabels: readonly string[];
}): PeopleFilter {
  const view = PEOPLE_VIEWS.find((candidate) => candidate === params.get(PARAM.view)) ?? EMPTY_PEOPLE_FILTER.view;
  const sort = PEOPLE_SORTS.find((candidate) => candidate === params.get(PARAM.sort)) ?? EMPTY_PEOPLE_FILTER.sort;
  return {
    query: urlQueryOf(params.get(PARAM.query) ?? ''),
    view,
    label: readLabel({ raw: params.get(PARAM.label), knownLabels }),
    sort,
  };
}

function readLabel({ raw, knownLabels }: { raw: string | null; knownLabels: readonly string[] }): PeopleLabelFilter {
  if (raw === null || knownLabels.length === 0) return EMPTY_PEOPLE_FILTER.label;
  if (raw === '') return { kind: 'none' };
  const known = knownLabels.find((candidate) => candidate === raw);
  return known === undefined ? EMPTY_PEOPLE_FILTER.label : { kind: 'named', label: known };
}

/** The address parameters for a filter. A default is left out, so an unfiltered list has a bare `/admin`. */
export function writePeopleFilter(filter: PeopleFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.view !== EMPTY_PEOPLE_FILTER.view) params.set(PARAM.view, filter.view);
  if (filter.sort !== EMPTY_PEOPLE_FILTER.sort) params.set(PARAM.sort, filter.sort);
  if (filter.label.kind === 'none') params.set(PARAM.label, '');
  if (filter.label.kind === 'named') params.set(PARAM.label, filter.label.label);
  const query = urlQueryOf(filter.query);
  if (query !== '') params.set(PARAM.query, query);
  return params;
}
