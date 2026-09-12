/**
 * settings._index.tsx, the settings hub (`/settings`).
 *
 * Replaces the old `/profile` card-hub. The difference is deliberate: a hub's
 * job is to say what exists and what it's currently set to, in one scan, and
 * then get out of the way. So every entry here is a compact ROW, icon, name,
 * one line of live status, chevron, not a card with its own explainer. The
 * per-page copy stays on the pages themselves (DESIGN.md §10.7: one phrasing
 * per idea; an explainer repeated on the hub and the page is a bug in one of
 * them).
 *
 * NO SERVER LOADER, by design (AGENTS.md, local-first). Every status line
 * below is read on the device, BYOK settings from the AI store, goals from
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
  CreditCard,
  Database,
  FlaskConical,
  HeartPulse,
  Info,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Target,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { BUILD } from '#app/lib/build-info';
import { getLocalFastingSettings, getLocalProfileGoals, resolveLocalTimezone } from '#app/lib/local-store';
import type { LocalFastingSettings, LocalProfileGoals } from '#app/lib/local-store';
// The routine phrase is built ONCE, by the page that owns the setting, and
// printed here. Two formatters would let the hub and the page disagree about
// what "16:8, starts 20:00" means.
import { fastingRowStatus } from './settings.fasting';
import { readBodyMetrics } from '#app/models/body-metrics';
import { reproductiveStatusLine } from '#app/lib/reproductive-status-line';
import { todayInTimezone } from '#app/lib/user-days';
// Shared with the header avatar menu's AI shortcut, one derivation of "which
// provider is this device connected to", rendered in two places.
import { useAiConnectionStatusLine } from '#app/hooks/use-ai-connection-summary';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { InstallCard } from '#app/components/install-card';
import { SectionEyebrow } from '#app/components/typography';
import { THEME_LABEL_KEYS, getStoredTheme, type Theme } from '#app/components/theme-selector';
import { useInstancePolicy, useSyncServerUrl } from '#app/hooks/use-public-config';
import { useSyncSession } from '#app/components/sync-status';
// The plan page's ONE address (plans-door.ts): the biller sends a browser
// back to it, so a second spelling here would be a page somebody pays on
// and cannot get back to.
import { hasPlansDoor, PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { DEFAULT_LANGUAGE, LANGUAGE_LABELS, isLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`
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
 * `null`, rather than a placeholder string, while the device read that
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
        {/* `line-clamp-2`, not a single-line `truncate`: German subtitles are
            roughly a third longer than the English ones, and at 390px the
            "Data & backup" row lost most of its sentence to an ellipsis. Two
            lines fit every current subtitle in both languages. */}
        {status !== null && <span className="block line-clamp-2 text-xs text-muted-foreground">{status}</span>}
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
// Device reads (all client-side, see the module doc comment)
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

/**
 * The life-phase row's status line: "Not active", or the phase and the number
 * the app derives from the stored date (M215 spec 01).
 *
 * Read for EVERY account. The fieldset behind the row has its own rule about
 * who is asked, but the row itself is never hidden by the sex answer: a person
 * who has not answered it still has to be able to find this page.
 */
function useLifePhaseStatus(): string | null {
  const { t } = useTranslation();
  const goals = useLocalGoals();

  if (goals === undefined) return null;
  const metrics = readBodyMetrics(goals);
  return reproductiveStatusLine({
    reproductiveStatus: metrics.reproductiveStatus,
    pregnancyDueDate: metrics.pregnancyDueDate ?? null,
    lactationStartDate: metrics.lactationStartDate ?? null,
    // The person's own calendar day, the same one every other surface derives
    // a gestation week against.
    today: todayInTimezone(resolveLocalTimezone(goals)),
    t,
  });
}

/** The device's fasting routine, or `undefined` while the first read is in flight. */
function useLocalFastingSettings(): LocalFastingSettings | undefined {
  const [settings, setSettings] = useState<LocalFastingSettings | undefined>(undefined);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const loaded = await getLocalFastingSettings();
      if (!isCancelled) setSettings(loaded);
    })();
    return () => {
      isCancelled = true;
    };
  }, []);

  return settings;
}

