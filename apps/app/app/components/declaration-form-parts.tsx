/**
 * The two pieces the statutory declaration forms (`/kuendigung`, `/widerrufen`)
 * share, each one a box that is on the page from the first paint.
 *
 * NO LAYOUT SHIFT (DESIGN.md section 7). A field error and a submit error are
 * lines that can appear, so each has its box before it has text:
 *
 * - `ReservedFieldError` keeps one line of `text-sm` under its field. The
 *   shared `FieldError` renders nothing until there is an error, which would
 *   push every field below it down on the first invalid submit.
 * - `DeclarationSubmitError` sits BELOW the submit button, so the button a
 *   person just pressed never moves, and keeps three lines for the longest
 *   message, the operator's `unavailable` text from the content file.
 */
import { useTranslation } from 'react-i18next';

import { ContentBlocks } from '#app/components/content-article';
import { FieldError } from '#app/components/field-error';
import type { ContentBlock } from '#app/lib/content/markdown';

/** A field error in a box that is one line tall before it has anything to say. */
export function ReservedFieldError({ id, errors }: { id?: string; errors?: string[] }) {
  return (
    <div className="min-h-5">
      <FieldError id={id} errors={errors} />
    </div>
  );
}

/** Why a declaration was not accepted. `unreachable` is also a 202 body this page could not read. */
export type DeclarationFailure = 'invalid' | 'rate-limited' | 'unreachable';

/**
 * The submit error slot.
 *
 * @param props.failure - the last submission's failure, or `null` before one.
 * @param props.unavailable - the content file's `unavailable` section, which is
 * also the text for an unreachable service (CONTRACT.md section 4).
 */
export function DeclarationSubmitError({
  failure,
  unavailable,
}: {
  failure: DeclarationFailure | null;
  unavailable: readonly ContentBlock[];
}) {
  const { t } = useTranslation();
  return (
    <div aria-live="polite" className="min-h-21 text-sm text-red-600 dark:text-red-400">
      {failure === 'invalid' && <p>{t('declarations.errors.invalid')}</p>}
      {failure === 'rate-limited' && <p>{t('declarations.errors.rateLimited')}</p>}
      {failure === 'unreachable' && <ContentBlocks blocks={unavailable} />}
    </div>
  );
}
