import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { PHOTO_RETENTION_DAYS } from '#app/lib/local-store/photo-policy';
import { USAGE_COUNTER_RETENTION_DAYS } from '#app/lib/admin/operator-visibility';
import type { MetaFunction } from 'react-router';
import { useInstancePolicy, usePublicConfig } from '#app/hooks/use-public-config';
import { useFeedbackRetentionDays } from '#app/hooks/use-server-instance';
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
  /**
   * How long the sync server keeps a photograph somebody reported, in days, or
   * `null` when it has advertised no window.
   *
   * A PROP, AND NOT A CONSTANT, which is the whole of M200 spec 06. This file
   * used to import `FEEDBACK_RETENTION_DAYS` from the app's own consent module
   * and publish that number as fact. The deletion happens in another
   * repository, on another schedule, under another operator, and nothing tied
   * the two together: a server whose window moved left this document stating a
   * period nobody keeps. The number now comes off that server's `/health`
   * handshake.
   *
   * `null` IS NOT A MISSING 30. It is "this app has not been told", which is
   * the honest state for a self-hosted instance with no sync server, for a
   * server with reports switched off, and for one older than the field. The
   * policy then names the operator's period without inventing a length for it,
   * because a legally operative document may not state a retention window on a
   * guess.
   */
  reportRetentionDays?: number | null;
  /**
   * `true` where an operator can open one person and read their account row,
   * their last sign-in and their photo counts (M201 spec 06).
   *
   * A SECOND PROP RATHER THAN A SIXTH USE OF `managed`, and the reason is the
   * one the previous round left open. `managed` above is fed by
   * `serverHoldsTheDiary` and gates three paragraphs that state three
   * different things: that accounts exist, that the diary reaches this server
   * as ciphertext, and that the plate photo passes through it. All three
   * questions answer alike in both modes today, so splitting the EXISTING
   * paragraphs would rename call sites and change nothing a reader sees, and
   * `privacy.leadManaged` states all three in one paragraph and could not be
   * split at all without rewriting it. What is worth having is the rule going
   * forward: a NEW claim gets the prop for the question it actually depends
   * on. This one is that question, and it is genuinely distinct, because an
   * instance could hold the ciphertext without an operator who reads
   * per-person activity, and this is the paragraph that would then be false.
   */
  operatorSeesActivity?: boolean;
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

export function PrivacyContent({
  analyticsLevel = null,
  managed = false,
  reportRetentionDays = null,
  operatorSeesActivity = false,
}: PrivacyContentProps) {
  const { t, i18n } = useTranslation('legal');
  // TWO WINDOWS, AND THEY ARE NOT THE SAME THING, AND THEY DO NOT COME FROM
  // THE SAME PLACE. `days` is how long the on-device photo cache keeps a
  // picture before evicting it: this app enforces that itself, so the sentence
  // reads the constant the eviction acts on. `reportWindow` is how long the
  // operator of the sync server keeps a photograph somebody deliberately
  // reported: that deletion happens on their machine, so the sentence reads
  // what THEY advertised, and says "the period the operator has set" when they
  // have advertised nothing. Neither number is ever typed into the copy.
  const days = PHOTO_RETENTION_DAYS;
  const reportWindow =
    reportRetentionDays === null ?
      t('privacy.reportWindowUnknown')
    : t('privacy.reportWindowDays', { reportDays: reportRetentionDays });
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
          <li>{t('privacy.s1Item3', { reportWindow })}</li>
          <li>{t(analyticsLevel === null ? 'privacy.s1Item4NoAnalytics' : S1_ITEM4_KEY_BY_LEVEL[analyticsLevel])}</li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s2Heading')}</H2>
        <P>{t(managed ? 'privacy.s2Body1Managed' : 'privacy.s2Body1')}</P>
        <P className="mt-4">{t('privacy.s2Body2', { days, reportWindow })}</P>
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
        <P className="mt-4">{t('privacy.s3Outro', { reportWindow })}</P>
      </section>

      <section className="mb-8">
        <H2 variant="default">{t('privacy.s4Heading')}</H2>
        {/* `s4BodyOnManaged`, NOT `s4BodyManaged`: the section already ends
            with `s4ManagedBody` below, and two keys a letter apart in the same
            section is how a swap lands on the wrong paragraph. */}
        <P>{t(managed ? 'privacy.s4BodyOnManaged' : 'privacy.s4Body', { days, reportWindow })}</P>
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
        {/* THE "ONLY" IN `s6Body4` IS FALSE ON A MANAGED INSTANCE, which is
            why this is a twin and not an extra paragraph. Since M201 spec 04
            an operator also reads a last sign-in and ninety days of daily
            photo counts, so a document that still called the address, the blob
            size and the storage time the only account-linked information would
            be understating what an administrator sees. The twin names the same
            fields `account.operatorSees.*` names in the app, in this
            document's register rather than the app's. */}
        <P className="mt-4">
          {t(operatorSeesActivity ? 'privacy.s6Body4Managed' : 'privacy.s6Body4', {
            usageDays: USAGE_COUNTER_RETENTION_DAYS,
          })}
        </P>
        {/* And the other half, which is the more important one: none of that
            is the diary. It stops short of "the operator can never read it",
            because `s6Body3` above says the opposite about the escrowed
            recovery key and a policy that contradicted itself two paragraphs
            apart would be worse than one that says less. */}
        {operatorSeesActivity && <P className="mt-4">{t('privacy.s6Body5Managed')}</P>}
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
  // WHICH QUESTION (M201/07). Same bundle argument as `Terms`: the managed
  // policy states that an account record exists, that the diary reaches this
  // operator's server as ciphertext, and that the plate photo passes through
  // it. The three questions answer alike and the document is one bundle, so
  // the route asks the one that changes the most paragraphs.
  // TWO QUESTIONS, because §6 now makes two claims. `serverHoldsTheDiary`
  // still chooses the paragraphs about accounts, ciphertext and the proxy;
  // `operatorSeesActivity` chooses the two that say what an administrator may
  // read about one person. The prop doc block records why the older bundle was
  // left as it is.
  const { serverHoldsTheDiary, operatorSeesActivity } = useInstancePolicy();
  // `null` until the sync server's `/health` answers, and for ever on an
  // instance that has none. The paragraph reads sensibly either way, which is
  // why this is not gated on a loading state: a policy that flickered between
  // two different retention claims would be worse than one that names the
  // operator's period.
  const reportRetentionDays = useFeedbackRetentionDays();
  return (
    <PublicWrapper>
      <PrivacyContent
        analyticsLevel={analytics?.eventLevel ?? null}
        managed={serverHoldsTheDiary}
        reportRetentionDays={reportRetentionDays}
        operatorSeesActivity={operatorSeesActivity}
      />
    </PublicWrapper>
  );
}
