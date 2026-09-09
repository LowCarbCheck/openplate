/**
 * Unit tests for `#app/routes/scan`'s `ConnectCard` — the screen a device with
 * no AI settings row lands on.
 *
 * The card used to offer "Connect with OpenRouter" on every instance, managed
 * ones included. On a managed instance (M187 spec 03) that is a false promise:
 * AI arrives with the gateway invite link and never from a button on this
 * card, so an owner who opened /scan read the card as "your OpenRouter
 * connection is missing" when the real answer was "ask for a new invite".
 *
 * So both shapes are rendered here, through the REAL shipped English catalog,
 * and each assertion pins copy that must be present in one shape and absent in
 * the other.
 *
 * ── The third shape, and the incident that added it (M201, 0.10.3) ───────
 *
 * A managed instance signed people out silently, and this card then told them
 * their account was not switched on for photo estimates and to ask their
 * administrator. The account had an allowance of 200 and was never suspended;
 * what had happened was that a spent refresh token in the device's cache had
 * been read as theft and the family revoked. The card was reading "no AI" as
 * "no allowance" because those were the only two answers it had.
 *
 * There are now three, and the session decides between them. THE VIEW IS
 * RENDERED DIRECTLY for the signed-in one: the container reads the session
 * through `useSyncExternalStore`, whose server snapshot is a constant
 * signed-out session, so a static render of it can only ever produce the
 * signed-out shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import {
  ConnectCard,
  ConnectCardView,
  resolveConnectCardVariant,
  resolveConnectSessionState,
  type ConnectCardVariant,
} from '../../app/routes/scan';
import { resolveEffectiveAiSettings } from '../../app/lib/ai/managed-ai-settings';
import type { AllowanceDoor } from '../../app/lib/ai/managed-ai-settings';
import type { SyncSessionSnapshot } from '../../app/lib/sync/sync-session';
import type { PublicConfig } from '../../app/config/public-config';

const CONNECT_OPENROUTER = 'Connect with OpenRouter';
const MANAGED_MISSING = 'Photo estimates are not switched on for this account.';
const ASK_ADMIN = 'Ask your administrator';
const SIGN_IN_HREF = '/sign-in';
const ADD_WITHOUT_PHOTO = 'Add food without a photo';

/** A self-hosted instance's public config: no gateway, no preset. */
function publicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    syncServerUrl: null,
    analytics: null,
    instancePreset: null,
    managed: false,
    ...overrides,
  };
}

/**
 * Renders the card under a data router whose ROOT route carries the public
 * config, because `useGatewayUrl` reads it through `useRouteLoaderData('root')`
 * — the same channel the real app uses. `hydrationData` supplies the loader's
 * result up front, so the router is never in a pending state during the
 * synchronous render.
 */
