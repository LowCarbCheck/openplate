/**
 * The sync operator's notice, shown as a dismissible banner (M181/07).
 *
 * ── What this channel is, and what it is not ──────────────────────────────
 *
 * The sync service holds no email addresses, so it has no way to write to
 * anybody: no breach notice, no "this instance is moving", no "your account
 * will be deleted". That cost is deliberate and is not undone here. This is a
 * PULL channel and nothing more: the operator sets `SYNC_NOTICE`, the service
 * publishes it on `GET /health`, and a client that connects reads it. A person
 * who opens the app sees the message. A person who has stopped opening the app
 * never will, and the server cannot know the difference. Anything that must
 * actually arrive belongs on a contact list the operator keeps themselves,
 * outside the service.
 *
 * ── The notice is hostile input ───────────────────────────────────────────
 *
 * It arrives from whatever server the user pointed this app at, which on a
 * self-hosted product is not necessarily the operator they believe it is. Two
 * rules follow, and both are load-bearing rather than defensive habit:
 *
 *  1. The text is rendered as TEXT. It goes through JSX as a child, never
 *     through `dangerouslySetInnerHTML`, so markup in it is markup the user
 *     reads and never markup the browser runs.
 *  2. A link is followed only when its scheme is on {@link NOTICE_LINK_SCHEMES}.
 *     `javascript:` and `data:` URLs are exactly what an attacker who controls
 *     a server would supply, and `noticeLinkHref` drops them — the banner then
 *     shows the message with no link rather than hiding the message.
 *
 * ── Dismissal is keyed to the notice, not to a boolean ────────────────────
 *
 * A remembered "dismissed" flag would silence the NEXT notice too, which is
 * the one nobody has read yet. So the dismissal stores a key derived from the
 * notice's own content ({@link noticeDismissKey}): change the message and the
 * banner comes back, leave it up for a month and it stays out of the way.
 */
import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OperatorNotice } from '#app/lib/sync/engine/protocol';
import { readServerNotice } from '#app/lib/sync/sync-actions';
import { deviceStorage, type KeyValueStorage } from '#app/lib/sync/sync-state';
import { cn } from '#app/lib/utils';

/**
 * The only URL schemes a server-supplied notice link may use.
 *
 * `https:` first because it is what every operator should publish; `http:` is
 * kept because a self-hosted instance on a home LAN legitimately has no
 * certificate. Everything else — `javascript:`, `data:`, `file:` — is dropped.
 */
export const NOTICE_LINK_SCHEMES: readonly string[] = ['https:', 'http:'];

/** Where the dismissal marker lives. Versioned so a future shape change starts clean rather than misreading an old value. */
export const DISMISSED_STORAGE_KEY = 'openplate.sync.notice-dismissed.v1';

/**
 * A short, stable key for one notice's CONTENT — the thing dismissal is
 * remembered against.
 *
 * djb2 over text and link together, so editing either brings the banner back.
 * It is a bucketing key and nothing more: it guards no secret, and a collision
 * costs one unseen banner, which is why a hash function this small is the
 * right tool and a `crypto.subtle` digest (async, secure-context-only) is not.
 */
export function noticeDismissKey(notice: OperatorNotice): string {
  const content = `${notice.text}\n${notice.url ?? ''}`;
  let hash = 5381;
  for (let index = 0; index < content.length; index += 1) {
    // `(hash << 5) + hash` is djb2's `* 33`, kept in 32-bit integer maths so
    // the value never drifts through a float and differs between two devices.
    hash = ((hash << 5) + hash) ^ content.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The link to render for a notice, or `null` when there is none to trust.
 *
 * Pure, and the one place the scheme rule is enforced. A relative or malformed
 * value throws inside `URL` and is dropped the same way a rejected scheme is:
 * the message still shows, the link does not.
 */
export function noticeLinkHref(url: string | undefined): string | null {
  if (url === undefined || url.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!NOTICE_LINK_SCHEMES.includes(parsed.protocol)) return null;
  return parsed.toString();
}

/**
 * Whether a notice is still worth showing, given what this device last
 * dismissed. Pure, and the whole dismissal rule in one place.
 *
 * A dismissal that does not match is a DIFFERENT notice, and a different
 * notice has never been read: it shows. That is the property a stored boolean
 * would quietly break, and it is the one worth a test of its own.
 */
export function shouldShowNotice({
  notice,
  dismissedKey,
}: {
  notice: OperatorNotice | null;
  /** What this device last dismissed, or `null` for "nothing yet", including a storage that could not be read. */
  dismissedKey: string | null;
}): boolean {
  if (notice === null) return false;
  return dismissedKey !== noticeDismissKey(notice);
}

/**
 * The banner itself: presentational, and given its notice rather than fetching
 * one, so it renders in a test with no network and no browser.
 *
 * Amber, like `OfflineBanner` and `BackupNudgeBanner` — an operator notice is
 * something to read, never an error to alarm about (DESIGN §10).
 */
export function SyncNoticeBanner({
  notice,
  storage,
  className,
}: {
  notice: OperatorNotice | null;
  /** Where dismissal is remembered. Defaults to the device's storage; a test passes its own. */
  storage?: KeyValueStorage;
  className?: string;
}) {
  const { t } = useTranslation();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // Read in an effect, never during render: `localStorage` does not exist
  // during SSR, and a first paint that differs from the server's would
  // hydrate-mismatch. Unread, the banner simply shows — which is the safe
  // direction for a message the operator wanted seen.
  useEffect(() => {
    const store = storage ?? deviceStorage();
    setDismissedKey(store.getItem(DISMISSED_STORAGE_KEY));
  }, [storage]);

  if (notice === null) return null;
  if (!shouldShowNotice({ notice, dismissedKey })) return null;
  const key = noticeDismissKey(notice);

  const href = noticeLinkHref(notice.url);

  const dismiss = (): void => {
    const store = storage ?? deviceStorage();
    store.setItem(DISMISSED_STORAGE_KEY, key);
    setDismissedKey(key);
  };

  return (
    <output
      className={cn(
        'flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface px-3 py-2 text-sm text-accent-amber',
        className,
      )}
    >
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {/* Text, as a JSX child. The server does not get to write markup. */}
        {notice.text}
        {href !== null && (
          <>
            {' '}
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:no-underline"
            >
              {t('sync.notice.readMore')}
            </a>
          </>
        )}
      </span>
      <button
        type="button"
        aria-label={t('sync.notice.dismiss')}
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 text-accent-amber/70 hover:text-accent-amber"
      >
        <X className="h-4 w-4" />
      </button>
    </output>
  );
}

/**
 * The banner wired to a server: reads the handshake once per server URL and
 * renders whatever came back.
 *
 * `readServerNotice` fails open and never rejects, so there is nothing here
 * for a catch to do — no notice IS the failure result, and a server that
 * cannot be reached must not turn a settings page into an error.
 */
export function ServerNoticeBanner({ serverUrl, className }: { serverUrl: string; className?: string }) {
  const [notice, setNotice] = useState<OperatorNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ask = async (): Promise<void> => {
      const found = await readServerNotice(serverUrl);
      if (!cancelled) setNotice(found);
    };
    void ask();
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  return <SyncNoticeBanner notice={notice} className={className} />;
}
