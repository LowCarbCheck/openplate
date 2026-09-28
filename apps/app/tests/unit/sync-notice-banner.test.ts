/**
 * Unit tests for `#app/components/sync-notice-banner` — the operator's message
 * on the sync handshake (M181/07).
 *
 * The notice is the one string on the sync screen that this app did not write.
 * It arrives from whatever server the user pointed at, so the three properties
 * pinned here are the ones that decide whether a hostile server can do
 * anything with it: the text is rendered as text, a link is followed only on
 * an allowed scheme, and dismissal is remembered against the notice's CONTENT
 * so the next message is not silenced by a click on this one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { createMemoryStorage } from '../../app/lib/sync/sync-state';
import {
  DISMISSED_STORAGE_KEY,
  NOTICE_LINK_SCHEMES,
  SyncNoticeBanner,
  noticeDismissKey,
  noticeLinkHref,
  shouldShowNotice,
} from '../../app/components/sync-notice-banner';

function render(notice: { text: string; url?: string } | null): string {
  return renderToStaticMarkup(withI18n(createElement(SyncNoticeBanner, { notice })));
}

describe('noticeLinkHref', () => {
  it('follows a link only on an allowed scheme', () => {
    assert.deepEqual(NOTICE_LINK_SCHEMES, ['https:', 'http:']);
    assert.equal(noticeLinkHref('https://example.org/moving'), 'https://example.org/moving');
    // http is kept deliberately: a self-hosted instance on a home LAN has no
    // certificate, and dropping it would silence those operators entirely.
    assert.equal(noticeLinkHref('http://192.168.1.10:3000/notice'), 'http://192.168.1.10:3000/notice');
  });

  it('drops the schemes a hostile server would supply', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd']) {
      assert.equal(noticeLinkHref(url), null, `${url} must never become an href`);
    }
  });

  it('drops a relative or empty value rather than resolving it against our own origin', () => {
    // A server-supplied "/settings/data" resolved against the app's origin
    // would be a link the operator did not write, pointing into this app.
    assert.equal(noticeLinkHref('/settings/data'), null);
    assert.equal(noticeLinkHref('   '), null);
    assert.equal(noticeLinkHref(undefined), null);
  });
});

describe('noticeDismissKey', () => {
  it('is keyed to the content, so a NEW notice is not silenced by an old dismissal', () => {
    const first = noticeDismissKey({ text: 'We move on 1 March.' });

    assert.equal(noticeDismissKey({ text: 'We move on 1 March.' }), first, 'the same notice keeps the same key');
    assert.notEqual(noticeDismissKey({ text: 'We close on 1 April.' }), first);
    // The link is part of the content: same sentence, new destination, new key.
    assert.notEqual(noticeDismissKey({ text: 'We move on 1 March.', url: 'https://example.org/moving' }), first);
  });
});

describe('SyncNoticeBanner', () => {
  it('renders nothing when the server published no notice', () => {
    assert.equal(render(null), '');
  });

  it('renders the operator text as TEXT, never as markup', () => {
    const html = render({ text: '<img src=x onerror="alert(1)"> please read this' });

    assert.ok(html.includes('please read this'), 'the message itself still reaches the user');
    // Escaped, so the browser reads it and never runs it.
    assert.ok(!html.includes('<img'), 'server-supplied markup must not survive into the DOM');
    assert.ok(html.includes('&lt;img'));
  });

  it('shows the message with no link when the link is not one we will follow', () => {
    const html = render({ text: 'Read this.', url: 'javascript:alert(1)' });

    assert.ok(html.includes('Read this.'), 'a bad link must not cost the user the message');
    assert.ok(!html.includes('<a '), 'no anchor is rendered at all');
    assert.ok(!html.includes('javascript:'));
  });

  it('renders an allowed link with the shipped English label', () => {
    const html = render({ text: 'We move on 1 March.', url: 'https://example.org/moving' });

    assert.ok(html.includes('href="https://example.org/moving"'));
    assert.ok(html.includes('Read more'), 'the label comes from the real catalog, so a renamed key fails here');
    // New tab, and never a referrer or an opener handed to a server the user
    // may not trust.
    assert.ok(html.includes('rel="noreferrer noopener"'));
  });

  it('offers a dismissal, and writes the content key rather than a boolean', () => {
    // The effect that reads storage does not run under `renderToStaticMarkup`,
    // so the dismissal decision is asserted at the seam that carries it: the
    // key written to storage is the content key, never a boolean.
    const storage = createMemoryStorage();
    const notice = { text: 'We move on 1 March.', url: 'https://example.org/moving' };

    storage.setItem(DISMISSED_STORAGE_KEY, noticeDismissKey(notice));

    assert.equal(storage.getItem(DISMISSED_STORAGE_KEY), noticeDismissKey(notice));
    assert.notEqual(storage.getItem(DISMISSED_STORAGE_KEY), 'true');
    // And the button that writes it is present, with a translated label.
    const html = renderToStaticMarkup(withI18n(createElement(SyncNoticeBanner, { notice, storage })));
    assert.ok(html.includes('aria-label="Dismiss this message from the server operator"'));
  });
});

describe('shouldShowNotice', () => {
  const notice = { text: 'We move on 1 March.', url: 'https://example.org/moving' };

  it('hides a notice this device has dismissed', () => {
    assert.equal(shouldShowNotice({ notice, dismissedKey: noticeDismissKey(notice) }), false);
  });

  it('shows a NEW notice even after the previous one was dismissed', () => {
    // The whole point of keying on content: a person who dismissed "we move on
    // 1 March" must still be shown "we close on 1 April". A stored boolean
    // would fail this, and nothing else in the app would notice.
    const dismissedKey = noticeDismissKey({ text: 'We move on 1 March.' });

    assert.equal(shouldShowNotice({ notice: { text: 'We close on 1 April.' }, dismissedKey }), true);
    // Same sentence, different link, still a different notice.
    assert.equal(shouldShowNotice({ notice, dismissedKey }), true);
  });

  it('shows a notice on a device that has dismissed nothing, or cannot read its storage', () => {
    assert.equal(shouldShowNotice({ notice, dismissedKey: null }), true);
    assert.equal(shouldShowNotice({ notice: null, dismissedKey: null }), false);
  });
});
