/**
 * `resolveConsentGate` and `safeConsentNext`: every branch of the consent gate
 * and every way a `next` parameter can try to leave the origin (2026-09-28).
 *
 * Every "consent" answer below is paired with an open answer that differs in
 * one input only: the instance's version, the account's version, the account
 * being known, or the path. A gate that answered the same thing for everybody
 * fails half of this file, in either direction. The same holds for the guard:
 * every refused `next` has a same-origin twin that passes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSENT_GATE_EXEMPT_PATHS,
  CONSENT_PAGE_PATH,
  DEFAULT_CONSENT_NEXT,
  consentPageHref,
  isConsentGateExempt,
  resolveConsentGate,
  safeConsentNext,
  type ConsentGateAccount,
} from '../../app/lib/health-consent/consent-gate';

const VERSION = '2026-09-28';

const NEVER_AGREED: ConsentGateAccount = { consentedVersion: null };
const AGREED: ConsentGateAccount = { consentedVersion: VERSION };
const AGREED_EARLIER: ConsentGateAccount = { consentedVersion: '2026-01-01' };

function gate({
  requiredVersion = VERSION,
  account = NEVER_AGREED,
  pathname = '/dashboard',
  search = '',
}: {
  requiredVersion?: string | null;
  account?: ConsentGateAccount | null;
  pathname?: string;
  search?: string;
} = {}) {
  return resolveConsentGate({ requiredVersion, account, pathname, search });
}

describe('resolveConsentGate', () => {
  it('asks an account that never agreed, on an instance that asks', () => {
    assert.deepEqual(gate(), { kind: 'consent', destination: '/consent?next=/dashboard' });
  });

  it('THE TWIN: lets through an account that agreed to the wording asked for now', () => {
    assert.deepEqual(gate({ account: AGREED }), { kind: 'open' });
  });

  it('asks again an account that agreed to an older wording', () => {
    assert.equal(gate({ account: AGREED_EARLIER }).kind, 'consent');
  });

  it('compares the version byte for byte, as the service does: no trim, no case fold', () => {
    assert.equal(gate({ account: { consentedVersion: ` ${VERSION}` } }).kind, 'consent');
    assert.equal(gate({ requiredVersion: 'V1', account: { consentedVersion: 'v1' } }).kind, 'consent');
    assert.equal(gate({ requiredVersion: 'v1', account: { consentedVersion: 'v1' } }).kind, 'open');
  });

  it('THE TWIN: never asks on an instance that asks for no consent, or whose answer is not known', () => {
    assert.deepEqual(gate({ requiredVersion: null }), { kind: 'open' });
  });

  it('never asks without a known account: no session, or a view not read yet', () => {
    assert.deepEqual(gate({ account: null }), { kind: 'open' });
  });

  it('keeps the query string of the page it asked on, so nothing is lost on the way back', () => {
    assert.deepEqual(gate({ pathname: '/diary', search: '?date=2026-09-28' }), {
      kind: 'consent',
      destination: '/consent?next=/diary%3Fdate%3D2026-09-28',
    });
  });

  it('asks on every page an account uses, the admin console included, because administrators are asked too', () => {
    for (const pathname of ['/diary', '/add/photo', '/settings', '/settings/plan', '/settings/preferences', '/admin']) {
      assert.equal(gate({ pathname }).kind, 'consent', pathname);
    }
  });
});

describe('the exempt pages', () => {
  it('are exactly the consent screen, the export, the account page and its old address', () => {
    assert.deepEqual(
      [...CONSENT_GATE_EXEMPT_PATHS].toSorted(),
      ['/consent', '/settings/account', '/settings/data', '/settings/sync'].toSorted(),
    );
  });

  it('stay open to an account that never agreed, while the same account is asked elsewhere', () => {
    for (const pathname of CONSENT_GATE_EXEMPT_PATHS) assert.equal(gate({ pathname }).kind, 'open', pathname);
    assert.equal(gate({ pathname: '/settings/profile' }).kind, 'consent');
  });

  it('exempt the gate its own destination, so the redirect can never loop', () => {
    assert.equal(gate({ pathname: CONSENT_PAGE_PATH }).kind, 'open');
  });

  it('are matched the way the router matches: a trailing slash and a capital letter are the same page', () => {
    assert.equal(isConsentGateExempt('/settings/data/'), true);
    assert.equal(isConsentGateExempt('/Settings/Account'), true);
  });

  it('are exact paths, never prefixes', () => {
    assert.equal(isConsentGateExempt('/settings/data/export'), false);
    assert.equal(isConsentGateExempt('/settings'), false);
    assert.equal(isConsentGateExempt('/consent-elsewhere'), false);
  });
});

describe('consentPageHref', () => {
  it('writes the page with its slashes readable, and reads back to exactly the page it was given', () => {
    for (const next of ['/dashboard', '/diary?date=2026-09-28', '/admin/people/7', '/add/photo?mode=label&x=a b']) {
      const href = consentPageHref(next);
      assert.equal(new URL(href, 'https://example.test').searchParams.get('next'), next, href);
    }
    assert.equal(consentPageHref('/dashboard'), '/consent?next=/dashboard');
  });
});

describe('safeConsentNext', () => {
  it('passes a path on this origin, with its query and fragment', () => {
    assert.equal(safeConsentNext('/dashboard'), '/dashboard');
    assert.equal(safeConsentNext('/diary?date=2026-09-28'), '/diary?date=2026-09-28');
    assert.equal(safeConsentNext('/settings/plan?plan=yearly#top'), '/settings/plan?plan=yearly#top');
  });

  it('falls back to the dashboard with no parameter at all', () => {
    assert.equal(safeConsentNext(null), DEFAULT_CONSENT_NEXT);
    assert.equal(DEFAULT_CONSENT_NEXT, '/dashboard');
  });

  it('refuses an absolute URL', () => {
    assert.equal(safeConsentNext('https://evil.example/steal'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('http://evil.example'), DEFAULT_CONSENT_NEXT);
  });

  it('refuses a scheme-relative URL, //evil', () => {
    assert.equal(safeConsentNext('//evil.example'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('//evil.example/dashboard'), DEFAULT_CONSENT_NEXT);
  });

  it('refuses a backslash, which a browser reads as a slash, so /\\evil is //evil', () => {
    assert.equal(safeConsentNext('/\\evil.example'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('/dashboard\\..\\x'), DEFAULT_CONSENT_NEXT);
  });

  it('refuses a control character, which a browser drops before it parses, so /<tab>/evil is //evil', () => {
    assert.equal(safeConsentNext('/\t/evil.example'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('/\n/evil.example'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('/dashboard\u0000'), DEFAULT_CONSENT_NEXT);
  });

  it('refuses anything that is not a path at all', () => {
    for (const raw of ['', 'dashboard', 'javascript:alert(1)', 'data:text/html,x', ' /dashboard']) {
      assert.equal(safeConsentNext(raw), DEFAULT_CONSENT_NEXT, JSON.stringify(raw));
    }
  });

  it('refuses the consent screen itself, which would ask for ever', () => {
    assert.equal(safeConsentNext('/consent'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('/consent?next=/consent'), DEFAULT_CONSENT_NEXT);
    assert.equal(safeConsentNext('/Consent/'), DEFAULT_CONSENT_NEXT);
  });

  it('normalises a dot segment rather than trusting it, and stays on the origin', () => {
    assert.equal(safeConsentNext('/settings/../diary'), '/diary');
    assert.equal(safeConsentNext('/../../evil.example'), '/evil.example');
  });
});
