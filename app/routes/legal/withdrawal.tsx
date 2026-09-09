import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { OPERATOR } from './operator';
import { LEGAL_LAST_UPDATED, formatLegalDate } from './last-updated';
import '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.withdrawal') }];

/**
 * One line of postal contact detail, as the model text wants it inserted.
 *
 * Gestaltungshinweis 2 of Anlage 1 says "Fügen Sie Ihren Namen, Ihre Anschrift,
 * Ihre Telefonnummer und Ihre E-Mail-Adresse ein", a run of IDENTIFIERS, so it
 * is assembled here from `operator.ts` and never from a locale bundle, exactly
 * as the imprint and the seller sentence in the terms are. `legal-locales.test.ts`
 * pins that arrangement.
 *
 * The telephone number is absent today (see `OPERATOR.phone`), so it is dropped
 * from the run rather than printed as an empty gap.
 */
function operatorContactLine(): string {
  return [
    OPERATOR.legalName,
    OPERATOR.street,
    `${OPERATOR.postalCode} ${OPERATOR.city}`,
    OPERATOR.country,
    OPERATOR.phone,
    OPERATOR.imprintEmail,
  ]
    .filter((part): part is string => part !== undefined)
    .join(', ');
}

/**
 * The name, address and e-mail the model withdrawal form asks for.
 *
 * Anlage 2 wants "der Name, die Anschrift und die E-Mail-Adresse des
 * Unternehmers" and, unlike the instruction above, NO telephone number. Two
 * functions rather than one with a flag: the two model texts ask for different
 * runs, and that difference is the statute's, not a rendering option.
 */
function operatorFormLine(): string {
  return [OPERATOR.legalName, OPERATOR.street, `${OPERATOR.postalCode} ${OPERATOR.city}`, OPERATOR.country, OPERATOR.imprintEmail].join(
    ', ',
  );
}

/**
 * The statutory withdrawal instruction and the model withdrawal form.
 *
 * ── WHAT THIS DOCUMENT IS ───────────────────────────────────────────────────
 * The German text is Anlage 1 (Muster-Widerrufsbelehrung) and Anlage 2
 * (Muster-Widerrufsformular) zu Artikel 246a § 1 Absatz 2 EGBGB, transcribed
 * from the statute with the Gestaltungshinweise applied for OUR case, which is
 * an online service contract that begins during the withdrawal period at the
 * consumer's request:
 *
 *  - Hinweis 1 variant a): the period runs from "des Vertragsabschlusses";
 *  - Hinweis 2: our name, address, telephone number and e-mail, from
 *    `operator.ts`, telephone still missing (see `OPERATOR.phone`);
 *  - Hinweis 3: NOT inserted, see the note below;
 *  - Hinweis 4 and 5: omitted, they concern goods and we deliver none;
 *  - Hinweis 6: inserted, with "Wasser/Gas/Strom/Fernwärme" struck as the
 *    model directs, leaving the services-only sentence.
 *
 * THE GERMAN IS THE BINDING TEXT. It is not wordsmith's to rephrase and it is
 * pinned byte-for-byte by `legal-withdrawal.test.ts`. The English beside it is
 * a courtesy translation, and `withdrawal.bindingNotice` says so on the page.
 *
 * TODO(owner): whether openplate must also offer an ONLINE WITHDRAWAL FUNCTION
 * (a button that withdraws the contract, Gestaltungshinweis 3, § 356 Absatz 5
 * BGB for contracts concluded on a website) is an owner question, not a
 * technical one. If the answer is yes, the inserted paragraph names the URL of
 * that function and an acknowledgement has to be e-mailed on a durable medium.
 * Nothing here may guess at it, so the paragraph is absent.
 *
 * Split into `WithdrawalContent` + default export for the same reason
 * `terms.tsx` is: the content renders under `renderToStaticMarkup` with no data
 * router, while `PublicWrapper` needs one.
 *
 * NO GATE ON `plans`. Unlike section 4a of the terms, this page is always
 * rendered: the terms link to it unconditionally in the markup a reader may
 * have saved, and a withdrawal instruction that 404s is worse than one a
 * self-hoster's reader never needed.
 */
export function WithdrawalContent() {
  const { t, i18n } = useTranslation('legal');
  const contact = operatorContactLine();
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        {t('withdrawal.title')}
      </H1>

      <P variant="subtle" className="mb-8">
        {t('lastUpdated', { date: formatLegalDate(LEGAL_LAST_UPDATED, i18n.language) })}
      </P>

      <P variant="lead" className="mb-8">
        {t('withdrawal.bindingNotice')}
      </P>

      <section className="mb-8">
        <H2 variant="default">{t('withdrawal.instructionHeading')}</H2>

        <H2 variant="default" className="mt-4">
          {t('withdrawal.rightHeading')}
        </H2>
        <P className="mt-4">{t('withdrawal.rightBody1')}</P>
        <P className="mt-4">{t('withdrawal.rightBody2')}</P>
        <P className="mt-4">{t('withdrawal.rightBody3', { operator: contact })}</P>
        <P className="mt-4">{t('withdrawal.rightBody4')}</P>

        <H2 variant="default" className="mt-8">
          {t('withdrawal.consequencesHeading')}
        </H2>
        <P className="mt-4">{t('withdrawal.consequencesBody1')}</P>
        <P className="mt-4">{t('withdrawal.consequencesBody2')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('withdrawal.formHeading')}</H2>
        <P className="mt-4">{t('withdrawal.formIntro')}</P>
        {/* A LIST, where the statute prints an en dash before every field. The
            dashes are typography for "here is a field", and this repository
            writes no dash of either kind, so the same structure is carried by
            list items instead. */}
        <ul className="mt-4">
          <li>{t('withdrawal.formField1', { operator: operatorFormLine() })}</li>
          <li>{t('withdrawal.formField2')}</li>
          <li>{t('withdrawal.formField3')}</li>
          <li>{t('withdrawal.formField4')}</li>
          <li>{t('withdrawal.formField5')}</li>
          <li>{t('withdrawal.formField6')}</li>
          <li>{t('withdrawal.formField7')}</li>
        </ul>
        <P className="mt-4">{t('withdrawal.formFootnote')}</P>
      </section>
    </article>
  );
}

export default function Withdrawal() {
  return (
    <PublicWrapper>
      <WithdrawalContent />
    </PublicWrapper>
  );
}
