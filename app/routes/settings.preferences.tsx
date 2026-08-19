/**
 * settings.preferences.tsx — how the app looks and what language it speaks.
 *
 * Both settings on this page are DEVICE preferences, not account data: they
 * are written to localStorage (plus a cookie for the language, so the server
 * can render the first paint in the right language). Nothing here submits to
 * a server, which is why the route has no action and no loader — it is the
 * local-first invariant applied to preferences (see
 * `app/i18n/language-prefs.ts`).
 */
import type { MetaFunction } from 'react-router';
import { Check, Languages, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThemeSelector } from '#app/components/theme-selector';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SectionEyebrow, P } from '#app/components/typography';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { cn } from '#app/lib/utils';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isLanguageCode,
  selectLanguage,
  type LanguageCode,
} from '#app/i18n/language-prefs';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.preferences') }];

export const handle = {
  titleKey: 'preferences.title',
  title: 'Preferences',
  backTo: '/settings',
};

function LanguageRow({ code, isActive }: { code: LanguageCode; isActive: boolean }) {
  return (
    <button
      type="button"
      onClick={() => selectLanguage(code)}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
        isActive ?
          'border-primary/40 bg-primary/5 font-medium text-foreground'
        : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
      )}
    >
      {/* The language is named in its own language — never translated. */}
      <span lang={code}>{LANGUAGE_LABELS[code]}</span>
      {isActive && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  );
}

export default function SettingsPreferences() {
  const { t, i18n } = useTranslation();
  const raw = i18n.resolvedLanguage ?? i18n.language;
  const active: LanguageCode = isLanguageCode(raw) ? raw : DEFAULT_LANGUAGE;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <SectionEyebrow>{t('preferences.eyebrow')}</SectionEyebrow>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('preferences.theme.title')}
          </CardTitle>
          <CardDescription>{t('preferences.theme.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSelector />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionEyebrow>{t('preferences.language.eyebrow')}</SectionEyebrow>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-primary" aria-hidden="true" />
            {/* "Display language", not "Language" — the eyebrow above already
                says Language, and naming the setting precisely also draws the
                line against the food-data language, which this does not change. */}
            {t('preferences.language.title')}
          </CardTitle>
          <CardDescription>{t('preferences.language.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {SUPPORTED_LANGUAGES.map((code) => (
            <LanguageRow key={code} code={code} isActive={code === active} />
          ))}
          <P variant="meta" className="pt-1">
            {t('preferences.language.reloadNote')}
          </P>
        </CardContent>
      </Card>
    </div>
  );
}
