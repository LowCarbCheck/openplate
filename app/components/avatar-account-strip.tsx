/**
 * avatar-account-strip.tsx, the account as ONE strip at the foot of the
 * avatar menu (M215 spec 02).
 *
 * ── What it replaces, and why ────────────────────────────────────────────
 *
 * The menu used to carry two mid-menu rows that both read as "account": a
 * sync row titled "Synchronisierung" linking to `/settings/account`, and a
 * "Konto erstellen" row linking to the same page. Two same-weight items, one
 * destination, and neither of them said the one thing a person opens this
 * menu to check: who is signed in here, and is the diary safe. So the rows are
 * gone and this is what the foot of the menu says instead:
 *
 *   1. the email (or the display name) on top,
 *   2. the sync status line under it,
 *   3. an allowance-or-plan line under that, on an instance whose AI comes
 *      with the account.
 *
 * The whole strip is a single tap target that opens `/settings/account`. One
 * destination, one target, instead of one destination behind two rows.
 *
 * ── Cached state only. No request on open ────────────────────────────────
 *
 * Every value here comes from a hook the app has already read:
 * `useSyncSession` (an external store), `useSyncServerUrl` and
 * `useInstancePolicy` (the root loader's public config), and
 * `useServerInstance` (one `/health` read per tab, cached at module scope).
 * Opening the menu must cost nothing, so nothing here starts a fetch.
 *
 * ── It never names an administrator (M212) ───────────────────────────────
 *
 * `account.allowance.askAdmin` and the `ask-admin` door kind belong to
 * `/settings/account` and nowhere else. This strip prints allowance numbers,
 * or the plan line, or nothing at all. An instance whose accounts arrive by
 * invitation has no administrator to name here.
 *
 * ── No sync server means no strip ────────────────────────────────────────
 *
 * `useSyncServerUrl() === null` is the AGENTS.md rule, not a layout choice:
 * that instance has no account and no sync, so the menu is "Einstellungen"
 * plus the theme group and this component renders nothing at all.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, LogIn, RefreshCw } from 'lucide-react';

import { Link } from '#app/components/link';
import { useSyncSession } from './sync-status';
import { useInstancePolicy, useSyncServerUrl } from '#app/hooks/use-public-config';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { hasPlansDoor } from '#app/lib/plans/plans-door';
import { formatRelativeTime } from '#app/lib/relative-time';
import { deriveSyncMenuState, type SyncMenuState } from '#app/lib/sync/sync-menu-state';
import { DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu';
import { cn } from '#app/lib/utils';

/** Where the strip goes. One destination, always, whatever the strip currently says. */
export const ACCOUNT_STRIP_HREF = '/settings/account';

/**
 * The third line of the strip, decided once and in the open.
 *
 * `ask-admin` IS DELIBERATELY NOT ONE OF THESE (M212). An account with no
 * allowance on an instance that sells nothing has nothing true left to say in
 * a menu, so the answer there is `none` and the line does not render.
 */
export type AllowanceLine =
  /** Nothing to add: the AI does not come from the instance, or the view is unread. */
  | { kind: 'none' }
  /** A working allowance, with today's numbers. */
  | { kind: 'usage'; used: number; limit: number }
  /** No allowance at all, on an instance that sells no plan. */
  | { kind: 'no-allowance' }
  /** No allowance, on an instance that has a plan page behind it. */
  | { kind: 'plan' };

/** Everything {@link resolveAllowanceLine} needs, all of it already in memory. */
export interface AllowanceLineInput {
  /** `InstancePolicy.aiComesFromTheInstance`, the same question `/settings` asks. */
  aiComesFromTheInstance: boolean;
  /** `session.account.dailyAiLimit`. `null` is "not read yet", never "zero". */
  dailyAiLimit: number | null;
  /** `session.account.aiUsedToday`. `null` is "not read yet". */
  aiUsedToday: number | null;
  /** `hasPlansDoor(useServerInstance())`. */
  plansAvailable: boolean;
}

/**
 * Which allowance line the strip shows, if any.
 *
 * `null` limits read as UNKNOWN and print nothing. The account view arrives a
 * moment after every reload, and "0 of 0 used today" during that moment is a
 * lie about somebody's allowance rather than a loading state.
 */
export function resolveAllowanceLine({
  aiComesFromTheInstance,
  dailyAiLimit,
  aiUsedToday,
  plansAvailable,
}: AllowanceLineInput): AllowanceLine {
  if (!aiComesFromTheInstance) return { kind: 'none' };
  if (dailyAiLimit === null) return { kind: 'none' };
  if (dailyAiLimit === 0) return plansAvailable ? { kind: 'plan' } : { kind: 'no-allowance' };
  return { kind: 'usage', used: aiUsedToday ?? 0, limit: dailyAiLimit };
}

