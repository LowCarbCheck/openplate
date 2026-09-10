import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import type { Route } from './+types/terms';
import { CONFIG } from '#app/config';
import { resolveRequestLanguage } from '#app/i18n/language-prefs';
import { formatPlanPrice, PLAN_PRICING } from '#app/lib/plans/plan-price.server';
import { Trans, useTranslation } from 'react-i18next';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { hasPlansDoor } from '#app/lib/plans/plans-door';
import { OPERATOR } from './operator';
import { LEGAL_LAST_UPDATED, formatLegalDate } from './last-updated';
import '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

// Title via the pure `meta-title` seam — see `meta-title.ts` for why the
// i18next singleton must not be read from a `meta()`.
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.terms') }];

/**
 * SERVER: the price and the trial length, for THIS request's language.
 *
 * The figures are parsed once at boot (`plan-price.server.ts`); what this
 * loader adds is the locale, and it takes it from the same cookie the document
 * is rendered from (`resolveRequestLanguage`, the reading `app/root.tsx` uses
 * for `<html lang>`). Formatting on the server rather than in the component
 * keeps the whole decision on one side of the wire: the browser receives a
 * finished string, or `null`, and never a number it could format a second way.
 *
 * A language change reloads the document (`applyLanguageChange`), so this
 * runs again and the label follows the reader.
 */
export function loader({ request }: Route.LoaderArgs) {
  const language = resolveRequestLanguage(request.headers.get('cookie'), CONFIG.i18n.defaultLanguage);
  const { priceEur, trialDays } = PLAN_PRICING;
  return {
    priceLabel: priceEur === null ? null : formatPlanPrice(priceEur, language),
    trialDays,
  };
}

/**
 * The terms copy itself, split out from the page chrome so it can be unit-tested
 * (`renderToStaticMarkup`) without needing a router context — `PublicWrapper` reads
 * the authenticated user via `useOptionalUser`, which requires a data router; this
 * component has no such dependency (plain `<a>` tags only, no `Link`/`NavLink`).
 */
export interface TermsContentProps {
  /**
   * `true` on an instance an organization runs for its people (M196).
   *
   * Three paragraphs here describe the open instance: no account record, an
   * optional sync of your own, and bring-your-own-key AI you pay a provider
   * for. On a managed instance all three are false, so each has a `*Managed`
   * twin. A prop rather than a hook, for the same reason `PrivacyContent`
   * takes one: this content renders with no data router in the unit tests.
   */
  managed?: boolean;
  /**
   * `true` where the photo estimates come from this instance's own proxy, on
   * the account's allowance, rather than from a provider the reader chose
   * (M212 spec 06).
   *
   * A SECOND PROP RATHER THAN A SIXTH USE OF `managed`, and the same rule
   * `PrivacyContentProps` wrote down: a NEW claim gets the prop for the
   * question it actually depends on. These are the paragraphs about WHO the
   * photo goes to and WHAT the account's allowance is, which is
   * `aiComesFromTheInstance` and not "there are accounts here". `managed`
   * above still chooses the older bundle, and splitting that bundle now would
   * rename call sites and change nothing a reader sees.
   */
  aiComesFromTheInstance?: boolean;
  /**
   * `true` where a biller stands behind this instance, so a person here can be
   * charged money (M213 spec 07).
   *
   * A THIRD NAMED QUESTION, and the same per-claim rule the two above wrote
   * down. Section 4a states what is sold, at what price, how it renews, how it
   * is cancelled and that a card is taken. Every one of those sentences is
   * FALSE on a deployment with no biller, and false in the direction that
   * matters: a self-hoster's terms would announce a subscription nobody can
   * buy. It is not `managed` and not `aiComesFromTheInstance`, because two
   * managed instances answer it differently, exactly as they do for
   * `memberInvites`. It arrives on the sync server's `/health` handshake.
   */
  plans?: boolean;
  /**
   * The gross monthly price, already formatted with its currency, or `null`.
   *
   * `null` MEANS THE SENTENCE IS NOT DRAWN, and never an empty space where a
   * number belongs. The Preisangabenverordnung requires a consumer to see a
   * total price including VAT; a terms page printing "openplate Plus costs
   * per month" would be worse than one that does not raise the subject. The
   * figure is the owner's, it lives in the Stripe price object, and nothing in
   * this repository may invent one.
   */
  price?: string | null;
  /** The trial length in days, or `null`. Same rule as `price`: no number, no sentence. */
  trialDays?: number | null;
}

