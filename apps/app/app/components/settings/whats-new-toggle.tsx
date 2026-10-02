/**
 * The switch that shows or hides the "What's new" card and its row in About.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────
 *
 * The EFFECTIVE state, not the stored one. An administrator who never touched
 * it sees the switch on, because that is what their screens do; a member sees it
 * off. Flipping it stores an explicit choice, which then wins over the role in
 * both directions (`#app/lib/whats-new-visibility`).
 *
 * ── WHY IT MOVES NOTHING ─────────────────────────────────────────────────
 *
 * The row is the same box in every state: the label, the switch and one
 * description line are always drawn. Only the switch's `checked` changes, so an
 * administrator's role arriving a moment after the page flips a thumb and
 * shifts no layout.
 *
 * Preferences is the home for it because that page is reachable signed out, and
 * the card has to be switchable by the people it is hidden from.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { SETTINGS_INSET_CLASS } from '#app/components/settings/settings-section';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import { useWhatsNewVisible } from '#app/hooks/use-whats-new-visible';
import { setWhatsNewVisible } from '#app/lib/whats-new-visibility';
import { cn } from '#app/lib/utils';

/**
 * The switch, with its label and one line of explanation.
 *
 * @returns the settings row.
 */
export function WhatsNewToggle(): ReactElement {
  const { t } = useTranslation();
  const isVisible = useWhatsNewVisible();

  return (
    <div data-slot="settings-inset" className={cn(SETTINGS_INSET_CLASS, 'space-y-3 px-4 py-4')}>
      {/* The ROW is the target, not the 32px track. */}
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="whats-new-visible" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('preferences.whatsNew.label')}
        </Label>
        <Switch id="whats-new-visible" checked={isVisible} onCheckedChange={setWhatsNewVisible} />
      </div>
      <p className="text-sm text-muted-foreground">{t('preferences.whatsNew.description')}</p>
    </div>
  );
}