/** "Dark · Deutsch". `null` until the theme is readable, localStorage isn't available during SSR/first paint. */
function usePreferencesStatus(): string | null {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  if (theme === null) return null;
  const raw = i18n.resolvedLanguage ?? i18n.language;
  const language: LanguageCode = isLanguageCode(raw) ? raw : DEFAULT_LANGUAGE;
  // The language is named in its own language, never translated.
  return `${t(THEME_LABEL_KEYS[theme])} · ${LANGUAGE_LABELS[language]}`;
}

////////////////////////////////////////////////////////////////////////////////
// The group model (pure)
////////////////////////////////////////////////////////////////////////////////

/** The app's translator, narrowed to what this module asks of it. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** One hub destination, plus the condition that decides whether it is drawn. */
export interface SettingsHubRow {
  to: string;
  icon: LucideIcon;
  title: string;
  status: string | null;
  /** Whether this instance and this account can see the row at all. */
  isVisible: boolean;
}

/** A heading and the rows under it. Only rows a person can actually see survive into one of these. */
export interface SettingsHubGroup {
  label: string;
  rows: SettingsHubRow[];
}

/** Everything the hub needs to know, all of it read on the device by the component below. */
export interface SettingsHubFacts {
  t: Translate;
  /** The AI row's status line, `null` while the device read is in flight. */
  aiStatus: string | null;
  lifePhaseStatus: string | null;
  preferencesStatus: string | null;
  /**
   * The device's goals row, `null` when nothing is stored and `undefined`
   * while the first read is in flight. The nutrition row's status line is
   * derived from it, so the live figure a person set is on the hub.
   */
  goals: LocalProfileGoals | null | undefined;
  /**
   * The device's fasting routine, `null` when nothing is stored and
   * `undefined` while the first read is in flight. The fasting row's status
   * line is derived from it, so the live routine is on the hub.
   */
  fastingSettings: LocalFastingSettings | null | undefined;
  /** The account row's status line: an address, or "signed out". */
  accountStatus: string;
  /** A managed instance brings its own AI, so there is no provider to pick and no key to bring. */
  aiComesFromTheInstance: boolean;
  /** `SYNC_SERVER_URL` is set on this instance. Unset means no sync UI anywhere. */
  hasSyncServer: boolean;
  isAdmin: boolean;
  /** This instance sells a plan (`hasPlansDoor`), so the plan page exists. */
  hasPlanPage: boolean;
  version: string;
}

/**
 * The nutrition row's status line: the goal the person actually set, carbs
 * first and calories for a calorie-only tracker, which is the same precedence
 * the diary hero uses.
 *
 * `null` while the device read is in flight, so the row never flashes a wrong
 * value, and the page's own name for itself once there is no goal at all: a
 * person with nothing set is told what the page holds rather than that they
 * are missing something.
 */
export function nutritionRowStatus({
  goals,
  t,
}: {
  goals: LocalProfileGoals | null | undefined;
  t: Translate;
}): string | null {
  if (goals === undefined) return null;
  const netCarbsCeiling = goals?.goalNetCarbsCeilingG ?? null;
  if (netCarbsCeiling !== null) return t('settings.rows.goals.carbs', { grams: netCarbsCeiling });
  const kcalTarget = goals?.goalKcalTarget ?? null;
  if (kcalTarget !== null) return t('settings.rows.goals.calories', { kcal: kcalTarget });
  return t('settings.rows.nutrition.status');
}

/**
 * The seven groups of the hub, in order, with every hidden row and every empty
 * group already gone.
 *
 * ── WHY A GROUP CAN COME OUT EMPTY ───────────────────────────────────────
 *
 * "Account and plan" is built entirely from conditional rows: the account row
 * and sharing and research ride `SYNC_SERVER_URL`, the plan row rides the
 * biller, and the admin row rides one account's role. On an instance with no
 * sync server every one of them is hidden, and without the filter below the
 * page would draw that heading over nothing. So the guard lives here, in the
 * model, rather than inside the rendering component: an empty group is a fact
 * about the data, and a test can read it without a DOM.
 */
