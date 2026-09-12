/**
 * "Today, everyone here", four figures from the whole instance, under the
 * Overview's glance row.
 *
 * ── It is absent, not empty ──────────────────────────────────────────────
 *
 * Under three contributors this renders nothing at all: no card, no zeroes and
 * no "be the first" line. A number that is really "you, alone" reads as a dead
 * instance, and inviting somebody to be the first is a request, not a figure.
 * The floor decision is `showPulseTile` in `#app/lib/pulse`, pure and pinned
 * by its own test.
 *
 * ── Two components, on purpose ───────────────────────────────────────────
 *
 * {@link PulseTile} takes the figures as a prop and has no idea where they
 * came from, so the floor can be rendered against a fixture. {@link PulseTileSlot}
 * is the one line the dashboard mounts.
 */
import { useTranslation } from 'react-i18next';

import { usePulseToday } from '#app/hooks/use-pulse-today';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { formatMeasureIn } from '#app/lib/format-macro-number';
import { showPulseTile, type PulseToday } from '#app/lib/pulse';

/** The tile, driven by a value. Renders `null` under the floor. */
export function PulseTile({ today }: { today: PulseToday | null }) {
  const { t, i18n: i18next } = useTranslation();
  if (!showPulseTile(today) || today === null) return null;
  const language = i18next.language;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('pulse.tile.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label={t('pulse.tile.meals')} value={formatMeasureIn(language, today.meals, '')} />
          <Figure label={t('pulse.tile.photos')} value={formatMeasureIn(language, today.photos, '')} />
          <Figure label={t('pulse.tile.kcal')} value={formatMeasureIn(language, today.kcal, '')} />
          <Figure label={t('pulse.tile.protein')} value={formatMeasureIn(language, today.protein, 'g')} />
        </dl>
      </CardContent>
    </Card>
  );
}

/** One figure: the number first, its label under it, exactly as the glance tiles read. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dd className="font-display text-xl font-semibold leading-none tracking-tight">{value}</dd>
      <dt className="mt-1 truncate text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

/** The dashboard's one line. Fetches after first paint and renders nothing until there is something to render. */
export function PulseTileSlot() {
  const today = usePulseToday();
  return <PulseTile today={today} />;
}
