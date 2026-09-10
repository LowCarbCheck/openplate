/**
 * avatar-menu.tsx — the header's top-right control, at every breakpoint.
 *
 * An OPEN instance has no account to put in a menu (AGENTS.md), so this is not
 * an account menu there: it is about the DEVICE. It answers "whose diary is this,
 * is it safe, and how does it look" without leaving the page. The label at the
 * top names the device, the theme row switches appearance in place, and the
 * foot carries the ACCOUNT STRIP (`avatar-account-strip.tsx`), which is where
 * the email, the sync state and the allowance all live now.
 *
 * THAT PREMISE IS NOW CONDITIONAL (M201). `INSTANCE_MODE=managed` gives an
 * instance accounts, and on one of those this menu is the menu a person
 * already uses to leave, so the absence of a sign-out sent them three
 * navigations deep into the Danger Zone of `/settings/account` to find one.
 * The device-only reading still holds wherever the policy says so, and the
 * question to ask is `useInstancePolicy()`, never the mode name; see
 * `app/config/instance-policy.ts`.
 *
 * So the menu now carries an ACCOUNT DOOR, and there are four states of it,
 * decided in `resolveAvatarMenuDoor` rather than by `&&`s in the JSX below:
 * signed in (the way out), signed out on an instance that requires an account
 * (the way in), signed out on an open instance with a sync server (also the
 * way in), and no sync server at all (nothing). The "make one" row was the
 * only one that ever existed, and it was shown in every case: a managed
 * instance offered "Create account" to somebody who cannot create one,
 * because accounts there come from an invitation an administrator sends. That
 * is the same false promise the public header carried, and
 * `resolveAvatarMenuDoor` documents why `requiresAccount` and "is sync
 * configured" are not the same question.
 *
 * M215 SPEC 02 CUT THE MENU DOWN AGAIN. Two mid-menu rows both read as
 * "account" and both went to `/settings/account`: the sync row and the
 * "Create account" row. Both are gone. One row opens `/settings`, one strip
 * at the foot opens `/settings/account`, and that is the whole account
 * surface here.
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
import { LogIn, LogOut, Settings, User } from 'lucide-react';

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
import { AvatarAccountStrip } from './avatar-account-strip';
import { useSyncSession } from './sync-status';
import { useInstancePolicy, useSyncServerUrl } from '#app/hooks/use-public-config';
import { resolveAvatarMenuDoor, type AvatarMenuDoor } from '#app/lib/sync/sync-menu-state';
import { SignOutDialog } from './sign-out-dialog';
import { cn } from '#app/lib/utils';

/** Narrows Radix's `string` callback value back to a theme. */
function isTheme(value: string): value is Theme {
  return THEME_OPTIONS.some((option) => option.value === value);
}

/**
 * The account door: the rows the menu offers about the account, if any
 * (M201 spec 02 and 03).
 *
 * ONE ROW NOW, or none. It used to be two whenever an open instance let
 * anybody make an account: "Sign in", then "Create account" pointing at
 * `/settings/account`. M215 spec 02 folded the second into the footer strip,
 * which opens that same page and says why somebody would go there. Signing in
 * stays a row of its own because `/sign-in` is a different destination.
 *
 * Which state applies comes from `resolveAvatarMenuDoor`, so it stays a tested
 * decision rather than a chain of conditions in this file. Each row is a plain
 * menu item, none is styled as a danger action, and the sign-out one is the
 * whole reason this component exists.
 *
 * Exported for `tests/unit/avatar-menu-door.test.ts`, which renders it.
 */
export function AccountDoor({ door }: { door: AvatarMenuDoor }) {
  if (door === 'none') return null;
  if (door === 'sign-out') return <SignOutRow />;

  // BOTH signed-out doors render the same ONE row now. Creating an account
  // used to be a second row here, pointing at `/settings/account`; M215 spec
  // 02 folded that job into the footer strip, which already opens that page
  // and now also says WHY somebody would go there ("Abgemeldet"). The
  // distinction the resolver draws still matters to the rest of the app, so
  // the door type is unchanged and only this file stopped drawing two rows.
  return <SignInRow />;
}

/** The way out, behind the shared confirm dialog `/settings/account` also opens. */
function SignOutRow() {
  const { t } = useTranslation();

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

/** The way back in, on every instance that has accounts at all. */
function SignInRow() {
  const { t } = useTranslation();

  return (
    <DropdownMenuItem asChild className="cursor-pointer py-2">
      <Link to="/sign-in">
        <LogIn className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t('signIn.title')}</span>
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
        {/* THE DEVICE, and only the device. The email used to sit under this
            label as well; the footer strip carries it now, and printing the
            same address twice in a 16rem menu is noise, not identity. */}
        <DropdownMenuLabel className="py-2">
          <span className="block">{t('chrome.thisDevice')}</span>
        </DropdownMenuLabel>

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

        {/* THE ACCOUNT, AT THE FOOT. Not a row among rows: one strip that
            names who is signed in, how sync is doing and what the allowance
            is, and opens `/settings/account` when tapped. It renders nothing
            at all on an instance with no sync server. */}
        <AvatarAccountStrip />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
