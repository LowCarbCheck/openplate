/**
 * "Import from YAZIO" on "Data & backup" (M254/02).
 *
 * Pick the two files the open-source yazio-exporter tool writes, and its
 * optional weight.json (M254/06), read a preview, confirm. Reading and sorting happen in `#app/lib/yazio-import`,
 * which is pure; this component only reads the files, keeps the parsed result
 * in state and writes it on confirm. Nothing reaches the store before then.
 *
 * NO LAYOUT SHIFT ABOVE THE BUTTON. The error line and the preview render
 * below the pick button, only after the person picked, which is an expansion
 * they asked for. Every line of the preview, the weigh-in rows included, is
 * known before the preview's first paint (`readPick` finishes every read
 * first), so nothing inside it arrives late and pushes its neighbours.
 * Success and write failure go through `publishStatus`, never as a new line
 * here.
 */
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Upload } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { numberLocale } from '#app/i18n/date-locale';
import { YAZIO_IMPORT_DOCS_URL } from '#app/lib/brand';
import { formatContentDate } from '#app/lib/content/format-content-date';
import { formatMeasureIn } from '#app/lib/format-macro-number';
import {
  getLocalProfileGoals,
  listLocalFoodLogsInRange,
  listLocalWeightEntries,
  putLocalFoodLog,
  putLocalWeightEntry,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import { trackYazioImported } from '#app/lib/matomo-events';
import { publishStatus } from '#app/lib/status';
import {
  YAZIO_SKIP_REASONS,
  countDaysAlreadyLogged,
  parseYazioExport,
  planYazioWeighIns,
  sortYazioFiles,
  type YazioImport,
  type YazioWeighInPlan,
  type YazioPickError,
  type YazioSkipReason,
} from '#app/lib/yazio-import';

/** The id this section carries, so a link can land on it by hash. `tests/e2e/yazio-import.spec.ts` names it too. */
const YAZIO_IMPORT_ANCHOR = 'import-yazio';

type SectionState =
  | { kind: 'idle' }
  | { kind: 'error'; error: YazioPickError }
  | { kind: 'preview'; preview: Preview }
  | { kind: 'writing'; preview: Preview };

/**
 * What the preview shows: the parsed import, how many of its days the diary
 * already holds entries on, and the weigh-ins it would write (null when no
 * weight.json was picked).
 */
interface Preview {
  result: YazioImport;
  overlapDays: number;
  weighInPlan: YazioWeighInPlan | null;
}

const ERROR_KEYS = {
  unreadable: 'settings.data.yazio.error.unreadable',
  unrecognised: 'settings.data.yazio.error.unrecognised',
  duplicate: 'settings.data.yazio.error.duplicate',
  'missing-days': 'settings.data.yazio.error.missingDays',
  'missing-products': 'settings.data.yazio.error.missingProducts',
} as const satisfies Record<YazioPickError, string>;

const SKIP_KEYS = {
  'missing-product': 'settings.data.yazio.skipped.missingProduct',
  'missing-recipe': 'settings.data.yazio.skipped.missingRecipe',
  'recipe-without-weight': 'settings.data.yazio.skipped.recipeWithoutWeight',
  'quick-entry': 'settings.data.yazio.skipped.quickEntry',
  'invalid-item': 'settings.data.yazio.skipped.invalidItem',
} as const satisfies Record<YazioSkipReason, string>;

/**
 * Reads, sorts and parses one pick. Any failure below the file sort, a file
 * the browser cannot read or an export the parser refuses, reads as an
 * unreadable pick: the person's next step is the same.
 */
async function readPick(files: readonly File[]): Promise<SectionState> {
  try {
    const pick = sortYazioFiles({ texts: await Promise.all(files.map((file) => file.text())) });
    if (pick.kind === 'error') return { kind: 'error', error: pick.error };
    const timeZone = resolveLocalTimezone(await getLocalProfileGoals());
    const result = parseYazioExport({
      days: pick.days,
      products: pick.products,
      weight: pick.weight,
      timeZone,
      now: Date.now(),
    });
    const [overlapDays, weighInPlan] = await Promise.all([countOverlapDays(result), planWeighIns(result)]);
    return { kind: 'preview', preview: { result, overlapDays, weighInPlan } };
  } catch {
    return { kind: 'error', error: 'unreadable' };
  }
}

/**
 * How many of the import's days already hold an entry of the person's own.
 * Reads the diary for the import's day range only, and not at all when there
 * is nothing to import.
 */
async function countOverlapDays(result: YazioImport): Promise<number> {
  const { firstDay, lastDay } = result.report;
  if (firstDay === null || lastDay === null) return 0;
  const existingLogs = await listLocalFoodLogsInRange({ fromDate: firstDay, toDate: lastDay });
  return countDaysAlreadyLogged({ importDayKeys: result.entries.map((entry) => entry.dayKey), existingLogs });
}

/**
 * The weigh-ins the import would write, against the weight log as it stands
 * now. Called for the preview AND again on confirm, so a weigh-in the person
 * logged in between is still never overwritten.
 */
async function planWeighIns(result: YazioImport): Promise<YazioWeighInPlan | null> {
  if (result.weight === null) return null;
  return planYazioWeighIns({ weighIns: result.weight.weighIns, existingEntries: await listLocalWeightEntries() });
}

/** Whether a preview has anything to write, a diary entry or a weigh-in. */
function hasAnythingToWrite(preview: Preview): boolean {
  return preview.result.entries.length > 0 || (preview.weighInPlan?.weighIns.length ?? 0) > 0;
}

/**
 * The status line after a write: the entries sentence, then the weigh-ins
 * sentence when any landed. With no entries and only weigh-ins, the weigh-ins
 * sentence alone.
 */
function successText({
  t,
  entryCount,
  weighInCount,
}: {
  t: (key: string, options: { count: number }) => string;
  entryCount: number;
  weighInCount: number;
}): string {
  const entries = t('settings.data.yazio.success', { count: entryCount });
  if (weighInCount === 0) return entries;
  const weighIns = t('settings.data.yazio.successWeighIns', { count: weighInCount });
  return entryCount === 0 ? weighIns : `${entries} ${weighIns}`;
}

export function YazioImportSection() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SectionState>({ kind: 'idle' });
  const isWriting = state.kind === 'writing';

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = [...(event.target.files ?? [])];
    event.target.value = ''; // the same two files may be picked again
    if (files.length === 0) return;
    setState(await readPick(files));
  }

  async function handleConfirm(preview: Preview): Promise<void> {
    const { result } = preview;
    setState({ kind: 'writing', preview });
    let weighInCount = 0;
    try {
      // `restore`, like a backup import: these are old meals, not meals eaten now,
      // so the community pulse must not hear about them.
      for (const entry of result.entries) await putLocalFoodLog(entry, { origin: 'restore' });
      // A direct put with the import's own id, never the day upsert, which mints a random one.
      const weighIns = (await planWeighIns(result))?.weighIns ?? [];
      for (const entry of weighIns) await putLocalWeightEntry(entry);
      weighInCount = weighIns.length;
    } catch {
      publishStatus({ text: t('settings.data.yazio.writeError'), tone: 'error' });
      setState({ kind: 'preview', preview });
      return;
    }
    trackYazioImported();
    publishStatus({ text: successText({ t, entryCount: result.entries.length, weighInCount }), tone: 'success' });
    setState({ kind: 'idle' });
  }

  // `scroll-mt-20`: the pinned app header (see `app-wrapper.tsx`) would
  // otherwise cover the heading when the guide links here by hash.
  return (
    <div id={YAZIO_IMPORT_ANCHOR} className="scroll-mt-20 space-y-2 border-t pt-4">
      <p className="text-sm font-medium">{t('settings.data.yazio.heading')}</p>
      <p className="text-xs text-muted-foreground">{t('settings.data.yazio.description')}</p>
      <p className="text-xs">
        <a
          href={YAZIO_IMPORT_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-slot="yazio-guide-link"
          className="text-primary underline underline-offset-4"
        >
          {t('settings.data.yazio.guideLink')}
          <ExternalLink className="ml-1 inline h-3 w-3 align-baseline" aria-hidden="true" />
        </a>
      </p>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-slot="yazio-file-input"
        onChange={(event) => void handleFileChange(event)}
      />
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center sm:h-10 sm:w-auto"
        disabled={isWriting}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload />
        {t('settings.data.yazio.pickButton')}
      </Button>
      {state.kind === 'error' && (
        <p role="alert" data-slot="yazio-error" className="text-xs text-destructive">
          {t(ERROR_KEYS[state.error])}
        </p>
      )}
      {(state.kind === 'preview' || state.kind === 'writing') && (
        <YazioPreview
          preview={state.preview}
          isWriting={isWriting}
          onConfirm={() => void handleConfirm(state.preview)}
          onCancel={() => setState({ kind: 'idle' })}
        />
      )}
    </div>
  );
}

