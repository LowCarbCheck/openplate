import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { fromKg, type WeightUnit } from '#app/lib/weight-units';
import { ConfirmAction } from '#app/components/confirm-action';
import { Button } from '#app/components/ui/button';

/** One weigh-in row rendered in the recent-entries list. */
export interface WeightEntryRow {
  /** Opaque row id — a local-store client id (M117/03), not a numeric server id. */
  id: string;
  /** Calendar day, `YYYY-MM-DD`. */
  measuredAt: string;
  weightKg: number;
}

interface WeightEntryListProps {
  entries: WeightEntryRow[];
  /** `_intent` value posted to the route action for a delete. */
  deleteIntent: string;
  /** Unit each row's weight is displayed in — stored data (and the delete action) stay kg-keyed either way. */
  weightUnit: WeightUnit;
}

/**
 * Formatter for the `YYYY-MM-DD` day label — read in UTC so the date never
 * shifts. Built per active language: a German UI writing "Jul 13, 2026" is the
 * same bug as an untranslated string, just one `t()` can't catch.
 */
function dayLabelFormat(language: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(language, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Recent weigh-ins, newest first, each with a confirm-guarded delete
 * (DESIGN.md §7 — no `window.confirm`). Presentational: it renders loader data
 * and posts deletes to the owning route's action via `ConfirmAction`.
 */
export function WeightEntryList({ entries, deleteIntent, weightUnit }: WeightEntryListProps) {
  const { t, i18n } = useTranslation();
  const dayFormat = useMemo(() => dayLabelFormat(i18n.language), [i18n.language]);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('trends.weight.empty')}</p>;
  }

  return (
    <ul className="divide-y">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between py-2 text-sm">
          <span className="text-muted-foreground">{_formatDay(entry.measuredAt, dayFormat)}</span>
          <span className="flex items-center gap-3">
            <span className="font-medium tabular-nums">
              {formatMacroNumberIn(i18n.language, fromKg(entry.weightKg, weightUnit))} {weightUnit}
            </span>
            <ConfirmAction
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('trends.weight.deleteLabel', { date: entry.measuredAt })}
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              }
              title={t('trends.weight.deleteTitle')}
              description={t('trends.weight.deleteDescription')}
              confirmText={t('trends.weight.deleteConfirm')}
              confirmVariant="destructive"
              formData={{ _intent: deleteIntent, weightEntryId: entry.id }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Renders a `YYYY-MM-DD` day as e.g. "Jul 13, 2026" without a time-zone shift. */
function _formatDay(measuredAt: string, format: Intl.DateTimeFormat): string {
  return format.format(new Date(`${measuredAt}T00:00:00Z`));
}
