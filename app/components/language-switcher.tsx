/**
 * language-switcher.tsx, the language choice as a segmented strip in the device menu.
 *
 * The operator's words for where this lives: "in the top next to the theme icon". In this app
 * the theme control is `ThemeRow` inside `AvatarMenu` (`avatar-menu.tsx`), the top-right avatar
 * dropdown, so this row sits directly under it and wears the same grammar: real Radix
 * `RadioItem`s in a rounded muted strip, the active one drawn as a filled cell.
 *
 * ── THE SAME MECHANISM AS THE SETTINGS PAGE, NOT A SECOND ONE ──
 * `/settings/preferences` already lists the languages, and it and this strip call one function,
 * `selectLanguage` from `app/i18n/language-prefs.ts`: cookie, then the localStorage mirror, then
 * a full document reload. Nothing here writes a preference of its own, so the two controls cannot
 * drift apart on what a switch means.
 *
 * ── A GRID, NOT A ROW ──
 * Six names in one line do not fit a 16rem menu on a phone, and a horizontal overflow inside a
 * dropdown is invisible until a finger tries to reach the last cell. The strip is a three-column
 * grid, so six languages are two rows and a seventh starts a third; every cell is as wide as its
 * column and the strip's `scrollWidth` equals its `clientWidth`, which the browser tier asserts
 * at 390px (`tests/e2e/settings-pages.spec.ts`).
 *
 * ── KEYBOARD ──
 * Radix's roving focus walks radio items in DOM order with Up and Down whatever the visual layout,
 * exactly as it does for the theme strip above. `preventDefault` on select is NOT applied here,
 * unlike the theme: a language change reloads the document, so there is no menu to keep open.
 *
 * ── NO HYDRATION GATE ──
 * The theme strip shows nothing selected before hydration because the theme lives in
 * localStorage, which the server cannot read. The language is different: the server rendered
 * this document from the same cookie the client reads, so the active code is known on the first
 * paint and is marked from the start.
 */
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isLanguageCode,
  selectLanguage,
  type LanguageCode,
} from '#app/i18n/language-prefs';
import { trackPreferenceChanged } from '#app/lib/matomo-events';
import { cn } from '#app/lib/utils';

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from './ui/dropdown-menu';

/**
 * The `data-slot` the browser tier finds the strip by, so the assertion does not depend on a
 * class list that a restyle is allowed to change.
 */
export const LANGUAGE_STRIP_SLOT = 'language-strip';

/** The language the UI is rendering in right now, narrowed to a code the app ships. */
export function useActiveLanguage(): LanguageCode {
  const { i18n } = useTranslation();
  const raw = i18n.resolvedLanguage ?? i18n.language;
  return isLanguageCode(raw) ? raw : DEFAULT_LANGUAGE;
}

/**
 * The switch itself: count it only on a real change, and count it BEFORE the call, because
 * `selectLanguage` reloads the document and a push queued behind that reload may never be sent.
 * Its two writes cannot fail, so the count is still only of real changes.
 */
export function switchLanguage(next: string, active: LanguageCode): void {
  if (!isLanguageCode(next)) return;
  if (next !== active) trackPreferenceChanged('language');
  selectLanguage(next);
}

/**
 * The strip, as a Radix radio group so it composes into `DropdownMenuContent`. It must be rendered
 * inside a `DropdownMenu`; `tests/unit/language-switcher.test.tsx` renders it through one.
 */
export function LanguageRow() {
  const active = useActiveLanguage();

  return (
    <DropdownMenuRadioGroup
      value={active}
      onValueChange={(value) => switchLanguage(value, active)}
      data-slot={LANGUAGE_STRIP_SLOT}
      className="grid grid-cols-3 gap-1 bg-muted/40 p-1"
    >
      {SUPPORTED_LANGUAGES.map((code) => (
        <DropdownMenuRadioItem
          key={code}
          value={code}
          // The language is named in its own language, never translated, and `lang` tells a
          // screen reader to pronounce it that way.
          lang={code}
          className={cn(
            // The primitive's first child is its absolutely-positioned dot indicator; a
            // segmented cell says "selected" with the whole filled cell instead, so the dot
            // and the `pl-8` reserved for it go away.
            '[&>span:first-child]:hidden',
            'min-h-11 min-w-0 cursor-pointer justify-center px-2 py-2 text-xs font-medium',
            'text-muted-foreground data-[state=checked]:bg-background data-[state=checked]:text-foreground',
            'data-[state=checked]:shadow-sm data-[state=checked]:ring-1 data-[state=checked]:ring-primary/30',
          )}
        >
          <span>{LANGUAGE_LABELS[code]}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
