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
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { ConnectCard, resolveConnectCardVariant } from '../../app/routes/scan';
import type { PublicConfig } from '../../app/config/public-config';

const CONNECT_OPENROUTER = 'Connect with OpenRouter';
const MANAGED_MISSING = 'Photo estimates are not switched on for this account.';
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
function render(config: PublicConfig): string {
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: withI18n(createElement(ConnectCard, { logDate: null })) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('resolveConnectCardVariant', () => {
  it('is self-hosted when the instance runs no AI of its own', () => {
    assert.deepEqual(resolveConnectCardVariant({ managed: false, presetBaseUrl: null }), {
      kind: 'self-hosted',
    });
  });

  it('names the preset host when the instance runs its own endpoint', () => {
    assert.deepEqual(resolveConnectCardVariant({ managed: false, presetBaseUrl: 'https://ai.example.org:8443' }), {
      kind: 'instance-ai',
      host: 'ai.example.org:8443',
    });
  });

  it('is the managed dead end whenever a gateway is configured, preset or not', () => {
    assert.deepEqual(resolveConnectCardVariant({ managed: true, presetBaseUrl: null }), {
      kind: 'managed-missing',
    });
    assert.deepEqual(resolveConnectCardVariant({ managed: true, presetBaseUrl: 'https://ai.example.org' }), {
      kind: 'managed-missing',
    });
  });
});

describe('ConnectCard on a managed instance', () => {
  const markup = render(publicConfig({ managed: true }));

  it('never offers to connect OpenRouter', () => {
    assert.ok(
      !markup.includes(CONNECT_OPENROUTER),
      'a user on a managed instance brings no key of their own, so the OAuth button reads as a missing connection they can fix',
    );
  });

  it('says photo estimates are not switched on, and names who switches them on', () => {
    assert.ok(markup.includes(MANAGED_MISSING), markup.slice(0, 400));
    // AND THE NEXT STEP, which is a person rather than a settings page: on a
    // managed instance there is no key to bring, so "connect a provider" would
    // send somebody to a screen that cannot help them.
    assert.ok(markup.includes('Ask your administrator'), markup.slice(0, 600));
    assert.ok(!markup.includes('OpenRouter'), 'a managed instance must not offer a provider signup');
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

  it('does not show the managed copy', () => {
    assert.ok(!markup.includes(MANAGED_MISSING));
  });

  it('keeps the manual settings path', () => {
    assert.ok(markup.includes('/settings/ai?next=scan'));
    assert.ok(markup.includes(ADD_WITHOUT_PHOTO));
  });
});
