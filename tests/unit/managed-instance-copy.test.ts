/**
 * WHAT THE MANAGED SURFACES SAY, and that the flag actually reaches them
 * (M196).
 *
 * The defect this file exists for is not a missing string, it is a string that
 * exists and is never rendered: a `*Managed` twin sitting in the catalog with
 * no call site passes `i18n-key-parity`, passes `managed-copy-bans`, and
 * leaves the false open-instance sentence on the screen. So every assertion
 * here pairs a key with the branch that chooses it.
 *
 * The landing page and onboarding are read as SOURCE rather than rendered, the
 * same trade `landing-assets.test.ts` documents: both route modules pull in
 * React, i18next and the local store, and a render harness would only cover
 * the branch a given render happened to take. `settings.ai.tsx` is imported
 * for real, because its guard is a function with one argument and no browser
 * dependency on the path under test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientLoader } from '../../app/routes/settings.ai';
import enCommon from '../../app/i18n/locales/en/common.json';

function readRoute(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/${name}`, import.meta.url)), 'utf8');
}

/** `managed ? …` followed by the managed key, i.e. the twin is on the managed branch. */
function assertChosenByManaged(source: string, managedKey: string): void {
  assert.match(source, new RegExp(`managed \\?[\\s\\S]{0,80}${managedKey.replaceAll('.', '\\.')}`));
}

describe('landing page — the three claims that are false on a managed instance', () => {
  const source = readRoute('index.tsx');

  for (const [openKey, managedKey] of [
    ['landing.features.byok.title', 'landing.features.byokManaged.title'],
    ['landing.features.byok.body', 'landing.features.byokManaged.body'],
    ['landing.cta.tryItFree', 'landing.cta.tryItFreeManaged'],
    ['landing.sync.body', 'landing.sync.bodyManaged'],
  ]) {
    it(`renders ${managedKey} on a managed instance and keeps ${openKey} on an open one`, () => {
      assertChosenByManaged(source, managedKey);
      assert.ok(source.includes(openKey), `${openKey} must still be the open instance's string`);
    });
  }

  it('sends the closing call to action to the sign-in door rather than the anonymous one', () => {
    // `/dashboard` bounces to `/welcome` on a managed instance anyway; naming
    // the real door is what makes the button's label true.
    assert.match(source, /managed \? '\/welcome' : '\/dashboard'/);
  });
});

describe('onboarding — the first-run trust card', () => {
  it('swaps the local-first promise for the managed one', () => {
    assertChosenByManaged(readRoute('onboarding.tsx'), 'onboarding.localFirstManaged');
  });

  it('keeps the emphasis tag the open string carries, so the <Trans> components still land', () => {
    assert.match(enCommon.onboarding.localFirstManaged, /<strong>[\s\S]+<\/strong>/);
  });
});

describe('/settings/ai on a managed instance', () => {
  it('redirects to /settings instead of drawing a page about a key nobody brings', async () => {
    // No cast: `clientLoader` declares exactly the one argument it reads
    // (`Pick<Route.ClientLoaderArgs, 'serverLoader'>`), so a test can hand it a
    // real one instead of a request, params and a router context it ignores.
    const thrown = await clientLoader({ serverLoader: async () => ({ managed: true }) }).then(
      () => null,
      (cause: unknown) => cause,
    );
    assert.ok(thrown instanceof Response, 'the guard throws a redirect Response');
    assert.equal(thrown.status, 302);
    assert.equal(thrown.headers.get('location'), '/settings');
  });
});
