/**
 * NO CREDENTIAL FORM MAY BE SUBMITTABLE BEFORE IT HYDRATES.
 *
 * ── The defect this file exists for ──────────────────────────────────────
 *
 * Submit `/sign-in` before the page hydrates and no JavaScript runs, so
 * nothing calls `preventDefault` and the browser performs a native submit. The
 * form carries no `method`, so that is a GET, and the address becomes
 * `/sign-in?email=…&passphrase=…`. The passphrase is then in the address bar,
 * in history, in every log on the path and in the next request's `Referer`,
 * and it is the passphrase that derives the encryption keys for the whole
 * diary. Observed twice in a real browser, 2026-09-08.
 *
 * ── Why every assertion is about SERVER-RENDERED MARKUP ──────────────────
 *
 * Because that is where the defect lives. The window being closed is the one
 * before any client code exists, so the only possible fix is in the bytes the
 * server sent, and the only honest test renders those bytes.
 * `renderToStaticMarkup` is exactly that renderer: `useEffect` never runs and
 * `useSyncExternalStore` always takes the server snapshot, so `useHydrated()`
 * resolves to `false` here FOR REAL rather than through a stub. See
 * `first-food-install.test.ts`'s header for the same limit stated from the
 * other side.
 *
 * ── The two kinds of credential form, and the two kinds of proof ─────────
 *
 * A form is safe here for one of exactly two reasons, and each is pinned
 * differently.
 *
 *  1. GUARDED. It does reach the server's markup, and its submit control is
 *     `CredentialSubmitButton`, which renders `disabled` until hydration. That
 *     closes the click path and, because HTML implicit submission goes through
 *     the form's default button, the Enter-in-a-text-field path with it.
 *     Proven by rendering it and reading the button.
 *
 *  2. CLIENT-GATED. It never reaches the server's markup at all, because the
 *     screen around it opens on a state only a client effect or a completed
 *     request can produce. Nothing to submit means nothing to leak. Proven by
 *     rendering the screen and asserting that no password box and no enabled
 *     submit are in it, so deleting the gate turns this red rather than
 *     shipping a second `/sign-in`.
 *
 * The source sweep at the bottom is what stops the NEXT form arriving
 * unguarded.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { CredentialSubmitButton } from '../../app/components/credential-submit-button';
import { SignInPanel } from '../../app/components/sign-in-panel';
import { Button } from '../../app/components/ui/button';
import Forgot from '../../app/routes/forgot';
import Join from '../../app/routes/join';
import Reset from '../../app/routes/reset';
import StudyConsole from '../../app/routes/study._index';
import type { PublicConfig } from '../../app/config/public-config';

const SYNC_SERVER_URL = 'https://sync.example.test';

/** The marker `CredentialSubmitButton` stamps on itself, and the only anchor these tests need. */
const GUARD_MARKER = 'data-credential-submit=""';

/**
 * Every `<button …>` opening tag in a blob of markup.
 *
 * Rendered attributes, not source text: this is what a browser would receive,
 * which is the whole point of asserting here rather than on a `.tsx` file.
 */
function buttonTags(markup: string): string[] {
  return markup.match(/<button[^>]*>/g) ?? [];
}

/** The one button carrying the guard marker, or `null` when the guard is gone. */
function guardedButton(markup: string): string | null {
  return buttonTags(markup).find((tag) => tag.includes(GUARD_MARKER)) ?? null;
}

/**
 * The `disabled` ATTRIBUTE, not the word.
 *
 * `ui/button`'s class list contains `disabled:pointer-events-none` and
 * `disabled:opacity-50`, so a substring search for "disabled" matches every
 * button this app renders and proves nothing. The first draft of this file did
 * exactly that and was green against an unguarded control.
 */
const DISABLED_ATTRIBUTE = /\sdisabled=""/;

function isDisabled(tag: string): boolean {
  return DISABLED_ATTRIBUTE.test(tag);
}

/** Submitting controls a pre-hydration Enter or click could actually reach. */
function enabledSubmitTags(markup: string): string[] {
  return buttonTags(markup).filter((tag) => tag.includes('type="submit"') && !isDisabled(tag));
}

