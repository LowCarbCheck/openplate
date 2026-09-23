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

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { clientLoader } from '../../app/routes/settings.ai';
import { NoAiIntakeNotice } from '../../app/components/add/no-ai-intake-notice';
import { resolveAiIntakeDoor, type AiIntakeDoor } from '../../app/components/add/use-ai-connection';
import enCommon from '../../app/i18n/locales/en/common.json';
import { formatNumericDate } from '../../app/i18n/date-locale';

/** The notice `/add` and `/describe` draw, rendered for one door. */
function renderNoAiNotice(door: AiIntakeDoor): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(NoAiIntakeNotice, {
        door,
        byokMessage: 'byok message',
        byokLinkLabel: 'byok link',
        byokHref: '/settings/ai',
      }),
    ),
  );
}

function readRoute(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/${name}`, import.meta.url)), 'utf8');
}

/**
 * The connect card's own source.
 *
 * It USED to live inside `scan.tsx`. M233/02 lifted it into
 * `components/intake/` because `/pantry` reaches the same dead end, so the
 * source this file greps moved with it. The assertion is unchanged: the
 * sentence that names an administrator must still be gated on the door that
 * has one.
 */
function readConnectCard(): string {
  return readFileSync(
    fileURLToPath(new URL('../../app/components/intake/intake-connect-card.tsx', import.meta.url)),
    'utf8',
  );
}

/**
 * `<question> ? …` followed by the managed key, i.e. the twin is on the branch
 * that policy question turns on.
 *
 * The question is NAMED by the caller since M201 spec 07. It used to be the
 * literal `managed`, one boolean for every branch, which is the arrangement
 * that let a managed instance keep three false sentences: nothing said WHY a
 * given branch cared, so nothing said which other branch should have existed.
 * Naming it here means this wiring check also pins the reason.
 */
function assertChosenByPolicy(source: string, question: string, managedKey: string): void {
  assert.match(source, new RegExp(`${question} \\?[\\s\\S]{0,80}${managedKey.replaceAll('.', '\\.')}`));
}

describe('landing page — the three claims that are false on a managed instance', () => {
  const source = readRoute('index.tsx');

  // Three different questions, one per claim (M201/07): the AI cards are about
  // where the estimate comes from, the call to action is about whether an
  // account is the only way in, and the sync card is about who holds the copy.
  for (const [question, openKey, managedKey] of [
    ['aiComesFromTheInstance', 'landing.features.byok.title', 'landing.features.byokManaged.title'],
    ['aiComesFromTheInstance', 'landing.features.byok.body', 'landing.features.byokManaged.body'],
    ['requiresAccount', 'landing.cta.tryItFree', 'landing.cta.tryItFreeManaged'],
    ['serverHoldsTheDiary', 'landing.sync.body', 'landing.sync.bodyManaged'],
  ]) {
    it(`renders ${managedKey} on a managed instance and keeps ${openKey} on an open one`, () => {
      assertChosenByPolicy(source, question, managedKey);
      assert.ok(source.includes(openKey), `${openKey} must still be the open instance's string`);
    });
  }

  it('sends the closing call to action to the sign-in door rather than the anonymous one', () => {
    // `/dashboard` bounces to `/welcome` on a managed instance anyway; naming
    // the real door is what makes the button's label true.
    assert.match(source, /requiresAccount \? '\/welcome' : '\/dashboard'/);
  });
});

describe('the two screens M196 first missed', () => {
  // Both are RENDERED, both ways, in `device-only-managed-copy.test.ts`. What
  // is pinned here is the NAME of the question each one asks: a branch on the
  // bare mode would render the same two screens correctly and teach the next
  // screen nothing (M201 spec 07).
  for (const [route, managedKey] of [
    ['offline.tsx', 'offline.bodyManaged'],
    ['settings.data.tsx', 'settings.data.descriptionManaged'],
  ]) {
    it(`${route} chooses ${managedKey} by asking who holds the diary`, () => {
      assertChosenByPolicy(readRoute(route), 'serverHoldsTheDiary', managedKey);
    });
  }
});

describe('onboarding — the first-run trust card', () => {
  it('swaps the local-first promise for the managed one', () => {
    assertChosenByPolicy(readRoute('onboarding.tsx'), 'serverHoldsTheDiary', 'onboarding.localFirstManaged');
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

/**
 * THE ASK-ADMIN PROBLEM (M212 spec 04).
 *
 * Three sentences in this app sent a person to an administrator. On an
 * instance whose accounts invite each other there is no administrator, so each
 * one is now chosen by what is TRUE of the account rather than by who to ask.
 */
describe('no surface names an administrator where memberInvites is on', () => {
  const NOW = new Date('2026-09-09T10:00:00.000Z');

  it('says nothing about an administrator on an instance whose accounts invite each other', () => {
    const door = resolveAiIntakeDoor({
      aiComesFromTheInstance: true,
      plansAvailable: false,
      allowance: { memberInvites: true, allowanceExpiresAt: null, now: NOW },
    });
    assert.doesNotMatch(renderNoAiNotice(door), /administrator/i);
  });

  it('names the date instead, when the allowance ended on one', () => {
    const door = resolveAiIntakeDoor({
      aiComesFromTheInstance: true,
      plansAvailable: false,
      allowance: { memberInvites: true, allowanceExpiresAt: '2026-09-01T00:00:00.000Z', now: NOW },
    });
    const markup = renderNoAiNotice(door);
    assert.doesNotMatch(markup, /administrator/i);
    assert.doesNotMatch(markup, /\{\{date\}\}/, 'the date is interpolated, never printed as a placeholder');
    // THE APP LANGUAGE'S FORM, never the runtime's default (M251 spec 01).
    assert.ok(markup.includes(formatNumericDate('2026-09-01T00:00:00.000Z', 'en')));
  });

  it('KEEPS the old sentence where there really is an administrator, which is the control', () => {
    // Without this the two assertions above would pass against a notice that
    // had simply lost the sentence, and every organization's instance would
    // stop telling anybody who can switch their allowance on.
    const door = resolveAiIntakeDoor({
      aiComesFromTheInstance: true,
      plansAvailable: false,
      allowance: { memberInvites: false, allowanceExpiresAt: null, now: NOW },
    });
    assert.match(renderNoAiNotice(door), /administrator/i);
  });

  it('gates the account page and the connect card on the same rule, from their own source', () => {
    const account = readRoute('settings.account.tsx');
    const scan = readConnectCard();
    // The sentence is rendered only for the door that has somebody to name.
    assert.match(account, /door\.kind === 'ask-admin' && <p/);
    assert.match(scan, /allowanceDoor\.kind === 'ask-admin' && <p>\{t\('scan\.setup\.managedMissing\.askAdmin'\)\}/);
    // And both read the instance's own answer rather than the mode. The
    // account page has it in a variable of that name; the scan card reads the
    // descriptor inline.
    // The account page reads the descriptor into a variable and then asks it
    // twice, since M213 spec 05 added the plans question beside this one, so
    // the two facts cannot come from two different reads of `/health`.
    // Since M253/11 that one read is `useServerInstanceRead`, whose settled
    // flag holds the lower page until the handshake answers.
    assert.match(account, /const instanceRead = useServerInstanceRead\(\);/);
    assert.match(account, /const instance = instanceRead\.instance;/);
    assert.match(account, /instance\?\.memberInvites \?\? false/);
    assert.match(scan, /memberInvites: instance\?\.memberInvites \?\? false/);
  });
});
