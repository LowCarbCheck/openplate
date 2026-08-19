import { H1, H2, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => {
  return [{ title: 'Terms of Service' }];
};

/**
 * The terms copy itself, split out from the page chrome so it can be unit-tested
 * (`renderToStaticMarkup`) without needing a router context — `PublicWrapper` reads
 * the authenticated user via `useOptionalUser`, which requires a data router; this
 * component has no such dependency (plain `<a>` tags only, no `Link`/`NavLink`).
 */
export function TermsContent() {
  return (
    <article className="prose prose-zinc dark:prose-invert max-w-none">
      <H1 variant="default" className="mb-8">
        Terms of Service
      </H1>

      <P variant="subtle" className="mb-8">
        Last updated: July 16, 2026
      </P>

      <P variant="lead" className="mb-8">
        These terms govern your use of the hosted openplate instance we (LowCarbCheck) operate. openplate is a local-first
        food-tracking tool with bring-your-own-key AI plate identification. By creating an account on the hosted
        instance, or otherwise using it, you agree to these terms. openplate is open-source and can be self-hosted; if
        you run your own copy, these terms describe our hosted deployment only and do not govern your instance.
      </P>

      <section className="mb-8">
        <H2 variant="default">1. Acceptance of terms</H2>
        <P>
          By accessing or using the hosted openplate service, you agree to be bound by these Terms of Service and by our{' '}
          <a href="/privacy">Privacy Policy</a>. If you do not agree, please do not use the hosted service. If you are
          using openplate on behalf of an organisation, you represent that you have authority to accept these terms on
          its behalf.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">2. What openplate is</H2>
        <P>
          openplate is a food-tracking tool. It is built local-first: your foods, food logs, weight entries, goals, and
          your AI provider key live in your browser on your own device, not on our servers. The hosted service
          additionally keeps a small account record so you can sign in, and — once premium sync ships — can store
          end-to-end-encrypted copies of your data that only you can decrypt. The core feature is bring-your-own-key AI
          plate identification: you connect your own AI provider and it estimates the macros and nutrition of a plate
          from a photo.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">3. Not medical or nutritional advice</H2>
        <P>
          openplate is not a medical device and does not provide medical or nutritional advice. The macro and nutrition
          figures shown after a plate scan are estimates produced by the AI provider you have configured — they are
          approximations, not measurements, and can be wrong. Food-search nutrition data is likewise provided for
          general information only. You should not rely on openplate for medical, dietary, or health decisions; consult
          a qualified professional for those. To the fullest extent permitted by law, we are not liable for the accuracy
          of AI-generated estimates or of any nutrition data, or for any decision you make based on them.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">4. Bring your own AI provider</H2>
        <P>
          AI plate identification is bring-your-own-key (BYOK) and runs entirely on your device. You connect your own AI
          provider (an OpenAI-compatible endpoint or Anthropic) and supply your own API key. That key is stored only on
          your device, and when you scan a plate the photo is sent straight from your browser to your provider using
          your key — neither the key nor the photo ever passes through our servers. Your AI provider is a separate third
          party that you choose and that bills you directly under your own account. We have no relationship with, and no
          liability for, that provider&apos;s service, pricing, availability, output, or how it handles your photo; that
          is governed by the provider&apos;s own terms and privacy policy, not by us. You are responsible for your own
          usage costs with your provider.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">5. Acceptable use</H2>
        <P>When using the hosted service, you agree not to:</P>
        <ul className="mt-4">
          <li>scrape, crawl, or bulk-harvest the service or its food data by automated means;</li>
          <li>
            attempt credential stuffing, brute-forcing, or any other unauthorised access to accounts that are not yours;
          </li>
          <li>
            send excessive automated requests — for example, hammering the food-search endpoint — beyond ordinary
            interactive use;
          </li>
          <li>
            probe, disrupt, or overload the service, or attempt to circumvent its rate-limiting or security controls;
          </li>
          <li>use the service for any unlawful purpose or to upload malicious code.</li>
        </ul>
        <P className="mt-4">
          The hosted service applies rate-limiting and login/registration throttling to protect availability. Repeatedly
          tripping these limits, or otherwise abusing the service, may lead to temporary blocks or to suspension of your
          account under the next section.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">6. Your account, suspension, and termination</H2>
        <P>
          You are responsible for keeping your account credentials secure. We may suspend or terminate access to the
          hosted service if you breach these terms, abuse the service, or where we are required to by law. Where
          practical and lawful we will give notice, but for serious abuse or security reasons we may act immediately.
          Terminating your access to the hosted service does not affect the tracker data stored locally on your own
          device.
        </P>
        <P className="mt-4">
          You can stop using the hosted service at any time. Because openplate is local-first, most of your data is
          already under your direct control — clearing the site&apos;s local storage erases your on-device tracker data.
          We do not yet offer a self-service button to delete your server-side account record. Until we do, you can
          request deletion of your account by contacting us at the address below and we will action it. This mirrors our
          Privacy Policy — we are honest about the absence of a self-service flow rather than advertising one that does
          not exist yet.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">7. Premium end-to-end encrypted sync</H2>
        <P>
          We are building an optional paid premium tier that will let you sync your tracker data across your own
          devices. It is not yet available, and the terms in this section apply only once it launches and you subscribe.
          When it ships, subscribing grants your account a sync entitlement; the terms below describe what that
          entitlement means so there are no surprises.
        </P>
        <ul className="mt-4">
          <li>
            <strong>End-to-end encryption.</strong> Your data is encrypted on your device before upload. Our server
            stores only opaque ciphertext it cannot read, and the encryption keys are derived on your device from a
            passphrase only you hold.
          </li>
          <li>
            <strong>Version retention.</strong> To make sync robust, the server keeps a limited history of your
            encrypted data — the five most recent versions per account. When you save a newer version, the oldest is
            automatically pruned. By using premium sync you agree to this retention model.
          </li>
          <li>
            <strong>Cancellation or downgrade.</strong> If you cancel your premium subscription or delete your account,
            your locally stored tracker data on your own devices is unaffected. Your server-stored encrypted sync blobs
            are deleted within 30 days of cancellation or account deletion, after which they cannot be restored from the
            live service. (Routine encrypted backups may retain them a little longer before they rotate out, as
            described in the Privacy Policy.)
          </li>
          <li>
            <strong>Passphrase and recovery-code loss.</strong> Because sync is end-to-end encrypted, we literally
            cannot recover a lost passphrase or recovery code, and we cannot decrypt or reset your synced data on your
            behalf. If you lose your passphrase and your recovery code, your server-stored synced data is permanently
            inaccessible. Safeguarding them is your responsibility, and any resulting data loss is not our liability.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <H2 variant="default">8. No warranty and limitation of liability</H2>
        <P>
          The hosted service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind,
          to the fullest extent permitted by law. We do not warrant that it will be uninterrupted, error-free, or that
          AI estimates and nutrition data will be accurate. To the fullest extent permitted by law, we are not liable
          for indirect or consequential loss, for loss of data (including data made inaccessible by a lost passphrase),
          or for decisions made in reliance on estimates produced by your AI provider. Nothing in these terms limits any
          liability that cannot be limited under applicable law.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">9. Self-hosting</H2>
        <P>
          openplate is open-source and can be self-hosted. These terms describe the specific hosted instance we operate.
          On a self-hosted deployment, the operator of that instance — not the openplate project — is responsible for
          its own terms, its own users, and its own operation, and these terms do not apply to it.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">10. Changes to these terms</H2>
        <P>
          We may update these terms as openplate evolves — for example, when premium sync launches. When we make a
          material change, we will update the &quot;Last updated&quot; date above. Continuing to use the hosted service
          after a change means you accept the updated terms.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">11. Governing law</H2>
        <P>
          These terms are governed by the laws of Germany, where the operator is based, without regard to
          conflict-of-law rules. Mandatory consumer-protection rights you have under the law of your country of
          residence are not affected.
        </P>
      </section>

      <section className="mb-8">
        <H2 variant="default">12. Contact</H2>
        <P>
          Questions about these Terms of Service, or requests to delete your account, can be sent to us at{' '}
          <a href="mailto:partners@sportsight.de">partners@sportsight.de</a>.
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
