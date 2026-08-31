/**
 * The landing page's newsletter capture (M146 spec 02).
 *
 * ── This component only exists on an instance that configured one ────────
 *
 * It is rendered exclusively behind the landing loader's `newsletter` gate
 * (`NEWSLETTER_SUBSCRIBE_URL` + `NEWSLETTER_TURNSTILE_SITE_KEY`). With the
 * feature off nothing here mounts, so no Turnstile script is fetched and no
 * request is made — see `app/config/newsletter.ts` for why the mailing list is
 * the operator's rather than the software's.
 *
 * ── Why it is not an email box with a button ─────────────────────────────
 *
 * This is a personal-data collection point, so it carries the same guards the
 * sibling site's form does: an UNTICKED consent checkbox (opt-in has to be an
 * act), a link to the privacy policy next to it, and a Turnstile challenge.
 * The submit button stays disabled until consent is given and the challenge
 * passes, so a visitor cannot post before either exists.
 *
 * Every async state is on screen (DESIGN.md §1 principle 2): pending spinner,
 * a real error line, and a confirmation that REPLACES the form on success —
 * a form left standing after a successful signup invites a second one, and the
 * second one fails on a spent challenge token.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';

import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { loadTurnstile } from '#app/lib/turnstile';
import type { NewsletterOutcome } from '#app/lib/newsletter-outcome';
import { trackNewsletterSubscribed } from '#app/lib/matomo-events';

const CONSENT_FIELD_ID = 'newsletter-consent';
/** Ties the "waiting for the check" line to the disabled submit button. */
const CHALLENGE_HINT_ID = 'newsletter-challenge-hint';

/**
 * Renders the challenge and reports its token, or `null` while there isn't one
 * (not yet solved, expired, or errored). `reset` spends the current token and
 * asks for a fresh challenge — required after any submit, because a token is
 * single-use.
 */
function useTurnstile(siteKey: string, language: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    let cancelled = false;
    void (async () => {
      try {
        const turnstile = await loadTurnstile();
        if (cancelled) return;
        widgetIdRef.current =
          turnstile.render(container, {
            sitekey: siteKey,
            language,
            // Calm by default: invisible unless this visitor is actually
            // challenged, following the OS theme when it isn't (the widget is
            // a cross-origin iframe, so the app's `.dark` class cannot style
            // it), and taking the form's width rather than a fixed 300px box.
            theme: 'auto',
            appearance: 'interaction-only',
            size: 'flexible',
            callback: (issued) => setToken(issued),
            'error-callback': () => setToken(null),
            'expired-callback': () => setToken(null),
          }) ?? null;
      } catch {
        // Cloudflare unreachable, or blocked by an extension. The form says so
        // rather than sitting with a permanently disabled button.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
      widgetIdRef.current = null;
    };
  }, [siteKey, language]);

  const reset = useCallback(() => {
    const widgetId = widgetIdRef.current;
    if (widgetId === null) return;
    window.turnstile?.reset(widgetId);
    setToken(null);
  }, []);

  return { containerRef, token, failed, reset };
}

