/**
 * ONE LINE ON THE ENROLMENTS SCREEN: which days this device has actually sent
 * to a study (M163/01).
 *
 * It is a component rather than a ternary inside `settings.research.tsx`
 * because the decision it makes is the one thing on that screen a test has to
 * be able to falsify. `null` means "nothing has been sent to this study yet"
 * and must render as the granularity sentence M161/05 shipped — never as an
 * empty range, and never as a defaulted today. A screen that names days which
 * were never sent is worse than one that names none, and the copy is the last
 * place that promise can be broken after `research/contribute.ts` has kept it.
 *
 * The dates are printed as the raw `YYYY-MM-DD` day keys, matching
 * `research.export.window`'s convention in the researcher's own export. A
 * `new Date('2026-08-24').toLocaleDateString()` would render the PREVIOUS day
 * west of UTC — a day key is a calendar day, not an instant.
 */
import { useTranslation } from 'react-i18next';

import type { LocalSubmittedWindow } from '#app/lib/local-store';

export function ResearchWindowLine({ lastSubmission }: { lastSubmission: LocalSubmittedWindow | null }) {
  const { t } = useTranslation();

  // The guard is first and it is total: there is no third state, and no
  // fallback that could invent one.
  if (lastSubmission === null) return <p>{t('research.enrolments.window')}</p>;

  return <p>{t('research.enrolments.sentWindow', { from: lastSubmission.fromDayKey, to: lastSubmission.toDayKey })}</p>;
}
