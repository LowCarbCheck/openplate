/**
 * The bottom sheet that ends a fast: how it went, in one word, and a line
 * about it if the person wants one.
 *
 * BOTH ANSWERS ARE OPTIONAL, and the confirm button never waits for either.
 * A fast that ended is a fact; a feeling about it is a question, and a
 * question that blocks the record is a question the app had no right to ask.
 * Nothing here is required, nothing is pre-selected, and a second press of a
 * chosen mood chip takes it back.
 *
 * PRESENTATIONAL. The sheet reports a mood and a note through `onConfirm`; the
 * route owns the fetcher, the intent and the store write. That is what lets
 * `tests/unit/fasting-route.test.ts` render it without a router.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldError } from '#app/components/field-error';
import { fastingChipClass } from '#app/components/fasting/chip-class';
import { SubmitButton } from '#app/components/submit-button';
import { Label } from '#app/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#app/components/ui/sheet';
import type { FastMood } from '#app/lib/local-store';
import { FAST_NOTE_MAX_LENGTH } from '#app/models/fasting';

/** The three answers, in the order they are offered: worst to best, left to right. */
const MOODS: readonly FastMood[] = ['rough', 'ok', 'good'];

export interface EndFastReflection {
  /** The chosen mood, or null when the person did not answer. */
  mood: FastMood | null;
  /** The typed note, trimmed, or null when it is empty. */
  note: string | null;
}

export interface EndFastSheetProps {
  /** Whether the sheet is showing. Owned by the caller so the trigger can live anywhere. */
  isOpen: boolean;
  /** Called with the next open state, including on a dismiss. */
  onOpenChange: (isOpen: boolean) => void;
  /** Whether the end submission is in flight. */
  isSaving: boolean;
  /** Errors to show under the note, e.g. a note over the ceiling. */
  noteErrors?: string[];
  /** Hands the answers up. The caller submits. */
  onConfirm: (reflection: EndFastReflection) => void;
}

const NOTE_FIELD_ID = 'end-fast-note';

/**
 * The label on the button that opens this sheet.
 *
 * ONE control, two words. "Complete" once the target is cleared and the plain
 * end label before it: the same act reads as finishing something or as
 * stopping it, and which one it is depends on the clock rather than on how the
 * app feels about the person (DESIGN.md section 10.1). A second, separate
 * "Complete" button would make ending early look like the wrong door.
 *
 * A function rather than a ternary inline in the card, so
 * `tests/unit/fasting-route.test.ts` can falsify the boundary without a DOM.
 *
 * @param hasReachedTarget - `FastTimeline.hasReachedTarget`.
 * @returns the catalog key for the button label.
 */
export function endLabelKey(hasReachedTarget: boolean): string {
  return hasReachedTarget ? 'fasting.active.complete' : 'fasting.active.end';
}

/** The sheet. Mood and note are local state; nothing is stored until Confirm. */
export function EndFastSheet({
  isOpen,
  onOpenChange,
  isSaving,
  noteErrors,
  onConfirm,
}: EndFastSheetProps): ReactElement {
  const { t } = useTranslation();
  const [mood, setMood] = useState<FastMood | null>(null);
  const [note, setNote] = useState('');

  const confirm = () => {
    const trimmed = note.trim();
    onConfirm({ mood, note: trimmed === '' ? null : trimmed });
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="motion-reduce:transition-none motion-reduce:animate-none rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle>{t('fasting.end.title')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('fasting.end.moodLabel')}</p>
            <fieldset className="flex flex-wrap gap-2" aria-label={t('fasting.end.moodLabel')}>
              {MOODS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={mood === candidate}
                  // A second press clears it: the person may have tapped by
                  // mistake, and there is no fourth "actually, nothing" chip
                  // to tap instead.
                  onClick={() => setMood(mood === candidate ? null : candidate)}
                  className={fastingChipClass(mood === candidate)}
                >
                  {t(`fasting.end.mood.${candidate}`)}
                </button>
              ))}
            </fieldset>
          </div>

          <div className="space-y-2">
            <Label htmlFor={NOTE_FIELD_ID}>{t('fasting.end.note')}</Label>
            <textarea
              id={NOTE_FIELD_ID}
              name="note"
              rows={3}
              maxLength={FAST_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full resize-none rounded-2xl border border-input bg-card px-3 py-2 text-base outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
            <FieldError id={`${NOTE_FIELD_ID}-error`} errors={noteErrors} />
          </div>

          <SubmitButton
            type="button"
            pending={isSaving}
            pendingLabel={t('fasting.plan.saving')}
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={confirm}
          >
            {t('fasting.end.confirm')}
          </SubmitButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
