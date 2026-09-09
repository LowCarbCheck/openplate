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
import { USAGE_COUNTER_RETENTION_DAYS } from '../../app/lib/admin/operator-visibility';

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

  it("still states the true, strong claim: the photo never passes through openplate's servers", () => {
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
    // Case-insensitive: this clause can open a sentence ("Neither...") or sit
    // mid-sentence ("...key — neither...") depending on how the copy is
    // punctuated. Pin the wording, not the capitalisation of its first word.
    assert.match(html, /neither the key nor the photo ever passes through our servers/i);
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
    const html = renderToStaticMarkup(createElement(PrivacyContent, { analyticsLevel: 'product' }));
    assert.match(html, /Matomo/);
    assert.match(html, /Art\. 6\(1\)\(f\)/);
    assert.match(html, /Do Not Track/);
    assert.doesNotMatch(html, /This instance measures nothing/);
  });

  // The three levels below are the reason the section stopped being keyed on a
  // boolean. Each assertion is a sentence that would be FALSE on the instance
  // it is asserted against if the level were ignored.
  it('does not claim feature tracking on an instance that counts only pageviews', () => {
    const html = renderToStaticMarkup(createElement(PrivacyContent, { analyticsLevel: 'pageviews' }));
    assert.match(html, /It does not record which features you use/);
    assert.match(html, /What is never recorded:<\/strong> the features you used/);
    assert.doesNotMatch(html, /for example that a plate was scanned/);
  });

  it('discloses the health-behaviour events on an instance that records them', () => {
    const html = renderToStaticMarkup(createElement(PrivacyContent, { analyticsLevel: 'research' }));
    assert.match(html, /This instance also records research measurements/);
    assert.match(html, /when you start or end a fast/);
    assert.match(html, /openplate has three analytics levels/);
  });

  it('keeps the research paragraph off the two lower levels', () => {
    for (const analyticsLevel of ['pageviews', 'product'] as const) {
      const html = renderToStaticMarkup(createElement(PrivacyContent, { analyticsLevel }));
      assert.doesNotMatch(html, /This instance also records research measurements/);
      // The level itself is still disclosed, at every level that is on.
      assert.match(html, /openplate has three analytics levels/);
    }
  });

  it('says nothing about levels at all when analytics are off', () => {
    const html = renderToStaticMarkup(createElement(PrivacyContent));
    assert.doesNotMatch(html, /openplate has three analytics levels/);
    assert.doesNotMatch(html, /This instance also records research measurements/);
  });
});

