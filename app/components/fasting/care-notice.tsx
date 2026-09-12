/**
 * The two pieces of care copy on `/fasting`: the sheet shown once before a
 * first fast of 24 h or more, and the quiet notice that sits above the plan
 * card while the profile says pregnant or breastfeeding.
 *
 * NEITHER OF THEM STOPS ANYONE. The sheet has one button and it proceeds; the
 * notice has no button at all. openplate states what is known and then gets
 * out of the way, because an app that refuses an adult a choice about their own
 * body has appointed itself their doctor (DESIGN.md section 10.1).
 *
 * NOT AMBER, NOT DESTRUCTIVE, NO WARNING ICON. The notice is a muted card in
 * ordinary text. Colouring it as an alarm would make it a thing to dismiss
 * rather than a thing to read, and the person it is addressed to already knows
 * they are pregnant.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '#app/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#app/components/ui/sheet';

export interface CareSheetProps {
  /** Whether the sheet is showing. Owned by the caller. */
  isOpen: boolean;
  /** Called with the next open state, including on a dismiss. */
  onOpenChange: (isOpen: boolean) => void;
  /**
   * Acknowledges the sheet and proceeds with the start the person already
   * asked for. A dismiss does NOT acknowledge, so backing out leaves the sheet
   * to be shown again next time.
   */
  onUnderstood: () => void;
}

/** The one-time sheet before an extended fast. Three paragraphs and one button. */
export function CareSheet({ isOpen, onOpenChange, onUnderstood }: CareSheetProps): ReactElement {
  const { t } = useTranslation();

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="motion-reduce:transition-none motion-reduce:animate-none rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle>{t('fasting.care.title')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-4">
          <p className="text-sm text-muted-foreground">{t('fasting.care.who')}</p>
          <p className="text-sm text-muted-foreground">{t('fasting.care.stop')}</p>
          <p className="text-sm text-muted-foreground">{t('fasting.care.water')}</p>
          <Button type="button" className="h-11 w-full sm:h-9 sm:w-auto" onClick={onUnderstood}>
            {t('fasting.care.understood')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The notice above the plan card. A plain muted card, no icon, no border
 * accent: it is a sentence the person reads once and then plans around.
 */
export function PregnancyNotice(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
      <p className="text-sm text-muted-foreground">{t('fasting.care.pregnancyNotice')}</p>
    </div>
  );
}
