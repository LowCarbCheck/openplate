/**
 * settings.about.tsx — "About openplate" (M146 spec 01).
 *
 * The in-app provenance surface. The public chrome has a header icon and a
 * footer link, but a person who USES the app rarely sees the public chrome —
 * they live inside `_personal`, which has no footer at all. This row in the
 * settings hub is where they find out what this thing is, which version they
 * are running and where the source lives.
 *
 * NO LOADER AND NO ACTION, like every other settings page. The provenance card
 * is constants from `#app/lib/brand` and `#app/lib/build-info`; the Updates card
 * below it reads `/api/update-status` from the browser, which is a plain fetch
 * rather than a loader because the same store feeds the sidebar stamp and the
 * ribbon (see `app/lib/update-store.ts`).
 *
 * The repository link is the one cross-repo element that legitimately ships ON
 * by default (M146/00): it is true on every instance.
 *
 * ── WHY THERE IS NO "UPGRADE THIS SERVER" BUTTON ────────────────────────────
 *
 * openplate is one stateless container. The server cannot replace its own image,
 * so a newer release on GitHub is reported here as a fact with a link, and the
 * only button that changes anything is the one that reloads this page onto a
 * newer bundle the server is already serving. See ADR-0012.
 *
 * ── WHAT THE SCREEN DOES SAY, AND TO WHOM ───────────────────────────────────
 *
 * A newer release is still information, but a small link and one muted line
 * left a person on a hosted instance unsure whether they were meant to act. So
 * the top of the Updates card now states the fact in words, "a newer release
 * exists", with both versions, and then one sentence that depends on who is
 * reading. Where the reader runs the server it says how (a new image, no
 * button). Where an organization runs it for them it says there is nothing for
 * them to do. That fork is `updatesAreSomeoneElsesJob`, an instance policy
 * question, not the bare mode. The status is a plain block in existing tokens:
 * a newer release is not an error, so it wears no warning colour.
 */
import type { ReactNode } from 'react';
import type { MetaFunction } from 'react-router';
import { CalendarClock, Github, History, RefreshCw, Scale, Sparkles, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SettingsSection } from '#app/components/settings/settings-section';
import { Button } from '#app/components/ui/button';
import { APP_NAME, REPO_LICENSE_URL, REPO_URL } from '#app/lib/brand';
import { BUILD, formatBuildLabel } from '#app/lib/build-info';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { cn } from '#app/lib/utils';
import { useUpdateStatus, type UpdateStatusView } from '#app/hooks/use-update-status';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import type { UpdateStatus } from '#app/lib/update-status';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.about') }];

export const handle = {
  titleKey: 'about.title',
  title: 'About openplate',
  backTo: '/settings',
};

/**
 * The classes a value that is a LINK wears, so the row height is what a finger
 * gets.
 *
 * The anchors here were 17px tall inside 48px rows (SET-09). `min-h-11 py-3`
 * makes the target 44, and `-my-3` spends that height on the padding the row
 * already had, so the row keeps the height it draws today and the two anchors
 * on this page still sit a full row pitch apart.
 */
const ABOUT_LINK_CLASS = '-my-3 inline-flex min-h-11 items-center py-3 text-primary underline-offset-4 hover:underline';

/**
 * One fact about this build: an icon, a label, and the value or link that
 * answers it.
 *
 * THE ROW WRAPS. In Turkish at 320 the label and the value were both squeezed
 * onto one line and the two texts touched (SET-17): `flex-auto` lets the label
 * ask for its own width, so a pair that cannot share a line puts the value on
 * the next one, right-aligned under it, instead of overlapping.
 */
function AboutRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 last:border-b-0 last:pb-0">
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-auto text-sm text-muted-foreground">{label}</span>
      <span className="ml-auto text-right text-sm font-medium">{children}</span>
    </div>
  );
}

