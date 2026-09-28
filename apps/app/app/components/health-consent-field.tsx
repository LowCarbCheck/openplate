/**
 * The consent box: one checkbox, the sentence a person agrees to, and the
 * line under it that says the box is not ticked (2026-09-28).
 *
 * ONE COMPONENT FOR BOTH DOORS. `/join` draws it where an account is created,
 * and `/consent` draws it for an account that never agreed. The wording is the
 * one the operator's privacy notice describes, and two copies of it are how
 * one of them would quietly drift from what was agreed to.
 *
 * ── The line under the box holds its place from the first paint ─────────
 *
 * DESIGN.md section 7: nothing on a screen moves because a status arrived. The
 * sentence is always rendered and only made `invisible` until it is needed,
 * so its box is the height of the sentence itself, in the language on screen,
 * and the button below it never moves. `invisible` also takes it out of the
 * accessibility tree until then.
 *
 * ── Unticked, always ────────────────────────────────────────────────────
 *
 * Consent has to be an act (Art. 7 GDPR), so nothing here ticks the box for
 * anybody. The caller owns the value: Conform's `getInputProps` on `/join`,
 * and the same on `/consent`.
 *
 * The privacy notice opens in a NEW TAB. A person reading it is halfway
 * through a form, and a navigation would take their typed password with it.
 * On an instance with no legal pages (`useHasLegalPages`) the words stay and
 * the link does not, because it would lead to a 404.
 */
import type { InputHTMLAttributes } from 'react';
import { Trans } from 'react-i18next';

import { Link } from '#app/components/link';
import { useHasLegalPages } from '#app/hooks/use-public-config';
import { cn } from '#app/lib/utils';

export interface HealthConsentFieldProps {
  /** The checkbox's attributes, `id` and `name` included: Conform's `getInputProps(field, { type: 'checkbox' })`. */
  inputProps: InputHTMLAttributes<HTMLInputElement> & { id: string };
  /** The id of the line under the box, which the checkbox names in `aria-describedby` while it shows. */
  messageId: string;
  /** What the line says when the box is not ticked. Rendered from the first paint, hidden until `isMessageShown`. */
  message: string;
  isMessageShown: boolean;
}

export function HealthConsentField({ inputProps, messageId, message, isMessageShown }: HealthConsentFieldProps) {
  const hasLegalPages = useHasLegalPages();
  return (
    <div data-slot="health-consent" className="space-y-1.5">
      <div className="flex items-start gap-2.5">
        <input
          {...inputProps}
          type="checkbox"
          data-slot="health-consent-box"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <label htmlFor={inputProps.id} className="text-sm leading-relaxed">
          <Trans
            i18nKey="healthConsent.checkbox"
            components={{
              privacy:
                hasLegalPages ?
                  <Link
                    to="/privacy"
                    target="_blank"
                    rel="noopener"
                    className="text-primary underline underline-offset-4"
                  >
                    {/* Replaced by the linked run from the catalog entry. */}
                    privacy
                  </Link>
                : <span />,
            }}
          />
        </label>
      </div>
      <p
        id={messageId}
        data-slot="health-consent-message"
        className={cn('text-sm text-red-600 dark:text-red-400', !isMessageShown && 'invisible')}
      >
        {message}
      </p>
    </div>
  );
}
