/**
 * THE SELF-HOSTER INVARIANT (M146/00, enforced here).
 *
 * > A self-hoster running openplate with no lowcarbcheck-specific environment
 * > sees zero cross-promotion and zero newsletter UI.
 *
 * openplate is a public repository, and the landing page now carries two
 * optional rungs — sync and a newsletter — that belong to whoever runs an
 * instance rather than to the software. The failure mode this file exists to
 * catch is silent and one-directional: a section moved from the loader's gate
 * into a component's `&&`, or an env default flipped from "absent" to "empty
 * string", still renders green everywhere while quietly putting an operator's
 * mailing list on every self-hoster's front page.
 *
 * The environment is cleared BEFORE the route module is imported, because
 * `CONFIG` reads `process.env` once at module load — a static import would
 * bind the developer's own shell.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { parseNewsletterConfig, toNewsletterPublicConfig } from '../../app/config/newsletter';
import type { NewsletterOutcome } from '../../app/lib/newsletter-outcome';
import { buildContentSecurityPolicy } from '../../app/config/content-security-policy';
import { readNewsletterResponse } from '../../app/lib/newsletter-outcome';

/** The landing loader's payload — the only thing that decides what renders. */
interface LandingData {
  syncEnabled: boolean;
  newsletter: { turnstileSiteKey: string } | null;
}

/** A GET for `/` from a browser carrying no home-entry hint (i.e. a first-time visitor). */
function landingRequest(): Request {
  return new Request('http://localhost:3000/');
}

describe('newsletter config — unset means the feature does not exist', () => {
  it('is null when neither variable is set', () => {
    assert.equal(parseNewsletterConfig({ subscribeUrl: undefined, turnstileSiteKey: undefined }), null);
    assert.equal(parseNewsletterConfig({ subscribeUrl: '', turnstileSiteKey: '  ' }), null);
  });

  it('throws rather than shipping a form with no bot check in front of it', () => {
    assert.throws(
      () => parseNewsletterConfig({ subscribeUrl: 'https://example.com/subscribe', turnstileSiteKey: undefined }),
      /NEWSLETTER_TURNSTILE_SITE_KEY/,
    );
    assert.throws(
      () => parseNewsletterConfig({ subscribeUrl: undefined, turnstileSiteKey: '0x000' }),
      /NEWSLETTER_SUBSCRIBE_URL/,
    );
  });

  it('throws on a malformed endpoint instead of degrading to "quietly off"', () => {
    assert.throws(
      () => parseNewsletterConfig({ subscribeUrl: 'not-a-url', turnstileSiteKey: '0x000' }),
      /valid absolute URL/,
    );
    assert.throws(
      () => parseNewsletterConfig({ subscribeUrl: 'ftp://example.com', turnstileSiteKey: '0x000' }),
      /http\(s\)/,
    );
  });

  it('never lets the subscribe endpoint reach the browser — only the site key', () => {
    const config = parseNewsletterConfig({
      subscribeUrl: 'https://newsletter.example.com/api/subscribe/',
      turnstileSiteKey: '0xSITEKEY',
    });
    assert.deepEqual(config, {
      subscribeUrl: 'https://newsletter.example.com/api/subscribe',
      turnstileSiteKey: '0xSITEKEY',
    });
    assert.deepEqual(toNewsletterPublicConfig(config), { turnstileSiteKey: '0xSITEKEY' });
    assert.equal(toNewsletterPublicConfig(null), null);
  });
});

/** The two server exports this file exercises, called the way the router calls them. */
interface LandingRouteModule {
  loader: (args: { request: Request }) => Promise<{ data: LandingData }>;
  action: (args: { request: Request }) => Promise<NewsletterOutcome>;
}