/** An instant in the reader's own locale, or a placeholder when there is none. */
function useInstant(): (iso: string | null) => string | null {
  const { i18n } = useTranslation();
  return (iso) => {
    if (iso === null || iso === '') return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(at);
  };
}

/**
 * The one-glance answer at the top of the Updates card: this server is behind,
 * this server is current, or there is nothing to say yet.
 *
 * Silent (null) when checks are off, when the server has not answered, and when
 * it answered without a release. Those states keep the rows and hints the card
 * has always had; a status line that said "up to date" about a check that never
 * ran would be a claim with nothing behind it.
 *
 * Behind is a calm block, not an alarm: `bg-muted/50` and the ordinary text
 * tokens, no warning colour and no icon. A newer release is a fact about the
 * server, and on a hosted instance it is not the reader's problem at all.
 */
function ReleaseStatus({
  server,
  updatesAreSomeoneElsesJob,
}: {
  server: UpdateStatus | null;
  updatesAreSomeoneElsesJob: boolean;
}) {
  const { t } = useTranslation();
  if (server === null || !server.enabled || server.latest === null) return null;

  if (!server.updateAvailable) {
    return (
      <p data-release-status="current" className="text-sm text-muted-foreground">
        {t('about.updates.upToDate')}
      </p>
    );
  }

  return (
    <div data-release-status="behind" className="space-y-1 rounded-lg bg-muted/50 px-3 py-3">
      <p className="text-sm font-medium">{t('about.updates.behindTitle')}</p>
      <p className="text-sm text-muted-foreground break-words">
        {t('about.updates.behindVersions', { running: server.currentVersion, latest: server.latest })}
      </p>
      <p className="text-sm text-muted-foreground break-words">
        {updatesAreSomeoneElsesJob ? t('about.updates.behindWhoManaged') : t('about.updates.behindWho')}
      </p>
    </div>
  );
}

/** What `UpdatesCardView` reads from the update hook, so a test can hand it any state. */
export type UpdatesCardState = Pick<UpdateStatusView, 'status' | 'ribbon' | 'checkNow' | 'updateNow'>;

/**
 * What this instance runs, what the project published, and the one button that
 * changes anything.
 *
 * Every state says something: checks are off, nothing new, something new, or the
 * check was just refused for being too soon. A card that renders empty while the
 * first poll is in flight would read as broken, so the running build is printed
 * from the bundle's own constants and is there before any request finishes.
 *
 * PROPS, NOT HOOKS. The update state and the instance policy arrive as
 * arguments so `tests/unit/about-behind-notice.test.tsx` can render every state
 * with `renderToStaticMarkup`, where no effect runs and no data router exists.
 * `UpdatesCard` below is the two hook reads and nothing else.
 */
