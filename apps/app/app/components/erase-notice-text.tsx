/**
 * One sentence about what an erase would lose, rendered from one
 * `EraseNoticeLine` (`app/lib/sync/erase-notice.ts`).
 *
 * SHARED by every screen that asks before an erase: the sign-out dialog
 * (`sign-out-dialog-body.tsx`) and the account-switch step (ADR-0022) both
 * render their lines here, so a sentence is wired to its string in one place.
 * `tests/unit/erase-notice-text-source.test.ts` fails on a second definition.
 *
 * Each line is one named string and carries its kind in `data-erase-line`, so
 * a browser check reads which sentence was said without pinning its words. A
 * count is interpolated only into a line that exists because the count is not
 * zero (`erase-notice.ts`, "Empty is a sentence, not a zero").
 */
import { useTranslation } from 'react-i18next';

import type { EraseNoticeLine } from '#app/lib/sync/erase-notice';

/** Renders one erase-notice line as its sentence. */
export function EraseNoticeText({ line }: { line: EraseNoticeLine }) {
  const { t } = useTranslation();
  if (line.kind === 'checking') return <span data-erase-line={line.kind}>{t('signOut.unsent.checking')}</span>;
  if (line.kind === 'unchecked') return <span data-erase-line={line.kind}>{t('signOut.unsent.unchecked')}</span>;
  if (line.kind === 'all-sent') return <span data-erase-line={line.kind}>{t('signOut.unsent.allSent')}</span>;
  // TWO LINES SINCE M240/03, where one blanket sentence used to stand. Each
  // says one true thing, and `resolveEraseNotice` pushes each only when it is
  // true, so a person is never warned about saved meals the account already
  // holds.
  if (line.kind === 'saved-meals-unsent') {
    return <span data-erase-line={line.kind}>{t('signOut.unsent.savedMealsUnsent')}</span>;
  }
  if (line.kind === 'keys-not-covered') {
    return <span data-erase-line={line.kind}>{t('signOut.unsent.keysNotCovered')}</span>;
  }
  if (line.kind === 'unsent-changes') {
    return (
      <span data-erase-line={line.kind} data-count={line.count}>
        {t('signOut.unsent.changes', { count: line.count })}
      </span>
    );
  }
  return (
    <span data-erase-line={line.kind} data-count={line.count}>
      {t('signOut.unsent.reports', { count: line.count })}
    </span>
  );
}
