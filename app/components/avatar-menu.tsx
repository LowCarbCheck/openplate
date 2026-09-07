/**
 * avatar-menu.tsx — the header's top-right control, at every breakpoint.
 *
 * An OPEN instance has no account to put in a menu (AGENTS.md), so this is not
 * an account menu there: it is about the DEVICE. It answers "whose diary is this,
 * is it safe, and how does it look" without leaving the page, the identity
 * header names the device (plus the sync account's email when one is
 * connected), the sync row reports the one piece of state that had no presence
 * in the chrome at all, and the theme row switches appearance in place.
 *
 * THAT PREMISE IS NOW CONDITIONAL (M201). `INSTANCE_MODE=managed` gives an
 * instance accounts, and on one of those this menu is the menu a person
 * already uses to leave, so the absence of a sign-out sent them three
 * navigations deep into the Danger Zone of `/settings/account` to find one.
 * The device-only reading still holds wherever the policy says so, and the
 * question to ask is `useInstancePolicy()`, never the mode name; see
 * `app/config/instance-policy.ts`.
 *
 * So the menu now carries an ACCOUNT DOOR, and there are three states of it,
 * decided in `resolveAvatarMenuDoor` rather than by `&&`s in the JSX below:
 * signed in (the way out), signed out on an instance that requires an account
 * (the way in), and signed out on an instance where an account is an optional
 * extra (the way to set one up). The third was the only one that existed, and
 * it was shown in all three cases: a managed instance offered "Create account"
 * to somebody who cannot create one, because accounts there come from an
 * invitation an administrator sends. That is the same false promise the public
 * header carried, and `resolveAvatarMenuDoor` documents why
 * `requiresAccount` and "is sync configured" are not the same question.
 *
 * Why a menu and not the plain `/settings` link it briefly was: sync status and
 * the theme both belong in the chrome. Sync is the only thing in the app whose
 * health a user might want to check at a glance, and the theme is the one
 * preference people flip mid-task (a bright room, a dark bedroom) — making
 * either a two-navigation trip through the settings hub is why they went
 * unnoticed. Everything else stays in the hub, which remains the map: exactly
 * one plain "Settings" shortcut leads there.
 *
 * The nav surfaces each have one job (see `app-sidebar.tsx`'s catalog comment):
 * tabs = the logging loop, drawer/sidebar = the whole map, and this = the
 * device and its state. Destinations here are deliberately NOT catalog items,
 * so it never grows into a third copy of the navigation.
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, LogIn, LogOut, RefreshCw, Settings, User } from 'lucide-react';

import { Avatar, AvatarFallback } from './ui/avatar';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { THEME_OPTIONS, useThemePreference, type Theme } from './theme-selector';
import { useSyncSession } from './sync-status';
import { useInstancePolicy, useSyncServerUrl } from '#app/hooks/use-public-config';
import { formatRelativeTime } from '#app/lib/relative-time';
import {
  deriveSyncMenuState,
  resolveAvatarMenuDoor,
  type AvatarMenuDoor,
  type SyncMenuState,
} from '#app/lib/sync/sync-menu-state';
import { SignOutDialog } from './sign-out-dialog';
import { cn } from '#app/lib/utils';

/** Narrows Radix's `string` callback value back to a theme. */
function isTheme(value: string): value is Theme {
  return THEME_OPTIONS.some((option) => option.value === value);
}

/**
 * The sync row's status line, or `null` when the row has nothing to add under
 * its title.
 *
 * Wording is reused wholesale from `sync.status.*` (DESIGN.md §10.7: one
 * phrasing per idea) — the only menu-specific string is the short error line,
 * because the settings page's full sentence is a paragraph and this is one
 * line under a title.
 */
function useSyncStatusLine(state: SyncMenuState): string | null {
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

/**
 * The sync row — the point of this revision. Sync had no presence in the app
 * chrome at all: a device could be signed out, or hours behind, and nothing
 * outside `/settings/sync` would say so.
 *
 * Renders NOTHING when the instance has no sync server configured — that is
 * the AGENTS.md rule ("unset ⇒ no sync UI renders anywhere"), not a layout
 * choice, so it is decided in `deriveSyncMenuState` and merely obeyed here.
 */
function SyncRow({ state }: { state: SyncMenuState }) {
  const { t } = useTranslation();
  const status = useSyncStatusLine(state);

  if (state.status === 'hidden') return null;
  // "No account on this device yet" is now the DOOR's business, not a status
  // line's: what to offer there depends on whether this instance lets anybody
  // make an account, and this row only knows about syncing. See `AccountDoor`.
  if (state.status === 'not-set-up') return null;

  return (
    <DropdownMenuItem asChild className="cursor-pointer py-2">
      <Link to="/settings/account">
        <SyncStateIcon state={state} />
        <span className="min-w-0 flex-1">
          <span className="block">{t('settings.rows.sync.title')}</span>
          {status !== null && (
            /* While a sync is actually in flight the status line breathes, so
               the row has a live quality even when the spinning icon is out of
               the reader's focus. Deliberately the text and NOT a second glyph:
               the leading `SyncStateIcon` is already spinning, and two moving
               objects in one two-line row is noise, not feedback. */
            <span
              className={cn('block truncate text-xs text-muted-foreground', state.status === 'syncing' && 'pulse-soft')}
            >
              {status}
            </span>
          )}
        </span>
      </Link>
    </DropdownMenuItem>
  );
}

/**
 * The account door: one row, or none (M201 spec 02 and 03).
 *
 * The four states come from `resolveAvatarMenuDoor`, so which one shows is a
 * tested decision rather than a chain of conditions in this file. Each is a
 * plain menu item, none is styled as a danger action, and the sign-out one is
 * the whole reason this component exists.
 */
function AccountDoor({ door }: { door: AvatarMenuDoor }) {
  const { t } = useTranslation();

  if (door === 'none') return null;

  if (door === 'sign-out') {
    return (
      <SignOutDialog
        trigger={
          <DropdownMenuItem
            // `preventDefault` keeps the menu mounted. Radix unmounts a closed
            // dropdown's content, and the dialog's trigger lives inside it, so
            // letting the select close the menu would tear the dialog down in
            // the same frame it opened. The modal covers the menu anyway.
            onSelect={(event) => event.preventDefault()}
            className="cursor-pointer py-2"
          >
            <LogOut className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('signOut.menuItem')}</span>
          </DropdownMenuItem>
        }
      />
    );
  }

  if (door === 'sign-in') {
    return (
      <DropdownMenuItem asChild className="cursor-pointer py-2">
        <Link to="/sign-in">
          <LogIn className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{t('signIn.title')}</span>
        </Link>
      </DropdownMenuItem>
    );
  }

  // `create-account`, and it is honest here and only here: an OPEN instance
  // with a sync server, where anybody may make one for themselves.
  return (
    <DropdownMenuItem asChild className="cursor-pointer py-2">
      <Link to="/settings/account">
        <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t('sync.profileCard.setUp')}</span>
      </Link>
    </DropdownMenuItem>
  );
}

