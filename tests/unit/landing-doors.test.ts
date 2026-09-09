/**
 * THE LANDING PAGE MAY NOT OFFER WHAT THE INSTANCE FORBIDS (M201 spec 08).
 *
 * This is the one defect in M201 that seven specs of careful reading missed. A
 * green gate of 2978 tests, a header fixed by spec 03, and the German front
 * page of a managed instance still said, in one viewport, top to bottom:
 * "request access", "an administrator must invite you", "try it now,
 * completely free" pointing at `/dashboard`, and "invitation only". Every test
 * passed because every test asserted the thing it was written to assert.
 *
 * So this file RENDERS the page. A source grep would prove that a ternary
 * exists; it cannot prove that no fifth call to action was added beside the
 * four that were fixed, and that is the failure this spec exists to stop
 * happening a second time. The whole route component goes through
 * `renderToStaticMarkup` under a data router whose ROOT carries the public
 * config, which is the channel `useInstancePolicy()` actually reads, and the
 * assertions are counts over the resulting markup rather than reads of the
 * source that produced it.
 *
 * The two directions are equally load-bearing:
 *
 *  1. THE MANAGED PAGE OFFERS A DOOR IT HAS. No `/dashboard`, no
 *     `/settings/account`, no free trial, no self-service account.
 *  2. THE OPEN PAGE IS UNTOUCHED. Its copy is the product's actual pitch and
 *     it is correct there. Every string and every destination is pinned by
 *     name below, so a "tidy-up" that leaks the managed wording onto a
 *     self-host fails here.
 *
 * M196/02 ADDED A SECOND FALSE CLAIM to the same page. Spec 08 was about doors
 * the instance does not have; this one is about the diary's ADDRESS. The page
 * title, the footer tagline and all three analytics bodies said the diary
 * stays on the device, which is false wherever `serverHoldsTheDiary` is true.
 * Two of those had never been rendered by this file at all: the `<title>` is a
 * `meta()` descriptor and not markup, and the three level bodies only appear
 * when the loader reports an analytics level, which `renderLanding` used to
 * pin at `null`. Both gaps are closed below.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import Index, { meta } from '../../app/routes/index';
import enCommon from '../../app/i18n/locales/en/common.json';
import type { PublicConfig } from '../../app/config/public-config';
import type { AnalyticsEventLevel } from '../../app/config/analytics';

/** The landing loader's payload, with sync on so the account link renders at all. */
const LOADER_DATA = {
  analyticsLevel: null,
  syncEnabled: true,
  newsletter: null,
  siteOrigin: 'https://openplate.test',
};

/**
 * A managed instance always has a sync server (`isManagedInstance` refuses to
 * boot without one), so the two flags move together here on purpose.
 */
function publicConfig(managed: boolean): PublicConfig {
  return {
    syncServerUrl: 'https://sync.openplate.test',
    analytics: null,
    instancePreset: null,
    managed,
  };
}

/**
 * The real page, rendered.
 *
 * `hydrationData` hands the root loader's result over up front so the router
 * is never pending during a synchronous render, the same arrangement
 * `scan-connect-card.test.ts` uses. Effects do not run under
 * `renderToStaticMarkup`, so the hard-load repair effect stays out of the way.
 *
 * `analyticsLevel` defaults to `null`, the self-host default and the level
 * every assertion written before M196/02 was written against. The three
 * counting levels are rendered separately, because the trust card's body is
 * chosen by the level and the level-off sentence is the one body of the four
 * that is NOT mode-dependent.
 *
 * @param managed - the instance mode this render's public config reports.
 * @param analyticsLevel - what the loader says this instance counts.
 */
function renderLanding(managed: boolean, analyticsLevel: AnalyticsEventLevel | null = null): string {
  const config = publicConfig(managed);
  // SAFETY: `Route.ComponentProps` also carries `params`, `matches`, `actionData`
  // and `loaderData` typed by the generated route module, and this page reads
  // exactly the four fields of `loaderData` supplied above and nothing else.
  // The cast is the harness admitting it is not the router, not a claim about
  // the component.
  const page = withI18n(createElement(Index as never, { loaderData: { ...LOADER_DATA, analyticsLevel } } as never));
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: page }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * The `#how` section's markup, sliced out of the page.
 *
 * Counting `<img>` over the WHOLE page would count the hero pair and the two
 * ladder-card captures too, so the count would move for reasons that have
 * nothing to do with the three steps. The section is bounded by its own
 * `id="how"` and the start of the next `<section>`.
 */
function howSection(html: string): string {
  const start = html.indexOf('id="how"');
  assert.ok(start !== -1, 'the how-it-works section is not on the page at all');
  const end = html.indexOf('<section', start);
  assert.ok(end !== -1, 'the how-it-works section is the last one on the page, so this slice is unbounded');
  return html.slice(start, end);
}

