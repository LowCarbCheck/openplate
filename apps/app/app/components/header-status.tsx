import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '#app/lib/utils';
import {
  clearStatus,
  registerStatusHost,
  useStatus,
  type StatusAction,
  type StatusMessage,
  type StatusTone,
} from '#app/lib/status';

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
 * the bottom nav and its raised button below, the device menu and the brand
 * mark above.
 *
 * THE HEADER NEVER MOVES. This component swaps `children` for the status row
 * inside the same box. An error persists until dismissed, so its text wraps
 * instead of truncating to an unreadable one: `text-sm line-clamp-2` for
 * every other tone, but an ERROR drops to `text-xs font-semibold leading-4
 * line-clamp-3` so a long sentence, in German especially, fits whole rather
 * than clipping after two lines of the larger size (M225 follow-up). Three
 * lines at `leading-4` (16px) is 48px.
 *
 * FOUR LINES AT MOST, AND THEY FIT THE BOX. The header is `min-h-16` with a
 * 1px bottom border, so its content box is 63px. A compact status that also
 * carries a description (the trial countdown near its end, with its recap
 * line) draws two lines of each at `leading-tight` (15px): 30 + 1 + 30 is
 * 61px. The `AvatarMenu` and the brand mark are siblings of this component
 * rather than children of it, so neither shifts by a pixel.
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
 * The sentence line's size and line height.
 *
 * @param input.isCompact - an error or a status with an action, which drops to `text-xs`.
 * @param input.hasFourLines - a compact status that also carries a description, which shares four lines.
 */
function compactTextRowClass({ isCompact, hasFourLines }: { isCompact: boolean; hasFourLines: boolean }): string {
  if (!isCompact) return 'text-sm font-semibold';
  return hasFourLines ? 'text-xs font-semibold leading-tight' : 'text-xs font-semibold leading-4';
}

/**
 * The action's words and its tap area.
 *
 * THE LABEL IS THE LAST WORDS OF THE SENTENCE, NOT A BUTTON BESIDE IT (the
 * buyer walk, 2026-09-28). A bordered button beside the text took its width
 * out of the sentence: at 390 px the German "Tarife ansehen" plus the close
 * control left the countdown about 40 px, and it read "Noch 10 kost…". The
 * French "Voir les forfaits" would have left less. Drawn inline, the label
 * costs its own words and nothing more, and the sentence keeps the whole
 * column.
 *
 * THE TAP AREA IS THE WHOLE COLUMN. The label is a line of `text-xs`, far
 * under the 44 px floor, so its `after:` box is stretched over the text
 * column (`relative`, as tall as the row's `min-h-11`): a finger anywhere on
 * the sentence takes the action, and the close control beside the column
 * stays its own target. The accessible name is the label alone.
 */
function StatusActionLabel({ action }: { action: StatusAction }): ReactNode {
  return (
    <button
      type="button"
      data-slot="header-status-action"
      onClick={() => {
        action.onClick();
        clearStatus();
      }}
      className="cursor-pointer whitespace-nowrap underline underline-offset-2 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
    >
      {action.label}
    </button>
  );
}

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
  //
  // A status WITH AN ACTION gets the same compact treatment (M230): the
  // action's words and the dismiss control take width from the sentence, and
  // the German "{{name}} entfernt." beside "Rückgängig" needed a third line
  // at 390px, which `line-clamp-2` cut. The browser tier walks that delete in
  // every language (`tests/e2e/header-status.spec.ts`), and the trial
  // countdown in the three longest (`tests/e2e/trial-countdown.spec.ts`).
  const isCompact = isError || status.action !== null;
  // A COMPACT STATUS WITH A SECOND LINE SHARES FOUR LINES (M265/08). The
  // recap line under the trial countdown used to be one `truncate` line, and
  // at 390 px it ended in an ellipsis in every language, English included:
  // the status face is Victor Mono, a flat 7.2px a character at `text-xs`, so
  // the 208px column holds 28 of them. It now wraps to a second line, and all
  // four lines drop to `leading-tight` so they fit the header's box (the file
  // comment has the sum). `tests/e2e/trial-recap-line-fits.spec.ts` writes
  // every day sentence and recap of all six languages into that row.
  const hasFourLines = isCompact && hasDescription;
  const textRowClass = compactTextRowClass({ isCompact, hasFourLines });
  const textClampClass = isCompact && !hasDescription ? 'line-clamp-3' : 'line-clamp-2';
  const descriptionClass =
    hasFourLines ?
      'line-clamp-2 text-balance break-words text-xs leading-tight text-muted-foreground'
    : 'truncate text-xs leading-4 text-muted-foreground';

  return (
    <div
      data-slot="header-status"
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 opacity-100 transition-opacity duration-150 motion-reduce:transition-none"
    >
      {/* THE TEXT COLUMN. `relative` and `self-stretch` only matter when the
          status carries an action: that is the box the action's tap area
          fills, as tall as the row (see `StatusActionLabel`). */}
      <div className={cn('relative flex min-w-0 flex-1 flex-col justify-center self-stretch', TONE_CLASS[status.tone])}>
        {/* `<output>` carries an implicit ARIA role of "status", which is the
            polite live region this needs. A `role` or an `aria-live` beside it
            would be a second, redundant declaration of the same thing. */}
        <output className="flex min-w-0 flex-col justify-center gap-px">
          {/* `items-start`, not `items-center`: the text below can wrap to a
              second or third line, and the icon sits on the first line rather
              than centering across all of them. `line-clamp-2`/`line-clamp-3`
              plus `break-words` replaces `truncate` here (M225): an error stays
              on screen until dismissed, so cutting it to one line with an
              ellipsis made it unreadable. The description below keeps
              `truncate` beside a full-size sentence, where two lines of
              `text-sm` leave it one; beside a compact one it wraps to two
              (M265/08, see `hasFourLines`).

              `text-balance` is the mobile audit's fix for the orphan: at 390 px
              "That's seven days logged in a row." broke after "in a" and left
              "row." alone on the second line, and German did the same with
              "Folge.". Balancing evens the two lines out instead. It changes no
              copy and adds no line: a sentence that already fits stays on one. */}
          <span className={cn('flex min-w-0 items-start gap-1.5', textRowClass)}>
            {/* NO TONE ICON BESIDE AN ACTION. Its 22 px are a ninth of the
                208 px column at 390 px, and the sentence with its action needs
                them: with the icon, the German, French and Turkish scan counts
                plus their labels took a third line in the two lines a recap
                line leaves them (measured, 2026-09-28). The tone stays in the
                colour, and the underlined label says there is something to do. */}
            {status.action === null && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span data-slot="header-status-text" className={cn(textClampClass, 'text-balance break-words')}>
              <span data-slot="header-status-sentence">{status.text}</span>
              {status.action !== null && (
                <>
                  {' '}
                  <StatusActionLabel action={status.action} />
                </>
              )}
            </span>
          </span>
          {status.description !== null && (
            <span data-slot="header-status-description" className={descriptionClass}>
              {status.description}
            </span>
          )}
        </output>
      </div>
      {isDismissable && (
        // `size-11` is the app's 44px tap floor. The text of a persisting error
        // opens nothing, tapping it is not a gesture, this button is the exit.
        <button
          type="button"
          aria-label={t('chrome.status.dismiss')}
          onClick={() => {
            // THE CLOSE IS REPORTED BEFORE IT HAPPENS, so a caller that
            // records it (the trial countdown, closed for the day) has
            // recorded it by the time the channel is empty.
            status.onDismiss?.();
            clearStatus();
          }}
          className="flex size-11 shrink-0 items-center justify-center"
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
