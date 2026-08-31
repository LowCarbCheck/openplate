import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => {
  return [{ title: 'Imprint (Impressum)' }, { name: 'robots', content: 'noindex, follow' }];
};

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
 * NOTE — entity alignment (M120): `terms.tsx` still says "we (LowCarbCheck)",
 * which is a product name, not a legal person. The provider named here,
 * SPARQ VENTURES UG (haftungsbeschränkt), is the legal person. Aligning the
 * terms and privacy copy to it is M120's job and is deliberately NOT done in
 * this file — an imprint that is correct is worth shipping before the prose
 * around it is reconciled.
 *
 * Split into `ImprintContent` + default export for the same reason `terms.tsx`
 * is: the content renders under `renderToStaticMarkup` with no data router,
 * while `PublicWrapper` needs one.
 */
export function ImprintContent() {
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        Imprint (Impressum)
      </H1>

      <P variant="subtle" className="mb-8">
        Information required under Section 5 of the German Digital Services Act (DDG).
      </P>

      <section className="mb-8">
        <H2 variant="default">Provider</H2>
        <address className="not-italic">
          <P className="mt-4">
            SPARQ VENTURES UG (haftungsbeschränkt)
            <br />
            Straße 73 49
            <br />
            13125 Berlin
            <br />
            Deutschland
          </P>
        </address>
      </section>

      <section className="mb-8">
        <H2 variant="default">Represented By</H2>
        <P className="mt-4">Managing Director (Geschäftsführer): Altan Sarisin</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">Register Entry</H2>
        <P className="mt-4">
          Commercial Register (Handelsregister): HRB 174062 B
          <br />
          Register Court: Amtsgericht Charlottenburg
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">VAT ID</H2>
        <P className="mt-4">
          VAT identification number (Umsatzsteuer-ID) per Section 27a of the German VAT Act (UStG):
          DE312546809
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">Contact</H2>
        <P className="mt-4">
          Email: <a href="mailto:info@sprqvntrs.com">info@sprqvntrs.com</a>
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
        <H2 variant="default">Consumer Dispute Resolution</H2>
        <P className="mt-4">
          We are neither willing nor obliged to take part in dispute resolution proceedings before a
          consumer arbitration board (Verbraucherschlichtungsstelle).
        </P>
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
