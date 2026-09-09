/**
 * WHAT THE NOTICE UNDER A DEAD AI INTAKE SAYS, and which of its branches
 * carries a door.
 *
 * ── The property under test ──────────────────────────────────────────────
 *
 * Four branches, and exactly one of them has a page behind it. The three
 * allowance answers end at a sentence, because no page fixes any of them: on
 * an organization's instance a person does, and on a consumer instance with no
 * biller there is nobody to send anybody to. The `plans` branch is the
 * exception M213 spec 05 adds, and it exists ONLY because `/settings/plan` is
 * a real page that sells the thing that is missing.
 *
 * ── Asserted on the rendered output, not on a class list ─────────────────
 *
 * `markup.includes('disabled')` once matched `disabled:pointer-events-none` in
 * every `ui/button` class list and passed against an unguarded button
 * (workspace CLAUDE.md). So the assertions below look for an `<a href=...>`
 * with the plan address in it, and the no-link cases assert that NO anchor
 * exists at all, which is a claim a class name cannot satisfy by accident.
 *
 * ── Why a MemoryRouter ───────────────────────────────────────────────────
 *
 * The `plans` branch renders `#app/components/link`, which is react-router's
 * `Link`, and that throws outside a router. `MemoryRouter` is enough here: no
 * loader, no action and no `useNavigation` is involved.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { NoAiIntakeNotice } from '../../app/components/add/no-ai-intake-notice';
import type { AiIntakeDoor } from '../../app/components/add/use-ai-connection';
import { PLAN_PAGE_HREF } from '../../app/lib/plans/plans-door';
import enCommon from '../../app/i18n/locales/en/common.json';

function render(door: AiIntakeDoor): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      withI18n(
        createElement(NoAiIntakeNotice, {
          door,
          byokMessage: 'byok message',
          byokLinkLabel: 'byok link',
          byokHref: '/settings/ai',
        }),
      ),
    ),
  );
}

/** Every `href` in a render, so "no link" can be asserted as an empty list. */
function hrefsIn(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
}

const ENDED_AT = '2026-09-01T00:00:00.000Z';

describe('the notice under a dead AI intake', () => {
  it('offers the plan page on the plans door, and offers it as a real link', () => {
    const markup = render({ kind: 'plans', endedAt: null });
    assert.deepEqual(hrefsIn(markup), [PLAN_PAGE_HREF]);
    // The label is read from the shipped catalog rather than typed here:
    // wordsmith owns the wording and rephrases it, and this assertion must
    // fail on a MISSING link, never on a better sentence.
    assert.ok(markup.includes(enCommon.aiIntake.plansLink));
  });

  it('names the date on the plans door when the account carries one', () => {
    const markup = render({ kind: 'plans', endedAt: ENDED_AT });
    assert.deepEqual(hrefsIn(markup), [PLAN_PAGE_HREF], 'the dated plans notice lost its door');
    // A date, rendered in the reader's own locale, so the assertion is on the
    // year rather than on a format this test would have to duplicate.
    assert.match(markup, /2026/);
    // THE CONTROL: the dateless twin says nothing about a year, so the match
    // above is really reading the interpolated date.
    assert.doesNotMatch(render({ kind: 'plans', endedAt: null }), /2026/);
  });

  it('draws NO link on any of the three allowance doors', () => {
    // THE CONTROL FOR THE TWO CASES ABOVE. A notice that always linked would
    // pass both of them and would put a payment page under a sentence about an
    // administrator.
    for (const door of [
      { kind: 'ask-admin' },
      { kind: 'not-switched-on' },
      { kind: 'allowance-ended', endedAt: ENDED_AT },
    ] satisfies AiIntakeDoor[]) {
      assert.deepEqual(hrefsIn(render(door)), [], `${door.kind} grew a link`);
    }
  });

  it('keeps the BYOK branch pointing at the settings page the screen handed it', () => {
    // The fourth branch, and the one whose wording is the screen's own. Its
    // link is a prop, so this is also the control proving `hrefsIn` reads a
    // link when there is one.
    const markup = render({ kind: 'byok' });
    assert.deepEqual(hrefsIn(markup), ['/settings/ai']);
  });

  it('does not name an administrator on the plans door', () => {
    // The whole reason the door exists: "ask your administrator" is false on a
    // consumer instance, and a plans notice that still said it would be the
    // M212 defect returning under a new name.
    assert.doesNotMatch(render({ kind: 'plans', endedAt: null }), /administrator/i);
    // THE CONTROL: the organization branch still does say it.
    assert.match(render({ kind: 'ask-admin' }), /administrator/i);
  });
});
