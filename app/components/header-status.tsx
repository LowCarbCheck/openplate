import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '#app/components/ui/button';
import { cn } from '#app/lib/utils';
import { clearStatus, registerStatusHost, useStatus, type StatusMessage, type StatusTone } from '#app/lib/status';

/**
 * The app's notifications, rendered in the header's TITLE SLOT.
 *
 * There is no toast layer any more. Every confirmation, warning and failure in
 * the app publishes to `#app/lib/status` and lands here, in place of the
 * wordmark and the page title, for the few seconds it has something to say.
 *
 * WHY THE TITLE SLOT. The header is sticky (`components/app-wrapper.tsx`), so
 * it is the one region guaranteed to be on screen whatever the page has
 * scrolled to. Its contents are also the least-read text in the app: nobody is
 * looking at "Diary" while their entry saves. A toast, by contrast, had to
 * float somewhere, and every candidate was somewhere a control already lived,
 * the bottom nav and the raised Scan button below, the device menu and the nav
 * drawer above.
 *
 * THE HEADER NEVER MOVES. This component swaps `children` for the status row
 * inside the same box. An error persists until dismissed, so its text wraps
 * instead of truncating to an unreadable one: `text-sm line-clamp-2` for
 * every other tone, but an ERROR drops to `text-xs font-semibold leading-4
 * line-clamp-3` (or `line-clamp-2` when it also carries a description) so a
 * long sentence, in German especially, fits whole rather than clipping after
 * two lines of the larger size (M225 follow-up). Three lines at `leading-4`
 * (16px) plus a 16px description is 64px, so the bar's height is still fixed
 * by the header's own `min-h-16`, and the `AvatarMenu` and the drawer trigger
 * are siblings of this component rather than children of it, so neither
 * shifts by a pixel.
 *
 * THE `h1` IS NOT RENDERED while a status shows. That is deliberate and not an
 * oversight: for those seconds the status IS what the header says, and it is
 * announced as such. The page still has its `<title>`, which is what a screen
 * reader uses to name the document.
 */

/**
 * The tone colours, each taken from a class the app already paints with:
 * `text-accent-amber` is the warning token (`app.css`), `text-destructive` is
 * the error token, and the green pair is `ui/alert.tsx`'s own success text.
 * Never a hex and never a brand literal, see the workspace rule on the mark.
 */
const TONE_CLASS = {
  info: 'text-muted-foreground',
  success: 'text-green-700 dark:text-green-400',
  warning: 'text-accent-amber',
  error: 'text-destructive',
} satisfies Record<StatusTone, string>;

const TONE_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
} as const;

/**
 * The status row itself, props only, so a static render can be handed a
 * message without driving the store.
 */
export function HeaderStatusRow({ status }: { status: StatusMessage }): ReactNode {
  const { t } = useTranslation();
  const Icon = TONE_ICON[status.tone];
  // An error persists until it is dismissed (`STATUS_TTL_MS`), so it needs a
  // way out. A status carrying an action gets the same control for a different
  // reason: it is offering a choice, and "neither" has to be one of them.
  const isDismissable = status.tone === 'error' || status.action !== null;
  const isError = status.tone === 'error';
  const hasDescription = status.description !== null;
  // An error is smaller AND taller than every other tone: dropping to
  // `text-xs` buys a third line before the header's `min-h-16` is at risk, so
  // a long sentence (the German notifications-blocked copy is the one that
  // forced this) has somewhere to go instead of clipping at two lines of
  // `text-sm`. Two lines, not three, when a description is also showing, so
  // the two together still fit the same budget.
  const textRowClass = isError ? 'text-xs font-semibold leading-4' : 'text-sm font-semibold';
  const textClampClass = isError && !hasDescription ? 'line-clamp-3' : 'line-clamp-2';

  return (
    <div
      data-slot="header-status"
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 opacity-100 transition-opacity duration-150 motion-reduce:transition-none"
    >
      {/* `<output>` carries an implicit ARIA role of "status", which is the
          polite live region this needs. A `role` or an `aria-live` beside it
          would be a second, redundant declaration of the same thing. */}
      <output className={cn('flex min-w-0 flex-1 flex-col justify-center gap-px', TONE_CLASS[status.tone])}>
        {/* `items-start`, not `items-center`: the text below can wrap to a
            second or third line, and the icon sits on the first line rather
            than centering across all of them. `line-clamp-2`/`line-clamp-3`
            plus `break-words` replaces `truncate` here (M225): an error stays
            on screen until dismissed, so cutting it to one line with an
            ellipsis made it unreadable. The description below keeps
            `truncate`, it is supplementary, never the whole message. */}
        <span className={cn('flex min-w-0 items-start gap-1.5', textRowClass)}>
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className={cn(textClampClass, 'break-words')}>{status.text}</span>
        </span>
        {status.description !== null && (
          <span className="truncate text-xs leading-4 text-muted-foreground">{status.description}</span>
        )}
      </output>
      {status.action !== null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            status.action?.onClick();
            clearStatus();
          }}
        >
          {status.action.label}
        </Button>
      )}
      {isDismissable && (
        // `size-11` is the app's 44px tap floor. The text of a persisting error
        // opens nothing, tapping it is not a gesture, this button is the exit.
        <button
          type="button"
          aria-label={t('chrome.status.dismiss')}
          onClick={() => clearStatus()}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg"
        >
          <X className="size-4 opacity-70" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Renders `children` (the header's wordmark and page title) until there is
 * something to say, then renders that instead.
 *
 * Keyed by `status.id`, which is monotone per publish, so republishing the same
 * words restarts the row rather than leaving a half-faded one in place.
 *
 * It also REGISTERS ITSELF as a host for the lifetime of the mount. That is how
 * `components/status-fallback-host.tsx` knows whether a shell is already
 * carrying the message; see that file for the three tiers. The registration is
 * an effect, so it never runs during a server render, which is what makes the
 * fallback's server snapshot of zero the honest answer.
 */
export function HeaderStatus({ children }: { children: ReactNode }): ReactNode {
  useEffect(() => registerStatusHost(), []);
  const status = useStatus();
  if (status === null) return <>{children}</>;
  return <HeaderStatusRow key={status.id} status={status} />;
}
