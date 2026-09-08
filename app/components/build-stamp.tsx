/**
 * "Which build am I looking at?", in the two places a person can always see.
 *
 * The version used to live on `/settings/about` only, which is exactly where
 * somebody filing a bug report does not think to look. A stamp in the sidebar
 * footer and in the public footer makes the answer readable without navigating,
 * and links to `/settings/about` for the rest of the story.
 *
 * ── SPLIT IN TWO ON PURPOSE ─────────────────────────────────────────────────
 *
 * `BuildStamp` is presentational and takes everything as props, so a test can
 * render it. `AppBuildStamp` is the container that reads the update store; a hook
 * driven by `useSyncExternalStore` always takes the server snapshot under
 * `renderToStaticMarkup`, so a single component would be untestable in the half
 * that matters.
 *
 * ── THE DOT NEVER SPEAKS ALONE ──────────────────────────────────────────────
 *
 * The update marker is a dot AND the word "Update". A dot on its own would carry
 * the whole meaning in colour and position, which is unreadable to anyone who
 * cannot see either.
 */
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import { BUILD, formatBuildLabel } from '#app/lib/build-info';
import { useUpdateStatus } from '#app/hooks/use-update-status';
import { cn } from '#app/lib/utils';

export function BuildStamp({
  label,
  hasUpdate,
  className,
}: {
  /** The stamp itself, e.g. `v0.18.3 · 586caeb`. */
  label: string;
  /** Whether to append the update marker. Always false in the public footer. */
  hasUpdate: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Link
      to="/settings/about"
      aria-label={t('chrome.buildStamp', { label })}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      {/* Tabular figures: this is a version string, not prose. */}
      <span className="tabular-nums">{label}</span>
      {hasUpdate && (
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          {t('chrome.update.badge')}
        </span>
      )}
    </Link>
  );
}

/** The stamp inside the personal app, where an update marker is meaningful. */
export function AppBuildStamp({ className }: { className?: string }) {
  const { ribbon } = useUpdateStatus();

  return <BuildStamp label={formatBuildLabel(BUILD)} hasUpdate={ribbon !== 'none'} className={className} />;
}
