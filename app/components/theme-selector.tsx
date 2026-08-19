/**
 * theme-selector.tsx — the theme control as it lives in Preferences (M129/05).
 *
 * Same storage protocol as the old header dropdown (`theme-toggle.tsx`): the
 * choice is written to `localStorage.theme` and applied by `window.__applyTheme`,
 * the blocking script in `app/root.tsx` that also runs before first paint so a
 * dark-mode user never sees a white flash. Nothing here talks to the server —
 * the theme is a device preference, exactly like the language next to it.
 *
 * The shape changed from a dropdown to a three-up segmented control because
 * this is now a settings row, not a toolbar affordance: all three options are
 * visible, the active one is obvious without opening anything, and each target
 * clears the 44px touch minimum.
 */
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '#app/lib/utils';

export type Theme = 'system' | 'light' | 'dark';

/**
 * The bridge the blocking script in `app/root.tsx` installs. Declared here
 * because this is now the only component that talks to it.
 */
declare global {
  interface Window {
    __applyTheme?: () => void;
    __getStoredTheme?: () => string;
  }
}

/**
 * Reads the persisted theme through the same `window.__getStoredTheme` bridge
 * the root script defines, so there is one reader of `localStorage.theme` in
 * the app. Returns `'system'` during SSR and before the script has run.
 */
export function getStoredTheme(): Theme {
  const readStoredTheme = globalThis.window === undefined ? undefined : window.__getStoredTheme;
  if (readStoredTheme === undefined) return 'system';
  // The bridge hands back whatever sits in `localStorage.theme`, which any
  // extension or older build could have written — accept only the three
  // themes this app knows, and fall back to `system` for anything else.
  const stored = readStoredTheme();
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/**
 * The catalog key for each theme's display label. Exported because the
 * settings hub (`routes/settings._index.tsx`) shows the active theme in its
 * Preferences row status line — one source for the wording, so the row and
 * the control can't disagree.
 */
export const THEME_LABEL_KEYS = {
  light: 'preferences.theme.light',
  dark: 'preferences.theme.dark',
  system: 'preferences.theme.system',
} satisfies Record<Theme, string>;

/**
 * The three options with their wording and icons, in display order. Exported
 * because the header avatar menu offers the same choice inline
 * (`components/avatar-menu.tsx`) — one list, so the two controls can never
 * offer different options or different words for them.
 */
export const THEME_OPTIONS = [
  { value: 'light', labelKey: THEME_LABEL_KEYS.light, icon: Sun },
  { value: 'dark', labelKey: THEME_LABEL_KEYS.dark, icon: Moon },
  { value: 'system', labelKey: THEME_LABEL_KEYS.system, icon: Monitor },
] as const satisfies ReadonlyArray<{ value: Theme; labelKey: string; icon: typeof Sun }>;

/**
 * The theme preference as state: what's stored, whether we've read it yet, and
 * how to change it. The storage protocol (write `localStorage.theme`, then let
 * `window.__applyTheme` do the DOM work) lives here once, so every control that
 * offers the choice writes it the same way.
 *
 * @returns `theme` (`'system'` until hydrated), `hydrated` (false during SSR
 *   and the first client render, when nothing may be shown as selected — the
 *   server's markup can't know localStorage), and `selectTheme`.
 */
export interface ThemePreference {
  theme: Theme;
  hydrated: boolean;
  selectTheme: (next: Theme) => void;
}

export function useThemePreference(): ThemePreference {
  // `'system'` on the server and on the very first client render — the real
  // value arrives in the effect below, which is also what keeps hydration
  // stable.
  const [theme, setTheme] = useState<Theme>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTheme(getStoredTheme());
    setHydrated(true);
  }, []);

  // Re-apply whenever the system preference flips, so a `system` user follows
  // their OS without a reload.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => window.__applyTheme?.();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  function selectTheme(next: Theme): void {
    setTheme(next);
    localStorage.setItem('theme', next);
    window.__applyTheme?.();
  }

  return { theme, hydrated, selectTheme };
}

export function ThemeSelector() {
  const { t } = useTranslation();
  const { theme, hydrated, selectTheme } = useThemePreference();

  return (
    <div
      role="radiogroup"
      aria-label={t('preferences.theme.title')}
      className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-1.5"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        // Before hydration nothing is marked active — showing `system` as
        // selected would be a guess, and a wrong one for most users.
        const isActive = hydrated && theme === option.value;
        return (
          // A real radio carries the semantics; it is visually hidden and the
          // label is the segment, so the rendered control is unchanged while
          // the group works with native keyboard/AT behaviour.
          <label
            key={option.value}
            className={cn(
              'flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-primary',
              isActive ?
                'bg-background text-foreground shadow-sm ring-1 ring-primary/30'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={isActive}
              onChange={() => selectTheme(option.value)}
              className="sr-only"
            />
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{t(option.labelKey)}</span>
          </label>
        );
      })}
    </div>
  );
}