/**
 * Does the page render this exact source string?
 *
 * `renderToStaticMarkup` escapes the five characters React escapes, so a
 * sentence containing an apostrophe ("what's on it") never appears in the
 * markup as it appears in the catalog. Every assertion above this line happens
 * to pin a string with none of them; the scan step's body does not, and a
 * plain `includes` on it fails for a reason that has nothing to do with the
 * page. The string is escaped the way React escapes it and then looked for.
 */
function rendersCopy(html: string, text: string): boolean {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
  return html.includes(escaped);
}

/** How many times a destination appears as an `href` in the rendered page. */
function hrefCount(html: string, path: string): number {
  return html.split(`href="${path}"`).length - 1;
}

const MANAGED = renderLanding(true);
const OPEN = renderLanding(false);

/** Every counting level, so the trust card's three mode-dependent bodies are all exercised. */
const ANALYTICS_LEVELS: readonly AnalyticsEventLevel[] = ['pageviews', 'product', 'research'];

describe('the landing page on a managed instance', () => {
  it('leaves no dashboard link anywhere on the page', () => {
    // Spec 01 makes `/dashboard` bounce a signed-out managed visitor to
    // `/welcome`, so this is not about a broken route. A button named for a
    // destination it never reaches is a redirect wearing that name, and the
    // page had three of them.
    assert.equal(hrefCount(MANAGED, '/dashboard'), 0, MANAGED.slice(0, 400));
  });

  it('offers no self-service account link', () => {
    // "Create an account" pointing at a settings page behind a door the
    // visitor has not opened. An invite-only instance cannot honour either
    // half of that.
    assert.equal(hrefCount(MANAGED, '/settings/account'), 0);
    assert.ok(!MANAGED.includes(enCommon.landing.sync.link), 'the open label leaked onto a managed page');
  });

  it('names the real door instead, five times over', () => {
    // Hero, how-it-works, mid-page, sync card, close. The mid-page one was
    // already right before this spec and is counted with the rest, because the
    // rule is about the page and not about the four links that were wrong. The
    // count is the guard: a sixth call to action added later without the branch
    // would leave this at five while `/dashboard` came back above.
    assert.equal(hrefCount(MANAGED, '/welcome'), 5, MANAGED.slice(0, 400));
  });

  it('promises no free trial and no immediate start', () => {
    for (const forbidden of ['completely free', 'Nothing to sign up for', 'Start with step one']) {
      assert.ok(!MANAGED.includes(forbidden), `${forbidden} is still on the managed page`);
    }
  });

  it('says the managed words the catalog actually holds', () => {
    assert.ok(MANAGED.includes(enCommon.landing.cta.tryItFreeManaged), 'the hero and closing label');
    assert.ok(MANAGED.includes(enCommon.landing.setup.ctaManaged), 'the how-it-works label');
    assert.ok(MANAGED.includes(enCommon.landing.sync.linkManaged), 'the sync card label');
    assert.ok(MANAGED.includes(enCommon.landing.close.bodyManaged), 'the closing paragraph');
  });

  it('still carries the small print that made the contradiction visible', () => {
    // The facts were never the problem: this line was already right while the
    // button above it offered a free trial. It is pinned so a later pass
    // cannot "resolve" the contradiction by deleting the true half.
    assert.ok(MANAGED.includes('Invitation only'), MANAGED.slice(0, 400));
  });
});

////////////////////////////////////////////////////////////////////////////////
// The sweep: nothing managed-false anywhere in the markup
////////////////////////////////////////////////////////////////////////////////

/**
 * THE ASSERTION THAT MAKES A FOURTH ROUND IMPOSSIBLE.
 *
 * Everything above this line names a key, a label or a destination, and every
 * one of them was written after somebody found the string it pins. That is the
 * shape of the whole defect: three passes over this page each fixed the
 * sentences they had been shown and each left more of the same sentence
 * elsewhere, because a test that names a key can only fail for a key it names.
 * The hero was fixed while the setup subtitle still said the middle step asks
 * something; the scan step's body was branched while the alt text beside it
 * still said "OpenRouter"; the sync body was branched while its own alt text
 * still offered to create an account.
 *
 * So this sweep asserts over the RENDERED MARKUP and knows nothing about keys.
 * A new string added to this page without a branch fails here by EXISTING, not
 * by being remembered. That is the only property that ends the sequence.
 *
 * Two more things it deliberately does:
 *
 *  - It reads the raw markup, not the text. The last three offenders were two
 *    `alt` attributes and one paragraph. Stripping tags first would have hidden
 *    two of the three, and an `alt` is copy: it is what a screen reader is told
 *    the page shows.
 *  - It reads the text as well, collapsed. A phrase broken across an inline
 *    element or a React text-node boundary is still the phrase, and matching
 *    only the raw markup would let a `<strong>` hide one.
 */
