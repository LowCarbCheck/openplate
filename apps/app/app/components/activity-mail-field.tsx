/**
 * The reminder-email box on the sign-up form: one checkbox, its sentence, and
 * a hint under it (2026-11).
 *
 * UNTICKED, ALWAYS. A reminder is mail the person did not ask for until they
 * tick this, and EU law wants the tick to be an act, so nothing here ticks the
 * box for anybody. The caller owns the value: Conform's `getInputProps` on
 * `/join`.
 *
 * The box is drawn only where the instance's handshake says it sends
 * reminders (`InstanceDescriptor.activityMail`). Where it does not, the form
 * has no such field at all and the signup body carries no trace of it.
 *
 * NOTHING ON IT CHANGES SIZE: the hint is always rendered, not revealed, so
 * the button below it never moves (DESIGN.md section 7).
 */
import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

export interface ActivityMailFieldProps {
  /** The checkbox's attributes, `id` and `name` included: Conform's `getInputProps(field, { type: 'checkbox' })`. */
  inputProps: InputHTMLAttributes<HTMLInputElement> & { id: string };
}

export function ActivityMailField({ inputProps }: ActivityMailFieldProps) {
  const { t } = useTranslation();
  const hintId = `${inputProps.id}-hint`;
  return (
    <div data-slot="activity-mail" className="space-y-1.5">
      <div className="flex items-start gap-2.5">
        <input
          {...inputProps}
          type="checkbox"
          aria-describedby={hintId}
          data-slot="activity-mail-box"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <label htmlFor={inputProps.id} className="text-sm leading-relaxed">
          {t('activityMail.signup.label')}
        </label>
      </div>
      <p id={hintId} data-slot="activity-mail-hint" className="pl-6.5 text-xs text-muted-foreground">
        {t('activityMail.signup.hint')}
      </p>
    </div>
  );
}
