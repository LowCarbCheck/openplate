/**
 * What the delete-account dialog says besides "it is gone": what can stay, and what happens to a
 * paid plan (M3/01).
 *
 * The dialog used to say "Everything stored for you is removed". That is not true on a hosted
 * instance: a backup lives on for days, a mail already sent stays in the inbox it went to, and an
 * operator keeps what the law makes it keep. This app is public and also self-hosted, so the base
 * sentence names the KINDS of record that can stay and never a number or a period, which are the
 * operator's to state in its privacy notice. The notice is linked only where the mounted content
 * folder has one (`useHasLegalPages`), because a link on an instance with no legal pages is a 404.
 *
 * THE SUBSCRIPTION LINE IS ONLY FOR AN INSTANCE THAT SELLS A PLAN (`plansAvailable`, from the
 * handshake through `hasPlansDoor`). On a self-hosted instance with no biller there is nothing to
 * cancel, and a line about a refund would be a claim about a service that is not there.
 *
 * NOTHING HERE MOVES. The dialog is only drawn after a tap, and the parent draws it once the
 * handshake has answered, so both lines are known at the first paint of the dialog: the
 * subscription line is present from the start when it applies, never inserted after it.
 *
 * The privacy tag is named `privacy`, not after an HTML void element (`link`, `source`, `img`):
 * `Trans` renders such a tag empty. The link opens in a new tab, because the person reading is
 * midway through a destructive action with a password typed in.
 */
import { Trans, useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import { useHasLegalPages } from '#app/hooks/use-public-config';

export function DeleteAccountNotes({ plansAvailable }: { plansAvailable: boolean }) {
  const { t } = useTranslation();
  const hasLegalPages = useHasLegalPages();

  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground" data-slot="delete-account-notes">
      <p data-slot="delete-account-stays">
        {hasLegalPages ?
          <Trans
            i18nKey="account.delete.staysWithNotice"
            components={{
              privacy: (
                <Link
                  to="/privacy"
                  target="_blank"
                  rel="noopener"
                  className="text-primary underline underline-offset-4"
                >
                  {/* Replaced by the linked run from the catalog entry. */}
                  privacy
                </Link>
              ),
            }}
          />
        : t('account.delete.stays')}
      </p>
      {plansAvailable && <p data-slot="delete-account-subscription">{t('account.delete.subscription')}</p>}
    </div>
  );
}