const MANAGED_FALSE_CLAIMS = [
  { phrase: 'OpenRouter', why: 'a managed visitor brings no provider and cannot connect one' },
  { phrase: 'no account', why: 'there is one, and it is the only way in' },
  { phrase: 'completely free', why: 'the instance is invitation only, not a free trial' },
  { phrase: 'your own key', why: 'the operator holds the key, nobody brings one' },
  { phrase: 'your provider', why: 'the operator runs the AI; the person has no provider' },
  { phrase: 'create an account', why: 'an invite-only instance cannot honour this' },
  { phrase: 'sign up', why: 'there is no self-service signup to point at' },
  { phrase: 'nothing to sign up for', why: 'there is: an administrator has to invite you' },
  { phrase: 'bills you', why: 'nobody is billed by a provider here' },
  {
    phrase: 'stays on your device',
    why: 'the account keeps an encrypted copy on the server, so the device is not the only place it is',
  },
  {
    phrase: 'lives on your device',
    why: 'the hero says where the diary lives, and on a managed instance it lives in two places',
  },
  {
    phrase: 'no database at all',
    why: 'openplate-core runs a Postgres and keeps the ciphertext diary in it',
  },
];

/** The markup with its tags removed and its whitespace collapsed. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

/** Does this page say the phrase, in its markup or in its text? */
function saysPhrase(html: string, phrase: string): boolean {
  const needle = phrase.toLowerCase();
  return html.toLowerCase().includes(needle) || textOf(html).toLowerCase().includes(needle);
}

describe('the managed landing page makes no claim its own mode forbids', () => {
  for (const { phrase, why } of MANAGED_FALSE_CLAIMS) {
    it(`never says "${phrase}", because ${why}`, () => {
      assert.ok(!saysPhrase(MANAGED, phrase), `"${phrase}" is on the managed landing page`);
    });
  }
});

describe('the ban is real, because the open page says every one of them', () => {
  // WITHOUT THIS the sweep above is nine assertions that a string absent from
  // both pages is absent from one of them, which is what a ban list becomes
  // the first time somebody deletes the copy instead of branching it. Each
  // phrase is the product's actual pitch where there are no accounts, so its
  // presence here is both the non-vacuity proof and the open page's guarantee.
  for (const { phrase } of MANAGED_FALSE_CLAIMS) {
    it(`still says "${phrase}"`, () => {
      assert.ok(saysPhrase(OPEN, phrase), `"${phrase}" left the open landing page, so the managed ban proves nothing`);
    });
  }
});

////////////////////////////////////////////////////////////////////////////////
// The three strings the sweep caught, pinned by name
////////////////////////////////////////////////////////////////////////////////

describe('the setup ladder describes the ladder it actually has', () => {
  it('does not claim the middle step asks anything, because it does not', () => {
    // The subtitle is a claim ABOUT step two, and step two stopped asking for
    // a key when `connectManaged` replaced `connect`.
    assert.ok(!MANAGED.includes(enCommon.landing.setup.subtitle), 'the open subtitle survived');
    assert.ok(MANAGED.includes(enCommon.landing.setup.subtitleManaged), MANAGED.slice(0, 400));
    assert.ok(OPEN.includes(enCommon.landing.setup.subtitle));
    assert.ok(!OPEN.includes(enCommon.landing.setup.subtitleManaged));
  });

  it('names the instance rather than a provider in the third step', () => {
    assert.ok(!MANAGED.includes(enCommon.landing.setup.steps.scan.body), 'the BYOK third step survived');
    assert.ok(MANAGED.includes(enCommon.landing.setup.steps.scan.bodyManaged));
    assert.ok(OPEN.includes(enCommon.landing.setup.steps.scan.body));
    assert.ok(!OPEN.includes(enCommon.landing.setup.steps.scan.bodyManaged));
    // The step's own title is true in both modes and is deliberately NOT
    // branched, so it is pinned as shared rather than left unmentioned.
    for (const page of [MANAGED, OPEN]) assert.ok(page.includes(enCommon.landing.setup.steps.scan.title));
  });
});

