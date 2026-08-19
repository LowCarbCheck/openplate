import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '#app/lib/service-worker';
import { cn } from '#app/lib/utils';

/**
 * Unobtrusive "you're offline" strip. Renders nothing while online. Uses the
 * amber (never destructive red — DESIGN §10) tone, because being offline is a
 * state to acknowledge, not an error to alarm about. Reused across the diary,
 * add, and scan surfaces.
 */
export function OfflineBanner({ message, className }: { message?: string; className?: string }) {
  const isOnline = useOnlineStatus();
  const { t } = useTranslation();
  if (isOnline) return null;

  return (
    <output
      className={cn(
        'flex items-center gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface px-3 py-2 text-sm text-accent-amber',
        className,
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      {/* Callers that pass a surface-specific `message` own translating it —
          this default is the only copy this component itself owns. */}
      <span>{message ?? t('banners.offlineDefault')}</span>
    </output>
  );
}
