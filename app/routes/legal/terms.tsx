import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { OPERATOR } from './operator';
import { LEGAL_LAST_UPDATED, formatLegalDate } from './last-updated';
import '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

// Title via the pure `meta-title` seam — see `meta-title.ts` for why the
// i18next singleton must not be read from a `meta()`.
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.terms') }];

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
}

export function TermsContent({ managed = false, aiComesFromTheInstance = false }: TermsContentProps) {
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
  return (
    <PublicWrapper>
      <TermsContent managed={serverHoldsTheDiary} aiComesFromTheInstance={aiComesFromTheInstance} />
    </PublicWrapper>
  );
}
