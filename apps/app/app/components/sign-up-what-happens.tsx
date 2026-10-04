/**
 * The box on `/sign-up` that says, in plain words, what happens to a photo, a
 * diary and a deletion (M3/07, 2026-10-04). It informs; there is no checkbox
 * and nothing to open, because the agreement is carried by the consent on
 * `/join` and the terms.
 *
 * ── Where it sits, and why nothing moves ─────────────────────────────────
 *
 * Directly below the form, drawn in the same commit as the form (the route
 * renders it inside `SignUpForm`), so the title, the description and the
 * spinner that were on screen before it stay where they are. Whether it is
 * drawn comes from the root loader's public config (`showsSignUpDataBox`),
 * never from the handshake, so there is no second moment at which it can
 * appear and push the form.
 *
 * NOT ABOVE THE ADDRESS FIELD. It is about 570 px tall on a 390 px phone, which
 * put the field at 905 px on an 844 px screen: a form nobody could see.
 *
 * ── Square, with a hairline on all four sides ────────────────────────────
 *
 * DESIGN.md section 5 allows no radius and the design notes allow no thick
 * rule down one edge, so this is a plain bordered block.
 *
 * ── The words are `signUp.whatHappens.*` ─────────────────────────────────
 *
 * One catalogue entry per sentence, so the pricing page and the order page
 * (M2/06, M2/04) quote the same words. The wording comes from the README of
 * milestone M3, and a change starts there.
 */
import { Trans, useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import { useHasLegalPages, useInstancePolicy } from '#app/hooks/use-public-config';
import { PHOTO_PROXY_SOURCE_URL, showsSignUpDataBox } from '#app/lib/sign-up-data-box';

const LINK_CLASS = 'text-primary underline underline-offset-4';

export function SignUpWhatHappens() {
  const { t } = useTranslation();
  const policy = useInstancePolicy();
  const hasLegalPages = useHasLegalPages();
  if (!showsSignUpDataBox({ policy, hasLegalPages })) return null;
  return (
    <section
      data-slot="sign-up-what-happens"
      aria-labelledby="sign-up-what-happens-title"
      className="space-y-2 border border-border p-3 text-xs leading-relaxed"
    >
      <h2 id="sign-up-what-happens-title" className="text-sm font-semibold">
        {t('signUp.whatHappens.title')}
      </h2>
      <p data-slot="sign-up-what-happens-photo">{t('signUp.whatHappens.photo')}</p>
      <p>{t('signUp.whatHappens.providers')}</p>
      <p>{t('signUp.whatHappens.report')}</p>
      <p>{t('signUp.whatHappens.diary')}</p>
      <p>{t('signUp.whatHappens.deletion')}</p>
      <p>
        <Trans
          i18nKey="signUp.whatHappens.notice"
          components={{
            // A NEW TAB: the person is halfway through a form, and a
            // navigation would take the address they typed with it.
            privacy: (
              <Link to="/privacy" target="_blank" rel="noopener" className={LINK_CLASS}>
                {/* Replaced by the linked run from the catalog entry. */}
                privacy
              </Link>
            ),
          }}
        />
      </p>
      <p>
        <Trans
          i18nKey="signUp.whatHappens.proof"
          components={{
            proxy: (
              <a href={PHOTO_PROXY_SOURCE_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                {/* Replaced by the linked run from the catalog entry. */}
                proxy
              </a>
            ),
          }}
        />
      </p>
    </section>
  );
}
