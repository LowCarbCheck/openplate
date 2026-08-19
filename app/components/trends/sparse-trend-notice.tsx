/**
 * The honest stand-in for a chart that would lie (M129/04). Under three logged
 * days, a full-width bar chart is mostly empty slots with one or two lonely
 * bars, and that picture reads as "your data is bad" rather than "there isn't
 * enough of it yet" — the same failure mode the diary's empty states were
 * rewritten to avoid. So below the threshold the chart is replaced outright by
 * this panel, which says the true thing and counts what the user actually has.
 *
 * Uses the established empty-state pattern (DESIGN.md §2): `surface-brand-soft`
 * + `border-dashed`, a muted `PlateGlyph`, one plain sentence. No CTA button —
 * the fix is "log more days", which every other surface on this page already
 * offers; a second "Add food" button here would just be noise.
 */
import { useTranslation } from 'react-i18next';
import { PlateGlyph } from '#app/components/plate-glyph';

/** Logged days needed before a chart is worth drawing — two points is a line, three is a hint of a pattern. */
export const MIN_TREND_DAYS = 3;

/**
 * @param loggedDays - days with at least one entry inside the selected window.
 */
export function SparseTrendNotice({ loggedDays }: { loggedDays: number }) {
  const { t } = useTranslation();
  // "none in this stretch" / "1" / "2" — the tail of the headline sentence.
  // Deliberately NOT passed as `count`: that name switches i18next into plural
  // resolution, which this key has no plural forms for.
  const logged = loggedDays <= 0 ? t('trends.sparse.countNone') : `${loggedDays}`;

  return (
    <div className="surface-brand-soft flex flex-col items-center gap-3 rounded-xl border border-dashed border-primary/30 px-4 py-8 text-center">
      <PlateGlyph className="h-12 w-12 text-primary/40" />
      <p className="text-sm font-medium">{t('trends.sparse.headline', { logged })}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{t('trends.sparse.body', { days: MIN_TREND_DAYS })}</p>
    </div>
  );
}
