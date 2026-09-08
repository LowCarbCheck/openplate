/**
 * The console's three tabs: people, invitations, activity.
 *
 * ── Links, not a widget ──────────────────────────────────────────────────
 *
 * Each tab is a route, so each one is an `<a>`. The back button walks between
 * them, an operator can bookmark the one they use, and nothing here holds any
 * state at all. A tab component that owned "which tab is open" would be a
 * second, quieter copy of the router.
 *
 * ── The active tab is decided by a pure function ─────────────────────────
 *
 * {@link activeAdminTab} takes the path and answers which tab is lit, and
 * `/admin/people/:id` lights PEOPLE: a person's page is somewhere the list
 * leads, not a fourth place. That is a rule worth a test rather than a
 * `startsWith` buried in a `className`.
 */
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';

/** The three tabs, by name. The detail page is not one of them; it lights `people`. */
export type AdminTab = 'people' | 'invitations' | 'activity';

/** Every tab, in the order they are shown. */
export const ADMIN_TABS: readonly AdminTab[] = ['people', 'invitations', 'activity'];

/** Where each tab goes. */
export const ADMIN_TAB_PATH = {
  people: '/admin',
  invitations: '/admin/invitations',
  activity: '/admin/activity',
} satisfies Record<AdminTab, string>;

/** The copy key for each tab's label. */
export const ADMIN_TAB_LABEL_KEY = {
  people: 'admin.tabs.people',
  invitations: 'admin.tabs.invitations',
  activity: 'admin.tabs.activity',
} satisfies Record<AdminTab, string>;

/**
 * Which tab a path belongs to.
 *
 * Everything that is not one of the other two tabs is PEOPLE, including
 * `/admin/people/:id` and `/admin/invite`, because both are places one of the
 * lists leads to and an unlit tab bar would tell an operator they had left the
 * console.
 */
export function activeAdminTab(pathname: string): AdminTab {
  if (pathname.startsWith('/admin/invitations') || pathname.startsWith('/admin/invite')) return 'invitations';
  if (pathname.startsWith('/admin/activity')) return 'activity';
  return 'people';
}

export interface AdminTabsProps {
  /** The current path. Passed in rather than read from a hook, so a render test can put the bar in any state. */
  pathname: string;
}

export function AdminTabs({ pathname }: AdminTabsProps) {
  const { t } = useTranslation();
  const active = activeAdminTab(pathname);

  return (
    <nav className="flex gap-1 border-b" aria-label={t('admin.tabs.label')}>
      {ADMIN_TABS.map((tab) => (
        <Link
          key={tab}
          to={ADMIN_TAB_PATH[tab]}
          aria-current={tab === active ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === active ?
              'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(ADMIN_TAB_LABEL_KEY[tab])}
        </Link>
      ))}
    </nav>
  );
}
