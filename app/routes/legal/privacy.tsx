import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { PHOTO_RETENTION_DAYS } from '#app/lib/local-store/photo-policy';
import type { MetaFunction } from 'react-router';
import { useManagedInstance, usePublicConfig } from '#app/hooks/use-public-config';
import { Trans, useTranslation } from 'react-i18next';
import { OPERATOR } from './operator';
import { LEGAL_LAST_UPDATED, formatLegalDate } from './last-updated';
import '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

// Title via the pure `meta-title` seam — see `meta-title.ts` for why the
// i18next singleton must not be read from a `meta()`.
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.privacy') }];

/**
 * The policy copy itself, split out from the page chrome so it can be unit-tested
 * (`renderToStaticMarkup`) without needing a router context — `PublicWrapper` reads
 * the authenticated user via `useOptionalUser`, which requires a data router; this
 * component has no such dependency (plain `<a>` tags only, no `Link`/`NavLink`).
 */
/**
 * Whether THIS instance actually runs analytics.
 *
 * §9a used to be written unconditionally, on the reasoning that the whole
 * document describes "the hosted instance we operate". That reasoning broke on
 * 2026-08-31: the openplate.de cutover shipped the section while the hosted
 * instance's `MATOMO_URL` was never set, so the live policy described
 * measurement that was switched off. Over-disclosure misleads nobody about
 * their privacy, but it is still a false statement in a legally operative
 * document, and a reader cannot tell which of the other sections are stale too.
 *
 * A PROP rather than `usePublicConfig()`: this component is deliberately
 * renderable by `renderToStaticMarkup` with no data router (see the header
 * below), and a hook would take that away. The route passes the real value.
 */
export interface PrivacyContentProps {
  /** `false` unless the operator configured Matomo. The self-host default. */
  analyticsEnabled?: boolean;
  /**
   * `true` on an instance an organization runs for its people (M196).
   *
   * Three paragraphs of this policy were written for the open instance and are
   * false on a managed one: it HAS accounts, the diary does reach the server
   * (as ciphertext), and the plate photo goes through the operator's own proxy
   * under the operator's key rather than straight to a provider the person
   * picked. A prop for the same reason `analyticsEnabled` is one: the content
   * stays renderable with no data router.
   */
  managed?: boolean;
}