describe('the how-it-works scan step shows no picture it cannot honour', () => {
  it('renders the BYOK connect capture only where BYOK exists', () => {
    // `scan-mobile-*.webp` has "Connect with OpenRouter" on its primary
    // button. The picture is the claim here, so the managed page carries
    // neither the file nor the sentence that describes it. When a managed
    // capture exists this test changes to name that file instead.
    assert.ok(!MANAGED.includes('scan-mobile'), 'the BYOK scan capture is on the managed page');
    assert.ok(!MANAGED.includes(enCommon.landing.how.scan.shotAlt), 'its alt text is on the managed page');
    assert.ok(OPEN.includes('scan-mobile-dark.webp'), OPEN.slice(0, 400));
    assert.ok(OPEN.includes(enCommon.landing.how.scan.shotAlt));
  });

  it('keeps the other two captions on both pages, because both are true', () => {
    for (const page of [MANAGED, OPEN]) {
      assert.ok(page.includes(enCommon.landing.how.search.shotAlt));
      assert.ok(page.includes(enCommon.landing.how.see.shotAlt));
    }
  });

  it('still shows three steps and, on managed, two of the three captures', () => {
    // THE STEP THAT LOST ITS PICTURE MUST NOT LOSE ITSELF. Withholding the
    // capture is a `shot={undefined}`, one prop away from withholding the whole
    // step, and a page with two steps where three belong would pass every
    // assertion above it: no banned phrase, no forbidden href, the two true
    // alts still present. So this counts what the section renders rather than
    // naming what it must not say.
    //
    // Four `<img>` on managed and six on open is the same fact stated twice:
    // every capture is a dark/light PAIR (`ThemedShot`), because the theme is a
    // class and not a media query, so one withheld capture is two fewer
    // elements and not one.
    for (const [label, page, captures] of [
      ['managed', MANAGED, 4],
      ['open', OPEN, 6],
    ] as const) {
      const section = howSection(page);
      assert.equal(section.split('<img').length - 1, captures, `${label}: wrong number of step captures`);
      for (const title of [
        enCommon.landing.how.scan.title,
        enCommon.landing.how.search.title,
        enCommon.landing.how.see.title,
      ]) {
        assert.ok(section.includes(title), `${label}: the "${title}" step left the section`);
      }
    }
  });

  it("keeps the scan step's own copy on the managed page", () => {
    // The picture is withheld; the step it illustrated is not. Its paragraph is
    // the managed one, and its heading is the same in both modes.
    assert.ok(MANAGED.includes(enCommon.landing.how.scan.title));
    assert.ok(rendersCopy(MANAGED, enCommon.landing.how.scan.bodyManaged), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, enCommon.landing.how.scan.body), 'the BYOK body survived');
    assert.ok(rendersCopy(OPEN, enCommon.landing.how.scan.body), OPEN.slice(0, 400));
  });
});

describe('the sync capture is described as the capture it is', () => {
  it('says the same true sentence on both pages', () => {
    // `sync-mobile-*.webp` shows a signed-out account screen with one "Sign
    // in" link on it. It has never shown a create-account offer or a note
    // about photographs, both of which the old alt text claimed, so this one
    // is a CORRECTION rather than a mode branch: the picture is the same
    // picture on both instances and the sentence is now true of it on both.
    for (const page of [MANAGED, OPEN]) assert.ok(page.includes(enCommon.landing.sync.shotAlt), page.slice(0, 400));
    assert.match(enCommon.landing.sync.shotAlt, /signed out/i);
    assert.ok(!/create an account/i.test(enCommon.landing.sync.shotAlt));
  });
});

describe('the copy this pass added is fit to be managed copy', () => {
  const ADDED = {
    'landing.setup.subtitleManaged': enCommon.landing.setup.subtitleManaged,
    'landing.setup.steps.scan.bodyManaged': enCommon.landing.setup.steps.scan.bodyManaged,
    'landing.sync.shotAlt': enCommon.landing.sync.shotAlt,
  };

  it('exists, in full, and carries no dash', () => {
    for (const [key, text] of Object.entries(ADDED)) {
      assert.ok(text.trim().length > 0, `${key} is empty`);
      assert.ok(!/[–—]/.test(text), `${key} carries a dash: ${text}`);
    }
  });

  it('makes none of the claims the sweep bans', () => {
    for (const [key, text] of Object.entries(ADDED)) {
      for (const { phrase } of MANAGED_FALSE_CLAIMS) {
        assert.ok(!text.toLowerCase().includes(phrase.toLowerCase()), `${key} says "${phrase}": ${text}`);
      }
    }
  });
});

describe('the open instance landing page is unchanged', () => {
  it('keeps every call to action pointing at the tracker', () => {
    // Hero, how-it-works, close, and the header's own button. The mid-page
    // call to action is a fourth on the page and a fifth href here.
    assert.equal(hrefCount(OPEN, '/dashboard'), 5, OPEN.slice(0, 400));
    assert.equal(hrefCount(OPEN, '/welcome'), 0);
  });

  it('keeps the account link the sync card always had', () => {
    assert.equal(hrefCount(OPEN, '/settings/account'), 1);
    assert.ok(OPEN.includes(enCommon.landing.sync.link));
  });

  it('keeps its copy word for word, because it is the product pitch here', () => {
    for (const expected of ['completely free', 'Nothing to sign up for', enCommon.landing.setup.cta]) {
      assert.ok(OPEN.includes(expected), `${expected} left the open page`);
    }
  });

  it('borrows none of the managed wording', () => {
    for (const managedOnly of [
      enCommon.landing.setup.ctaManaged,
      enCommon.landing.sync.linkManaged,
      enCommon.landing.close.bodyManaged,
    ]) {
      assert.ok(!OPEN.includes(managedOnly), `${managedOnly} reached an instance with no accounts`);
    }
    assert.ok(!OPEN.includes('Invitation only'), 'the open instance invites nobody, it is simply open');
  });
});

