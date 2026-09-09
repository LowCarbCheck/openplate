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

function readLegal(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/legal/${name}`, import.meta.url)), 'utf8');
}

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
 * The legal pages, wired the same way (M212 spec 06).
 *
 * WHAT IS PINNED IS THE QUESTION, not the sentence. `legal-pages.test.ts`
 * renders both documents and checks that the managed one has stopped making
 * the claim; this checks that the branch which chooses it names the rule it
 * depends on, so the next paragraph that should ask the same question can be
 * found by grepping for it.
 */
describe('the legal pages ask which fact each paragraph depends on', () => {
  for (const [file, managedKey] of [
    ['terms.tsx', 'terms.s3BodyManaged'],
    ['terms.tsx', 'terms.s4HeadingManaged'],
    ['privacy.tsx', 'privacy.s1Item3Managed'],
    ['privacy.tsx', 'privacy.s2Body2Managed'],
    ['privacy.tsx', 'privacy.s4HeadingManaged'],
  ]) {
    it(`${file} chooses ${managedKey} by asking where the photo estimates come from`, () => {
      assertChosenByPolicy(readLegal(file), 'aiComesFromTheInstance', managedKey);
    });
  }

  it('privacy.tsx chooses privacy.s3OutroManaged by asking who holds the diary', () => {
    // A DIFFERENT QUESTION on purpose: the second exception this paragraph
    // admits is the recovery escrow, which is about the copy on the server and
    // not about who reads a photograph.
    assertChosenByPolicy(readLegal('privacy.tsx'), 'serverHoldsTheDiary', 'privacy.s3OutroManaged');
  });

  it('draws the two new paragraphs from a call site rather than leaving them in the catalog', () => {
    // The defect this whole file exists for: a `*Managed` twin that is never
    // rendered passes key parity and leaves the false sentence on the screen.
    assert.match(readLegal('terms.tsx'), /aiComesFromTheInstance && <P className="mt-4">\{t\('terms\.s4AllowanceManaged'\)\}/);
    assert.match(readLegal('privacy.tsx'), /memberInvites && <P className="mt-4">\{t\('privacy\.s3InvitesManaged'\)\}/);
  });

  it('reads memberInvites off the instance rather than inventing a policy question for it', () => {
    // `InstancePolicy` states that the mode is its only input, and two managed
    // instances answer this differently. It comes off `/health`, like the
    // feedback retention window beside it.
    // ONE READ, TWO QUESTIONS since M213 spec 07 put the plans fact beside it:
    // the descriptor is read into a variable and asked twice, so the two
    // paragraphs cannot come from two different reads of `/health`.
    assert.match(readLegal('privacy.tsx'), /const instance = useServerInstance\(\);/);
    assert.match(readLegal('privacy.tsx'), /instance\?\.memberInvites \?\? false/);
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
    assert.match(markup, new RegExp(new Date('2026-09-01T00:00:00.000Z').toLocaleDateString()));
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

  it('gates the account page and the scan card on the same rule, from their own source', () => {
    const account = readRoute('settings.account.tsx');
    const scan = readRoute('scan.tsx');
    // The sentence is rendered only for the door that has somebody to name.
    assert.match(account, /door\.kind === 'ask-admin' && <p/);
    assert.match(scan, /allowanceDoor\.kind === 'ask-admin' && <p>\{t\('scan\.setup\.managedMissing\.askAdmin'\)\}/);
    // And both read the instance's own answer rather than the mode. The
    // account page has it in a variable of that name; the scan card reads the
    // descriptor inline.
    // The account page reads the descriptor into a variable and then asks it
    // twice, since M213 spec 05 added the plans question beside this one, so
    // the two facts cannot come from two different reads of `/health`.
    assert.match(account, /const instance = useServerInstance\(\);/);
    assert.match(account, /instance\?\.memberInvites \?\? false/);
    assert.match(scan, /memberInvites: instance\?\.memberInvites \?\? false/);
  });
});
