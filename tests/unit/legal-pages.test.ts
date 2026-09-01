/**
 * Unit tests for `#app/routes/legal/privacy` and `#app/routes/legal/terms`.
 *
 * The photo-cache truthfulness round (2026-07-28) found `/privacy` — the
 * legally operative document — still claiming plate photos are "never
 * stored", while `photos.ts`/`photo-policy.ts` document a real 90-day
 * on-device cache. These tests render the pure `PrivacyContent`/`TermsContent`
 * components (split out from the router-dependent `PublicWrapper` chrome
 * specifically so they're testable — see each route file's doc comment) and
 * assert:
 *   - the false "we do not store the photo" claim never reappears
 *   - the honest on-device-cache disclosure names the SAME retention window
 *     the code actually enforces (imported from `photo-policy.ts`, not a
 *     hardcoded "90" that could silently drift from the real constant)
 *   - the disclosure appears in both places it's now made (Section 2 and
 *     Section 4) and points readers at where they can manage/clear it
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PrivacyContent } from '../../app/routes/legal/privacy';
import { TermsContent } from '../../app/routes/legal/terms';
import { ImprintContent } from '../../app/routes/legal/imprint';
import { PHOTO_RETENTION_DAYS } from '../../app/lib/local-store/photo-policy';

function renderPrivacy(): string {
  return renderToStaticMarkup(createElement(PrivacyContent));
}

function renderTerms(): string {
  return renderToStaticMarkup(createElement(TermsContent));
}

function renderImprint(): string {
  return renderToStaticMarkup(createElement(ImprintContent));
}

describe('Privacy policy — plate-photo honesty', () => {
  it('never claims the photo is not stored — that claim was false and is the whole point of this test', () => {
    const html = renderPrivacy();
    assert.doesNotMatch(html, /we do not store the photo/i);
    assert.doesNotMatch(html, /never store(s|d)? the photo/i);
  });

  it('discloses the on-device photo cache in "What stays on your device" (Section 2)', () => {
    const html = renderPrivacy();
    assert.match(html, /What stays on your device/);
    assert.match(html, /photo itself is also kept on your device/);
    assert.match(html, new RegExp(`clears itself automatically after ${PHOTO_RETENTION_DAYS} days`));
  });

  it('discloses the same on-device cache in the AI plate identification section (Section 4), not just Section 2', () => {
    const html = renderPrivacy();
    assert.match(html, /AI plate identification \(your own provider\)/);
    assert.match(html, /Your browser does keep an on-device copy of the photo/);
    assert.match(html, new RegExp(`expires on its own after${'\\s*'}${PHOTO_RETENTION_DAYS} days`));
  });

  it('tells the reader where to manage or clear the cached photo (Profile page)', () => {
    const html = renderPrivacy();
    assert.match(html, /Profile page/);
  });

  it('still states the true, strong claim: the photo never passes through openplate\'s servers', () => {
    const html = renderPrivacy();
    assert.match(html, /never pass through our servers/);
  });

  it('the "short version" summary (Section 1) is consistent with the detailed sections — also names the on-device copy', () => {
    const html = renderPrivacy();
    assert.match(html, /The short version/);
    assert.match(html, /temporary on-device copy of the photo/);
  });
});

describe('Terms of service — plate-photo claims stay accurate', () => {
  it('never claims the photo is not stored anywhere (no server-storage overclaim)', () => {
    const html = renderTerms();
    assert.doesNotMatch(html, /we do not store the photo/i);
    assert.doesNotMatch(html, /never store(s|d)? the photo/i);
  });

  it('scopes its "never passes through our servers" claim correctly (true: server pass-through, not persistence anywhere)', () => {
    const html = renderTerms();
    assert.match(html, /neither the key nor the photo ever passes through our servers/);
  });
});

/**
 * Imprint (§5 DDG) — added with the openplate.de cutover, 2026-08-31.
 *
 * A §5 DDG imprint is judged on whether specific facts are PRESENT and
 * findable, so the checks below are field-presence assertions rather than
 * prose assertions. That is deliberate: a copy edit should be free, but
 * silently dropping the register court or the VAT ID should not be.
 *
 * The one negative check is the important one. This copy was reproduced from
 * `nicotinepouch-org`, whose imprint carries a Section 18(2) MStV
 * ("Responsible for Editorial Content") section. openplate publishes no
 * editorial content, so that section was deliberately NOT carried over. The
 * assertion pins that decision, so a future copy-paste from the sibling site
 * cannot quietly reintroduce a claim openplate has no basis to make.
 */
describe('Imprint — Section 5 DDG provider identification', () => {
  it('names the legal person, not the product name', () => {
    const html = renderImprint();
    assert.match(html, /SPARQ VENTURES UG/);
    assert.match(html, /haftungsbeschr/);
    // "LowCarbCheck" is a product, not a legal person. It must never stand in
    // for the provider here, whatever terms.tsx still says (M120).
    assert.doesNotMatch(html, /Provider[\s\S]{0,200}LowCarbCheck/i);
  });

  it('carries every field a §5 DDG imprint is judged on', () => {
    const html = renderImprint();
    for (const required of [
      /Stra&#x00DF;e 73 49|Straße 73 49/, // street name is "Straße 73"; 49 is the house number
      /13125 Berlin/,
      /Altan Sarisin/,
      /HRB 174062 B/,
      /Amtsgericht Charlottenburg/,
      /DE312546809/,
      /info@sprqvntrs\.com/,
    ]) {
      assert.match(html, required);
    }
  });

  it('omits the Section 18(2) MStV section — openplate publishes no editorial content', () => {
    const html = renderImprint();
    assert.doesNotMatch(html, /18\(2\)/);
    assert.doesNotMatch(html, /Responsible for Editorial Content/i);
  });
});