function renderElement(config: PublicConfig, element: ReactElement): string {
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: withI18n(element) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The whole card, hooks included, session state comes from the real store's server snapshot. */
function render(config: PublicConfig): string {
  return renderElement(config, createElement(ConnectCard, { logDate: null }));
}

/**
 * One shape of the card, given its variant. The only way to render a signed-in
 * session statically.
 *
 * `allowanceDoor` defaults to the organization's answer, which is what every
 * assertion written before M212 spec 04 was reading: an instance with an
 * administrator to ask. The other two doors are passed explicitly by the tests
 * that are about them.
 */
function renderVariant(
  variant: Exclude<ConnectCardVariant, { kind: 'resuming' }>,
  allowanceDoor: AllowanceDoor = { kind: 'ask-admin' },
): string {
  return renderElement(
    publicConfig({ managed: true }),
    createElement(ConnectCardView, { variant, logDate: null, allowanceDoor }),
  );
}

/** A session snapshot, defaulted to the settled signed-out one. */
function snapshot(overrides: Partial<SyncSessionSnapshot> = {}): SyncSessionSnapshot {
  return {
    account: null,
    isResuming: false,
    phase: 'idle',
    lastSyncedAt: null,
    hasPendingChanges: false,
    error: null,
    ...overrides,
  };
}

/** A signed-in account, allowance included. `dailyAiLimit: 0` is the ordinary "no AI yet" standing. */
function account(dailyAiLimit: number): NonNullable<SyncSessionSnapshot['account']> {
  return {
    id: 7,
    email: 'anna@example.org',
    displayName: null,
    role: 'member',
    dailyAiLimit,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    invitesLeft: null,
  };
}

describe('resolveConnectSessionState', () => {
  it('reads a resume as neither signed in nor signed out', () => {
    // `account === null` is ALSO every moment between a reload and the end of
    // the resume. Reading the two as one is how a signed-in person is told,
    // once per reload, that they are signed out.
    assert.equal(resolveConnectSessionState(snapshot({ isResuming: true })), 'resuming');
  });

  it('is signed out once the resume has settled with no account', () => {
    assert.equal(resolveConnectSessionState(snapshot()), 'signed-out');
  });

  it('is signed in when the snapshot carries an account', () => {
    assert.equal(resolveConnectSessionState(snapshot({ account: account(200) })), 'signed-in');
  });
});

describe('resolveConnectCardVariant', () => {
  it('is self-hosted when the instance runs no AI of its own', () => {
    assert.deepEqual(resolveConnectCardVariant({ managed: false, presetBaseUrl: null, sessionState: 'signed-out' }), {
      kind: 'self-hosted',
    });
  });

  it('names the preset host when the instance runs its own endpoint', () => {
    assert.deepEqual(
      resolveConnectCardVariant({
        managed: false,
        presetBaseUrl: 'https://ai.example.org:8443',
        sessionState: 'signed-out',
      }),
      { kind: 'instance-ai', host: 'ai.example.org:8443' },
    );
  });

  it('is the managed dead end whenever a gateway is configured, preset or not', () => {
    assert.deepEqual(resolveConnectCardVariant({ managed: true, presetBaseUrl: null, sessionState: 'signed-in' }), {
      kind: 'managed-missing',
    });
    assert.deepEqual(
      resolveConnectCardVariant({ managed: true, presetBaseUrl: 'https://ai.example.org', sessionState: 'signed-in' }),
      { kind: 'managed-missing' },
    );
  });

  it('waits rather than choosing while the session is still being reopened', () => {
    // The two managed answers are opposite sentences. Picking one for the
    // second a resume takes means showing the wrong one and correcting it.
    assert.deepEqual(resolveConnectCardVariant({ managed: true, presetBaseUrl: null, sessionState: 'resuming' }), {
      kind: 'resuming',
    });
  });

  it('names the session, not the account, when the device is signed out', () => {
    assert.deepEqual(resolveConnectCardVariant({ managed: true, presetBaseUrl: null, sessionState: 'signed-out' }), {
      kind: 'managed-signed-out',
    });
  });
});

describe('ConnectCard on a managed instance with no session', () => {
  const markup = render(publicConfig({ managed: true }));

  it('offers the way back in', () => {
    assert.ok(markup.includes(SIGN_IN_HREF), markup.slice(0, 600));
    assert.ok(markup.includes('Sign in'));
  });

  it('does NOT send the person to their administrator', () => {
    // THE INCIDENT, in one assertion. The account is very probably fine, the
    // session is what ended, and an administrator asked to switch on photo
    // estimates that are already on can do nothing at all.
    assert.ok(!markup.includes(ASK_ADMIN), markup.slice(0, 600));
    assert.ok(!markup.includes(MANAGED_MISSING));
  });

  it('still brings no key of its own into it', () => {
    assert.ok(!markup.includes(CONNECT_OPENROUTER), 'a managed instance has no key for a person to bring');
    assert.ok(!markup.includes('/settings/ai?next=scan'));
  });
});

describe('ConnectCardView on a managed instance with a session open', () => {
  const markup = renderVariant({ kind: 'managed-missing' });

  it('is what a zero allowance resolves to', () => {
    // The pure rule answers `null` for a signed-in account with no allowance,
    // which is what makes this card render at all, and `null` is the same
    // answer it gives a signed-out device. Only the SCREEN can tell them apart.
    const effective = resolveEffectiveAiSettings({
      instance: { managed: true, syncServerUrl: 'https://sync.example.test', model: 'a-model' },
      session: snapshot({ account: account(0) }),
      storedSettings: null,
    });
    assert.equal(effective, null);
    assert.deepEqual(resolveConnectCardVariant({ managed: true, presetBaseUrl: null, sessionState: 'signed-in' }), {
      kind: 'managed-missing',
    });
  });

  it('says photo estimates are not switched on, and names who switches them on', () => {
    assert.ok(markup.includes(MANAGED_MISSING), markup.slice(0, 400));
    // AND THE NEXT STEP, which is a person rather than a settings page: on a
    // managed instance there is no key to bring, so "connect a provider" would
    // send somebody to a screen that cannot help them.
    assert.ok(markup.includes(ASK_ADMIN), markup.slice(0, 600));
    assert.ok(!markup.includes('OpenRouter'), 'a managed instance must not offer a provider signup');
  });

  it('does not offer a sign-in, because this device is signed in', () => {
    assert.ok(!markup.includes(SIGN_IN_HREF));
  });

  it('leaves adding without a photo as the only action', () => {
    assert.ok(markup.includes(ADD_WITHOUT_PHOTO));
    assert.ok(!markup.includes('/settings/ai?next=scan'), 'no manual key setup either — there is no key to set up');
  });

  it('does not name a photo recipient, because no photo goes anywhere yet', () => {
    assert.ok(!markup.includes('gateway.openplate.de'));
  });
});

describe('ConnectCard on an instance without a gateway', () => {
  const markup = render(publicConfig());

  it('still offers to connect OpenRouter', () => {
    assert.ok(markup.includes(CONNECT_OPENROUTER));
  });

  it('does not show either managed copy', () => {
    assert.ok(!markup.includes(MANAGED_MISSING));
    assert.ok(!markup.includes(ASK_ADMIN));
  });

  it('keeps the manual settings path', () => {
    assert.ok(markup.includes('/settings/ai?next=scan'));
    assert.ok(markup.includes(ADD_WITHOUT_PHOTO));
  });
});
