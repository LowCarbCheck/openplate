import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
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
export function TermsContent() {
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
          i18nKey="legal:terms.lead"
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
        <P>{t('terms.s2Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s3Heading')}</H2>
        <P>{t('terms.s3Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('terms.s4Heading')}</H2>
        <P>{t('terms.s4Body')}</P>
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
  return (
    <PublicWrapper>
      <TermsContent />
    </PublicWrapper>
  );
}