/** A managed instance's public config: sync is configured, so every credential screen is offered. */
function publicConfig(): PublicConfig {
  return { syncServerUrl: SYNC_SERVER_URL, analytics: null, instancePreset: null, managed: true };
}

/**
 * Renders a whole route the way the server does: under a data router whose
 * `root` loader supplies the public config `useSyncServerUrl` reads.
 */
function renderRoute(Component: ComponentType): string {
  const config = publicConfig();
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: withI18n(createElement(Component)) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The sign-in form as `/sign-in` server-renders it: no remembered address, no repair in flight. */
function renderSignInPanel(): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(SignInPanel, {
        serverUrl: SYNC_SERVER_URL,
        initialEmail: '',
        onForgot: () => undefined,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// 1. The guarded forms: they are in the server's markup, and they are disabled
// ---------------------------------------------------------------------------

describe('the sign-in form cannot be submitted before it hydrates', () => {
  it('is a real password form with no method, so a native submit would be the GET that leaked', () => {
    const markup = renderSignInPanel();
    assert.ok(markup.includes('type="password"'), 'the sign-in form stopped rendering a password field');
    // The premise of the whole file. A `method` appearing here would be
    // `post`, which is a DIFFERENT leak, the passphrase into this server's
    // request body, and must be caught rather than tolerated.
    assert.ok(!/<form[^>]*\smethod=/.test(markup), `the sign-in form grew a method: ${markup}`);
  });

  it('renders its submit control disabled', () => {
    const tag = guardedButton(renderSignInPanel());
    assert.ok(tag !== null, 'the sign-in form no longer uses the guarded submit control');
    assert.ok(isDisabled(tag), `the sign-in submit is enabled in server markup: ${tag}`);
  });

  it('leaves no other submitting control for Enter to reach', () => {
    // Implicit submission goes through the form's DEFAULT button, so a second,
    // unguarded submit button reopens the Enter path even with the first one
    // disabled.
    assert.deepEqual(enabledSubmitTags(renderSignInPanel()), [], 'an enabled submit is on the pre-hydration form');
  });
});

describe('/forgot cannot be submitted before it hydrates', () => {
  it('renders its submit control disabled, and nothing else that submits', () => {
    const markup = renderRoute(Forgot);
    assert.ok(markup.includes('type="email"'), 'the forgot form stopped rendering its address field');
    const tag = guardedButton(markup);
    assert.ok(tag !== null, 'the forgot form no longer uses the guarded submit control');
    assert.ok(isDisabled(tag), `the forgot submit is enabled in server markup: ${tag}`);
    assert.deepEqual(enabledSubmitTags(markup), [], 'an enabled submit is on the pre-hydration /forgot form');
  });
});

describe('the study console sign-in cannot be submitted before it hydrates', () => {
  it('renders its submit control disabled, and nothing else that submits', () => {
    const markup = renderRoute(StudyConsole);
    assert.ok(markup.includes('type="password"'), 'the study console stopped rendering a password field');
    const tag = guardedButton(markup);
    assert.ok(tag !== null, 'the study console no longer uses the guarded submit control');
    assert.ok(isDisabled(tag), `the study console submit is enabled in server markup: ${tag}`);
    assert.deepEqual(enabledSubmitTags(markup), [], 'an enabled submit is on the pre-hydration study sign-in');
  });

});

describe('the guard is what disables the button, not the renderer', () => {
  // Without this pair, every "renders disabled" assertion above would also
  // pass if `renderToStaticMarkup` simply emitted `disabled` on every button.
  // Same renderer, same `ui/button`, one difference: the wrapper.
  it('the plain submit button renders ENABLED under the same renderer', () => {
    const markup = renderToStaticMarkup(createElement(Button, { type: 'submit' }, 'go'));
    assert.ok(!isDisabled(markup), markup);
  });

  it('the same button inside CredentialSubmitButton renders DISABLED', () => {
    const markup = renderToStaticMarkup(createElement(CredentialSubmitButton, { children: 'go' }));
    assert.ok(isDisabled(markup), markup);
    assert.ok(markup.includes(GUARD_MARKER), markup);
  });
});

// ---------------------------------------------------------------------------
// 2. The client-gated forms: they are not in the server's markup at all
// ---------------------------------------------------------------------------

describe('the client-gated credential screens put no form in the server markup', () => {
  it('/join renders its loading card, not the account-creation form', () => {
    // The invite is read from the URL FRAGMENT in an effect, which never runs
    // under a server renderer, so the panel and the `SyncSetupFlow` form
    // inside it are unreachable here. Delete that gate and this goes red.
    const markup = renderRoute(Join);
    assert.ok(!markup.includes('type="password"'), `/join server-rendered a password box: ${markup}`);
    assert.deepEqual(enabledSubmitTags(markup), [], '/join server-rendered a submittable form');
  });

  it('/reset renders its reading state, not the new-password form', () => {
    const markup = renderRoute(Reset);
    assert.ok(!markup.includes('type="password"'), `/reset server-rendered a password box: ${markup}`);
    assert.deepEqual(enabledSubmitTags(markup), [], '/reset server-rendered a submittable form');
  });
});

// ---------------------------------------------------------------------------
// 3. The sweep: no credential source may reopen the hole
// ---------------------------------------------------------------------------

/** Every source that draws, or is drawn into, a form asking for a credential. */
const CREDENTIAL_SOURCES = [
  'app/components/sign-in-panel.tsx',
  'app/components/create-account-panel.tsx',
  'app/components/password-fields.tsx',
  'app/components/sync-setup-flow.tsx',
  'app/routes/join.tsx',
  'app/routes/reset.tsx',
  'app/routes/forgot.tsx',
  'app/routes/recover.tsx',
  'app/routes/settings.account.tsx',
  'app/routes/study._index.tsx',
  'app/components/study-key-card.tsx',
] as const;

/**
 * The three that are in the server's markup and must therefore use the shared
 * guard.
 *
 * The rest are absent from it for a structural reason, pinned by the renders
 * above, and their own raw submit controls are unreachable before hydration.
 * A file moving between these two lists is a change of that structure and
 * belongs in the same commit as the list edit.
 */
const SERVER_RENDERED_CREDENTIAL_SOURCES = [
  'app/components/sign-in-panel.tsx',
  'app/routes/forgot.tsx',
  'app/routes/study._index.tsx',
] as const;

function readSource(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('no credential source may declare a form method', () => {
  for (const path of CREDENTIAL_SOURCES) {
    it(path, () => {
      // `method="get"` is the observed defect spelled out loud. `method="post"`
      // is the fix people reach for and is worse: it posts the passphrase to
      // THIS app's server, which is designed never to see it.
      assert.ok(!/\bmethod=/.test(readSource(path)), `${path} declares a form method; both values are wrong here`);
    });
  }
});

describe('every server-rendered credential form routes its submit through the shared guard', () => {
  for (const path of SERVER_RENDERED_CREDENTIAL_SOURCES) {
    it(path, () => {
      const source = readSource(path);
      assert.ok(source.includes('CredentialSubmitButton'), `${path} stopped using the shared guarded submit control`);
      assert.deepEqual(
        source.match(/type="submit"/g) ?? [],
        [],
        `${path} has a raw type="submit"; use CredentialSubmitButton so it is disabled before hydration`,
      );
    });
  }
});

describe('the sweep is non-vacuous', () => {
  it('the guarded button is a submit control that disables itself before hydration', () => {
    // If `CredentialSubmitButton` ever stopped being a submit control, or
    // stopped consulting `useHydrated`, every assertion above would pass while
    // the hole was wide open.
    const guard = readSource('app/components/credential-submit-button.tsx');
    assert.ok(guard.includes('type="submit"'), 'CredentialSubmitButton is no longer a submit control');
    assert.ok(guard.includes('data-credential-submit'), 'CredentialSubmitButton lost the marker these tests read');
    assert.ok(guard.includes('!isHydrated'), 'CredentialSubmitButton no longer disables itself before hydration');
  });

  it('the guarded list still names real password forms', () => {
    // A list that had drifted to paths which no longer draw a credential form
    // would pass silently.
    assert.ok(readSource('app/components/sign-in-panel.tsx').includes("type: 'password'"));
    assert.ok(readSource('app/routes/study._index.tsx').includes('type="password"'));
  });
});
