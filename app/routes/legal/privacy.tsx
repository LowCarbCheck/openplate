import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { PHOTO_RETENTION_DAYS } from '#app/lib/local-store/photo-policy';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => {
  return [{ title: 'Privacy Policy' }];
};

/**
 * The policy copy itself, split out from the page chrome so it can be unit-tested
 * (`renderToStaticMarkup`) without needing a router context — `PublicWrapper` reads
 * the authenticated user via `useOptionalUser`, which requires a data router; this
 * component has no such dependency (plain `<a>` tags only, no `Link`/`NavLink`).
 */
export function PrivacyContent() {
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        Privacy Policy
      </H1>

      <P variant="subtle" className="mb-8">
        Last updated: July 28, 2026
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
            We keep a small account record so you can sign in: your email, your name, and a one-way hash of your
            password. No health or nutrition data is attached to it.
          </li>
          <li>
            AI plate identification uses your own AI provider. Your plate photo and your provider key are sent straight
            from your browser to that provider — they never pass through our servers. Your browser also keeps a
            temporary on-device copy of the photo (see Section 2) so you can see it again later; that copy is never
            uploaded anywhere.
          </li>
          <li>We do not use any third-party analytics, advertising, or tracking.</li>
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
        <P>When you create an account on the hosted instance, we store the minimum needed to operate your login:</P>
        <ul className="mt-4">
          <li>Your email address and display name.</li>
          <li>
            A one-way hash of your password (never the password itself). We can verify a password, but we cannot read
            it.
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
          We do not store your foods, food logs, weight, goals, or plate photos on our servers. Those live on your
          device.
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
        <H2 variant="default">6. Premium end-to-end encrypted sync</H2>
        <P>
          We are building an optional premium tier that will let you sync your tracker data across your own devices. It
          is not yet available. When premium sync becomes available, it will be end-to-end encrypted: your data is
          encrypted on your device before it is uploaded, and our server stores only opaque ciphertext that it cannot
          read or decrypt. The encryption keys are derived on your device from a passphrase only you hold — the server
          never sees your passphrase, your plaintext, or your decryption keys. The only account-linked information our
          server can see for a synced account is non-content metadata such as the encrypted blob&apos;s size and the
          time it was stored. We will not describe premium sync as active until it actually ships.
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
          holds account records and (once premium sync ships) end-to-end-encrypted sync blobs, but no plaintext tracker
          data — is included in our routine encrypted backups, stored in Amazon S3 in the EU (eu-central-1 region) for
          disaster recovery. Encrypted sync blobs remain encrypted in those backups; a backup gives us no more
          visibility into your data than the live database does. Backups are retained on a rolling basis and rotate out
          over time.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">9. Cookies</H2>
        <P>
          We use a single essential session cookie to keep you signed in. We do not use advertising cookies or
          third-party tracking cookies, and there is no third-party analytics on the hosted instance.
        </P>
      </section>

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
          We may update this policy as openplate evolves — for example, when premium sync launches. When we make a
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
  return (
    <PublicWrapper>
      <PrivacyContent />
    </PublicWrapper>
  );
}
