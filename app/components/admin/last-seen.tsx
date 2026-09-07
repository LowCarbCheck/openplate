/**
 * "When did this person last do something", in one place.
 *
 * ── An account that never signed in gets WORDS ───────────────────────────
 *
 * `lastSeenAt` is null for somebody who was invited and has not arrived yet,
 * and that is a real and common state on a managed instance. `new Date(null)`
 * is the first of January 1970, and a dash says nothing at all, so both the
 * list and the detail render a sentence instead. It is one rule and it lives
 * here rather than at the two call sites, because the second call site is where
 * that kind of rule gets forgotten.
 *
 * The service sends a timestamp and the formatting happens here, against the
 * reader's own locale (`PROTOCOL.md` §5.20).
 */
import { useTranslation } from 'react-i18next';

export function LastSeenValue({ lastSeenAt }: { lastSeenAt: string | null }) {
  const { t } = useTranslation();
  if (lastSeenAt === null) return <>{t('admin.lastSeen.never')}</>;
  return <>{new Date(lastSeenAt).toLocaleDateString()}</>;
}