function YazioPreview({
  preview,
  isWriting,
  onConfirm,
  onCancel,
}: {
  preview: Preview;
  isWriting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { report } = preview.result;
  const formatCount = (count: number): string => count.toLocaleString(numberLocale(i18n.language));
  const formatDay = (isoDate: string): string => formatContentDate({ isoDate, language: i18n.language });
  const skippedReasons = YAZIO_SKIP_REASONS.filter((reason) => report.skipped[reason] > 0);
  const { weighInPlan } = preview;
  const weightSkippedCount = preview.result.weight?.skippedCount ?? 0;
  const formatKg = (kg: number): string => formatMeasureIn(i18n.language, kg, 'kg');

  return (
    <div data-slot="yazio-preview" className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('settings.data.yazio.preview.entries')}</dt>
        <dd data-slot="yazio-entry-count" className="tabular-nums">
          {formatCount(report.entryCount)}
        </dd>
        <dt className="text-muted-foreground">{t('settings.data.yazio.preview.days')}</dt>
        <dd data-slot="yazio-day-count" className="tabular-nums">
          {formatCount(report.dayCount)}
        </dd>
        {report.firstDay !== null && report.lastDay !== null && (
          <>
            <dt className="text-muted-foreground">{t('settings.data.yazio.preview.firstDay')}</dt>
            <dd data-slot="yazio-first-day">{formatDay(report.firstDay)}</dd>
            <dt className="text-muted-foreground">{t('settings.data.yazio.preview.lastDay')}</dt>
            <dd data-slot="yazio-last-day">{formatDay(report.lastDay)}</dd>
          </>
        )}
        {weighInPlan !== null && (
          <>
            <dt className="text-muted-foreground">{t('settings.data.yazio.preview.weighIns')}</dt>
            <dd data-slot="yazio-weigh-in-count" className="tabular-nums">
              {formatCount(weighInPlan.weighIns.length)}
            </dd>
          </>
        )}
        {weighInPlan !== null && weighInPlan.firstKg !== null && weighInPlan.lastKg !== null && (
          <>
            <dt className="text-muted-foreground">{t('settings.data.yazio.preview.weightRange')}</dt>
            <dd data-slot="yazio-weight-range" className="tabular-nums">
              {t('settings.data.yazio.preview.weightRangeValue', {
                first: formatKg(weighInPlan.firstKg),
                last: formatKg(weighInPlan.lastKg),
              })}
            </dd>
          </>
        )}
      </dl>
      {preview.overlapDays > 0 && (
        <p data-slot="yazio-overlap" className="text-xs text-muted-foreground">
          {t('settings.data.yazio.overlap', { count: preview.overlapDays })}
        </p>
      )}
      {skippedReasons.map((reason) => (
        <p key={reason} data-slot="yazio-skipped" data-reason={reason} className="text-xs text-muted-foreground">
          {t(SKIP_KEYS[reason], { count: report.skipped[reason] })}
        </p>
      ))}
      {weightSkippedCount > 0 && (
        <p data-slot="yazio-weight-skipped" className="text-xs text-muted-foreground">
          {t('settings.data.yazio.skipped.implausibleWeight', { count: weightSkippedCount })}
        </p>
      )}
      {weighInPlan !== null && weighInPlan.alreadyLoggedDays > 0 && (
        <p data-slot="yazio-weight-already-logged" className="text-xs text-muted-foreground">
          {t('settings.data.yazio.skipped.weightAlreadyLogged', { count: weighInPlan.alreadyLoggedDays })}
        </p>
      )}
      {!hasAnythingToWrite(preview) && (
        <p data-slot="yazio-nothing" className="text-sm">
          {t('settings.data.yazio.preview.nothing')}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {hasAnythingToWrite(preview) && (
          <Button
            type="button"
            className="h-11 w-full justify-center sm:h-10 sm:w-auto"
            disabled={isWriting}
            data-slot="yazio-confirm"
            onClick={onConfirm}
          >
            {isWriting ? t('settings.data.importing') : t('settings.data.yazio.confirm')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-center sm:h-10 sm:w-auto"
          disabled={isWriting}
          data-slot="yazio-cancel"
          onClick={onCancel}
        >
          {t('settings.data.yazio.cancel')}
        </Button>
      </div>
    </div>
  );
}
