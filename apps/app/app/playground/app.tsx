/**
 * The states playground: every state of the screens named here, on one page,
 * without provoking the condition that produces it. DEV ONLY, see
 * `playground.html`.
 *
 * ── THE TWO RULES THIS PAGE KEEPS ────────────────────────────────────────
 *
 * 1. It mounts the REAL components with their REAL props. Nothing here is a
 *    copy of a component, and no component was given a prop it does not
 *    already have. A fixture is a plain typed object that satisfies the real
 *    prop type. Where a state cannot be reached through props, the card says
 *    so in words.
 * 2. Every card carries a "Reach it for real" line: one sentence telling a
 *    person how to get that state in the real app. A picture of a state is
 *    only useful if you can also get there, and writing the sentence is what
 *    stops a card drifting into a state the app can no longer produce.
 *
 * ── THE PAGE IS SPLIT INTO PAGES ─────────────────────────────────────────
 *
 * This file owns the chrome and the registry. Each section is its own page
 * with its own address (`#admin-people`), loaded only when it is opened, and
 * its groups are sub-pages of it (`#admin-people:filters`). A card has an
 * address too (`#admin-people/people-mixed`).
 *
 * ── ADDING A SECTION: ONE REGISTRY LINE AND ONE FILE ─────────────────────
 *
 * 1. Write `sections/<id>.tsx`. It exports `DEF` (id, title, intent) and a
 *    default component that draws one `Section` of `Group`s of `Card`s.
 * 2. Add `{ def: { id, title }, load: () => import('./sections/<id>') }` to
 *    `SECTIONS` below. Keep the `import()` a literal path so Vite splits the
 *    chunk; `tests/unit/playground-entry.test.ts` fails the push if it is not.
 *
 * `tests/unit/playground-sections.test.tsx` renders every section and refuses
 * a card with no handle, a repeated handle, and a `DEF` that differs from its
 * registry row.
 */
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';

import i18next from '#app/i18n/i18n';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type LanguageCode } from '#app/i18n/language-prefs';
import {
  PageRouteContext,
  Segmented,
  WidthContext,
  useHashRoute,
  type PageRoute,
  type SectionDef,
  type SegmentedOption,
} from './layout';
import { PlaygroundProviders } from './providers';
import {
  applyThemeChoice,
  readLanguageChoice,
  readThemeChoice,
  readWidthChoice,
  saveLanguageChoice,
  saveThemeChoice,
  saveWidthChoice,
  type ThemeChoice,
  type WidthChoice,
} from './prefs';

/** What a section file exports: its definition, and the component that draws it. */
export interface SectionModule {
  DEF: SectionDef;
  default: ComponentType;
}

/**
 * One row of the registry. `def` is what the nav needs before the section's
 * code is there; the file's own `DEF` carries the same id and title, and the
 * sections test holds the two equal. `load` fetches the section when its page
 * is opened.
 */
export interface SectionEntry {
  readonly def: Pick<SectionDef, 'id' | 'title'>;
  readonly load: () => Promise<SectionModule>;
}

/** The sections, in the order the nav shows them. The first one is the page's default. */
export const SECTIONS: readonly SectionEntry[] = [
  { def: { id: 'overview-hero', title: 'Overview hero' }, load: () => import('./sections/overview-hero') },
  { def: { id: 'admin-people', title: 'Admin: people' }, load: () => import('./sections/admin-people') },
  { def: { id: 'admin-invitations', title: 'Admin: invitations' }, load: () => import('./sections/admin-invitations') },
  { def: { id: 'admin-stats', title: 'Admin: stats row' }, load: () => import('./sections/admin-stats') },
  { def: { id: 'surfaces', title: 'Surfaces' }, load: () => import('./sections/surfaces') },
];

/** One `lazy` per section, made once: a fresh `lazy()` per render would suspend on every render. */
const PAGES = new Map(SECTIONS.map((entry) => [entry.def.id, lazy(entry.load)]));

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly SegmentedOption<ThemeChoice>[];

const WIDTH_OPTIONS = [
  { value: 'phone', label: 'Phone 375' },
  { value: 'full', label: 'Full' },
] as const satisfies readonly SegmentedOption<WidthChoice>[];

const LANGUAGE_OPTIONS: readonly SegmentedOption<LanguageCode>[] = SUPPORTED_LANGUAGES.map((code) => ({
  value: code,
  label: code.toUpperCase(),
  title: LANGUAGE_LABELS[code],
}));

