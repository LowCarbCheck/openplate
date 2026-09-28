/**
 * "Here is what changed", said once after an update.
 *
 * The rules live in `#app/lib/whats-new`; this is the one place that performs
 * them. It renders at the top of `/diary` (the installed app's `start_url`) and
 * of `/dashboard`, so a person who updated meets it on whichever of the two
 * they open, until they dismiss it or open the notes.
 *
 * ── WHY IT DECIDES IN AN EFFECT AND NOT IN A LOADER ──────────────────────
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * First, the same card is mounted by two routes; a loader field would be the
 * same decision written twice, and two copies of "has this person been told"
 * is exactly how a person gets told twice.
 *
 * Second, the decision reads `localStorage` and the profile row, and neither
 * exists on the server. Deciding during render would make the server's answer
 * and the browser's first answer differ, which is a hydration mismatch. So it
 * renders NOTHING until the effect has answered, the same shape
 * `app/components/gamification/award-note.tsx` uses for the same reason.
 *
 * ── THE SESSION STATE, AND WHY IT IS NOT THE MEMORY ──────────────────────
 *
 * Tapping either key hides the card in component state, which is what makes it
 * go away at the moment of the tap without a storage round trip on the critical
 * path of the click. Same split as the Insights hint on the dashboard.
 *
 * What makes it stay gone across a reload is the version written to the device,
 * and only ONE of the two keys writes it here. Dismiss writes, because nothing
 * else will. "See what's new" does not, because the page it opens records the
 * acknowledgement itself and has to read the old value first to mark what was
 * unread. See {@link WhatsNewCard} for the two handlers.
 *
 * Its own bordered card, never a `.surface-brand` hero: each page already has
 * one hero, and this is an aside a person is free to ignore.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import enReleases from '#app/i18n/locales/en/releases.json';
import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { Card, CardContent } from '#app/components/ui/card';
import { BUILD } from '#app/lib/build-info';
import { getLocalProfileGoals } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';
import {
  countLeads,
  entriesFromCatalog,
  decideWhatsNew,
  readWhatsNewSeen,
  writeWhatsNewSeen,
  type ReleaseEntry,
  type WhatsNewDecision,
} from '#app/lib/whats-new';

/**
 * The releases this bundle ships, newest first.
 *
 * THE ENGLISH CATALOG IS THE STRUCTURE. Which releases exist, which groups they
 * carry and how many leads each one has are facts about the release, not about
 * the reader, so they are read once off English and the TEXT is then looked up
 * per key in whatever language the reader is in. A translation that lost a lead
 * therefore renders the key rather than silently shortening the list.
 *
 * Derived here rather than exported from `#app/lib/whats-new`, see that file's
 * header for why it imports no JSON.
 */
const SHIPPED_RELEASES: readonly ReleaseEntry[] = entriesFromCatalog(enReleases);

/** How many leads the card itself prints before it says how many are left. */
const LEADS_ON_THE_CARD = 3;

/** What this device last acknowledged. Null outside a browser, where there is no device. */
function readSeenOnDevice(): string | null {
  if (globalThis.localStorage === undefined) return null;
  return readWhatsNewSeen(globalThis.localStorage);
}

/** Records this build as acknowledged. A no-op outside a browser. */
function writeSeenOnDevice(version: string): void {
  if (globalThis.localStorage === undefined) return;
  writeWhatsNewSeen(globalThis.localStorage, version);
}

/** The first few leads of one release, in `added`, `changed`, `fixed` order. */
function leadsOnTheCard(entry: ReleaseEntry): string[] {
  return entry.groups.flatMap((group) => group.keys).slice(0, LEADS_ON_THE_CARD);
}

/**
 * The card, or nothing.
 *
 * @returns the release note card when this device has an update to hear about.
 */
export function WhatsNewCard(): ReactElement | null {
  const { t } = useTranslation(['common', 'releases']);
  const [decision, setDecision] = useState<WhatsNewDecision | null>(null);
  const [isDismissedThisSession, setIsDismissedThisSession] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    async function decide(): Promise<void> {
      try {
        const profile = await getLocalProfileGoals();
        if (isCancelled) return;
        const answer = decideWhatsNew({
          current: BUILD.version,
          seen: readSeenOnDevice(),
          onboardedAt: profile?.onboardingCompletedAt ?? null,
          builtAt: BUILD.builtAt,
          entries: SHIPPED_RELEASES,
        });
        // A NEW DEVICE IS RECORDED SILENTLY, here and not on a tap: it has
        // nothing to be told, and without the write the next update would look
        // like a first run all over again and say nothing then either.
        if (answer.kind === 'stamp') writeSeenOnDevice(BUILD.version);
        setDecision(answer);
      } catch (error) {
        // A note about the release must never take the diary down: the read is
        // reported and the page renders exactly as it would with nothing to say.
        reportError(error, { boundary: 'whats-new-decide' });
      }
    }
    void decide();
    return () => {
      isCancelled = true;
    };
  }, []);

  if (decision === null || decision.kind !== 'show' || isDismissedThisSession) return null;

  const [newest] = decision.unseen;
  if (newest === undefined) return null;

  const leads = leadsOnTheCard(newest);
  const remaining = countLeads(decision.unseen) - leads.length;

  /** Waving it away. There is no page to do the recording, so this key does it. */
  function dismiss(): void {
    writeSeenOnDevice(BUILD.version);
    setIsDismissedThisSession(true);
  }

  /**
   * Opening the notes. Hides the card for the rest of this session, and
   * deliberately DOES NOT RECORD: `/settings/whats-new` records on arrival, and
   * it also marks the releases that were still unread. Recording here would
   * write the flag one navigation before that page reads it, so the page would
   * mark nothing on the one visit that earned the marks.
   */
  function openTheNotes(): void {
    setIsDismissedThisSession(true);
  }

  return (
    <Card data-slot="whats-new" data-version={newest.version} className="border-dashed">
      {/* A COLUMN ON A PHONE, two-up only from `md`. The leads are whole
          sentences, so a row that shared its width with two keys would leave
          them a column barely wider than one word. */}
      <CardContent className="flex flex-col items-start gap-3 p-4">
        <p className="min-w-0 text-sm font-medium break-words">
          {t('whatsNew.card.title', { version: newest.version })}
        </p>
        <ul className="min-w-0 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {leads.map((key) => (
            <li key={key} className="break-words">
              {t(key, { ns: 'releases' })}
            </li>
          ))}
        </ul>
        {remaining > 0 && (
          <p className="min-w-0 text-sm text-muted-foreground break-words">
            {t('whatsNew.card.more', { count: remaining })}
          </p>
        )}
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button asChild size="sm" className="h-11 md:h-8">
            <Link to="/settings/whats-new" onClick={openTheNotes}>
              {t('whatsNew.card.open')}
            </Link>
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-11 md:h-8" onClick={dismiss}>
            {t('whatsNew.card.dismiss')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
