/**
 * THE PASSWORD PAIR: a new password with its strength hint, and the
 * confirmation under it.
 *
 * ── Why one component and not three copies ───────────────────────────────
 *
 * Three screens ask a person to choose a password: the join form, the reset
 * form and the change-password card. Before M192 each drew its own fields, and
 * the drift was already visible — one had a strength meter, one did not, one
 * put the mismatch error over the submit button instead of under the field it
 * was about. Whichever copy is edited next, the other two keep the old
 * behaviour, silently.
 *
 * So the FIELDS live here and the RULES live in `signup-schema.ts` and
 * `recovery-schema.ts`, which both borrow the same floor from
 * `setup-flow.ts`'s `validateSyncPassphrase`. This component owns neither the
 * validation nor the submit: it takes Conform's field metadata and renders it.
 *
 * ── The strength hint is a HINT ──────────────────────────────────────────
 *
 * `passphrase-strength.ts` rates what has been typed and this prints it. The
 * twelve-character floor is the only hard rule; a meter that REFUSED would
 * push people towards whatever pattern satisfies it rather than towards
 * length. It is `aria-live="polite"` so a screen reader hears it change, and
 * `sr-only` while the field is empty so it does not announce nothing.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getInputProps, type FieldMetadata } from '@conform-to/react';

import { FieldError } from '#app/components/field-error';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { passphraseStrengthKey, ratePassphrase } from '#app/lib/sync/passphrase-strength';

/**
 * What this component needs a form to have, and nothing more.
 *
 * A CONSTRAINT rather than a fixed shape: Conform's `FieldMetadata` carries
 * the whole form's type and is invariant in it, so a component typed over one
 * concrete form could not take the other's fields. The join form also carries
 * an invite and a display name, the reset form carries neither, and the only
 * thing either owes this component is the pair below.
 *
 * Optional, because that is what `useForm` reports for a
 * `z.string().default('')` field: the schema fills the value, but the metadata
 * still describes it as possibly absent before the first parse.
 */
export interface PasswordPairForm {
  passphrase?: string;
  confirmPassphrase?: string;
}

/** The two Conform fields this renders, plus the label the first one wears. */
export interface PasswordFieldsProps<TForm extends PasswordPairForm> {
  passphrase: FieldMetadata<string | undefined, TForm, string[]>;
  confirmPassphrase: FieldMetadata<string | undefined, TForm, string[]>;
  /** Label for the first field. The reset screen says "New password"; the join screen says "Password". */
  passwordLabel: string;
}

export function PasswordFields<TForm extends PasswordPairForm>({
  passphrase,
  confirmPassphrase,
  passwordLabel,
}: PasswordFieldsProps<TForm>) {
  const { t } = useTranslation();
  // A local mirror ONLY because something else reads the live value: the
  // strength hint paints from it. Conform still owns the field itself, and
  // this is fed by an `onChange` layered on top of the spread.
  const [typed, setTyped] = useState('');
  const strength = ratePassphrase(typed);
  const strengthId = `${passphrase.id}-strength`;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={passphrase.id}>{passwordLabel}</Label>
        <Input
          {...getInputProps(passphrase, { type: 'password', ariaDescribedBy: strengthId })}
          autoComplete="new-password"
          onChange={(event) => setTyped(event.target.value)}
          className="h-11"
        />
        <p
          id={strengthId}
          aria-live="polite"
          className={
            typed === '' ? 'sr-only'
            : strength === 'strong' ?
              'text-xs text-primary'
            : strength === 'fair' ?
              'text-xs text-accent-amber'
            : 'text-xs text-muted-foreground'
          }
        >
          {typed === '' ? '' : t(passphraseStrengthKey(strength))}
        </p>
        <FieldError id={passphrase.errorId} errors={passphrase.errors} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={confirmPassphrase.id}>{t('sync.setup.confirmLabel')}</Label>
        {/* Under CONFIRM, never under the password: the field the person is
            asked to change is the second one, and an error over the first
            reads as "your password is wrong". */}
        <Input
          {...getInputProps(confirmPassphrase, { type: 'password' })}
          autoComplete="new-password"
          className="h-11"
        />
        <FieldError id={confirmPassphrase.errorId} errors={confirmPassphrase.errors} />
      </div>
    </>
  );
}
