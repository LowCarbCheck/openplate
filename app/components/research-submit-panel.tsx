/**
 * SEND A WINDOW (M163/02).
 *
 * The person picks the calendar days of her own diary that leave this device,
 * reads what a day carries, and sends. Everything this component decides lives
 * in `app/lib/sync/research/submit-view.ts` — the empty start, whether a draft
 * is sendable, and which sentence an outcome earns — so those three are
 * assertable without rendering anything.
 *
 * ── The picker starts empty ─────────────────────────────────────────────
 *
 * A pre-filled "last 90 days" is a pre-filled consent. The range is the thing
 * being consented to, so it is asked for, never proposed.
 *
 * ── What is stated BEFORE the send, and what after ───────────────────────
 *
 * Before: whole calendar days, the fields a day carries, and never a time, a
 * food name or a photo — the same two sentences the enrolment card shows,
 * because they are the same promise and a second wording would be a second
 * thing to keep true. After: the days that were ACCEPTED and the version they
 * landed at, which is the fact `research/contribute.ts` wrote to the pin.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import {
  EMPTY_WINDOW_DRAFT,
  isSendableWindow,
  type ResearchWindowDraft,
  type SubmitOutcomeCopy,
} from '#app/lib/sync/research/submit-view';

export function ResearchSubmitPanel({
  studyAccountId,
  onSubmit,
  isSubmitting,
  outcome,
}: {
  /** Only used to keep the two field ids unique — the screen lists one panel per study. */
  studyAccountId: number;
  onSubmit: (draft: ResearchWindowDraft) => void;
  isSubmitting: boolean;
  /** The last outcome, or `null` when nothing has been sent from this panel yet. */
  outcome: SubmitOutcomeCopy | null;
}) {
  const { t } = useTranslation();
  // Empty, from the constant that says why. A default here would be a range
  // this screen chose on the person's behalf.
  const [draft, setDraft] = useState<ResearchWindowDraft>(EMPTY_WINDOW_DRAFT);
  const fromId = `research-window-from-${studyAccountId}`;
  const toId = `research-window-to-${studyAccountId}`;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(draft);
  };

  return (
    <form className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4" onSubmit={handleSubmit}>
      <p className="text-sm font-medium">{t('research.submit.title')}</p>
      <p className="text-xs text-muted-foreground">{t('research.submit.description')}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={fromId}>{t('research.submit.fromLabel')}</Label>
          <Input
            id={fromId}
            type="date"
            value={draft.fromDayKey}
            onChange={(event) => setDraft({ ...draft, fromDayKey: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={toId}>{t('research.submit.toLabel')}</Label>
          <Input
            id={toId}
            type="date"
            value={draft.toDayKey}
            onChange={(event) => setDraft({ ...draft, toDayKey: event.target.value })}
          />
        </div>
      </div>

      {/* Stated before the send, not after it. */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{t('research.enrolments.window')}</p>
        <p>{t('research.enrolments.fields')}</p>
      </div>

      <Button type="submit" className="h-11 w-full" disabled={!isSendableWindow(draft) || isSubmitting}>
        {isSubmitting ?
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
        {t('research.submit.cta')}
      </Button>

      {outcome !== null && <p className="text-sm text-muted-foreground">{t(outcome.key, outcome.params)}</p>}
    </form>
  );
}
