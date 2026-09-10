import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { shouldPromptStatusUpdate } from '#app/lib/reproductive-status-nudge';
import type { ShouldPromptStatusUpdateInput } from '#app/lib/reproductive-status-nudge';
import { cn } from '#app/lib/utils';

/**
 * The props this banner needs to decide and render for itself. `Pick`ed off
 * {@link ShouldPromptStatusUpdateInput} rather than re-typed here, so the
 * prop shape and the decision function's input can never drift apart.
 */
type ReproductiveStatusPromptBannerProps = Pick<
  ShouldPromptStatusUpdateInput,
  'reproductiveStatus' | 'dueDate' | 'lactationStartDate' | 'today'
> & {
  className?: string;
};

/**
 * Dismissible, non-blocking prompt asking whether a stale pregnancy or
 * lactation status is still current (M206/04). Same shape as
 * `BackupNudgeBanner`: session-local `useState` dismiss (component state
 * only, no persistence, dismissing hides it for the rest of this session and
 * it reappears on the next load if the underlying condition is still true),
 * amber non-alarming tone, one `Link` out.
 *
 * THE APP NEVER FLIPS THE STATUS ITSELF. This banner calls
 * `shouldPromptStatusUpdate` and renders a question with a link to
 * `/settings/life-phase`, it has no write path of any kind. Only a person, on
 * that settings page, can change `reproductiveStatus`, `pregnancyDueDate` or
 * `lactationStartDate`; see `#app/lib/reproductive-status-nudge` for the full
 * rationale.
 *
 * Phrased as a question in both locales ("Still pregnant, or time to update
 * your settings?"), never as an assertion about the person's body (the M135
 * rule this feature inherits), the copy lives under
 * `banners.reproductiveStatusPrompt*` in both locale catalogs.
 */
export function ReproductiveStatusPromptBanner({
  reproductiveStatus,
  dueDate,
  lactationStartDate,
  today,
  className,
}: ReproductiveStatusPromptBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const { t } = useTranslation();
  if (isDismissed) return null;
  if (!shouldPromptStatusUpdate({ reproductiveStatus, dueDate, lactationStartDate, today })) return null;

  const message =
    reproductiveStatus === 'pregnant' ?
      t('banners.reproductiveStatusPromptDueDate')
    : t('banners.reproductiveStatusPromptLactation');

  return (
    <output
      className={cn(
        'flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface px-3 py-2 text-sm text-accent-amber',
        className,
      )}
    >
      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {message}{' '}
        <Link to="/settings/life-phase" className="underline underline-offset-2 hover:no-underline">
          {t('banners.reproductiveStatusPromptUpdate')}
        </Link>
      </span>
      <button
        type="button"
        aria-label={t('banners.reproductiveStatusPromptDismiss')}
        onClick={() => setIsDismissed(true)}
        className="shrink-0 rounded p-0.5 text-accent-amber/70 hover:text-accent-amber"
      >
        <X className="h-4 w-4" />
      </button>
    </output>
  );
}
