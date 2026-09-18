/**
 * `/awards`, the record: what this person has done with the app so far.
 *
 * ── WHAT THIS SCREEN IS NOT ──────────────────────────────────────────────
 *
 * No points, no level, no leaderboard, no comparison to anybody else, and no
 * loss language anywhere on it. Three separate lists, never one score: the
 * functions a person has tried, the days in a row they have used the app, and
 * the days in a row they stayed at or under their carb goal. Staying under the
 * goal is its own family precisely so it is never a number that resets.
 *
 * NO SERVER LOADER work, by design (AGENTS.md, local-first): the marks, the
 * awards and the profile are all on-device. The `loader` below exists only so
 * an offline client-side navigation resolves without a `.data` fetch, exactly
 * as `/dashboard`, `/diary` and `/catch-up` do it.
 *
 * ── AN UNKNOWN KEY IS NOT AN ERROR ───────────────────────────────────────
 *
 * The screen iterates the CATALOG and looks each key up in what the device
 * holds, never the other way round. An award minted by a newer build is
 * therefore kept by the store, never rendered here, and never a crash. The
 * loader passes the earned days as a LIST of pairs rather than a dictionary,
 * so what crosses the loader boundary stays a plain, typed, serialisable shape.
 */
import type { ReactElement } from 'react';
import type { Route } from './+types/awards';
import { useTranslation } from 'react-i18next';

import { AwardTile } from '#app/components/gamification/award-tile';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { AWARD_KINDS, awardSectionKey, awardsOfKind } from '#app/lib/gamification/surfaces';
import type { AwardKind } from '#app/lib/gamification/catalog';
import { listLocalAwards } from '#app/lib/local-store';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.awards') }];

export const handle = {
  // `title` stays as the untranslated fallback for any consumer that reads the
  // handle outside a React tree (where `t` isn't available).
  title: 'Your record',
  titleKey: 'awards.title',
  backTo: '/trends',
};

/** One earned award, flattened to what the screen draws: which key, and the day. */
export interface EarnedAward {
  key: string;
  earnedOnDay: string;
}

/** What `/awards` reads off this device. */
export interface AwardsData {
  /** Every award this device holds, oldest first, including keys this build does not know. */
  earned: EarnedAward[];
}

/** No server work. See the module doc. */
export async function loader() {
  return {};
}

/** The award row as the screen needs it. A named builder, not a map spread (the repo's lint rejects one). */
function toEarnedAward({ key, earnedOnDay }: { key: string; earnedOnDay: string }): EarnedAward {
  return { key, earnedOnDay };
}

export async function clientLoader(): Promise<AwardsData> {
  return { earned: (await listLocalAwards()).map(toEarnedAward) };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the awards off the on-device store. */
export function HydrateFallback(): ReactElement {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('awards.title')}
    </output>
  );
}

/**
 * One family, with every award in it, earned or not.
 *
 * @param kind - the family.
 * @param earnedDays - the day each held key was earned on.
 * @returns the section card.
 */
function AwardSection({ kind, earnedDays }: { kind: AwardKind; earnedDays: Map<string, string> }): ReactElement {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t(awardSectionKey(kind))}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border pt-0">
        {awardsOfKind(kind).map((award) => (
          <AwardTile key={award.key} award={award} earnedOnDay={earnedDays.get(award.key) ?? null} />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The screen itself, taking only what it draws.
 *
 * Split from the route export so it renders in a test without the route's
 * generated props, which is also this page's own convention: every component
 * here is presentational and the client loader does the reading.
 *
 * @param earned - every award this device holds, including keys this build does not know.
 * @returns the three sections.
 */
export function AwardsScreen({ earned }: { earned: readonly EarnedAward[] }): ReactElement {
  const { t } = useTranslation();
  const earnedDays = new Map(earned.map((award): [string, string] => [award.key, award.earnedOnDay]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">{t('awards.description')}</p>
      {/* "Empty is not an error" (DESIGN.md §10.5): a device with nothing yet
          gets one line saying what will happen, and the three lists still
          render under it, because the lists ARE what will happen. */}
      {earned.length === 0 && <p className="text-sm text-muted-foreground">{t('awards.empty')}</p>}
      {AWARD_KINDS.map((kind) => (
        <AwardSection key={kind} kind={kind} earnedDays={earnedDays} />
      ))}
    </div>
  );
}

export default function Awards({ loaderData }: Route.ComponentProps): ReactElement {
  return <AwardsScreen earned={loaderData.earned} />;
}
