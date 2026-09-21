/**
 * The streak card on `/trends` (M235/06), and the door to the awards screen.
 *
 * ── ONE NUMBER, AND IT IS THE ACTIVITY STREAK ────────────────────────────
 *
 * This replaces `streak-card.tsx`, which read the adherence walk
 * (`computeStreak`) while `/dashboard` read the same walk from its own loader.
 * Two numbers derived twice is one defect waiting to happen, and the number
 * itself said something a person does not mean by "streak": a single day over
 * the carb goal read as zero to somebody who had opened the app every morning.
 * Both screens now show the ACTIVITY streak, derived by one function
 * (`deriveActivityStreak`), from marks.
 *
 * ── WHY THE MARKS ARRIVE AS A PROP ───────────────────────────────────────
 *
 * The old card read the store from an effect, which meant it rendered nothing
 * at all until that read resolved and could not be exercised without a browser.
 * `/trends` already has a client loader reading this device, so the marks and
 * the switch come down with everything else and this component is
 * presentational, which is also what lets its hidden case be rendered against
 * its control in a unit test.
 *
 * DESIGN.md §2 "at most one `.surface-brand` hero per screen": Trends already
 * spends its hero on `WeeklyRecapCard`, so this renders on an ordinary
 * `bg-card` surface, and a second hero panel on that screen would be a bug.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Flame } from 'lucide-react';

import { Link } from '#app/components/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { deriveActivityStreak } from '#app/lib/gamification/surfaces';
import type { LocalActivityMark } from '#app/lib/local-store';
import { describeStreak } from '#app/lib/streak-message';

/**
 * The streak, plus a row into `/awards`.
 *
 * Renders nothing at all when the person has switched the streak and the
 * awards off: the card, the link it carries and the note elsewhere all go
 * together, and recording carries on regardless.
 *
 * @param marks - every activity mark this device holds, from the route's client loader.
 * @param today - the person's current local day, `YYYY-MM-DD`, in their own zone.
 * @param hidden - whether the person switched these surfaces off.
 * @returns the card, or null when hidden.
 */
export function ActivityStreakCard({
  marks,
  today,
  hidden,
}: {
  marks: readonly LocalActivityMark[];
  today: string;
  hidden: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  if (hidden) return null;

  const streak = deriveActivityStreak({ marks, today });

  return (
    <Link
      to="/awards"
      // The ring is drawn on this wrapper, so it takes the radius of the card
      // inside it (the ladder's 8px card step).
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> {t('trends.streak.title')}
          </CardTitle>
          <CardDescription>{describeStreak(streak, t)}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* The whole card is the link, so this row is an affordance and not a
              second anchor: a nested one would be invalid markup, the same
              reason `StreakGridCard` draws its grid read-only. */}
          <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            {t('awards.title')}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