/**
 * The theme choice as a segmented row at the foot of the menu.
 *
 * KEYBOARD: these are real Radix `RadioItem`s, so the group keeps menu
 * semantics — Radix's roving focus walks items in DOM order with Up/Down
 * whatever the visual layout, and Left/Right stay reserved for sub-menus. A
 * horizontal strip of plain `<button>`s would have looked identical and been
 * unreachable by keyboard, which is why the layout here is CSS only and the
 * elements are unchanged.
 *
 * `preventDefault` on select is what keeps the menu OPEN: switching theme is
 * something you do to LOOK at the page behind the menu, and closing on each
 * try makes comparing light and dark a three-click loop.
 */
function ThemeRow() {
  const { t } = useTranslation();
  const { theme, hydrated, selectTheme } = useThemePreference();

  return (
    <DropdownMenuRadioGroup
      // Before hydration nothing is marked selected — showing `system` as
      // active would be a guess, and a wrong one for most users.
      value={hydrated ? theme : ''}
      onValueChange={(value) => {
        if (isTheme(value)) selectTheme(value);
      }}
      className="flex gap-1 rounded-lg bg-muted/40 p-1"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <DropdownMenuRadioItem
            key={option.value}
            value={option.value}
            onSelect={(event) => event.preventDefault()}
            className={cn(
              // The primitive's first child is its absolutely-positioned dot
              // indicator; a segmented cell says "selected" with the whole
              // filled cell instead, so the dot — and the `pl-8` reserved for
              // it — go away.
              '[&>span:first-child]:hidden',
              'flex-1 cursor-pointer flex-col justify-center gap-1 rounded-md py-2 pl-2 pr-2 text-[11px] font-medium',
              'text-muted-foreground data-[state=checked]:bg-background data-[state=checked]:text-foreground',
              'data-[state=checked]:shadow-sm data-[state=checked]:ring-1 data-[state=checked]:ring-primary/30',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{t(option.labelKey)}</span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

export function AvatarMenu() {
  const { t } = useTranslation();
  const session = useSyncSession();
  // `null` unless the operator set `SYNC_SERVER_URL` — on every other instance
  // the sync row vanishes entirely (AGENTS.md).
  const syncServerUrl = useSyncServerUrl();
  const syncState = deriveSyncMenuState({ hasSyncServer: syncServerUrl !== null, session });
  // `requiresAccount`, not the mode name: the question is whether a person
  // needs an account to use this instance at all, and a self-hoster who turned
  // sync on for themselves does not.
  const { requiresAccount } = useInstancePolicy();
  const door = resolveAvatarMenuDoor({
    hasSyncServer: syncServerUrl !== null,
    hasSession: session.account !== null,
    requiresAccount,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Below `sm` the trigger shrinks to the avatar circle alone, so the
            aria-label carries the meaning regardless of whether the text
            shows. `pr-2 -mr-2` cancels the ghost button's default `px-4`
            right padding so this trigger sits the same visual distance from
            the header's right edge as the left drawer trigger (an `icon`-size
            button) sits from the left edge — otherwise the default size's
            16px right padding stacks on top of the header's own `px-4`. */}
        <Button variant="ghost" className="flex items-center gap-2 pr-2 -mr-2" aria-label={t('chrome.deviceMenuLabel')}>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-sm">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{t('chrome.thisDevice')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Identity, not an action: the email only appears when sync is
            actually connected, because on every other install there is no
            account to name (AGENTS.md — the app server holds none). */}
        <DropdownMenuLabel className="py-2">
          <span className="block">{t('chrome.thisDevice')}</span>
          {session.account !== null && (
            <span className="block truncate text-xs font-normal text-muted-foreground">{session.account.email}</span>
          )}
        </DropdownMenuLabel>

        <SyncRow state={syncState} />
        <AccountDoor door={door} />

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer py-2">
          <Link to="/settings">
            <Settings className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('nav.settings')}</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="py-1 text-xs font-medium text-muted-foreground">
          {t('preferences.theme.title')}
        </DropdownMenuLabel>
        <ThemeRow />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