export function UpdatesCardView({
  state,
  updatesAreSomeoneElsesJob,
}: {
  state: UpdatesCardState;
  updatesAreSomeoneElsesJob: boolean;
}) {
  const { t } = useTranslation();
  const instant = useInstant();
  const { status, ribbon, checkNow, updateNow } = state;
  const server = status.status;
  const enabled = server === null || server.enabled;
  const checked = instant(server?.checkedAt ?? null);
  const nextAllowed = instant(server?.nextCheckAllowedAt ?? null);

  return (
    <SettingsSection label={t('about.updates.title')} description={t('about.updates.description')}>
      <ReleaseStatus server={server} updatesAreSomeoneElsesJob={updatesAreSomeoneElsesJob} />

      <div>
        <AboutRow icon={Tag} label={t('about.updates.running')}>
          <span className="tabular-nums">{formatBuildLabel(BUILD)}</span>
        </AboutRow>
        <AboutRow icon={CalendarClock} label={t('about.updates.built')}>
          <span className="tabular-nums">{instant(BUILD.builtAt) ?? BUILD.builtAt}</span>
        </AboutRow>
        <AboutRow icon={RefreshCw} label={t('about.updates.latest')}>
          {!enabled && <span className="text-muted-foreground">{t('about.updates.disabled')}</span>}
          {enabled && server?.releaseUrl !== undefined && server.releaseUrl !== null && (
            <a href={server.releaseUrl} target="_blank" rel="noopener" className={cn('tabular-nums', ABOUT_LINK_CLASS)}>
              v{server.latest}
            </a>
          )}
          {enabled && (server === null || server.releaseUrl === null) && (
            <span className="text-muted-foreground">{t('about.updates.never')}</span>
          )}
        </AboutRow>
        {/* `History`, not the `CalendarClock` of "Built" above: two identical
            glyphs in one four-row list read as one repeated fact. */}
        {enabled && (
          <AboutRow icon={History} label={t('about.updates.lastChecked')}>
            <span className="text-muted-foreground">{checked ?? t('about.updates.never')}</span>
          </AboutRow>
        )}
      </div>

      {!enabled && <p className="text-sm text-muted-foreground">{t('about.updates.disabledHint')}</p>}
      {enabled && server?.throttled === true && nextAllowed !== null && (
        <p className="text-sm text-muted-foreground">{t('about.updates.throttled', { when: nextAllowed })}</p>
      )}
      {ribbon === 'newer-bundle' && <p className="text-sm text-muted-foreground">{t('about.updates.reloadHint')}</p>}

      <div className="flex flex-wrap gap-2">
        {enabled && (
          <Button type="button" variant="outline" size="sm" disabled={status.isChecking} onClick={checkNow}>
            {status.isChecking ? t('about.updates.checking') : t('about.updates.checkNow')}
          </Button>
        )}
        {/* Only when a reload would actually change something. A permanent
            button that usually re-serves the same page teaches people it does
            nothing, which is worse than not offering it. */}
        {ribbon === 'newer-bundle' && (
          <Button type="button" size="sm" onClick={updateNow}>
            {t('about.updates.reload')}
          </Button>
        )}
        {enabled && server?.releaseUrl !== undefined && server.releaseUrl !== null && (
          <Button asChild variant="ghost" size="sm">
            <a href={server.releaseUrl} target="_blank" rel="noopener">
              {t('about.updates.releaseLink')}
            </a>
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

function UpdatesCard() {
  const state = useUpdateStatus();
  const { updatesAreSomeoneElsesJob } = useInstancePolicy();
  return <UpdatesCardView state={state} updatesAreSomeoneElsesJob={updatesAreSomeoneElsesJob} />;
}

export default function SettingsAbout() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {/* No version row here. It used to be the only place the build was
          readable, and it is now the first line of the Updates section directly
          below, where it sits beside the build time and the latest release it
          has to be read against. Two identical version strings a few pixels
          apart read as a discrepancy the reader has to rule out. */}
      {/* `space-y-0`: `AboutRow` draws its own hairline between rows, so the
          section's default row gap must not reopen a second one. */}
      <SettingsSection label={t('about.title')} description={t('about.description')} contentClassName="space-y-0">
        <AboutRow icon={Scale} label={t('about.licence')}>
          <a href={REPO_LICENSE_URL} target="_blank" rel="noopener" className={ABOUT_LINK_CLASS}>
            {t('about.licenceValue')}
          </a>
        </AboutRow>
        <AboutRow icon={Github} label={t('about.source')}>
          <a href={REPO_URL} target="_blank" rel="noopener" className={ABOUT_LINK_CLASS}>
            {t('about.sourceValue', { appName: APP_NAME })}
          </a>
        </AboutRow>
        {/* The one row here that stays in the app: the release notes ship in the
            bundle (ADR-0018), so this is a page and not a link to GitHub. */}
        <AboutRow icon={Sparkles} label={t('about.whatsNew')}>
          <Link to="/settings/whats-new" className={ABOUT_LINK_CLASS}>
            {t('about.whatsNewValue')}
          </Link>
        </AboutRow>
      </SettingsSection>
      <UpdatesCard />
    </div>
  );
}
