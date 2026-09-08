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
 */
import type { ReactNode } from 'react';
import type { MetaFunction } from 'react-router';
import { CalendarClock, Github, History, RefreshCw, Scale, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SectionEyebrow } from '#app/components/typography';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { APP_NAME, REPO_LICENSE_URL, REPO_URL } from '#app/lib/brand';
import { BUILD, formatBuildLabel } from '#app/lib/build-info';
import { useUpdateStatus } from '#app/hooks/use-update-status';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

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

/** One fact about this build: an icon, a label, and the value or link that answers it. */
function AboutRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b py-3 last:border-b-0 last:pb-0">
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="shrink-0 text-sm font-medium">{children}</span>
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
 * What this instance runs, what the project published, and the one button that
 * changes anything.
 *
 * Every state says something: checks are off, nothing new, something new, or the
 * check was just refused for being too soon. A card that renders empty while the
 * first poll is in flight would read as broken, so the running build is printed
 * from the bundle's own constants and is there before any request finishes.
 */
function UpdatesCard() {
  const { t } = useTranslation();
  const instant = useInstant();
  const { status, ribbon, checkNow, updateNow } = useUpdateStatus();
  const server = status.status;
  const enabled = server === null || server.enabled;
  const checked = instant(server?.checkedAt ?? null);
  const nextAllowed = instant(server?.nextCheckAllowedAt ?? null);

  return (
    <Card>
      <CardHeader>
        <SectionEyebrow>{t('about.updates.title')}</SectionEyebrow>
        <CardTitle>{t('about.updates.title')}</CardTitle>
        <CardDescription>{t('about.updates.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
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
              <a
                href={server.releaseUrl}
                target="_blank"
                rel="noopener"
                className="tabular-nums text-primary underline-offset-4 hover:underline"
              >
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
        {enabled && server?.updateAvailable === true && (
          <p className="text-sm text-muted-foreground">{t('about.updates.selfHostHint')}</p>
        )}
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
      </CardContent>
    </Card>
  );
}

export default function SettingsAbout() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <SectionEyebrow>{t('about.eyebrow')}</SectionEyebrow>
          <CardTitle>{t('about.title')}</CardTitle>
          <CardDescription>{t('about.description')}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <AboutRow icon={Tag} label={t('about.version')}>
            {/* Tabular figures: this is a version string, not prose. */}
            <span className="tabular-nums">{formatBuildLabel(BUILD)}</span>
          </AboutRow>
          <AboutRow icon={Scale} label={t('about.licence')}>
            <a
              href={REPO_LICENSE_URL}
              target="_blank"
              rel="noopener"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('about.licenceValue')}
            </a>
          </AboutRow>
          <AboutRow icon={Github} label={t('about.source')}>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('about.sourceValue', { appName: APP_NAME })}
            </a>
          </AboutRow>
        </CardContent>
      </Card>
      <UpdatesCard />
    </div>
  );
}