describe('the landing copy this spec added is fit to be a managed label', () => {
  /** The English source strings, by the control each one labels. */
  const NEW_COPY = {
    'landing.setup.ctaManaged': enCommon.landing.setup.ctaManaged,
    'landing.sync.linkManaged': enCommon.landing.sync.linkManaged,
    'landing.close.bodyManaged': enCommon.landing.close.bodyManaged,
  };

  it('exists, in full', () => {
    for (const [key, text] of Object.entries(NEW_COPY)) {
      assert.ok(text.trim().length > 0, `${key} is empty`);
    }
  });

  it('never offers a signup an invite-only instance cannot honour', () => {
    // The same ban `public-header-doors.test.ts` puts on the header labels.
    // The label is the affordance's whole contract, so the ban is on the copy.
    for (const [key, text] of Object.entries(NEW_COPY)) {
      assert.ok(!/sign ?up|create an account|register|free/i.test(text), `${key} promises a signup: ${text}`);
    }
  });

  it('uses no em dash and no en dash', () => {
    for (const [key, text] of Object.entries(NEW_COPY)) {
      assert.ok(!/[–—]/.test(text), `${key} carries a dash: ${text}`);
    }
  });
});

////////////////////////////////////////////////////////////////////////////////
// The BYOK step, and the description a search engine quotes
////////////////////////////////////////////////////////////////////////////////

/**
 * The one meta tag this file is about, decoded rather than asserted.
 *
 * `meta()` answers an array of descriptors of several shapes, so the
 * description is FOUND by parsing each one instead of by trusting a position.
 * A reordering of the tags must not silently change what is being read.
 */
const DESCRIPTION_TAG = z.object({ name: z.literal('description'), content: z.string() });

/** The document title descriptor, which carries no `name` and no `property`. */
const TITLE_TAG = z.object({ title: z.string() });

/**
 * Every head tag this route serves, for a given mode.
 *
 * @param managed - the mode this route's loader reported, or `undefined` when
 *   the loader never ran.
 * @returns the descriptor list, undecoded.
 */
function landingMetaTags(managed: boolean | undefined): unknown[] {
  const loaderData = managed === undefined ? undefined : { ...LOADER_DATA, managed };
  // SAFETY: `Route.MetaArgs` also carries `params`, `location`, `error` and a
  // fully typed match union. `meta()` reads the root match's language and two
  // fields of its own loader data, which is exactly what this object supplies;
  // the cast is the harness admitting it is not the router.
  return [...meta({ matches: [{ id: 'root', loaderData: { language: 'en' } }], loaderData } as never)];
}

/**
 * The page's `<meta name="description">`, produced the way the router produces
 * it: the ROOT match carries the language, this route's own loader data
 * carries `managed`. That second channel is the whole point of the fix, since
 * `meta()` runs outside the React tree and has no `useInstancePolicy()`.
 *
 * @param managed - the mode this route's loader reported, or `undefined` for
 *   the error-boundary case where the loader never ran at all.
 */
function landingDescription(managed: boolean | undefined): string {
  for (const tag of landingMetaTags(managed)) {
    const parsed = DESCRIPTION_TAG.safeParse(tag);
    if (parsed.success) return parsed.data.content;
  }
  throw new Error('the landing page served no description tag at all');
}

/**
 * The `<title>` descriptor, found the same way and for the same reason.
 *
 * A title descriptor is `{ title }` and nothing else, so it is decoded with
 * its own schema rather than taken from position 0. `meta()` returns thirteen
 * tags here and three of them carry the title's text; only one of the three is
 * the document title.
 *
 * @param managed - the mode this route's loader reported, or `undefined` for
 *   the error-boundary case where the loader never ran at all.
 */
function landingTitle(managed: boolean | undefined): string {
  for (const tag of landingMetaTags(managed)) {
    const parsed = TITLE_TAG.safeParse(tag);
    if (parsed.success) return parsed.data.title;
  }
  throw new Error('the landing page served no title at all');
}

describe('the setup ladder on a managed instance', () => {
  it('does not offer to connect a provider the person cannot bring', () => {
    // The operator runs the AI here: no key is brought, no provider bills
    // anybody, and the whole paragraph plus its title was false on this page.
    assert.ok(!MANAGED.includes(enCommon.landing.setup.steps.connect.title), 'the BYOK step title survived');
    assert.ok(!MANAGED.includes(enCommon.landing.setup.steps.connect.body), 'the BYOK step body survived');
    assert.ok(!MANAGED.includes('your provider bills you'), 'the managed page still bills the person');
  });

  it('says instead that the instance provides the AI, with a daily limit', () => {
    assert.ok(MANAGED.includes(enCommon.landing.setup.steps.connectManaged.title), MANAGED.slice(0, 400));
    assert.ok(MANAGED.includes(enCommon.landing.setup.steps.connectManaged.body));
    // The two facts the managed step exists to state. Asserted as words rather
    // than only as the key, so a rewrite that drops the allowance and leaves a
    // pleasant sentence behind fails here.
    assert.match(enCommon.landing.setup.steps.connectManaged.body, /no key/i);
    assert.match(enCommon.landing.setup.steps.connectManaged.body, /each day/i);
  });

  it('promises no signup and carries no dash, like every managed label', () => {
    for (const [key, text] of Object.entries(enCommon.landing.setup.steps.connectManaged)) {
      assert.ok(!/sign ?up|create an account|register|free/i.test(text), `${key} promises a signup: ${text}`);
      assert.ok(!/[–—]/.test(text), `${key} carries a dash: ${text}`);
    }
  });
});