describe('landing loader — an empty environment renders neither optional rung', () => {
  let route: LandingRouteModule;

  before(async () => {
    delete process.env.SYNC_SERVER_URL;
    delete process.env.NEWSLETTER_SUBSCRIBE_URL;
    delete process.env.NEWSLETTER_TURNSTILE_SITE_KEY;
    const imported: unknown = await import('../../app/routes/index');
    // SAFETY: `imported` is this repo's own route module. Its typed signature
    // takes React Router's full server-args object, but both functions read
    // `request` and nothing else (see the route module), so the narrower shape
    // above is exactly what they do at runtime — and every field asserted
    // below is checked by the tests themselves.
    route = imported as LandingRouteModule;
  });

  /** The loader answers with `data(...)`; the payload is what the component destructures. */
  async function loadLandingData(): Promise<LandingData> {
    const result = await route.loader({ request: landingRequest() });
    return result.data;
  }

  it('emits no newsletter section', async () => {
    const payload = await loadLandingData();
    assert.equal(payload.newsletter, null);
  });

  it('emits no sync section', async () => {
    const payload = await loadLandingData();
    assert.equal(payload.syncEnabled, false);
  });

  it('emits nothing else at all — the payload is exactly the two gates', async () => {
    // A new field here is a new thing the landing page publishes about the
    // instance. That is a deliberate act, so it fails this assertion first.
    const payload = await loadLandingData();
    assert.deepEqual(Object.keys(payload).toSorted(), ['newsletter', 'syncEnabled']);
  });

  it('exposes no POST target for the newsletter', async () => {
    const request = new Request('http://localhost:3000/?index', { method: 'POST', body: new FormData() });
    // The action THROWS a 404 Response rather than returning "not enabled
    // here" — on this instance the address really is not a POST target.
    const thrown = await route.action({ request }).then(
      () => null,
      (rejection: Error | Response) => rejection,
    );
    assert.ok(thrown instanceof Response, 'expected a thrown Response, not a rendered "not enabled here"');
    assert.equal(thrown.status, 404);
  });
});

describe('CSP — the third-party script origin is part of the gate', () => {
  const base = {
    syncOrigin: null,
    connectExtra: [],
    providerOrigins: [],
    presetOrigin: null,
  };

  it('names no third-party script origin when the newsletter is off', () => {
    const policy = buildContentSecurityPolicy({ ...base, newsletterEnabled: false });
    assert.doesNotMatch(policy, /challenges\.cloudflare\.com/);
    // No frame-src at all: `default-src 'self'` governs, exactly as before.
    assert.doesNotMatch(policy, /frame-src/);
  });

  it('allows Turnstile — script and frame — only when it is on', () => {
    const policy = buildContentSecurityPolicy({ ...base, newsletterEnabled: true });
    assert.match(policy, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(policy, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  });
});

/** An endpoint answer, exactly as the action receives it. */
function reply(status: number, body: { status?: string; error?: string } | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('subscribe responses map to something a visitor can read', () => {
  it('treats every terminal state as a success the form should not repeat', async () => {
    assert.deepEqual(await readNewsletterResponse(reply(200, { status: 'pending' })), {
      ok: true,
      status: 'subscribed',
    });
    assert.deepEqual(await readNewsletterResponse(reply(200, { status: 'check_inbox' })), {
      ok: true,
      status: 'checkInbox',
    });
    assert.deepEqual(await readNewsletterResponse(reply(200, { status: 'already_subscribed' })), {
      ok: true,
      status: 'alreadySubscribed',
    });
  });

  it("maps the endpoint's error codes without echoing its wording", async () => {
    assert.deepEqual(await readNewsletterResponse(reply(400, { error: 'noConsent' })), {
      ok: false,
      reason: 'noConsent',
    });
    assert.deepEqual(await readNewsletterResponse(reply(400, { error: 'invalidToken' })), {
      ok: false,
      reason: 'invalidToken',
    });
  });

  it('falls back by HTTP class when the body says nothing useful', async () => {
    assert.deepEqual(await readNewsletterResponse(reply(422, null)), { ok: false, reason: 'invalidEmail' });
    assert.deepEqual(await readNewsletterResponse(new Response('gateway down', { status: 503 })), {
      ok: false,
      reason: 'unavailable',
    });
  });
});