export function PrivacyContent({ analyticsEnabled = false, managed = false }: PrivacyContentProps) {
  const { t, i18n } = useTranslation('legal');
  const days = PHOTO_RETENTION_DAYS;
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        {t('privacy.title')}
      </H1>

      <P variant="subtle" className="mb-8">
        {t('lastUpdated', { date: formatLegalDate(LEGAL_LAST_UPDATED, i18n.language) })}
      </P>

      <P variant="lead" className="mb-8">
        {t(managed ? 'privacy.leadManaged' : 'privacy.lead')}
      </P>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s1Heading')}</H2>
        <ul className="mt-4">
          <li>{t('privacy.s1Item1')}</li>
          <li>{t(managed ? 'privacy.s1Item2Managed' : 'privacy.s1Item2')}</li>
          <li>{t('privacy.s1Item3')}</li>
          <li>{t(analyticsEnabled ? 'privacy.s1Item4Analytics' : 'privacy.s1Item4NoAnalytics')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s2Heading')}</H2>
        <P>{t(managed ? 'privacy.s2Body1Managed' : 'privacy.s2Body1')}</P>
        <P className="mt-4">{t('privacy.s2Body2', { days })}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s3Heading')}</H2>
        <P>
          <Trans i18nKey="legal:privacy.s3Body1" components={{ b: <strong /> }} />
        </P>
        <P className="mt-4">{t('privacy.s3Intro')}</P>
        <ul className="mt-4">
          <li>{t('privacy.s3Item1')}</li>
          <li>{t('privacy.s3Item2')}</li>
          <li>{t('privacy.s3Item3')}</li>
          <li>{t('privacy.s3Item4')}</li>
        </ul>
        <P className="mt-4">{t('privacy.s3Outro')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s4Heading')}</H2>
        {/* `s4BodyOnManaged`, NOT `s4BodyManaged`: the section already ends
            with `s4ManagedBody` below, and two keys a letter apart in the same
            section is how a swap lands on the wrong paragraph. */}
        <P>{t(managed ? 'privacy.s4BodyOnManaged' : 'privacy.s4Body', { days })}</P>
        {/* The ASIDE, for a reader of an OPEN instance's policy who may also
            use an instance an organization runs: there, the photo goes to that
            organization's proxy rather than to a provider they picked. On a
            managed instance the paragraph above already says exactly that
            about THIS instance, so repeating it here said the same thing
            twice (M196). */}
        {!managed && <P className="mt-4">{t('privacy.s4ManagedBody')}</P>}
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s5Heading')}</H2>
        <P>{t('privacy.s5Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s6Heading')}</H2>
        <P>{t('privacy.s6Body1')}</P>
        <P className="mt-4">{t('privacy.s6Body2')}</P>
        {/* THE ESCROW, said plainly (M192). The paragraph this replaced said
            the operator could not decrypt a diary; that stopped being true
            when the recovery code moved into escrow so a mailed reset could
            return somebody's data. A promise nobody can keep is worse than the
            honest sentence. */}
        <P className="mt-4">{t('privacy.s6Body3')}</P>
        <P className="mt-4">{t('privacy.s6Body4')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s7Heading')}</H2>
        <P>{t('privacy.s7Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s8Heading')}</H2>
        <P>{t('privacy.s8Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s9Heading')}</H2>
        <P>{t('privacy.s9Intro')}</P>
        <ul className="mt-4">
          <li>{t('privacy.s9Item1')}</li>
          <li>{t('privacy.s9Item2')}</li>
          <li>{t('privacy.s9Item3')}</li>
          <li>{t('privacy.s9Item4')}</li>
        </ul>
        <P className="mt-4">{t('privacy.s9Outro')}</P>
      </section>

      {/*
        Article 13 disclosure for the hosted instance's analytics, added 2026-08-31
        with the openplate.de cutover and made CONDITIONAL on 2026-09-01 (M167/02).

        It was written unconditionally at first, reasoning that this whole document
        describes "the hosted openplate instance we operate". That reasoning was
        wrong in exactly one way and it mattered: the cutover shipped the section
        while MATOMO_URL was never set on the hosted instance, so the live policy
        described measurement that was switched off. It named cookies, a retention
        window and a right to object, all for something that was not running.

        Gating it on the fact is what makes the sentence self-correcting: the
        section appears when analytics does and disappears when it does not, on
        the hosted instance and on a self-hosted one alike, with no second edit.

        No consent banner accompanies this, deliberately and on advice: the tracker
        is loaded with cookies disabled and stores nothing on the device, so §25
        TTDSG is not engaged and the legal basis is Art. 6(1)(f). If anyone ever
        switches cookies back on in use-matomo-tracker.ts, that reasoning dies
        with the change and a banner becomes mandatory.
      */}
      {analyticsEnabled ?
        <section className="mb-8">
          <H2 variant="default">{t('privacy.s9aOnHeading')}</H2>
          <P>
            <Trans i18nKey="legal:privacy.s9aOnBody1" components={{ b: <strong /> }} />
          </P>
          <P className="mt-4">
            <Trans i18nKey="legal:privacy.s9aOnBody2" components={{ b: <strong /> }} />
          </P>
          <P className="mt-4">
            <Trans i18nKey="legal:privacy.s9aOnBody3" components={{ b: <strong /> }} />
          </P>
          <P className="mt-4">
            <Trans i18nKey="legal:privacy.s9aOnBody4" components={{ b: <strong /> }} />
          </P>
          <P className="mt-4">
            <Trans
              i18nKey="legal:privacy.s9aOnBody5"
              components={{ b: <strong />, imprint: <a href="/imprint">imprint</a> }}
            />
          </P>
          <P className="mt-4">{t('privacy.s9aOnBody6')}</P>
        </section>
      : <section className="mb-8">
          <H2 variant="default">{t('privacy.s9aOffHeading')}</H2>
          <P>{t('privacy.s9aOffBody1')}</P>
          <P className="mt-4">{t('privacy.s9aOffBody2')}</P>
        </section>
      }

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s10Heading')}</H2>
        <P>{t('privacy.s10Intro')}</P>
        <ul className="mt-4">
          <li>{t('privacy.s10Item1')}</li>
          <li>{t('privacy.s10Item2')}</li>
          <li>{t('privacy.s10Item3')}</li>
          <li>{t('privacy.s10Item4')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s11Heading')}</H2>
        <P>{t('privacy.s11Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s12Heading')}</H2>
        <P>{t('privacy.s12Body')}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s13Heading')}</H2>
        <P>
          <Trans
            i18nKey="legal:privacy.s13Body"
            values={{ email: OPERATOR.privacyEmail }}
            components={{ email: <a href={`mailto:${OPERATOR.privacyEmail}`}>{OPERATOR.privacyEmail}</a> }}
          />
        </P>
      </section>
    </article>
  );
}

export default function Privacy() {
  // The route reads the fact; `PrivacyContent` takes it as a prop. That split is
  // what keeps the content renderable by `renderToStaticMarkup` with no data
  // router, which `tests/unit/legal-pages.test.ts` depends on.
  const analytics = usePublicConfig()?.analytics ?? null;
  const managed = useManagedInstance();
  return (
    <PublicWrapper>
      <PrivacyContent analyticsEnabled={analytics !== null} managed={managed} />
    </PublicWrapper>
  );
}