/**
 * The sync status line, or `null` when there is nothing to add under the
 * title.
 *
 * Moved here wholesale from the sync row this strip replaced. Wording is
 * reused from `sync.status.*` (DESIGN.md §10.7: one phrasing per idea), and the
 * only menu-specific string is the short error line, because the settings
 * page's full sentence is a paragraph and this is one line under a title.
 */
export function useSyncStatusLine(state: SyncMenuState): string | null {
  const { t, i18n } = useTranslation();

  if (state.status === 'hidden' || state.status === 'not-set-up') return null;
  if (state.status === 'error') return t('sync.status.shortError');
  if (state.status === 'syncing') return t('sync.status.syncing');
  if (state.status === 'pending') return t('sync.status.pending');
  if (state.status === 'never-synced') return t('sync.status.never');

  const when = formatRelativeTime({
    from: state.lastSyncedAt,
    now: Date.now(),
    locale: i18n.resolvedLanguage ?? i18n.language,
  });
  return t('sync.status.syncedAgo', { when });
}

/** The leading icon carries the state too, so it never rests on the status line's color alone. */
function SyncStateIcon({ state }: { state: SyncMenuState }) {
  if (state.status === 'not-set-up') {
    return <LogIn className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
  }
  if (state.status === 'error') {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-accent-amber" aria-hidden="true" />;
  }
  if (state.status === 'syncing') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />;
  }
  if (state.status === 'pending') {
    return <RefreshCw className="h-4 w-4 shrink-0 text-accent-amber" aria-hidden="true" />;
  }
  if (state.status === 'synced') {
    return <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
  }
  return <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
}

/** What {@link AccountStripView} draws, with no hook between it and the props. */
export interface AccountStripViewProps {
  /**
   * The sync state, already derived. `hidden` never reaches here: the
   * container returns `null` first.
   */
  state: SyncMenuState;
  /** The email, or the display name when the account carries one, or `null` when signed out. */
  title: string | null;
  /** The third line. */
  allowance: AllowanceLine;
}

/**
 * The strip, as pure markup.
 *
 * Split out from the container so it can be rendered in a test with props
 * alone. This repo has no DOM test library, so a component that reads four
 * hooks cannot be exercised any other way. See
 * `tests/unit/avatar-account-strip.test.ts`.
 */
export function AccountStripView({ state, title, allowance }: AccountStripViewProps) {
  const { t } = useTranslation();
  const status = useSyncStatusLine(state);
  // Signed out on an instance that HAS accounts. The strip is the door back
  // in, and "Abgemeldet" is the same word the settings hub's row already uses
  // for the same state.
  const heading = title ?? t('settings.rows.account.signedOut');

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild className="cursor-pointer py-2">
        <Link to={ACCOUNT_STRIP_HREF}>
          <SyncStateIcon state={state} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{heading}</span>
            {status !== null && (
              /* While a sync is actually in flight the status line breathes,
                 so the strip has a live quality even when the spinning icon is
                 out of the reader's focus. Deliberately the text and NOT a
                 second glyph: the leading icon is already spinning, and two
                 moving objects in one strip is noise, not feedback. */
              <span
                className={cn(
                  'block truncate text-xs text-muted-foreground',
                  state.status === 'syncing' && 'pulse-soft',
                )}
              >
                {status}
              </span>
            )}
            {allowance.kind === 'usage' && (
              <span className="block truncate text-xs text-muted-foreground">
                {t('account.allowance.today', { used: allowance.used, limit: allowance.limit })}
              </span>
            )}
            {allowance.kind === 'no-allowance' && (
              <span className="block truncate text-xs text-muted-foreground">{t('account.allowance.none')}</span>
            )}
            {allowance.kind === 'plan' && (
              <span className="block truncate text-xs text-muted-foreground">{t('account.allowance.planLink')}</span>
            )}
          </span>
        </Link>
      </DropdownMenuItem>
    </>
  );
}

/**
 * The strip, wired to the cached state the app already holds.
 *
 * Returns `null` on an instance with no sync server, before anything else is
 * read: that instance has no account to describe (AGENTS.md).
 */
export function AvatarAccountStrip() {
  const session = useSyncSession();
  const syncServerUrl = useSyncServerUrl();
  const { aiComesFromTheInstance } = useInstancePolicy();
  const instance = useServerInstance();

  if (syncServerUrl === null) return null;

  const state = deriveSyncMenuState({ hasSyncServer: true, session });
  const account = session.account;
  const allowance = resolveAllowanceLine({
    aiComesFromTheInstance,
    dailyAiLimit: account?.dailyAiLimit ?? null,
    aiUsedToday: account?.aiUsedToday ?? null,
    plansAvailable: hasPlansDoor(instance),
  });

  return <AccountStripView state={state} title={account?.displayName ?? account?.email ?? null} allowance={allowance} />;
}
