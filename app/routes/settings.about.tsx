/**
 * settings.about.tsx — "About openplate" (M146 spec 01).
 *
 * The in-app provenance surface. The public chrome has a header icon and a
 * footer link, but a person who USES the app rarely sees the public chrome —
 * they live inside `_personal`, which has no footer at all. This row in the
 * settings hub is where they find out what this thing is, which version they
 * are running and where the source lives.
 *
 * NO LOADER AND NO ACTION, like every other settings page: everything on it is
 * a constant from `#app/lib/brand`. Nothing is read from the environment and
 * nothing is sent anywhere, so this page is identical on the hosted instance
 * and on a self-hoster's box — which is the point. The repository link is the
 * one cross-repo element that legitimately ships ON by default (M146/00): it
 * is true on every instance.
 */
import type { ReactNode } from 'react';
import type { MetaFunction } from 'react-router';
import { Github, Scale, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SectionEyebrow } from '#app/components/typography';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { APP_NAME, APP_VERSION, REPO_LICENSE_URL, REPO_URL } from '#app/lib/brand';
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
            <span className="tabular-nums">{APP_VERSION}</span>
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
    </div>
  );
}
