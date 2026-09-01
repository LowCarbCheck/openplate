import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { PHOTO_RETENTION_DAYS } from '#app/lib/local-store/photo-policy';
import type { MetaFunction } from 'react-router';
import { usePublicConfig } from '#app/hooks/use-public-config';

export const meta: MetaFunction = () => {
  return [{ title: 'Privacy Policy' }];
};

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
}

export function PrivacyContent({ analyticsEnabled = false }: PrivacyContentProps) {
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        Privacy Policy
      </H1>

      <P variant="subtle" className="mb-8">
        Last updated: September 1, 2026
      </P>

      <P variant="lead" className="mb-8">
        openplate is local-first. Everything you track — your foods, food logs, weight, goals, and AI provider key —
        lives in your browser on your own device, not on our servers. This policy describes the hosted openplate
        instance we operate. If you run your own self-hosted copy, you (or whoever operates that instance) are the data
        controller for it, and this policy does not govern your deployment.
      </P>

      <section className="mb-8">
        <H2 variant="default">1. The short version</H2>
        <ul className="mt-4">
          <li>
            Your tracker data (foods, logs, weight, goals) is stored on your device, in the browser&apos;s local
            storage. It is not uploaded to our servers by default.
          </li>
          <li>
            The app itself has no accounts and no sign-in. If you switch on the optional sync
            service, that separate service keeps a small record so you can sign in: your email and
            a one-way hash derived from your passphrase. No health or nutrition data is readable
            from it.
          </li>
          <li>
            AI plate identification uses your own AI provider. Your plate photo and your provider key are sent straight
            from your browser to that provider — they never pass through our servers. Your browser also keeps a
            temporary on-device copy of the photo (see Section 2) so you can see it again later; that copy is never
            uploaded anywhere.
          </li>
          <li>
            We use no advertising and no third-party analytics.{' '}
            {analyticsEnabled
              ? 'This instance measures visits and feature use with our own Matomo, which we run on our own server, so no data reaches an analytics company. It sets no cookies, and it is never told what you eat, weigh or log: your diary never leaves your device. See Section 9a for exactly what is recorded and how to object.'
              : 'This instance measures nothing at all: no analytics program runs on it. See Section 9a.'}{' '}
            An instance you host yourself has analytics switched off unless you turn them on.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">2. What stays on your device</H2>
        <P>
          openplate is built local-first. Your personal foods, food logs, weight entries, and profile/goals are stored
          on-device in your browser&apos;s IndexedDB. This data is not sent to us and we cannot see it. Because it lives
          in your browser profile, clearing your browser data (or the site&apos;s storage) removes it — so keep that in
          mind before you clear it, and note that this data is tied to the specific browser and device you use.
        </P>
        <P className="mt-4">
          When you scan a plate, the photo itself is also kept on your device, in a separate on-device cache from your
          other tracker data, so you can see it again on that food-log entry. It is never uploaded to us and never
          leaves your device — it only ever goes to the AI provider you connect, as described in Section 4. This cache
          is on by default, clears itself automatically after {PHOTO_RETENTION_DAYS} days, and you can turn it off or
          clear it at any time from your Profile page.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">3. What we store on our servers</H2>
        <P>
          The openplate app server stores nothing about you at all. It has no accounts, no
          database, and no record of your visit beyond the ordinary web-request metadata described
          in Section 5. Everything below concerns the <strong>separate, optional sync service</strong>{' '}
          described in Section 6, which you only ever reach by choosing to create a sync account.
          If you never do, none of it applies to you.
        </P>
        <P className="mt-4">When you create a sync account, that service stores the minimum needed to operate your sign-in:</P>
        <ul className="mt-4">
          <li>Your email address and display name.</li>
          <li>
            A one-way hash of a value derived on your device from your passphrase (never the
            passphrase itself, and never a key that could decrypt anything). The service can check
            that you are you; it cannot read your passphrase and cannot recover it for you.
          </li>
          <li>
            Hashes of one-time email-verification and password-reset tokens (never the raw links), used only to confirm
            the links you receive by email.
          </li>
          <li>
            Basic account timestamps and status flags (for example, when your account was created and whether your email
            is verified).
          </li>
        </ul>
        <P className="mt-4">
          We do not store your foods, food logs, weight, goals, or plate photos in readable form on
          any server. Those live on your device, and if you switch sync on they are encrypted on
          your device before they are uploaded (Section 6).
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">4. AI plate identification (your own provider)</H2>
        <P>
          openplate&apos;s photo-to-macros feature is bring-your-own-key: you connect your own AI provider (such as an
          OpenAI-compatible endpoint, OpenRouter, or Anthropic) and supply your own API key. When you scan a plate, your
          browser sends the photo directly to that provider using your key. The photo and the key never pass through our
          servers. Your browser does keep an on-device copy of the photo, separate from our servers and described in
          Section 2, so you can see it again on that entry; it is never uploaded anywhere, it expires on its own after{' '}
          {PHOTO_RETENTION_DAYS} days, and you can clear it or turn it off entirely from your Profile page. Your AI
          provider is a separate third party that you have chosen and whose relationship is with you under your own
          account and key — how they handle the photo is governed by that provider&apos;s own terms and privacy policy,
          not by us.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">5. Food search</H2>
        <P>
          After a scan identifies foods, openplate can look up curated nutrition data by name from the public
          LowCarbCheck food database. Only the food name is sent for a food search — never your photo, never your
          account data. The search term travels in the body of the request (not in the URL) specifically so it does not
          end up in a server access log, and we do not store the search terms. The one signal that does reach our server
          during a food search is the ordinary web-request metadata every website receives, including your IP address,
          which is used transiently for rate-limiting and appears in standard access logs; it is not linked to your
          tracker data.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">6. End-to-end encrypted sync (optional)</H2>
        <P>
          Sync is available and it is off unless you switch it on. It lets you carry your tracker
          data between your own devices. Registration is currently by invitation only, so you
          cannot end up with a sync account by accident.
        </P>
        <P className="mt-4">
          It is end-to-end encrypted. Your data is encrypted on your device before it is uploaded,
          and the sync server stores only opaque ciphertext that it cannot read or decrypt. The
          encryption keys are derived on your device from a passphrase only you hold — the server
          never sees your passphrase, your plaintext, or your decryption keys. That also means we
          cannot reset your passphrase or recover your data if you lose it; there is no back door
          for us to use on your behalf.
        </P>
        <P className="mt-4">
          The only account-linked information the sync server can see is non-content metadata: your
          email address, the size of an encrypted blob, and the time it was stored. It runs as a
          separate service from the app server described in Section 3.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">7. Transactional email</H2>
        <P>
          The hosted instance sends transactional email only — email verification and password-reset messages. We do not
          send marketing email. On the hosted instance these messages are delivered through our internal Pigeon email
          service, which relays them via Amazon SES (in the EU eu-central-1 region). Your email address and the message
          contents are processed by that delivery chain in order to reach you.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">8. Hosting and backups</H2>
        <P>
          The hosted instance runs on Hetzner infrastructure in the EU. The server database — which, as described above,
          holds the sync service's account records and end-to-end-encrypted sync blobs, but no plaintext tracker
          data — is included in our routine encrypted backups, stored in Amazon S3 in the EU (eu-central-1 region) for
          disaster recovery. Encrypted sync blobs remain encrypted in those backups; a backup gives us no more
          visibility into your data than the live database does. Backups are retained on a rolling basis and rotate out
          over time.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">9. Cookies</H2>
        <P>
          There is no sign-in on this site and therefore no session cookie. The cookies openplate
          sets are small preference cookies, written by your own browser, read only by this site,
          and never sent anywhere else:
        </P>
        <ul className="mt-4">
          <li>Your chosen interface language, so the page loads in it next time.</li>
          <li>Whether the sidebar is open or closed.</li>
          <li>Whether you have already seen the home-screen install hint.</li>
          <li>
            A short-lived cookie that carries a one-off confirmation message across a page reload.
          </li>
        </ul>
        <P className="mt-4">
          None of them identifies you, none is used to build a profile, and none is shared. We use
          no advertising cookies and no third-party tracking cookies. Clearing your browser data
          removes them; the only effect is that those preferences reset.
        </P>
      </section>

      {/*
        Article 13 disclosure for the hosted instance's analytics, added 2026-08-31
        with the openplate.de cutover and made CONDITIONAL on 2026-09-01 (M167/02).

        It was written unconditionally at first, reasoning that this whole document
        describes "the hosted openplate instance we operate". That reasoning was
        wrong in exactly one way and it mattered: the cutover shipped the section
        while `MATOMO_URL` was never set on the hosted instance, so the live policy
        described measurement that was switched off. It named cookies, a retention
        window and a right to object, all for something that was not running.

        Gating it on the fact is what makes the sentence self-correcting: the
        section appears when analytics does and disappears when it does not, on
        the hosted instance and on a self-hosted one alike, with no second edit.

        No consent banner accompanies this, deliberately and on advice: the tracker
        is loaded with cookies disabled and stores nothing on the device, so §25
        TTDSG is not engaged and the legal basis is Art. 6(1)(f). If anyone ever
        switches cookies back on in `use-matomo-tracker.ts`, that reasoning dies
        with the change and a banner becomes mandatory.
      */}
      {analyticsEnabled ? (
        <section className="mb-8">
          <H2 variant="default">9a. Analytics on the hosted instance</H2>
          <P>
            We measure how the hosted instance is used with <strong>Matomo</strong>, an analytics
            program we run on our own server. No third party receives the data and it is never sold or
            shared.
          </P>
          <P className="mt-4">
            <strong>What is recorded:</strong> the page you opened with any query string and account
            identifier removed before it is sent, a shortened form of your IP address, your browser
            type, your screen size, the page that linked you here, and which features you used — for
            example that a plate was scanned, or that a backup was exported. <strong>What is never
            recorded:</strong> anything from your diary. Not food names, not weights, not goals, not
            photos, not fasting times, and no identifier that ties events back to you.
          </P>
          <P className="mt-4">
            <strong>Cookies:</strong> none. The tracker runs with cookies switched off and stores
            nothing on your device, which is why you were not asked to accept anything.
          </P>
          <P className="mt-4">
            <strong>Legal basis:</strong> our legitimate interest in understanding whether the
            software works and which parts are used (Art. 6(1)(f) GDPR). <strong>Retention:</strong>{' '}
            raw records are deleted after 90 days; only anonymous totals are kept after that.
          </P>
          <P className="mt-4">
            <strong>Your right to object (Art. 21 GDPR):</strong> turn on “Do Not Track” in your
            browser and we record nothing — our Matomo is configured to honour it. You may also write
            to us at the address in the <a href="/imprint">imprint</a>.
          </P>
          <P className="mt-4">
            An instance you host yourself records nothing at all unless you configure Matomo on it.
            That is the default.
          </P>
        </section>
      ) : (
        <section className="mb-8">
          <H2 variant="default">9a. Analytics</H2>
          <P>
            This instance measures nothing. No analytics program runs on it, no usage data is
            collected, and no third party receives anything about you. There is nothing to object
            to and nothing to opt out of.
          </P>
          <P className="mt-4">
            An instance you host yourself behaves the same way unless you configure Matomo on it.
            That is the default.
          </P>
        </section>
      )}

      <section className="mb-8">
        <H2 variant="default">10. Your rights and data requests</H2>
        <P>
          Under the GDPR you have the right to access, correct, delete, restrict, or export your personal data, and to
          object to its processing. In practice, most of your data is already under your direct control:
        </P>
        <ul className="mt-4">
          <li>
            Your tracker data lives on your device, so you can view, change, or erase it directly at any time from
            within the app or by clearing the site&apos;s local storage.
          </li>
          <li>
            We do not yet offer a self-service button to export or delete your server-side account record. Until we do,
            you can make an access, correction, export, or erasure request by contacting us at the address below, and we
            will action it. We are honest about this rather than advertising a self-service flow that does not exist
            yet.
          </li>
          <li>
            If you run a self-hosted instance, you have direct database and CLI access to your own data and can export
            or delete it yourself.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">11. Self-hosting</H2>
        <P>
          openplate is open-source and can be self-hosted. This policy describes the specific hosted instance we
          operate. On a self-hosted deployment, the operator of that instance — not the openplate project — is the data
          controller and is responsible for its own privacy practices.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">12. Changes to this policy</H2>
        <P>
          We may update this policy as openplate evolves. When we make a
          material change, we will update the &quot;Last updated&quot; date above.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">13. Contact</H2>
        <P>
          For any privacy question, or to make a data access, export, or erasure request, contact us at{' '}
          <a href="mailto:partners@sportsight.de">partners@sportsight.de</a>.
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
  return (
    <PublicWrapper>
      <PrivacyContent analyticsEnabled={analytics !== null} />
    </PublicWrapper>
  );
}
