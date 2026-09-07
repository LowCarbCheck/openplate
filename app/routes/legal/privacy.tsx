import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { PHOTO_RETENTION_DAYS } from '#app/lib/local-store/photo-policy';
import type { MetaFunction } from 'react-router';
import { useManagedInstance, usePublicConfig } from '#app/hooks/use-public-config';
import type { AnalyticsEventLevel } from '#app/config/analytics';
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
 * HOW MUCH this instance actually measures, not merely whether it measures.
 *
 * §9a used to be written unconditionally, on the reasoning that the whole
 * document describes "the hosted instance we operate". That reasoning broke on
 * 2026-08-31: the openplate.de cutover shipped the section while the hosted
 * instance's `MATOMO_URL` was never set, so the live policy described
 * measurement that was switched off. Over-disclosure misleads nobody about
 * their privacy, but it is still a false statement in a legally operative
 * document, and a reader cannot tell which of the other sections are stale too.
 *
 * The boolean that fixed that is itself no longer enough. `MATOMO_EVENT_LEVEL`
 * (see `app/config/analytics.ts`) gives three levels, so "analytics are on" now
 * covers three different disclosures. A policy that describes feature tracking
 * on an instance running at `pageviews`, which counts no feature at all, states
 * something that is not true of that instance. A policy that omits the
 * health-behaviour events on an instance running at `research`, which counts
 * fasting, weight, clinician sharing and study participation, omits precisely
 * the processing a reader most needs to know about. Neither is stale copy;
 * both are false disclosure in a document the operator is legally answerable
 * for. So §9a is keyed on the LEVEL, and `null` means analytics are off.
 *
 * A PROP rather than `usePublicConfig()`: this component is deliberately
 * renderable by `renderToStaticMarkup` with no data router (see the header
 * below), and a hook would take that away. The route passes the real value.
 */
export interface PrivacyContentProps {
  /** `null` unless the operator configured Matomo. The self-host default. */
  analyticsLevel?: AnalyticsEventLevel | null;
  /**
   * `true` on an instance an organization runs for its people (M196).
   *
   * Three paragraphs of this policy were written for the open instance and are
   * false on a managed one: it HAS accounts, the diary does reach the server
   * (as ciphertext), and the plate photo goes through the operator's own proxy
   * under the operator's key rather than straight to a provider the person
   * picked. A prop for the same reason `analyticsLevel` is one: the content
   * stays renderable with no data router.
   */
  managed?: boolean;
}

/**
 * The Section 1 one-liner, one claim per level.
 *
 * A `Record` over the union rather than a chain of ternaries: a fourth level
 * added to `AnalyticsEventLevel` fails to compile HERE, which is the point. A
 * ternary chain would keep compiling and would quietly make one of these three
 * claims about an instance that does something else.
 */
const S1_ITEM4_KEY_BY_LEVEL = {
  pageviews: 'privacy.s1Item4Pageviews',
  product: 'privacy.s1Item4Analytics',
  research: 'privacy.s1Item4Research',
} satisfies Record<AnalyticsEventLevel, string>;

export function PrivacyContent({ analyticsLevel = null, managed = false }: PrivacyContentProps) {
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
          <li>{t(analyticsLevel === null ? 'privacy.s1Item4NoAnalytics' : S1_ITEM4_KEY_BY_LEVEL[analyticsLevel])}</li>
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

        Since MATOMO_EVENT_LEVEL exists, presence is not the only fact: the
        CONTENT below is keyed on the level too. See the props doc block for why
        a boolean stopped being a true statement about a `pageviews` or a
        `research` instance.

        No consent banner accompanies this, deliberately and on advice: the tracker
        is loaded with cookies disabled and stores nothing on the device, so §25
        TTDSG is not engaged and the legal basis is Art. 6(1)(f). If anyone ever
        switches cookies back on in use-matomo-tracker.ts, that reasoning dies
        with the change and a banner becomes mandatory.
      */}
      {analyticsLevel !== null ?
        <section className="mb-8">
          <H2 variant="default">{t('privacy.s9aOnHeading')}</H2>
          <P>
            <Trans i18nKey="legal:privacy.s9aOnBody1" components={{ b: <strong /> }} />
          </P>
          {/* The "what is recorded" list differs by level: `s9aOnBody2` names
              the features used, which an instance at `pageviews` never counts,
              so that instance gets the paragraph that says so instead. */}
          <P className="mt-4">
            <Trans
              i18nKey={analyticsLevel === 'pageviews' ? 'legal:privacy.s9aPageviewsBody2' : 'legal:privacy.s9aOnBody2'}
              components={{ b: <strong /> }}
            />
          </P>
          {/* The level itself, disclosed at every level: a reader cannot judge
              the paragraph above without knowing that its scope is a setting. */}
          <P className="mt-4">
            <Trans i18nKey="legal:privacy.s9aLevelBody" components={{ b: <strong /> }} />
          </P>
          {analyticsLevel === 'research' && (
            <P className="mt-4">
              <Trans i18nKey="legal:privacy.s9aResearchBody" components={{ b: <strong /> }} />
            </P>
          )}
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
      <PrivacyContent analyticsLevel={analytics?.eventLevel ?? null} managed={managed} />
    </PublicWrapper>
  );
}