describe('Legal pages — the managed instance says what the operator can see (M196)', () => {
  it('privacy: the lead does not promise that nothing reaches our servers', () => {
    const managed = renderToStaticMarkup(createElement(PrivacyContent, { managed: true }));
    assert.match(managed, /Your account keeps an encrypted copy of them on our server/);
    assert.doesNotMatch(managed, /not on our servers/);
  });

  it('privacy: section 4 says the proxy once, not twice', () => {
    // `s4ManagedBody` is the aside an OPEN instance's policy carries for a
    // reader who may also use somebody's managed instance. On a managed one
    // the main paragraph covers it, so the aside would repeat it.
    const managed = renderToStaticMarkup(createElement(PrivacyContent, { managed: true }));
    assert.doesNotMatch(managed, /On an instance run for you by an organization, your plate photo/);
    assert.match(renderPrivacy(), /On an instance run for you by an organization, your plate photo/);
  });

  it('privacy: an instance with accounts does not claim to have none', () => {
    const managed = renderToStaticMarkup(createElement(PrivacyContent, { managed: true }));
    assert.match(managed, /This instance uses invitation-only accounts/);
    assert.doesNotMatch(managed, /The app itself has no accounts and no sign-in/);
  });

  it("privacy: the photo goes through the operator's server, not straight to a provider you chose", () => {
    const managed = renderToStaticMarkup(createElement(PrivacyContent, { managed: true }));
    assert.match(managed, /you do not need an AI provider or an API key/);
    assert.doesNotMatch(managed, /supply your own API key/);
    // The retention constant still substitutes on the managed twin — a `{{days}}`
    // printed literally is exactly what a forgotten interpolation looks like.
    assert.doesNotMatch(managed, /\{\{days\}\}/);
    assert.match(managed, new RegExp(`expires automatically after${'\\s*'}${PHOTO_RETENTION_DAYS} days`));
  });

  it('privacy: the diary does reach the server there, as ciphertext', () => {
    const managed = renderToStaticMarkup(createElement(PrivacyContent, { managed: true }));
    assert.match(managed, /encrypted copy of them on our server/);
    assert.doesNotMatch(managed, /This data is not sent to us and we cannot see it/);
  });

  it('privacy: section 6 names every field an administrator can read (M201/06, M212/06)', () => {
    // The SAME facts the app states at `account.operatorSees.*`, in this
    // document's register rather than the app's, and gated on the question
    // that makes them true rather than on the mode name.
    //
    // THE SUBJECTS, NEVER THE SENTENCES. This test pinned three exact phrases
    // and one of them ("the day the account was created") broke on a
    // legitimate rephrase the moment the paragraph was rewritten, which is the
    // failure mode the workspace rule is about: wordsmith owns the wording and
    // a test that owns it too turns every copy pass into a red gate. What the
    // document owes the reader is that each of these things is named at all.
    const seen = renderToStaticMarkup(createElement(PrivacyContent, { managed: true, operatorSeesActivity: true }));
    for (const subject of [/email address/i, /created/i, /sign-?in/i, /allowance/i, /invitations/i]) {
      assert.match(seen, subject, `section 6 must name ${String(subject)}`);
    }
    assert.match(seen, new RegExp(`last${'\\s*'}${USAGE_COUNTER_RETENTION_DAYS} days`));
    assert.doesNotMatch(seen, /\{\{usageDays\}\}/);
    // And the half that matters more: none of it is the diary.
    assert.match(seen, /Your diary itself is not on those pages/);
  });

  // THE CONTROL for the two subjects M212 spec 04 added to the admin view. An
  // instance with no operator says neither, so the assertion above is reading
  // the managed paragraph rather than any paragraph on the page.
  it('privacy: an instance with no operator names neither the allowance end nor the invitations', () => {
    // The open document does say "you get one by invitation" about an account,
    // so the control is the PLURAL, which only a count of remaining ones can
    // be, plus the allowance, which an instance with no operator has none of.
    const open = renderPrivacy();
    assert.doesNotMatch(open, /allowance/i);
    assert.doesNotMatch(open, /invitations/i);
  });

  it('privacy: an instance with no operator keeps the shorter claim and gains no paragraph', () => {
    // `operatorSeesActivity` defaults to `false`, which is the open instance
    // and also the error-boundary render with no config.
    const open = renderPrivacy();
    assert.match(open, /The only account-linked information the server can see/);
    assert.doesNotMatch(open, /Your diary itself is not on those pages/);
  });

  it('terms: no bring-your-own-key promise on an instance where nobody brings one', () => {
    const managed = renderToStaticMarkup(createElement(TermsContent, { managed: true }));
    assert.doesNotMatch(managed, /bring-your-own-key/i);
    assert.doesNotMatch(managed, /BYOK/);
    assert.match(managed, /included with your account/);
    // The lead still carries its interpolation and its link.
    assert.match(managed, /href="\/imprint"/);
    assert.doesNotMatch(managed, /\{\{operator\}\}/);
  });

  it('leaves every one of those paragraphs alone on an open instance', () => {
    const privacy = renderPrivacy();
    const terms = renderTerms();
    assert.match(privacy, /The app itself has no accounts and no sign-in/);
    assert.match(privacy, /This data is not sent to us and we cannot see it/);
    assert.match(privacy, /supply your own API key/);
    assert.match(privacy, /not on our servers/);
    assert.match(terms, /bring-your-own-key/i);
    assert.doesNotMatch(privacy, /This instance has accounts, handed out by invitation/);
  });
});

/**
 * M212 spec 06. Six sentences and two of them headings had no managed twin,
 * so `beta.openplate.de` was already shipping them: a correct paragraph under
 * a false heading, and a promise that the photo and the key never reach any
 * server of ours on an instance where every scan passes through one.
 *
 * NO ASSERTION HERE PINS A TRANSLATED PHRASE. What is checked is that the
 * managed render and the open render DISAGREE, that the claim which is false
 * on a managed instance is gone from it, and that the two new facts are stated
 * at all. The wording is wordsmith's, and three tests broke on legitimate
 * rephrases in one session because they owned it too.
 */