export function buildSettingsHubGroups(facts: SettingsHubFacts): SettingsHubGroup[] {
  const { t } = facts;
  const groups: SettingsHubGroup[] = [
    {
      label: t('settings.groups.profile'),
      rows: [
        {
          to: '/settings/profile',
          icon: UserRound,
          title: t('profile.title'),
          status: t('settings.rows.profile.status'),
          isVisible: true,
        },
        // ALWAYS RENDERED, for every account (M215 spec 01). The question
        // behind it is gated by the sex answer inside the fieldset, but the
        // ROW is not: a person who never answered that question still has to
        // be able to find their life phase.
        {
          to: '/settings/life-phase',
          icon: HeartPulse,
          title: t('lifePhase.title'),
          status: facts.lifePhaseStatus,
          isVisible: true,
        },
      ],
    },
    {
      label: t('settings.groups.nutrition'),
      rows: [
        {
          to: '/settings/nutrition',
          icon: Target,
          title: t('nutrition.title'),
          status: nutritionRowStatus({ goals: facts.goals, t }),
          isVisible: true,
        },
        // The fasting ROUTINE (M216), never the timer: `/fasting` is a screen
        // you open to start something, this row is the preference behind it.
        {
          to: '/settings/fasting',
          icon: Timer,
          title: t('settings.hub.fasting.label'),
          status: fastingRowStatus({ settings: facts.fastingSettings, t }),
          isVisible: true,
        },
      ],
    },
    {
      // THE PROVIDER ROW IS ABSENT ON A MANAGED INSTANCE (M192/05). There is
      // no key to bring there and no provider to pick: photo estimates come
      // with the account, and the whole of `/settings/ai` is a page about
      // choosing and paying a provider. Offering it would send somebody to a
      // screen that cannot help them and reads as "your connection is
      // missing". The allowance lives on `/settings/account` instead.
      label: t('settings.groups.scanning'),
      rows: [
        {
          to: '/settings/ai',
          icon: Sparkles,
          title: t('settings.rows.ai.title'),
          status: facts.aiStatus,
          isVisible: !facts.aiComesFromTheInstance,
        },
      ],
    },
    {
      label: t('settings.groups.appearance'),
      rows: [
        {
          to: '/settings/preferences',
          icon: SlidersHorizontal,
          title: t('settings.rows.preferences.title'),
          status: facts.preferencesStatus,
          isVisible: true,
        },
      ],
    },
    {
      // ACCOUNT-SCOPED, all five of them, which is why "Your foods" and "Your
      // meals" moved out: those are device-local lists that exist with no
      // account and no server at all.
      label: t('settings.groups.account'),
      rows: [
        {
          to: '/settings/account',
          icon: ShieldCheck,
          title: t('settings.rows.account.title'),
          status: facts.accountStatus,
          isVisible: facts.hasSyncServer,
        },
        {
          to: PLAN_PAGE_HREF,
          icon: CreditCard,
          title: t('settings.rows.plan.title'),
          status: t('settings.rows.plan.status'),
          isVisible: facts.hasPlanPage,
        },
        // Sharing rides the same gate as the account row and for the same
        // reason: a share is a third wrap of the sync DEK, so an instance
        // with no sync has nothing to share. Whether the SERVER offers
        // sharing is a separate question the page itself answers, it cannot
        // be known here without asking, and asking on the hub would fire a
        // request on every settings visit.
        {
          to: '/settings/sharing',
          icon: Share2,
          title: t('settings.rows.sharing.title'),
          status: t('settings.rows.sharing.status'),
          isVisible: facts.hasSyncServer,
        },
        // Research contributions ride the same sync gate as sharing: a
        // contribution is pushed to the sync service. Whether that service
        // has a research lane at all is a question only the page can answer.
        {
          to: '/settings/research',
          icon: FlaskConical,
          title: t('settings.rows.research.title'),
          status: t('settings.rows.research.status'),
          isVisible: facts.hasSyncServer,
        },
        // ADMINISTRATORS ONLY, and read from the session rather than from a
        // request. `/admin` renders the not-an-administrator card to everybody
        // else, so this row is discoverability, not access control.
        {
          to: '/admin',
          icon: ShieldCheck,
          title: t('settings.rows.admin.title'),
          status: t('settings.rows.admin.status'),
          isVisible: facts.isAdmin,
        },
      ],
    },
    {
      // Items 1 and 5 (M123/07): "Your foods" was write-only from `/add`'s
      // sheet and saved meals had no surface at all. Both get a settings row
      // rather than living only inside the add flow, so they are discoverable
      // the same way every other durable device-local list already is.
      label: t('settings.groups.lists'),
      rows: [
        { to: '/foods', icon: Apple, title: t('settings.rows.foods.title'), status: null, isVisible: true },
        { to: '/meals', icon: BookMarked, title: t('settings.rows.meals.title'), status: null, isVisible: true },
        {
          to: '/settings/data',
          icon: Database,
          title: t('settings.rows.data.title'),
          status: t('settings.rows.data.status'),
          isVisible: true,
        },
      ],
    },
    {
      // Provenance (M146 spec 01): version, licence, source. Ungated, the
      // repository link is true on every instance, so unlike the account rows
      // above there is nothing to switch off for a self-hoster.
      label: t('settings.groups.about'),
      rows: [
        {
          to: '/settings/about',
          icon: Info,
          title: t('settings.rows.about.title'),
          status: t('settings.rows.about.status', { version: facts.version }),
          isVisible: true,
        },
      ],
    },
  ];

  return groups
    .map((group) => ({ label: group.label, rows: group.rows.filter((row) => row.isVisible) }))
    .filter((group) => group.rows.length > 0);
}