export function NewsletterSignup({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const { t, i18n } = useTranslation();
  const fetcher = useFetcher<NewsletterOutcome>();
  const [consented, setConsented] = useState(false);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { containerRef, token, failed, reset } = useTurnstile(turnstileSiteKey, language);

  const outcome = fetcher.data ?? null;
  const isPending = fetcher.state !== 'idle';
  // The one disabled-button state the visitor cannot act on: the challenge has
  // neither passed nor failed yet. Not shown when it FAILED (that has its own
  // error line below) and not while submitting (the button says so itself).
  const awaitingChallenge = token === null && !failed && !isPending;

  // A spent token cannot be replayed, so every completed attempt that did NOT
  // succeed needs a fresh challenge before the visitor can try again.
  useEffect(() => {
    if (fetcher.state !== 'idle') return;
    if (outcome === null || outcome.ok) return;
    reset();
  }, [fetcher.state, outcome, reset]);

  // Reported from an effect rather than the render below, because that branch
  // re-renders and would count one signup many times. `outcome.ok` alone is
  // the trigger; the status (subscribed vs already-subscribed) is deliberately
  // NOT sent — it is a fact about one person's prior state, not about whether
  // the form works.
  useEffect(() => {
    if (fetcher.state !== 'idle' || outcome === null || !outcome.ok) return;
    trackNewsletterSubscribed();
  }, [fetcher.state, outcome]);

  if (outcome !== null && outcome.ok) {
    return (
      <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t(`landing.newsletter.status.${outcome.status}`)}</span>
      </p>
    );
  }

  return (
    <fetcher.Form method="post" action="/?index" className="space-y-4">
      <input type="hidden" name="intent" value="newsletter" />
      <input type="hidden" name="locale" value={language} />
      <input type="hidden" name="turnstileToken" value={token ?? ''} />

      <div className="space-y-2">
        {/* `block`: shadcn's `Label` is an inline-flex row, so without it the
            label box shrink-wrapped the word and the `space-y-2` gap to the
            input was measured off an inline box rather than a block one. */}
        <Label htmlFor="newsletter-email" className="block">
          {t('landing.newsletter.emailLabel')}
        </Label>
        <Input
          id="newsletter-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder={t('landing.newsletter.emailPlaceholder')}
          className="max-w-sm"
        />
      </div>

      <div className="flex items-start gap-2.5">
        {/* Unticked, always: consent has to be an act. `value` rides along only
            when the box is checked, which is what the action reads. */}
        <input
          id={CONSENT_FIELD_ID}
          type="checkbox"
          name="consent"
          value="true"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
        />
        <Label htmlFor={CONSENT_FIELD_ID} className="text-sm font-normal leading-relaxed text-muted-foreground">
          {t('landing.newsletter.consent')}
        </Label>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        <Trans
          i18nKey="landing.newsletter.privacy"
          components={{
            privacy: (
              <Link to="/privacy" className="underline underline-offset-4 transition-colors hover:text-foreground">
                {/* Replaced by the linked run from the catalog entry. */}
                privacy
              </Link>
            ),
          }}
        />
      </p>

      {/* The challenge itself. It is the reason this section can exist at all
          on a service whose data-protection paperwork is still open.

          NO reserved height. It used to be `min-h-[65px]`, which was correct
          for a widget that always draws itself — and `appearance:
          'interaction-only'` means it usually draws nothing, so the reservation
          became a 65px hole between the privacy line and the submit button on
          almost every visit. An empty container collapses; a real challenge
          pushes the button down, which is a challenge appearing, not a layout
          shift the visitor has to interpret. */}
      <div ref={containerRef} />

      <div className="flex flex-wrap items-center gap-3">
        {/* The DEFAULT (filled) variant. M146 spec 02's rule is about competing
            CTA DESTINATIONS — "exactly one CTA destination may be a filled
            primary button, and `/dashboard` is it" — and it is checked as
            such: the spec's grep counts `to="/dashboard"` links above the fold.
            This is a form's submit button, not a link to anywhere; it commits
            the form the reader has already chosen to fill in. Outline made it
            look like a third way to opt out of something, sitting under a
            ticked consent box.

            It is still disabled until consent is given AND the challenge has
            passed, so it cannot post before either exists. */}
        <Button
          type="submit"
          disabled={!consented || token === null || isPending}
          aria-describedby={awaitingChallenge ? CHALLENGE_HINT_ID : undefined}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isPending ? t('landing.newsletter.pending') : t('landing.newsletter.submit')}
        </Button>
        {/* A disabled control with no stated reason is a dead end — the visitor
            ticks the box, the button stays grey, and nothing on screen says
            that a bot check is still running. `<output>` (an implicit live region) announces it to a
            screen reader when it appears, and `aria-describedby` ties it to the
            button for anyone who lands on the button first. */}
        {awaitingChallenge && (
          <output id={CHALLENGE_HINT_ID} className="text-sm text-muted-foreground">
            {t('landing.newsletter.awaitingChallenge')}
          </output>
        )}
        {outcome !== null && !outcome.ok && (
          <output className="text-sm text-red-600 dark:text-red-400">
            {t(`landing.newsletter.status.${outcome.reason}`)}
          </output>
        )}
        {failed && (
          <output className="text-sm text-red-600 dark:text-red-400">
            {t('landing.newsletter.status.challengeUnavailable')}
          </output>
        )}
      </div>
    </fetcher.Form>
  );
}
