/**
 * THE COHORT, as the console shows it (M163/03).
 *
 * ── The lines are the export's own ───────────────────────────────────────
 *
 * Every sentence here comes from `buildExportHeaderLines`, through
 * `cohortSummaryLines`, verbatim. This component authors NO copy about the
 * cohort: a second on-screen wording would be a second wording to get wrong,
 * and the one that has to survive is the one written into the file.
 *
 * ── The register is data, and only the tone is this component's job ──────
 *
 * `research/study-console-view.ts` decides which line is information, which is
 * a bug report and which is addressed to the operator. This component turns
 * those three into three classes and nothing else. The un-openable count is
 * INFORMATION — "4 of 31 are sealed to a key this device does not hold" is the
 * normal state after a rotation, and styling it as a failure would teach a
 * researcher that a working console is broken. `--destructive` is reserved for
 * `malformedCount`, which really is a bug report.
 */
import { useTranslation } from 'react-i18next';
import { Download, Users } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { CohortLineTone, CohortSummaryLine } from '#app/lib/sync/research/study-console-view';

/**
 * One class per register. `satisfies` so a fourth tone cannot be added without
 * a decision here, and the palette tops out at amber for the operator warning
 * — DESIGN §10 keeps `--destructive` for the one line that is a defect.
 */
const TONE_CLASS = {
  information: 'text-muted-foreground',
  bug: 'text-destructive',
  'operator-warning': 'text-accent-amber',
} as const satisfies Record<CohortLineTone, string>;

export function StudyCohortPanel({
  lines,
  participantCount,
  onExport,
}: {
  /** From `cohortSummaryLines` — the export header, paired with its registers. */
  lines: CohortSummaryLine[];
  participantCount: number;
  onExport: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" aria-hidden="true" /> {t('research.console.cohort.summaryTitle')}
        </CardTitle>
        <CardDescription>{t('research.console.cohort.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {lines.map((line) => (
            <li
              key={line.id}
              data-cohort-line={line.id}
              data-cohort-tone={line.tone}
              className={`text-sm ${TONE_CLASS[line.tone]}`}
            >
              {line.text}
            </li>
          ))}
        </ul>

        {participantCount === 0 && (
          <p className="text-sm text-muted-foreground">{t('research.console.cohort.empty')}</p>
        )}

        <div className="space-y-2">
          <Button type="button" variant="outline" className="h-11 w-full" onClick={onExport}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('research.console.cohort.export')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('research.console.cohort.exportHint')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
