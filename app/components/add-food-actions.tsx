/**
 * The pair of affordances that start a log: a prominent primary link into the
 * search-first `/add` flow, with a secondary icon button into `/scan` so search
 * and scan are always one tap apart.
 *
 * Extracted from `diary.tsx`, where it was module-private, so `/dashboard`'s
 * today hero offers the SAME two buttons — same labels, same order, same
 * geometry — rather than a second pair that drifts.
 *
 * Both destinations are passed in: `/diary` carries the viewed day when it
 * isn't today (so a back-dated log lands on the day the user is looking at),
 * while `/dashboard` is always today and passes the bare paths.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { Camera, Plus } from 'lucide-react';

export function AddFoodActions({ addTo, scanTo }: { addTo: string; scanTo: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <Button asChild className="h-11 flex-1">
        <Link to={addTo}>
          <Plus className="h-4 w-4" /> {t('diary.actions.addFood')}
        </Link>
      </Button>
      <Button asChild variant="outline" size="icon" className="h-11 w-11 shrink-0">
        <Link to={scanTo} aria-label={t('diary.actions.scanPlate')}>
          <Camera className="h-5 w-5" />
        </Link>
      </Button>
    </div>
  );
}