/**
 * Staleness guards (M167/02).
 *
 * Reviewing these pages on 2026-09-01, before translating them, found five
 * material inaccuracies in text that had been live for weeks. None of them was
 * a bug in code, so nothing failed and nothing alerted. That is the pattern
 * worth guarding: a legal document drifts from the product silently, and the
 * only thing that catches it is an assertion tied to the product's actual shape.
 *
 * Each test below names the claim that was wrong and why.
 */
describe('Privacy policy — claims that were false and must not return', () => {
  it('does not claim a session cookie: there is no sign-in on this app', () => {
    // Was: "We use a single essential session cookie to keep you signed in."
    // `app/root.tsx` is explicit that there are no accounts and no session
    // cookie, and the app actually sets four preference cookies it never named.
    const html = renderPrivacy();
    // The AFFIRMATIVE claim is what must not return. The page is allowed to say
    // there is no session cookie — a bare /session cookie/ match would fail
    // against the correct text, which is how a guard gets deleted rather than
    // obeyed.
    assert.doesNotMatch(html, /we use a single essential session cookie/i);
    assert.doesNotMatch(html, /keep you signed in/i);
    assert.match(html, /no sign-in on this site and therefore no session cookie/i);
  });

  it('names the preference cookies that DO exist', () => {
    const html = renderPrivacy();
    assert.match(html, /interface language/i);
    assert.match(html, /sidebar/i);
  });

  it('does not describe sync as unavailable: it shipped', () => {
    // Was: "It is not yet available." sync.openplate.de went live 2026-08-31.
    const html = renderPrivacy();
    assert.doesNotMatch(html, /not yet available/i);
    assert.doesNotMatch(html, /once premium sync ships/i);
  });

  it('does not claim the app server stores an account: it stores nothing', () => {
    // Was: "When you create an account on the hosted instance, we store..."
    // The app server has no database. The account belongs to the sync service.
    const html = renderPrivacy();
    assert.match(html, /app server stores nothing about you/i);
  });

  it('describes a passphrase, not a password: sync has no password', () => {
    const html = renderPrivacy();
    assert.doesNotMatch(html, /hash of your password/i);
    assert.match(html, /passphrase/i);
  });
});

describe('Privacy policy — the analytics section tracks reality', () => {
  it('says nothing is measured when analytics is off — the default', () => {
    // Was: the section was written unconditionally and shipped on an instance
    // whose MATOMO_URL was never set, describing measurement that was off.
    const html = renderToStaticMarkup(createElement(PrivacyContent));
    assert.match(html, /This instance measures nothing/);
    assert.doesNotMatch(html, /Do Not Track/);
    assert.doesNotMatch(html, /raw records are deleted after 90 days/);
  });

  it('makes the full Article 13 disclosure when analytics is on', () => {
    const html = renderToStaticMarkup(createElement(PrivacyContent, { analyticsEnabled: true }));
    assert.match(html, /Matomo/);
    assert.match(html, /Art\. 6\(1\)\(f\)/);
    assert.match(html, /Do Not Track/);
    assert.doesNotMatch(html, /This instance measures nothing/);
  });
});

describe('Terms — the operator is a legal person', () => {
  it('names the UG from the imprint, not a product name', () => {
    // Was: "we (LowCarbCheck)". LowCarbCheck is a product; the provider in the
    // imprint is SPARQ VENTURES UG (haftungsbeschränkt).
    const terms = renderTerms();
    assert.match(terms, /SPARQ VENTURES UG/);
    assert.doesNotMatch(terms, /we \(LowCarbCheck\)/);
  });

  it('names the same legal person the imprint does', () => {
    // The two documents must not drift apart again.
    const imprint = renderImprint();
    assert.match(imprint, /SPARQ VENTURES UG/);
    assert.match(renderTerms(), /SPARQ VENTURES UG/);
  });
});

describe('Legal pages — self-service deletion exists and is described', () => {
  it('does not claim there is no self-service delete: `settings.sync.tsx` has one', () => {
    // Was, in BOTH documents: "We do not yet offer a self-service button to
    // delete your server-side account record." `deleteSyncAccount` is wired
    // into Settings and the UI offers "Delete sync account" with a confirm.
    // Understating a data-subject right is not a compliance risk, but it does
    // tell people to send an email when they could press a button.
    for (const html of [renderPrivacy(), renderTerms()]) {
      assert.doesNotMatch(html, /do not yet offer a self-service/i);
      assert.match(html, /delete your sync account yourself/i);
    }
  });

  it('does not promise a 30-day window the product does not honour', () => {
    // The confirm dialog says "every encrypted copy the server holds. There is
    // no undo and no grace period." The terms said 30 days. Both cannot be true.
    const terms = renderTerms();
    assert.doesNotMatch(terms, /within 30 days/i);
    assert.match(terms, /immediately, with no grace period/i);
  });
});