/** Keeps the page painted in the chosen theme, and follows the operating system while the choice is `system`. */
function useAppliedTheme(theme: ThemeChoice): void {
  useEffect(() => {
    applyThemeChoice(theme);
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyThemeChoice('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);
}

interface ControlsProps {
  theme: ThemeChoice;
  onTheme: (next: ThemeChoice) => void;
  language: LanguageCode;
  onLanguage: (next: LanguageCode) => void;
  width: WidthChoice;
  onWidth: (next: WidthChoice) => void;
}

function Controls({ theme, onTheme, language, onLanguage, width, onWidth }: ControlsProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ControlRow label="Theme">
        <Segmented label="Theme" options={THEME_OPTIONS} value={theme} onChange={onTheme} />
      </ControlRow>
      <ControlRow label="Language">
        <Segmented label="Language" options={LANGUAGE_OPTIONS} value={language} onChange={onLanguage} />
      </ControlRow>
      <ControlRow label="Width">
        <Segmented label="Width" options={WIDTH_OPTIONS} value={width} onChange={onWidth} />
        {width === 'phone' && (
          <span className="mt-1 block text-xs text-muted-foreground">
            Container queries see 375 px. Rules like sm: still follow the browser window.
          </span>
        )}
      </ControlRow>
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function SectionLinks({ route }: { route: PageRoute }): ReactElement {
  return (
    <nav aria-label="Sections">
      <ul className="flex flex-col">
        {SECTIONS.map((entry) => (
          <li key={entry.def.id}>
            <a
              href={`#${entry.def.id}`}
              aria-current={entry.def.id === route.activeId ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                route.selectSection(entry.def.id);
              }}
              className={
                entry.def.id === route.activeId ?
                  'block bg-muted px-2 py-1.5 text-sm font-semibold'
                : 'block px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted'
              }
            >
              {entry.def.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The left rail from `lg` up: title, the section list, then the controls. */
function Sidebar({ route, controls }: { route: PageRoute; controls: ControlsProps }): ReactElement {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-e py-4 pe-4 lg:flex">
      <h1 className="text-base font-semibold tracking-tight">openplate states</h1>
      <SectionLinks route={route} />
      <Controls {...controls} />
    </aside>
  );
}

/** Below `lg`: a bar with the title and a section picker, and the controls under it. */
function TopBar({ route, controls }: { route: PageRoute; controls: ControlsProps }): ReactElement {
  return (
    <header className="sticky top-0 z-10 mb-4 flex flex-col gap-3 border-b bg-background py-3 lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">openplate states</h1>
        <select
          aria-label="Section"
          value={route.activeId}
          onChange={(event) => route.selectSection(event.target.value)}
          className="border bg-background px-2 py-1 text-sm"
        >
          {SECTIONS.map((entry) => (
            <option key={entry.def.id} value={entry.def.id}>
              {entry.def.title}
            </option>
          ))}
        </select>
      </div>
      <Controls {...controls} />
    </header>
  );
}

/** The page under the chrome: the active section's lazy page, with a box held open while it loads. */
function ActivePage({ activeId }: { activeId: string }): ReactElement {
  const Page = PAGES.get(activeId);
  if (Page === undefined) throw new Error(`No playground section has the id "${activeId}"`);
  return (
    <Suspense fallback={<p className="min-h-[60dvh] text-sm text-muted-foreground">Loading section</p>}>
      <Page />
    </Suspense>
  );
}

/** The page. Holds the three controls, remembers them, and draws the chrome around the active section. */
export function PlaygroundApp(): ReactElement {
  const [theme, setTheme] = useState(readThemeChoice);
  const [language, setLanguage] = useState(readLanguageChoice);
  const [width, setWidth] = useState(readWidthChoice);
  const route = useHashRoute(SECTIONS.map((entry) => entry.def.id));
  useAppliedTheme(theme);
  // Back to the top when the section changes, unless the address names a card (the section scrolls to it).
  useEffect(() => {
    if (route.cardHandle === null) window.scrollTo(0, 0);
  }, [route.activeId, route.cardHandle]);

  const controls: ControlsProps = {
    theme,
    onTheme: (next) => {
      setTheme(next);
      saveThemeChoice(next);
    },
    language,
    onLanguage: (next) => {
      setLanguage(next);
      saveLanguageChoice(next);
      // The app's own switcher reloads the page. Here the cards stay mounted, so the singleton
      // changes live and every `useTranslation` below re-renders.
      void i18next.changeLanguage(next);
    },
    width,
    onWidth: (next) => {
      setWidth(next);
      saveWidthChoice(next);
    },
  };

  return (
    <PlaygroundProviders>
      <WidthContext.Provider value={width}>
        <PageRouteContext.Provider value={route}>
          <div className="mx-auto flex min-h-dvh w-full max-w-[2000px] gap-6 bg-background px-4 text-foreground lg:px-6">
            <Sidebar route={route} controls={controls} />
            <main className="min-w-0 flex-1 pb-[50dvh]">
              <TopBar route={route} controls={controls} />
              <div className="pt-4">
                <ActivePage activeId={route.activeId} />
              </div>
            </main>
          </div>
        </PageRouteContext.Provider>
      </WidthContext.Provider>
    </PlaygroundProviders>
  );
}