describe('the open instance keeps its BYOK step', () => {
  it('still connects a provider, in the words it always used', () => {
    assert.ok(OPEN.includes(enCommon.landing.setup.steps.connect.title), OPEN.slice(0, 400));
    assert.ok(OPEN.includes(enCommon.landing.setup.steps.connect.body));
  });

  it('borrows none of the managed step', () => {
    assert.ok(!OPEN.includes(enCommon.landing.setup.steps.connectManaged.title));
    assert.ok(!OPEN.includes(enCommon.landing.setup.steps.connectManaged.body));
  });
});

describe('the description a search engine quotes follows the policy', () => {
  it('does not tell a managed visitor there is no account', () => {
    // There is one, and the diary reaches the operator's server as ciphertext.
    // This is the string a link preview shows for beta.openplate.de.
    const description = landingDescription(true);
    assert.ok(!description.includes('no account'), description);
    assert.ok(!/\bfree\b/i.test(description), description);
    assert.ok(!description.includes('everything you log stays on your device'), description);
    assert.notEqual(description, enCommon.meta.landingDescription);
  });

  it('serves the managed description instead', () => {
    assert.equal(landingDescription(true), enCommon.meta.landingDescriptionManaged);
    assert.ok(!/[–—]/.test(enCommon.meta.landingDescriptionManaged));
  });

  it('serves the open description word for word on an open instance', () => {
    assert.equal(landingDescription(false), enCommon.meta.landingDescription);
  });

  it('falls open when the loader never ran', () => {
    // The error-boundary case: a page that cannot read its configuration
    // answers with the open policy, the same direction `getInstancePolicy` and
    // `readInstancePolicy` both take.
    assert.equal(landingDescription(undefined), enCommon.meta.landingDescription);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Where the diary lives: the title, the footer, and the trust card (M196/02)
////////////////////////////////////////////////////////////////////////////////

describe('the title a tab and a link preview show follows the policy', () => {
  it('does not tell a managed visitor the diary stays on their device', () => {
    // The open title ends "a food tracker that stays on your device". On a
    // managed instance the account keeps an encrypted copy on the operator's
    // server, so this is the claim, not the wording, that is wrong.
    const title = landingTitle(true);
    assert.ok(!title.includes('stays on your device'), title);
    assert.notEqual(title, enCommon.meta.landing);
  });

  it('serves the managed title instead', () => {
    assert.equal(landingTitle(true), enCommon.meta.landingManaged);
    assert.ok(!/[–—]/.test(enCommon.meta.landingManaged));
  });

  it('serves the open title word for word on an open instance', () => {
    assert.equal(landingTitle(false), enCommon.meta.landing);
  });

  it('falls open when the loader never ran', () => {
    // The error-boundary case, answered the way `getInstancePolicy` answers it.
    assert.equal(landingTitle(undefined), enCommon.meta.landing);
  });
});

/**
 * The part of the footer tagline that survives `<Trans>` as one run of text.
 *
 * The catalog entry is `{{appName}} by <lcc>lowcarbcheck.org</lcc>, a food
 * tracker …`, and `<Trans>` splits it around the anchor, so the whole string
 * is never contiguous in the markup. The TAIL after the closing tag is, and it
 * is the half that carries the claim about where the diary lives. Sliced out
 * of the catalog rather than typed here, so a rewrite of the sentence moves
 * this with it instead of failing for a stale copy.
 *
 * @param key - `footerTagline` or its managed twin.
 * @returns everything after the anchor, including the leading comma.
 */
function taglineTail(key: 'footerTagline' | 'footerTaglineManaged'): string {
  const line = enCommon.chrome[key];
  const anchorEnd = line.indexOf('</lcc>');
  assert.ok(anchorEnd !== -1, `${key} lost its <lcc> anchor, so this slice means nothing`);
  const tail = line.slice(anchorEnd + '</lcc>'.length);
  assert.ok(tail.trim().length > 0, `${key} says nothing after the anchor`);
  return tail;
}

describe('the footer tagline follows the policy on every public page', () => {
  it('promises a managed visitor only what is true there', () => {
    assert.ok(rendersCopy(MANAGED, taglineTail('footerTaglineManaged')), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, taglineTail('footerTagline')), 'the device-only tagline survived');
  });

  it('keeps the device-only tagline on an open instance, where it is true', () => {
    assert.ok(rendersCopy(OPEN, taglineTail('footerTagline')), OPEN.slice(0, 400));
    assert.ok(!rendersCopy(OPEN, taglineTail('footerTaglineManaged')), 'the managed tagline reached a self-host');
  });

  it('states two different things, so the pair cannot drift into one sentence', () => {
    // WITHOUT THIS the two assertions above pass on a "fix" that points both
    // keys at the same words: each page would render its own tail and neither
    // would render the other, because there would be nothing to tell apart.
    assert.notEqual(taglineTail('footerTagline'), taglineTail('footerTaglineManaged'));
    assert.match(taglineTail('footerTagline'), /stays on your device/);
    assert.ok(!/stays on your device/.test(taglineTail('footerTaglineManaged')));
  });
});

/** The trust card body each counting level renders, in each mode. */
interface NoTrackingBodies {
  /** The sentence where the diary stays on this device and nowhere else. */
  readonly open: string;
  /** The sentence where it is encrypted here before a copy reaches the server. */
  readonly managed: string;
}

/**
 * The three mode-dependent bodies of "No ads, no tracking", by level.
 *
 * The level-off body is deliberately absent: it claims only that nothing is
 * counted and nothing is sent about what you do, which is true in both modes,
 * so it has no managed twin to pin. `satisfies` keeps a fourth level failing
 * to compile here the same way it fails in the route.
 */
const NO_TRACKING_BODIES = {
  pageviews: {
    open: enCommon.landing.features.noTracking.bodyPageviews,
    managed: enCommon.landing.features.noTracking.bodyPageviewsManaged,
  },
  product: {
    open: enCommon.landing.features.noTracking.bodyAnalytics,
    managed: enCommon.landing.features.noTracking.bodyAnalyticsManaged,
  },
  research: {
    open: enCommon.landing.features.noTracking.bodyResearch,
    managed: enCommon.landing.features.noTracking.bodyResearchManaged,
  },
} satisfies Record<AnalyticsEventLevel, NoTrackingBodies>;

/** The managed page as each counting level renders it. */
const MANAGED_AT = {
  pageviews: renderLanding(true, 'pageviews'),
  product: renderLanding(true, 'product'),
  research: renderLanding(true, 'research'),
} satisfies Record<AnalyticsEventLevel, string>;

/** The open page as each counting level renders it. */
const OPEN_AT = {
  pageviews: renderLanding(false, 'pageviews'),
  product: renderLanding(false, 'product'),
  research: renderLanding(false, 'research'),
} satisfies Record<AnalyticsEventLevel, string>;

describe('the trust card names where the diary lives at every analytics level', () => {
  // THE BODIES NOBODY HAD EVER RENDERED. Every assertion in this file was
  // written against `analyticsLevel: null`, which is the one body of the four
  // that makes no claim about where the diary lives. The three that do were
  // invisible here, and all three said "your diary stays on this device".
  for (const level of ANALYTICS_LEVELS) {
    it(`says the managed sentence at the ${level} level`, () => {
      assert.ok(rendersCopy(MANAGED_AT[level], NO_TRACKING_BODIES[level].managed), MANAGED_AT[level].slice(0, 400));
      assert.ok(!rendersCopy(MANAGED_AT[level], NO_TRACKING_BODIES[level].open), `the ${level} device-only body survived`);
    });

    it(`keeps the device-only sentence at the ${level} level on an open instance`, () => {
      assert.ok(rendersCopy(OPEN_AT[level], NO_TRACKING_BODIES[level].open), OPEN_AT[level].slice(0, 400));
      assert.ok(!rendersCopy(OPEN_AT[level], NO_TRACKING_BODIES[level].managed), `the ${level} managed body reached a self-host`);
    });
  }

  it('leaves the level-off body alone, because it claims nothing about the device', () => {
    // Analytics off is the self-host default and the one body with no managed
    // twin. It is pinned as SHARED rather than left unmentioned, so a later
    // pass that branches it has to say why.
    for (const page of [MANAGED, OPEN]) {
      assert.ok(rendersCopy(page, enCommon.landing.features.noTracking.body), page.slice(0, 400));
    }
    assert.ok(!/this device|your device/i.test(enCommon.landing.features.noTracking.body));
  });
});

/**
 * The false claim that only exists at a counting level.
 *
 * It is kept out of `MANAGED_FALSE_CLAIMS` on purpose: that sweep's control
 * case asserts the OPEN page says every phrase, and the open page at
 * `analyticsLevel: null` does not say this one. Weakening the control to make
 * it fit would cost more than the entry is worth, so the phrase is swept over
 * the renders that can actually carry it.
 */
const MANAGED_FALSE_CLAIMS_AT_A_COUNTING_LEVEL = [
  { phrase: 'stays on this device', why: 'an encrypted copy reaches the server the operator runs, as a matter of course' },
];

describe('no counting level lets a managed page claim the device keeps the diary', () => {
  for (const { phrase, why } of MANAGED_FALSE_CLAIMS_AT_A_COUNTING_LEVEL) {
    for (const level of ANALYTICS_LEVELS) {
      it(`never says "${phrase}" at the ${level} level, because ${why}`, () => {
        assert.ok(!saysPhrase(MANAGED_AT[level], phrase), `"${phrase}" is on the managed page at ${level}`);
      });
    }
  }
});

describe('that ban is real, because the open page says it at every level', () => {
  // The same non-vacuity proof the sweep above carries: the phrase is the
  // product's actual promise where the diary belongs to the device, so its
  // presence here is what makes its absence opposite mean anything.
  for (const { phrase } of MANAGED_FALSE_CLAIMS_AT_A_COUNTING_LEVEL) {
    for (const level of ANALYTICS_LEVELS) {
      it(`still says "${phrase}" at the ${level} level`, () => {
        assert.ok(saysPhrase(OPEN_AT[level], phrase), `"${phrase}" left the open page, so the managed ban proves nothing`);
      });
    }
  }
});

describe('the hero paragraph says where the diary lives, and it is right twice', () => {
  // THE FIRST SENTENCE A VISITOR READS, and the third occurrence of one false
  // claim on one page. The title, this paragraph and the footer tagline all
  // promised the device and nothing else, which is why the sweep above matters
  // more than any of the three: naming one of them only ever fixes one.
  it('names the encrypted copy on a managed instance', () => {
    assert.ok(rendersCopy(MANAGED, enCommon.landing.hero.taglineManaged), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, enCommon.landing.hero.tagline), 'the device-only hero survived');
  });

  it('keeps the device-only hero on an open instance, where it is true', () => {
    assert.ok(rendersCopy(OPEN, enCommon.landing.hero.tagline), OPEN.slice(0, 400));
    assert.ok(!rendersCopy(OPEN, enCommon.landing.hero.taglineManaged), 'the managed hero reached a self-host');
  });

  it('states two different things, so the pair cannot drift into one sentence', () => {
    assert.notEqual(enCommon.landing.hero.tagline, enCommon.landing.hero.taglineManaged);
    assert.match(enCommon.landing.hero.tagline, /lives on your device/);
    assert.ok(!/lives on your device/.test(enCommon.landing.hero.taglineManaged));
  });
});

/**
 * The half of the managed card title the open title does not already contain.
 *
 * "The diary lives on this device" is a strict PREFIX of "The diary lives on
 * this device, and the server's copy is locked", so `!renders(open title)` on
 * the managed page can never fail: the managed page renders the open title as
 * part of its own. The TAIL after the shared opening is what actually tells
 * the two cards apart, and it is sliced out of the catalog rather than typed
 * here, so a rewrite of either string moves this with it.
 */
function localTitleTail(): string {
  const open = enCommon.landing.features.local.title;
  const managed = enCommon.landing.features.local.titleManaged;
  assert.ok(managed.startsWith(open), 'the managed title no longer opens with the open one, so this slice is wrong');
  const tail = managed.slice(open.length);
  assert.ok(tail.trim().length > 0, 'the two titles are the same words, so nothing tells the cards apart');
  return tail;
}

describe('the storage card describes the storage this instance actually has', () => {
  // THE STRONGEST FALSE CLAIM ON THE PAGE, and different in kind from the
  // other five this file pins. The hero and the footer tagline made a promise
  // that a managed instance cannot keep; this card asserts a fact about the
  // operator's machines, "it has no database at all", and `openplate-core`
  // runs a Postgres with the ciphertext diary in it. Worse, the sync card
  // three cards down the same grid discloses that copy and the operator's
  // recovery key, so before this branch a managed visitor read two opposite
  // facts about one server without scrolling.
  it('names the locked copy on a managed instance', () => {
    assert.ok(rendersCopy(MANAGED, enCommon.landing.features.local.titleManaged), MANAGED.slice(0, 400));
    assert.ok(rendersCopy(MANAGED, enCommon.landing.features.local.bodyManaged), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, enCommon.landing.features.local.body), 'the no-database body survived');
  });

  it('keeps the no-database card on an open instance, where it is true', () => {
    assert.ok(rendersCopy(OPEN, enCommon.landing.features.local.title), OPEN.slice(0, 400));
    assert.ok(rendersCopy(OPEN, enCommon.landing.features.local.body), OPEN.slice(0, 400));
    assert.ok(!rendersCopy(OPEN, localTitleTail()), 'the managed title reached a self-host');
    assert.ok(!rendersCopy(OPEN, enCommon.landing.features.local.bodyManaged), 'the managed body reached a self-host');
  });

  it('states two different things, so the pair cannot drift into one sentence', () => {
    // WITHOUT THIS the assertions above pass on a "fix" that points both body
    // keys at the same words. The claim being branched is named here by hand,
    // because it is the sentence that was false rather than the whole
    // paragraph that carried it.
    assert.notEqual(enCommon.landing.features.local.body, enCommon.landing.features.local.bodyManaged);
    assert.match(enCommon.landing.features.local.body, /no database at all/);
    assert.ok(!/no database at all/.test(enCommon.landing.features.local.bodyManaged));
    // And the managed body has to state the fact it exists to state, which is
    // three things at once: there IS a copy, it is encrypted, and the server
    // cannot open it. Asserted as meaning rather than as the sentence, because
    // the sentence has already been rewritten once: it arrived as two clauses
    // saying the same thing twice and was merged into one.
    const managed = enCommon.landing.features.local.bodyManaged;
    assert.match(managed, /\bserver\b/i);
    assert.match(managed, /encrypted/i);
    assert.match(managed, /cannot read it/i);
    assert.ok(!/keeps no copy/i.test(managed), 'the managed body denies the copy it exists to announce');
  });
});
