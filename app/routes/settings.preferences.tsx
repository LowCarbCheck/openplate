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
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AwardsVisibilityToggle } from '#app/components/gamification/awards-visibility-toggle';
import { ThemeSelector } from '#app/components/theme-selector';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SettingsGroup, SettingsSection } from '#app/components/settings/settings-section';
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
import { trackPreferenceChanged } from '#app/lib/matomo-events';

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

/**
 * One language, as a row in the inset list rather than a box of its own: the
 * box and its own border were the hub's old per-item look, and the hairline
 * dividers now come from the container (M225).
 */
function LanguageRow({ code, isActive }: { code: LanguageCode; isActive: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        // Before the call, not after: `selectLanguage` reloads the document,
        // and a push queued behind that reload may never be sent. Its two
        // writes cannot fail, so this is still only counted on a real change.
        if (!isActive) trackPreferenceChanged('language');
        selectLanguage(code);
      }}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors',
        isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {/* The language is named in its own language, never translated. */}
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
    <div className="mx-auto max-w-xl space-y-5">
      <SettingsSection label={t('preferences.theme.title')} description={t('preferences.theme.description')}>
        <ThemeSelector />
      </SettingsSection>

      {/* A GROUP, not a section: these are choices in a list, so they get the
          list's hairline dividers and no padding of their own. */}
      <div className="space-y-2">
        {/* "Display language", not "Language": naming the setting precisely
            draws the line against the food-data language, which this does not
            change. */}
        <SettingsGroup label={t('preferences.language.title')}>
          {SUPPORTED_LANGUAGES.map((code) => (
            <LanguageRow key={code} code={code} isActive={code === active} />
          ))}
        </SettingsGroup>
        <p className="px-4 text-xs text-muted-foreground">{t('preferences.language.reloadNote')}</p>
      </div>

      {/*
        The streak and the awards switch (M235/06). The odd one out on this
        page: the theme and the language are DEVICE preferences, and this one
        rides the synced profile row, because "I do not want a streak" is a
        thing a person means about the app rather than about the phone in their
        hand. It lives here and not on `/awards` because the switch hides the
        only door to that screen.
      */}
      <AwardsVisibilityToggle />
    </div>
  );
}
