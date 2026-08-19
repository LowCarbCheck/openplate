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
import { PHOTO_RETENTION_DAYS } from '../../app/lib/local-store/photo-policy';

function renderPrivacy(): string {
  return renderToStaticMarkup(createElement(PrivacyContent));
}

function renderTerms(): string {
  return renderToStaticMarkup(createElement(TermsContent));
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
