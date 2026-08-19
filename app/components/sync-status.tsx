import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import {
  getServerSyncSessionSnapshot,
  getSyncSessionSnapshot,
  subscribeSyncSession,
  type SyncSessionSnapshot,
} from '#app/lib/sync/sync-session';

/**
 * The sync status line: when it last synced, whether anything is waiting, and
 * what went wrong if something did.
 *
 * TONE (DESIGN.md §10): amber, never alarmist. Every failure state here is
 * recoverable and none of them lose data — the diary is on the device either
 * way, and sync being behind is an inconvenience, not an emergency. Red is
 * reserved for things that actually are one. "Couldn't reach the sync server"
 * with a retry button is the right register; a red banner shouting about a
 * failure is not, and it teaches people to ignore the next one.
 *
 * Reads through `useSyncExternalStore` rather than context because the session
 * lives outside React (`sync-session.ts` — key material must never sit in
 * React state) and is mutated by boot/`online`/debounce callers that have no
 * component to dispatch from.
 */
export function useSyncSession(): SyncSessionSnapshot {
  return useSyncExternalStore(subscribeSyncSession, getSyncSessionSnapshot, getServerSyncSessionSnapshot);
}

/** Formats "last synced" in the visitor's own locale, or the never-synced line. */
function useLastSyncedLabel(lastSyncedAt: number | null): string {
  const { t, i18n } = useTranslation();
  if (lastSyncedAt === null) return t('sync.status.never');
  const formatted = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(lastSyncedAt));
  return t('sync.status.lastSynced', { when: formatted });
}

export function SyncStatus({ onSyncNow }: { onSyncNow: () => void }) {
  const { t } = useTranslation();
  const session = useSyncSession();
  const lastSynced = useLastSyncedLabel(session.lastSyncedAt);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {session.phase === 'syncing' && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />}
          {session.phase === 'idle' && session.error === null && !session.hasPendingChanges && (
            <Check className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          {session.phase === 'idle' && session.hasPendingChanges && session.error === null && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent-amber" aria-hidden="true" />
          )}
          <span className="text-muted-foreground" aria-live="polite">
            {session.phase === 'syncing' ?
              t('sync.status.syncing')
            : session.hasPendingChanges ?
              t('sync.status.pending')
            : lastSynced}
          </span>
        </div>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={session.phase === 'syncing'}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t('sync.status.syncNow')}
        </button>
      </div>

      {session.error !== null && (
        <output className="flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface p-3 text-sm text-accent-amber">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{t(`sync.status.error.${session.error.reason}`)}</p>
            {/* The service's own words underneath the reassurance, so a
                self-hoster debugging their instance has something to go on. */}
            <p className="text-xs opacity-80">{session.error.message}</p>
          </div>
        </output>
      )}
    </div>
  );
}
