/**
 * Unit tests for `#app/components/status-fallback-host`, the third and last
 * tier of the notification channel.
 *
 * The rule it enforces is the owner's: no published status may ever be lost.
 * The bare top-level routes (`/welcome`, `/sign-in`, `/join`, `/study` and the
 * rest) wear neither shell, so nothing there hosts a message; this component,
 * mounted once at the root, draws its own bar when nothing else is hosting.
 * Three answers, and all three matter: draw when a message is live and the
 * count is zero, draw NOTHING when a shell is hosting, draw nothing when there
 * is no message.
 *
 * There is no DOM library in this repo (`tests/unit/*` are node:test), so this
 * renders with `renderToStaticMarkup` and reads the markup. Effects do not run
 * in a static render, so the mount effect inside `HeaderStatus` never fires
 * here: the count is driven with `registerStatusHost()` directly, which is the
 * same call that effect makes.
 *
 * `useStatusHostCount` reads the same module slot for both snapshots, the way
 * `useStatus` does, so a static render sees whatever these tests registered.
 * On a real server that slot is always zero, because the only thing that ever
 * registers is a mount effect.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatusFallbackHost } from '../../app/components/status-fallback-host';
import { publishStatus, readStatusHostCount, registerStatusHost, resetStatusChannel } from '../../app/lib/status';
import { withI18n } from './trends-i18n-harness';

function render(): string {
  return renderToStaticMarkup(withI18n(createElement(StatusFallbackHost)));
}

describe('StatusFallbackHost', () => {
  beforeEach(() => resetStatusChannel());
  afterEach(() => resetStatusChannel());

  it('draws the message in a bar of its own when no shell is hosting', () => {
    assert.equal(readStatusHostCount(), 0, 'the fixture started with a host already mounted');
    publishStatus({ text: 'Check your inbox', tone: 'success' });
    const markup = render();
    assert.ok(markup.includes('Check your inbox'), 'a message on a chromeless route was lost');
    assert.ok(markup.includes('data-slot="status-fallback"'), 'the fallback bar did not render');
  });

  it('anchors that bar to the top of the viewport, above the page', () => {
    publishStatus({ text: 'Check your inbox' });
    const markup = render();
    // Pinned literally rather than by substring soup: `fixed` is what makes the
    // bar hold no space on a page that has no chrome to push down, and `top-0`
    // plus `inset-x-0` is what puts it where a header would have been.
    assert.ok(markup.includes('fixed inset-x-0 top-0 z-50'), 'the fallback bar is no longer fixed to the top');
    assert.ok(markup.includes('min-h-16'), 'the fallback bar no longer matches the header height');
    assert.ok(markup.includes('pt-[env(safe-area-inset-top)]'), 'the bar can sit under a notch');
  });

  it('renders nothing at all when a shell is already hosting', () => {
    // `registerStatusHost()` is exactly what `HeaderStatus`'s mount effect
    // calls. Effects do not run in a static render, so this stands in for a
    // mounted app or public header.
    const release = registerStatusHost();
    publishStatus({ text: 'Check your inbox' });
    const markup = render();
    assert.equal(markup, '', 'the message was drawn twice: once by the shell and once by the fallback');
    // The CONTROL: release the host and the SAME message through the SAME
    // render path does come out, so the empty string above is the host count
    // and not a broken harness.
    release();
    assert.ok(render().includes('Check your inbox'), 'the harness cannot render this component at all');
  });

  it('renders nothing when there is no message', () => {
    assert.equal(render(), '', 'the fallback bar drew over the page with nothing to say');
    // The CONTROL: one publish through the same path fills it.
    publishStatus({ text: 'Check your inbox' });
    assert.ok(render().includes('Check your inbox'), 'the harness cannot render this component at all');
  });

  it('carries the same row the headers draw, dismiss control and all', () => {
    publishStatus({ text: 'That link has expired', tone: 'error' });
    const markup = render();
    assert.ok(markup.includes('data-slot="header-status"'), 'the fallback drew its own row instead of the shared one');
    assert.ok(markup.includes('Dismiss this message'), 'a persisting error had no way out on a chromeless route');
  });
});

describe('the root mounts it', () => {
  it('renders StatusFallbackHost exactly once, beside the Outlet', () => {
    const root = readFileSync(fileURLToPath(new URL('../../app/root.tsx', import.meta.url)), 'utf8');
    const mounts = root.split('<StatusFallbackHost />').length - 1;
    assert.equal(mounts, 1, 'the root either lost the fallback host or mounts two of them');
    assert.ok(root.includes('<Outlet />'), 'the root no longer renders an Outlet to sit beside');
  });
});

describe('the public header hosts it', () => {
  it('wraps the wordmark block in HeaderStatus', () => {
    const wrapper = readFileSync(
      fileURLToPath(new URL('../../app/components/public-wrapper.tsx', import.meta.url)),
      'utf8',
    );
    const opened = wrapper.indexOf('<HeaderStatus>');
    const closed = wrapper.indexOf('</HeaderStatus>');
    assert.ok(opened > 0 && closed > opened, 'the public header stopped mounting HeaderStatus');
    const wrapped = wrapper.slice(opened, closed);
    assert.match(wrapped, /\{APP_NAME\}/, 'the wordmark is outside the status slot');
    // The sign-in control is the thing that must not move: it sits after the
    // slot, not inside it.
    assert.ok(wrapper.indexOf("t('chrome.signIn')") > closed, 'the sign-in door is inside the status slot');
    assert.ok(wrapper.includes('h-16'), 'the public header changed height');
  });
});
