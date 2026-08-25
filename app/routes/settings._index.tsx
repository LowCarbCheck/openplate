/**
 * settings._index.tsx — the settings hub (`/settings`).
 *
 * Replaces the old `/profile` card-hub. The difference is deliberate: a hub's
 * job is to say what exists and what it's currently set to, in one scan, and
 * then get out of the way. So every entry here is a compact ROW — icon, name,
 * one line of live status, chevron — not a card with its own explainer. The
 * per-page copy stays on the pages themselves (DESIGN.md §10.7: one phrasing
 * per idea; an explainer repeated on the hub and the page is a bug in one of
 * them).
 *
 * NO SERVER LOADER, by design (AGENTS.md, local-first). Every status line
 * below is read on the device — BYOK settings from the AI store, goals from
 * the primary store, theme/language from localStorage, sync from the
 * in-memory session. Nothing about this page's contents is ever sent
 * anywhere, and in particular the AI row shows the provider and model only,
 * never the key.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Route } from './+types/settings._index';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import {
  Apple,
  BookMarked,
  ChevronRight,
  Database,
  Info,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { APP_VERSION } from '#app/lib/brand';
import { getLocalProfileGoals } from '#app/lib/local-store';
import type { LocalProfileGoals } from '#app/lib/local-store';
// Shared with the header avatar menu's AI shortcut — one derivation of "which
// provider is this device connected to", rendered in two places.
import { useAiConnectionStatusLine } from '#app/hooks/use-ai-connection-summary';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { InstallCard } from '#app/components/install-card';
import { SectionEyebrow } from '#app/components/typography';
import { THEME_LABEL_KEYS, getStoredTheme, type Theme } from '#app/components/theme-selector';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { useSyncSession } from '#app/components/sync-status';
import { DEFAULT_LANGUAGE, LANGUAGE_LABELS, isLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.settings') }];

export const handle = {
  title: 'Settings',
  titleKey: 'settings.title',
};

////////////////////////////////////////////////////////////////////////////////
// Row primitives
////////////////////////////////////////////////////////////////////////////////

/**
 * One settings destination. The whole row is the link (not a trailing "Open"
 * action) so the touch target is the full width, and the status line is
 * `null` — rather than a placeholder string — while the device read that
 * feeds it is still in flight, so the row never flashes a wrong value.
 */
function SettingsRow({
  to,
  icon: Icon,
  title,
  status,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  status: string | null;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {status !== null && <span className="block truncate text-xs text-muted-foreground">{status}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** A labelled group of rows. The label is a real heading, so the page keeps an outline. */
function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow as="h2">{label}</SectionEyebrow>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Device reads (all client-side — see the module doc comment)
////////////////////////////////////////////////////////////////////////////////

/** The device's profile/goals row, or `undefined` while the first read is in flight. */
function useLocalGoals(): LocalProfileGoals | null | undefined {
  const [goals, setGoals] = useState<LocalProfileGoals | null | undefined>(undefined);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const loaded = await getLocalProfileGoals();
      if (!isCancelled) setGoals(loaded);
    })();
    return () => {
      isCancelled = true;
    };
  }, []);

  return goals;
}

/** The goal the user actually set — carbs first, calories for a calorie-only tracker (same precedence as the diary hero). */
function useGoalsStatus(): string | null {
  const { t } = useTranslation();
  const goals = useLocalGoals();

  if (goals === undefined) return null;
  const netCarbsCeiling = goals?.goalNetCarbsCeilingG ?? null;
  if (netCarbsCeiling !== null) return t('settings.rows.goals.carbs', { grams: netCarbsCeiling });
  const kcalTarget = goals?.goalKcalTarget ?? null;
  if (kcalTarget !== null) return t('settings.rows.goals.calories', { kcal: kcalTarget });
  return t('settings.rows.goals.none');
}

/** "Dark · Deutsch". `null` until the theme is readable — localStorage isn't available during SSR/first paint. */
function usePreferencesStatus(): string | null {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  if (theme === null) return null;
  const raw = i18n.resolvedLanguage ?? i18n.language;
  const language: LanguageCode = isLanguageCode(raw) ? raw : DEFAULT_LANGUAGE;
  // The language is named in its own language — never translated.
  return `${t(THEME_LABEL_KEYS[theme])} · ${LANGUAGE_LABELS[language]}`;
}

////////////////////////////////////////////////////////////////////////////////
// Page
////////////////////////////////////////////////////////////////////////////////

export default function SettingsIndex() {
  const { t } = useTranslation();
  const aiStatus = useAiConnectionStatusLine();
  const goalsStatus = useGoalsStatus();
  const preferencesStatus = usePreferencesStatus();
  // `null` unless the operator set `SYNC_SERVER_URL`. On that instance the
  // sync row renders NOTHING — no row, no mention (AGENTS.md: unset means no
  // sync UI anywhere).
  const syncServerUrl = useSyncServerUrl();
  const session = useSyncSession();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <SettingsGroup label={t('settings.groups.scanning')}>
        <SettingsRow to="/settings/ai" icon={Sparkles} title={t('settings.rows.ai.title')} status={aiStatus} />
      </SettingsGroup>

      <SettingsGroup label={t('settings.groups.you')}>
        <SettingsRow to="/settings/goals" icon={Target} title={t('settings.rows.goals.title')} status={goalsStatus} />
        <SettingsRow
          to="/settings/preferences"
          icon={SlidersHorizontal}
          title={t('settings.rows.preferences.title')}
          status={preferencesStatus}
        />
      </SettingsGroup>

      <SettingsGroup label={t('settings.groups.yourData')}>
        {/* Items 1 and 5 (M123/07): "Your foods" was write-only from `/add`'s
            sheet and saved meals had no surface at all. Both get a settings
            row rather than living only inside the add flow, so they're
            discoverable the same way every other durable device-local list
            already is. */}
        <SettingsRow to="/foods" icon={Apple} title={t('settings.rows.foods.title')} status={null} />
        <SettingsRow to="/meals" icon={BookMarked} title={t('settings.rows.meals.title')} status={null} />
        {syncServerUrl !== null && (
          <SettingsRow
            to="/settings/sync"
            icon={ShieldCheck}
            title={t('settings.rows.sync.title')}
            status={session.account === null ? t('settings.rows.sync.notSetUp') : session.account.email}
          />
        )}
        <SettingsRow
          to="/settings/data"
          icon={Database}
          title={t('settings.rows.data.title')}
          status={t('settings.rows.data.status')}
        />
      </SettingsGroup>

      {/* Provenance (M146 spec 01): version, licence, source. Ungated — the
          repository link is true on every instance, so unlike the sync row
          above there is nothing to switch off for a self-hoster. The status
          line is a constant, so it never renders `null` first. */}
      <SettingsGroup label={t('settings.groups.about')}>
        <SettingsRow
          to="/settings/about"
          icon={Info}
          title={t('settings.rows.about.title')}
          status={t('settings.rows.about.status', { version: APP_VERSION })}
        />
      </SettingsGroup>

      {/* Renders nothing unless the app is installable and not already standalone.
          `id="install"` gives the app-chrome nav drawer's iOS "Install app" item
          (`app-wrapper.tsx`) an anchor to jump straight to these instructions. */}
      <div id="install">
        <InstallCard />
      </div>
    </div>
  );
}