export function TermsContent({
  managed = false,
  aiComesFromTheInstance = false,
  plans = false,
  price = null,
  trialDays = null,
}: TermsContentProps) {
  const { t, i18n } = useTranslation('legal');
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        {t('terms.title')}
      </H1>

      <P variant="subtle" className="mb-8">
        {t('lastUpdated', { date: formatLegalDate(LEGAL_LAST_UPDATED, i18n.language) })}
      </P>

      <P variant="lead" className="mb-8">
        <Trans
          i18nKey={managed ? 'legal:terms.leadManaged' : 'legal:terms.lead'}
          values={{ operator: OPERATOR.legalName }}
          components={{ imprint: <a href="/imprint">imprint</a> }}
        />
      </P>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s1Heading')}</H2>
        <P>
          <Trans i18nKey="legal:terms.s1Body" components={{ privacy: <a href="/privacy">Privacy Policy</a> }} />
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s2Heading')}</H2>
        <P>{t(managed ? 'terms.s2BodyManaged' : 'terms.s2Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s3Heading')}</H2>
        {/* "the AI provider you have configured" is false where the operator
            configured it, and this is the disclaimer paragraph, so the false
            half was the sentence naming who to blame for an estimate. */}
        <P>{t(aiComesFromTheInstance ? 'terms.s3BodyManaged' : 'terms.s3Body')}</P>
      </section>

      <section className="mb-8">
        {/* THE HEADING, NOT ONLY THE BODY. "4. Bring your own AI provider" sat
            over `terms.s4BodyManaged`, which says the opposite, so a managed
            reader got a correct paragraph under a false title (M212 spec 06). */}
        <H2 variant="default">{t(aiComesFromTheInstance ? 'terms.s4HeadingManaged' : 'terms.s4Heading')}</H2>
        <P>{t(managed ? 'terms.s4BodyManaged' : 'terms.s4Body')}</P>
        {/* AND THE END DATE, which nothing in this document said. The managed
            body states the proxy, the operator's key and the daily limit; the
            allowance also ENDS, on a date the account carries, and access that
            ends itself is a term rather than a detail. */}
        {aiComesFromTheInstance && <P className="mt-4">{t('terms.s4AllowanceManaged')}</P>}
      </section>

      {/* SECTION 4a, BETWEEN 4 AND 5, and numbered 4a rather than renumbering
          the nine sections after it: those numbers are cited from the privacy
          policy and from anything a reader saved, and a document that
          silently renumbers itself breaks every one of those references.
          Drawn only where somebody can actually be charged. */}
      {plans && (
        <section className="mb-8">
          <H2 variant="default">{t('terms.s4aPaymentHeading')}</H2>
          {/* The two sentences that carry a figure nobody in this repository
              may invent. See `price` and `trialDays`. */}
          {price !== null && <P>{t('terms.s4aPaymentPrice', { price })}</P>}
          {trialDays !== null && <P className="mt-4">{t('terms.s4aPaymentTrial', { trialDays })}</P>}
          <P className="mt-4">{t('terms.s4aPaymentRenewal')}</P>
          <P className="mt-4">{t('terms.s4aPaymentFailed')}</P>
          <P className="mt-4">
            <Trans
              i18nKey="legal:terms.s4aPaymentWithdrawal"
              components={{ withdrawal: <a href="/withdrawal">withdrawal</a> }}
            />
          </P>
          <P className="mt-4">{t('terms.s4aPaymentWithdrawalLoss')}</P>
          <P className="mt-4">{t('terms.s4aPaymentProcessor')}</P>
          <P className="mt-4">
            {/* THE SELLER'S IDENTITY COMES FROM `operator.ts`, never from the
                bundle: `legal-locales.test.ts` pins that arrangement so the
                two languages cannot disagree about who is taking the money. */}
            <Trans
              i18nKey="legal:terms.s4aPaymentSeller"
              values={{ operator: OPERATOR.legalName, vatId: OPERATOR.vatId }}
              components={{ imprint: <a href="/imprint">imprint</a> }}
            />
          </P>
        </section>
      )}

      <section className="mb-8">
        <H2 variant="default">{t('terms.s5Heading')}</H2>
        <P>{t('terms.s5Intro')}</P>
        <ul className="mt-4">
          <li>{t('terms.s5Item1')}</li>
          <li>{t('terms.s5Item2')}</li>
          <li>{t('terms.s5Item3')}</li>
          <li>{t('terms.s5Item4')}</li>
          <li>{t('terms.s5Item5')}</li>
        </ul>
        <P className="mt-4">{t('terms.s5Outro')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s6Heading')}</H2>
        <P>{t('terms.s6Body1')}</P>
        <P className="mt-4">{t('terms.s6Body2')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s7Heading')}</H2>
        <P>{t('terms.s7Intro')}</P>
        <ul className="mt-4">
          <li>
            <strong>{t('terms.s7Item1Label')}</strong> {t('terms.s7Item1Body')}
          </li>
          <li>
            <strong>{t('terms.s7Item2Label')}</strong> {t('terms.s7Item2Body')}
          </li>
          <li>
            <strong>{t('terms.s7Item3Label')}</strong> {t('terms.s7Item3Body')}
          </li>
          <li>
            <strong>{t('terms.s7Item4Label')}</strong> {t('terms.s7Item4Body')}
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s8Heading')}</H2>
        <P>{t('terms.s8Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s9Heading')}</H2>
        <P>{t('terms.s9Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s10Heading')}</H2>
        <P>{t('terms.s10Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s11Heading')}</H2>
        <P>{t('terms.s11Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s12Heading')}</H2>
        <P>
          <Trans
            i18nKey="legal:terms.s12Body"
            values={{ email: OPERATOR.privacyEmail }}
            components={{ email: <a href={`mailto:${OPERATOR.privacyEmail}`}>{OPERATOR.privacyEmail}</a> }}
          />
        </P>
      </section>
    </article>
  );
}

export default function Terms() {
  // The route reads the fact; `TermsContent` takes it as a prop, exactly as
  // `Privacy` does, see the note on `TermsContentProps`.
  //
  // WHICH QUESTION (M201/07). The managed document rewrites three paragraphs,
  // and each one is a different policy question: it has accounts
  // (`requiresAccount`), the diary reaches the operator's server as ciphertext
  // (`serverHoldsTheDiary`), and the plate photo goes through that server under
  // the operator's key (`aiComesFromTheInstance`). All three answer alike, and
  // the document is one bundle rather than three switches, so the route asks
  // the question that changes the most of it and the prop selects the bundle.
  //
  // TWO QUESTIONS SINCE M212 SPEC 06. `serverHoldsTheDiary` still chooses the
  // older bundle; `aiComesFromTheInstance` chooses the three paragraphs about
  // the photo estimates, which is the question those actually depend on.
  const { serverHoldsTheDiary, aiComesFromTheInstance } = useInstancePolicy();
  // THE THIRD QUESTION, AND IT IS NOT A POLICY ONE (M213 spec 07). Whether
  // this deployment sells anything is a fact about the deployment, read off
  // the sync server's handshake exactly as `memberInvites` is on `/privacy`.
  // `false` for a service that has not answered, which draws no payment
  // section, and that is the safe direction: an instance nobody can pay for
  // must not publish terms describing a subscription.
  const plans = hasPlansDoor(useServerInstance());
  // THE TWO FIGURES COME FROM THE SERVER (M214 spec 02). They are this
  // deployment's own environment, not the handshake and not a bundle, so they
  // are read in the loader above and arrive here already formatted for the
  // language this request is being rendered in. An instance that set neither
  // sends `null` for both, and the two sentences stay unrendered exactly as
  // they did before. See `plan-price.server.ts`.
  const { priceLabel, trialDays } = useLoaderData<typeof loader>();
  return (
    <PublicWrapper>
      <TermsContent
        managed={serverHoldsTheDiary}
        aiComesFromTheInstance={aiComesFromTheInstance}
        plans={plans}
        price={priceLabel}
        trialDays={trialDays}
      />
    </PublicWrapper>
  );
}