describe('Legal pages — the sentences that had no managed twin (M212/06)', () => {
  const managedAi = { managed: true, aiComesFromTheInstance: true, serverHoldsTheDiary: true };

  it('terms: the section 4 heading stops promising a provider nobody brings', () => {
    const managed = renderToStaticMarkup(createElement(TermsContent, managedAi));
    // The heading and the body must agree. The body already said the estimates
    // come from this instance; the heading said to bring your own provider.
    assert.doesNotMatch(managed, /<h2[^>]*>[^<]*your own AI provider/i);
    assert.match(renderTerms(), /Bring your own AI provider/i, 'the open heading is still the open one');
  });

  it('privacy: the section 4 heading no longer says "your own provider" over the proxy paragraph', () => {
    const managed = renderToStaticMarkup(createElement(PrivacyContent, managedAi));
    assert.doesNotMatch(managed, /<h2[^>]*>[^<]*\(your own provider\)/i);
    assert.match(renderPrivacy(), /AI plate identification \(your own provider\)/);
  });

  it('terms: the disclaimer stops blaming a provider the reader did not configure', () => {
    const managed = renderToStaticMarkup(createElement(TermsContent, managedAi));
    assert.doesNotMatch(managed, /provider you have configured/i);
    assert.match(renderTerms(), /provider you have configured/i);
  });

  it('privacy: the short version stops promising the photo never reaches our servers', () => {
    // The claim `privacy.s4BodyOnManaged` has contradicted on the same page
    // since M196. This is the line that contradicted it.
    const managed = renderToStaticMarkup(createElement(PrivacyContent, managedAi));
    assert.doesNotMatch(managed, /never pass through our servers/i);
    assert.match(renderPrivacy(), /never pass through our servers/i);
  });

  it('privacy: section 2 stops saying the photo only ever goes to a provider you connect', () => {
    const managed = renderToStaticMarkup(createElement(PrivacyContent, managedAi));
    assert.doesNotMatch(managed, /only ever goes to the AI provider you connect/i);
    assert.match(renderPrivacy(), /only ever goes to the AI provider you connect/i);
  });

  it('privacy: section 3 admits the recovery escrow as a second exception', () => {
    // The open sentence names ONE exception. Where the operator holds a
    // recovery key there are two, and section 6 already admitted the second.
    const managed = renderToStaticMarkup(createElement(PrivacyContent, managedAi));
    assert.doesNotMatch(managed, /There is one exception/i);
    assert.match(managed, /two exceptions/i);
    assert.match(renderPrivacy(), /There is one exception/i);
  });

  it('terms: states that the allowance ends on a date, which no version said before', () => {
    const managed = renderToStaticMarkup(createElement(TermsContent, managedAi));
    assert.match(managed, /end date/i);
    // THE CONTROL. The paragraph is gated on the question about where the
    // estimates come from, so an open instance gains nothing.
    assert.doesNotMatch(renderTerms(), /end date/i);
  });

  it('privacy: discloses the address a member types only where a member can type one', () => {
    // `memberInvites` is the instance's own answer off `/health`, not a mode:
    // an organization's instance with the route switched off must not publish
    // a paragraph about addresses nobody there can hand over.
    const inviting = renderToStaticMarkup(createElement(PrivacyContent, { ...managedAi, memberInvites: true }));
    assert.match(inviting, /invitation/i);
    assert.match(inviting, /email address you enter/i);
    // THE CONTROL, and it is the whole reason this is a separate prop.
    const notInviting = renderToStaticMarkup(createElement(PrivacyContent, managedAi));
    assert.doesNotMatch(notInviting, /email address you enter/i);
  });

  it('keeps every interpolation on the new twins, so no reader sees a raw placeholder', () => {
    const managed = renderToStaticMarkup(
      createElement(PrivacyContent, { ...managedAi, memberInvites: true, reportRetentionDays: 30 }),
    );
    for (const placeholder of [/\{\{days\}\}/, /\{\{reportWindow\}\}/, /\{\{usageDays\}\}/]) {
      assert.doesNotMatch(managed, placeholder);
    }
    assert.match(managed, new RegExp(`${PHOTO_RETENTION_DAYS} days`));
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
