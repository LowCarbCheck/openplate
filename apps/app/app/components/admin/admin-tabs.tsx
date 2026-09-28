/**
 * The console's tabs: people, invitations, activity, reports, settings.
 *
 * ── Links, not a widget ──────────────────────────────────────────────────
 *
 * Each tab is a route, so each one is an `<a>`. The back button walks between
 * them, an operator can bookmark the one they use, and nothing here holds any
 * state at all. A tab component that owned "which tab is open" would be a
 * second, quieter copy of the router.
 *
 * ── One tab is not always there ──────────────────────────────────────────
 *
 * Reported estimates exist only on an instance whose server accepts them, and
 * that service answers the ordinary 404 on the whole subtree when it does not.
 * The tab follows: it is drawn only where the instance advertised a retention
 * window, so the bar never leads an operator to an address that answers "no
 * such page". `hasFeedback` is a PROP rather than a read of its own, because
 * the layout above already holds the instance descriptor and a second read
 * here would be a second answer to the same question.
 *
 * ── The active tab is decided by a pure function ─────────────────────────
 *
 * {@link activeAdminTab} takes the path and answers which tab is lit, and
 * `/admin/people/:id` lights PEOPLE: a person's page is somewhere the list
 * leads, not a fourth place. That is a rule worth a test rather than a
 * `startsWith` buried in a `className`.
 *
 * ── Every tab stays on screen, so a narrow bar wraps ─────────────────────
 *
 * Five labels in the body font (Victor Mono, 0.6em a character) need about
 * 470 px in English and 556 px in German as one underlined row. A phone gives
 * the bar 328 to 358 px, and a tablet with the sidebar open gives it about 464.
 * The single row used to run off the right edge there and widen the whole
 * page. A sideways scroller would hide the last tabs and a menu would hide all
 * of them, and a tab nobody can see is the discoverability problem this bar
 * exists to solve. So below {@link WIDE_BAR_MIN_PX} the bar wraps instead.
 *
 * A wrapped underline row reads as broken: the lit tab's underline floats in
 * the middle of the block, and the bar's own hairline runs under the last row
 * only. So the narrow bar has its own form. Each tab grows to fill its row,
 * carries a hairline under itself, and is at least 44 px tall. Each row then
 * reads as one ruled line, and the lit tab thickens its piece of that line in
 * the primary colour. Corners stay square, like everything else in the app.
 *
 * The switch is a CONTAINER query, not a viewport one. What decides whether
 * the labels fit is the width the bar gets, and the sidebar takes 256 px of
 * the viewport from `md` up. A viewport breakpoint would draw the underline
 * row at 768 px, where it does not fit in German.
 */
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';

/** The tabs, by name. A detail page is not one of them; it lights the list it came from. */
export type AdminTab = 'people' | 'invitations' | 'activity' | 'feedback' | 'settings';

/** Every tab this console can draw, in the order they are shown. Whether the last one is drawn is an instance's answer. */
export const ADMIN_TABS: readonly AdminTab[] = ['people', 'invitations', 'activity', 'feedback', 'settings'];

/** Where each tab goes. */
export const ADMIN_TAB_PATH = {
  people: '/admin',
  invitations: '/admin/invitations',
  activity: '/admin/activity',
  feedback: '/admin/feedback',
  settings: '/admin/settings',
} satisfies Record<AdminTab, string>;

/** The copy key for each tab's label. */
export const ADMIN_TAB_LABEL_KEY = {
  people: 'admin.tabs.people',
  invitations: 'admin.tabs.invitations',
  activity: 'admin.tabs.activity',
  feedback: 'admin.tabs.feedback',
  settings: 'admin.tabs.settings',
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
  // BEFORE the invitations line, which would otherwise never be reached for
  // this path: `/admin/settings` does not start with `/admin/invite`, but the
  // two names are close enough that the order is worth stating.
  if (pathname.startsWith('/admin/settings')) return 'settings';
  if (pathname.startsWith('/admin/invitations') || pathname.startsWith('/admin/invite')) return 'invitations';
  if (pathname.startsWith('/admin/activity')) return 'activity';
  // Before the fall-through, and it covers `/admin/feedback/:id` too: one
  // report is somewhere the queue leads, not a fifth place.
  if (pathname.startsWith('/admin/feedback')) return 'feedback';
  return 'people';
}

/**
 * The narrowest bar that draws the one underlined row: 42rem, Tailwind's
 * `@2xl` container size, which the classes below name. The widest set of
 * labels today is German at about 556 px, so this leaves room for a longer
 * translation before the row would have to wrap. The browser tier reads this
 * number to know which form it is measuring.
 */
export const WIDE_BAR_MIN_PX = 672;

/** Every tab, in both forms. Narrow first; the `@2xl:` half restores the underlined row exactly as it was drawn before. */
const TAB_CLASS =
  'flex min-h-11 grow items-center justify-center px-3 text-sm font-medium @2xl:-mb-px @2xl:min-h-0 @2xl:grow-0 @2xl:border-b-2 @2xl:py-2';

/**
 * The lit tab: a 2 px primary rule in both forms.
 *
 * The narrow form's border WIDTH lives here and in {@link IDLE_TAB_CLASS}, never in
 * {@link TAB_CLASS}, so no element carries two unprefixed widths whose order
 * would decide which one wins.
 */
const ACTIVE_TAB_CLASS = 'border-b-2 border-primary text-foreground';

/** Every other tab: a hairline in the narrow form, and the transparent 2 px rule of the underlined row. */
const IDLE_TAB_CLASS = 'border-b text-muted-foreground hover:text-foreground @2xl:border-transparent';

export interface AdminTabsProps {
  /** The current path. Passed in rather than read from a hook, so a render test can put the bar in any state. */
  pathname: string;
  /** Whether this instance takes reported estimates at all. `false` draws no tab to a page that answers 404. */
  hasFeedback: boolean;
}

export function AdminTabs({ pathname, hasFeedback }: AdminTabsProps) {
  const { t } = useTranslation();
  const active = activeAdminTab(pathname);
  const visible = ADMIN_TABS.filter((tab) => tab !== 'feedback' || hasFeedback);

  // The wrapper is the container the `@2xl:` classes measure. The nav cannot
  // be its own: a container query styles what is inside the container, and the
  // nav's own hairline and gap change between the two forms.
  return (
    <div className="@container">
      <nav className="flex flex-wrap @2xl:gap-1 @2xl:border-b" aria-label={t('admin.tabs.label')}>
        {visible.map((tab) => (
          <Link
            key={tab}
            to={ADMIN_TAB_PATH[tab]}
            aria-current={tab === active ? 'page' : undefined}
            className={`${TAB_CLASS} ${tab === active ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS}`}
          >
            {t(ADMIN_TAB_LABEL_KEY[tab])}
          </Link>
        ))}
      </nav>
    </div>
  );
}