////////////////////////////////////////////////////////////////////////////////
// Page
////////////////////////////////////////////////////////////////////////////////

export default function SettingsIndex() {
  const { t } = useTranslation();
  const aiStatus = useAiConnectionStatusLine();
  const lifePhaseStatus = useLifePhaseStatus();
  const goals = useLocalGoals();
  const fastingSettings = useLocalFastingSettings();
  const preferencesStatus = usePreferencesStatus();
  // `null` unless the operator set `SYNC_SERVER_URL`. On that instance the
  // account row renders NOTHING, no row, no mention (AGENTS.md: unset means no
  // sync UI anywhere), and the whole group it sits in goes with it.
  const syncServerUrl = useSyncServerUrl();
  // The provider row is a page about choosing and paying an AI provider, so
  // the question is where the AI comes from, not what the mode is called
  // (M201/07).
  const { aiComesFromTheInstance } = useInstancePolicy();
  const session = useSyncSession();
  const instance = useServerInstance();

  const groups = buildSettingsHubGroups({
    t,
    aiStatus,
    lifePhaseStatus,
    preferencesStatus,
    goals,
    fastingSettings,
    accountStatus: session.account === null ? t('settings.rows.account.signedOut') : session.account.email,
    aiComesFromTheInstance,
    hasSyncServer: syncServerUrl !== null,
    isAdmin: session.account?.role === 'admin',
    hasPlanPage: hasPlansDoor(instance),
    version: BUILD.version,
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {groups.map((group) => (
        <SettingsGroup key={group.label} label={group.label}>
          {group.rows.map((row) => (
            <SettingsRow key={row.to} to={row.to} icon={row.icon} title={row.title} status={row.status} />
          ))}
        </SettingsGroup>
      ))}

      {/* Renders nothing unless the app is installable and not already standalone.
          `id="install"` gives the app-chrome nav drawer's iOS "Install app" item
          (`app-wrapper.tsx`) an anchor to jump straight to these instructions. */}
      {/* `scroll-mt-20` keeps this clear of the pinned app header (see
          `app-wrapper.tsx`) when the drawer link jumps here by hash. */}
      <div id="install" className="scroll-mt-20">
        <InstallCard />
      </div>
    </div>
  );
}
