/**
 * The consent to health data as a step of its own, for the two flows that
 * meet it before any page of the app can ask (M266, 2026-09-29).
 *
 * WHERE IT IS DRAWN. openplate-core refuses every data write to an account
 * that does not hold the instance's current consent. Two flows write before
 * the person ever reaches `/consent`, and both sit outside the layout whose
 * gate sends people there:
 *
 * - `/reset`, whose recovery ends in a compartment rewrap. Refused after the
 *   rotation, the compartment's keys were lost for good, so the recovery asks
 *   first and this step is the question.
 * - `/sign-in`'s repair of an account whose first setup never finished, whose
 *   key-record writes are refused otherwise.
 *
 * THE SAME BOX AND THE SAME WORDS as `/consent`: `HealthConsentField`, the
 * screen's sentence above it and its "Agree and continue" button. Consent has
 * to be an act (Art. 7 GDPR), so the box starts unticked, and an unticked
 * press says so under the box and calls nothing. The line under the box holds
 * its place from the first paint (DESIGN.md section 7), so the button never
 * moves when it shows.
 */
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { HealthConsentField } from '#app/components/health-consent-field';
import { Button } from '#app/components/ui/button';

export interface HealthConsentStepProps {
  /** The box was ticked and the button pressed. The caller records the consent and carries on. */
  onAgree: () => void;
}

export function HealthConsentStep({ onAgree }: HealthConsentStepProps) {
  const { t } = useTranslation();
  const [isTicked, setIsTicked] = useState(false);
  const [isMessageShown, setIsMessageShown] = useState(false);
  const boxId = useId();
  const messageId = `${boxId}-message`;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isTicked) {
      setIsMessageShown(true);
      return;
    }
    onAgree();
  }

  return (
    <form data-slot="health-consent-step" className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-sm font-medium">{t('healthConsent.heading')}</p>
      <p className="text-sm">{t('healthConsent.body')}</p>
      <HealthConsentField
        inputProps={{
          id: boxId,
          name: 'healthConsent',
          checked: isTicked,
          onChange: (event) => {
            setIsTicked(event.target.checked);
            if (event.target.checked) setIsMessageShown(false);
          },
          'aria-invalid': isMessageShown || undefined,
          'aria-describedby': isMessageShown ? messageId : undefined,
        }}
        messageId={messageId}
        message={t('healthConsent.requiredToContinue')}
        isMessageShown={isMessageShown}
      />
      <Button type="submit" className="h-11 w-full">
        {t('healthConsent.agree')}
      </Button>
    </form>
  );
}
