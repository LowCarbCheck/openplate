/**
 * settings.whats-new.tsx, every release note this build ships with.
 *
 * The card on `/diary` and `/dashboard` says one release in three lines; this
 * is where the rest of it is. Same source, the `releases` i18n namespace, so
 * the page needs no loader, no action and no network: the notes are in the
 * bundle, in the reader's own language, and they work offline like everything
 * else here (ADR-0018).
 *
 * ── WHAT OPENING IT MEANS ────────────────────────────────────────────────
 *
 * Opening the page IS reading the notes, so it records this build as
 * acknowledged and the card stops appearing. The releases that were still
 * unacknowledged when the page opened are marked, once, so the reader can see
 * which part is new to them without having to remember a version number. The
 * mark is read BEFORE the write, in the same effect, or the page would mark
 * nothing on the very visit that earned the mark.
 *
 * THE LINK AT THE FOOT IS THE ONLY THING THAT LEAVES. Three releases fit a
 * phone; the whole history does not, and this app does not fetch it.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';

import enReleases from '#app/i18n/locales/en/releases.json';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SettingsSection } from '#app/components/settings/settings-section';
import { REPO_URL } from '#app/lib/brand';
import { BUILD } from '#app/lib/build-info';
import { dateLabelLocale } from '#app/i18n/date-locale';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import {
  decideWhatsNew,
  entriesFromCatalog,
  readWhatsNewSeen,
  writeWhatsNewSeen,
  type ReleaseEntry,
} from '#app/lib/whats-new';
import { getLocalProfileGoals } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton. See `meta-title.ts`.
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.whatsNew') }];

export const handle = {
  titleKey: 'whatsNew.title',
  title: "What's new",
  backTo: '/settings/about',
};

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

/** Where the whole history lives, for the reader who wants more than three releases. */
const ALL_RELEASES_URL = `${REPO_URL}/releases`;

/** The class an external link wears on the About pages, so the row is a finger tall. */
const RELEASES_LINK_CLASS = 'inline-flex min-h-11 items-center py-3 text-primary underline-offset-4 hover:underline';

/**
 * The release date in the reader's own language.
 *
 * `timeZone: 'UTC'` because the value is a calendar DATE, not an instant: read
 * in a negative offset, a plain `Date` would draw the day before.
 */
function useReleaseDate(): (date: string) => string {
  const { i18n } = useTranslation();
  const formatter = new Intl.DateTimeFormat(dateLabelLocale(i18n.resolvedLanguage ?? i18n.language), {
    timeZone: 'UTC',
    dateStyle: 'medium',
  });
  return (date) => {
    const at = new Date(`${date}T00:00:00Z`);
    // A date the generator could not write is printed as it stands rather than
    // as "Invalid Date", which is the one string a reader can do nothing with.
    return Number.isNaN(at.getTime()) ? date : formatter.format(at);
  };
}

/** One release: its version, its date, and its groups of leads. */
function ReleaseBlock({ entry, isUnseen }: { entry: ReleaseEntry; isUnseen: boolean }): ReactElement {
  const { t } = useTranslation(['common', 'releases']);
  const formatDate = useReleaseDate();

  return (
    <section data-slot="release" data-version={entry.version} className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="min-w-0 text-sm font-semibold break-words tabular-nums">v{entry.version}</h3>
        {/* A WORD, not a coloured block. The page already orders the releases
            newest first, so this only has to answer "where did I get to". */}
        {isUnseen && (
          <span data-slot="release-new" className="text-xs font-medium text-primary">
            {t('whatsNew.new')}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatDate(entry.date)}</span>
      </div>
      {entry.groups.map((group) => (
        <div key={group.group} className="min-w-0 space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">{t(`whatsNew.groups.${group.group}`)}</h4>
          <ul className="min-w-0 list-disc space-y-1 pl-5 text-sm">
            {group.keys.map((key) => (
              <li key={key} className="break-words">
                {t(key, { ns: 'releases' })}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default function SettingsWhatsNew(): ReactElement {
  const { t } = useTranslation();
  // The versions that were still unacknowledged when this page opened. Settled
  // in the effect below, so the first render (server and client alike) draws
  // the list with no marks and the marks arrive with the device's answer.
  const [unseenVersions, setUnseenVersions] = useState<readonly string[]>([]);

  useEffect(() => {
    let isCancelled = false;
    async function readThenRecord(): Promise<void> {
      try {
        const profile = await getLocalProfileGoals();
        if (isCancelled) return;
        if (globalThis.localStorage === undefined) return;
        const storage = globalThis.localStorage;
        // READ FIRST. The write below is what stops the card coming back, and
        // doing it before this would mark every release as already read.
        const decision = decideWhatsNew({
          current: BUILD.version,
          seen: readWhatsNewSeen(storage),
          onboardedAt: profile?.onboardingCompletedAt ?? null,
          builtAt: BUILD.builtAt,
          entries: SHIPPED_RELEASES,
        });
        if (decision.kind === 'show') setUnseenVersions(decision.unseen.map((entry) => entry.version));
        if (decision.kind !== 'none') writeWhatsNewSeen(storage, BUILD.version);
      } catch (error) {
        // The notes are in the bundle, so they render either way; only the
        // marks and the acknowledgement depend on the device.
        reportError(error, { boundary: 'whats-new-page' });
      }
    }
    void readThenRecord();
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <SettingsSection label={t('whatsNew.title')}>
        {SHIPPED_RELEASES.map((entry) => (
          <ReleaseBlock key={entry.version} entry={entry} isUnseen={unseenVersions.includes(entry.version)} />
        ))}
        <a href={ALL_RELEASES_URL} target="_blank" rel="noreferrer noopener" className={RELEASES_LINK_CLASS}>
          {t('whatsNew.allReleases')}
        </a>
      </SettingsSection>
    </div>
  );
}
