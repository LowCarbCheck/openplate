import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { OPERATOR } from './operator';
import '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.imprint') },
  { name: 'robots', content: 'noindex, follow' },
];

/**
 * The German-law provider identification (Impressum) for the hosted instance.
 *
 * Why this page exists now: Section 5 DDG binds the OPERATOR of a
 * business-facing telemedia service, and the hosted openplate instance has been
 * one since it went public. The duty did not begin with the domain. What
 * openplate.de changed is exposure, not obligation — a `.de` under a German UG
 * removes any argument that a reader would not expect German law to apply.
 *
 * The operator details are reproduced verbatim from the two already-shipped,
 * operator-verified copies in `nicotinepouch-org` and `selfhostedworld-com`.
 * "Straße 73" is a real street name in 13125 Berlin and "49" is the house
 * number — it is not a typo, do not "fix" it.
 *
 * Entity alignment, resolved 2026-09-01 (M167/02): `terms.tsx` used to say
 * "we (LowCarbCheck)", a product name rather than a legal person. It now names
 * SPARQ VENTURES UG (haftungsbeschränkt), the provider named here, and links
 * back to this page. That closes the contradiction M120 was tracking; M120's
 * remaining items (the DPA and the lawyer sign-offs) are untouched.
 *
 * Split into `ImprintContent` + default export for the same reason `terms.tsx`
 * is: the content renders under `renderToStaticMarkup` with no data router,
 * while `PublicWrapper` needs one.
 */
export function ImprintContent() {
  const { t } = useTranslation('legal');
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        {t('imprint.title')}
      </H1>

      <P variant="subtle" className="mb-8">
        {t('imprint.intro')}
      </P>

      <section className="mb-8">
        <H2 variant="default">{t('imprint.providerHeading')}</H2>
        <address className="not-italic">
          <P className="mt-4">
            {OPERATOR.legalName}
            <br />
            {OPERATOR.street}
            <br />
            {OPERATOR.postalCode} {OPERATOR.city}
            <br />
            {OPERATOR.country}
          </P>
        </address>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('imprint.representedHeading')}</H2>
        <P className="mt-4">
          {t('imprint.managingDirectorLabel')}: {OPERATOR.managingDirector}
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('imprint.registerHeading')}</H2>
        <P className="mt-4">
          {t('imprint.registerNumberLabel')}: {OPERATOR.registerNumber}
          <br />
          {t('imprint.registerCourtLabel')}: {OPERATOR.registerCourt}
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('imprint.vatHeading')}</H2>
        <P className="mt-4">
          {t('imprint.vatLabel')}: {OPERATOR.vatId}
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('imprint.contactHeading')}</H2>
        <P className="mt-4">
          {t('imprint.emailLabel')}: <a href={`mailto:${OPERATOR.imprintEmail}`}>{OPERATOR.imprintEmail}</a>
        </P>
      </section>

      {/*
        No Section 18(2) MStV section, unlike the nicotinepouch.org copy this
        page was taken from. That duty attaches to journalistic-editorial
        content offered to the public; openplate ships a food-tracking tool and
        publishes no articles or wiki. If editorial content is ever added here,
        this section has to come back.
      */}

      <section className="mb-8">
        <H2 variant="default">{t('imprint.disputeHeading')}</H2>
        <P className="mt-4">{t('imprint.disputeBody')}</P>
      </section>
    </article>
  );
}

export default function Imprint() {
  return (
    <PublicWrapper>
      <ImprintContent />
    </PublicWrapper>
  );
}
