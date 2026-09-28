/**
 * Narrowing the list of people, and nothing else.
 *
 * ── The filtering happens in the browser, on purpose ─────────────────────
 *
 * The whole list is already in hand: `AdminClient.listAccounts` follows the
 * service's paging itself and resolves with everybody. An instance here has a
 * handful of people to a few hundred, so a request per keystroke would buy
 * nothing and would make a search box that works offline into one that does
 * not work at all when the connection is poor.
 *
 * ── Pure, so the sentence for an empty result can be tested ──────────────
 *
 * The screen has to say WHICH filter emptied the list, and that decision is
 * the one thing here worth getting wrong. It lives in {@link filterPeople} and
 * {@link emptyReasonFor} rather than inside a component, where it would only
 * be reachable through a render.
 */
import type { AdminAccountView } from './admin-wire';

/** The four groups the list can be narrowed to. `everybody` is the default and filters nothing. */
export type PeopleGroup = 'everybody' | 'active' | 'suspended' | 'administrators';

/** Every group, in the order the control offers them. */
export const PEOPLE_GROUPS: readonly PeopleGroup[] = ['everybody', 'active', 'suspended', 'administrators'];

/** What the filter bar is currently set to. Both halves are always present; `query` is empty when nothing was typed. */
export interface PeopleFilter {
  query: string;
  group: PeopleGroup;
}

/** The filter a freshly opened list starts with: everybody, nothing typed. */
export const EMPTY_PEOPLE_FILTER: PeopleFilter = { query: '', group: 'everybody' };

/**
 * The people a filter leaves on screen, in the order they arrived.
 *
 * The search is trimmed and case insensitive and reads BOTH the display name
 * and the address, because an operator looking for somebody knows one or the
 * other and rarely knows which one this instance stored.
 */
export function filterPeople(input: { people: readonly AdminAccountView[]; filter: PeopleFilter }): AdminAccountView[] {
  const needle = input.filter.query.trim().toLowerCase();
  return input.people.filter((person) => matchesGroup(person, input.filter.group) && matchesQuery(person, needle));
}

/**
 * Why the list is empty, so the screen can say it.
 *
 * `'nobody-here'` is the instance having no accounts at all, which is a
 * different sentence from a filter that matched nobody, and the two used to be
 * the same one.
 */
export type PeopleEmptyReason = 'nobody-here' | 'query' | 'group' | 'both' | 'not-empty';

export function emptyReasonFor(input: {
  people: readonly AdminAccountView[];
  filter: PeopleFilter;
  visible: readonly AdminAccountView[];
}): PeopleEmptyReason {
  if (input.visible.length > 0) return 'not-empty';
  if (input.people.length === 0) return 'nobody-here';
  const hasQuery = input.filter.query.trim() !== '';
  const hasGroup = input.filter.group !== 'everybody';
  if (hasQuery && hasGroup) return 'both';
  if (hasQuery) return 'query';
  if (hasGroup) return 'group';
  // Everybody is filtered out by a filter that filters nothing: unreachable
  // while `filterPeople` is the only narrowing, and reported as the plain
  // empty instance rather than as a sentence about a filter nobody set.
  return 'nobody-here';
}

/** Whether one person is in a group. `administrators` is a role, the other two are a standing. */
function matchesGroup(person: AdminAccountView, group: PeopleGroup): boolean {
  if (group === 'everybody') return true;
  if (group === 'administrators') return person.role === 'admin';
  const isSuspended = person.suspendedAt !== null;
  return group === 'suspended' ? isSuspended : !isSuspended;
}

/** Whether a name or an address contains what was typed. An empty needle matches everybody. */
function matchesQuery(person: AdminAccountView, needle: string): boolean {
  if (needle === '') return true;
  if (person.email.toLowerCase().includes(needle)) return true;
  const name = person.displayName;
  return name !== null && name.toLowerCase().includes(needle);
}
