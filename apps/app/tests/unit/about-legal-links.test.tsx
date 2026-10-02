/**
 * THE LEGAL GROUP ON THE ABOUT SCREEN.
 *
 * The public footer draws the five legal links, but a person who is signed in
 * lives inside `_personal`, which has no footer, so the imprint had no door for
 * them (owner, 2026-10-02). `/settings/about` now draws the same five links in
 * a group of its own, behind the same gate as the footer: `useHasLegalPages`,
 * which reads `hasLegalPages` off the ROOT loader.
 *
 * ── HOW IT RENDERS ───────────────────────────────────────────────────────
 *
 * The real default export, under a memory data router whose root route carries
 * the loader data the hook reads (the shape `settings-hub.test.ts` uses). The
 * hook is not mocked: a mock of it would pass against a page that never called
 * it. The visible words are the shipped English catalog's, read by key, so a
 * renamed key fails here instead of printing a raw `chrome.imprint`.
 *
 * ── EVERY ABSENCE HAS A PRESENCE BESIDE IT ───────────────────────────────
 *
 * "None of the five links is drawn" passes on a render that printed nothing at
 * all. The off case therefore also asserts the provenance rows the page always
 * has, and the on case is the control for the heading and every href.
 *
 * ── THE LANDMARK IS A ROW EVERY RENDER DRAWS ─────────────────────────────
 *
 * The release notes row is behind the What's new switch (`useWhatsNewVisible`),
 * and this harness can never show it: `renderToStaticMarkup` reads only the
 * server snapshots, an unset preference and a signed-out session, which resolve
 * to hidden. So the last provenance row a render always draws is the source
 * code row, `href` exactly `REPO_URL`, and the order and the control read that.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import type { PublicConfig } from '../../app/config/public-config';
import { REPO_URL } from '../../app/lib/brand';
import SettingsAbout from '../../app/routes/settings.about';
import enCommon from '../../app/i18n/locales/en/common.json';
import { withI18n } from './trends-i18n-harness';

const CONFIG: PublicConfig = {
  coreUrl: null,
  syncServerUrl: null,
  instancePreset: null,
  analytics: null,
  managed: false,
  foodDbBackfill: false,
};

/** The five links in the footer's order, each with the catalog line the footer words it with. */
const LEGAL_LINKS = [
  { href: '/privacy', text: enCommon.chrome.privacy },
  { href: '/terms', text: enCommon.chrome.terms },
  { href: '/imprint', text: enCommon.chrome.imprint },
  { href: '/kuendigung', text: enCommon.chrome.cancelContract },
  { href: '/widerrufen', text: enCommon.chrome.withdrawContract },
] as const;

/** The About screen, under a root route whose loader data says whether the mounted folder has legal pages. */
function renderAbout(hasLegalPages: boolean): string {
  const loaderData = { publicConfig: CONFIG, hasLegalPages };
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => loaderData,
        children: [{ index: true, element: withI18n(createElement(SettingsAbout)) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: loaderData } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The source code row, the last provenance row a server render always draws. */
const SOURCE_ROW = `href="${REPO_URL}"`;

/** The release notes row, drawn only when the What's new switch resolves to shown. */
const RELEASE_NOTES_ROW = 'href="/settings/whats-new"';

/** The text of the `<a>` whose href is `href`, or null when there is no such anchor. */
function anchorText(markup: string, href: string): string | null {
  const found = new RegExp(`<a\\b[^>]*\\bhref="${href}"[^>]*>([\\s\\S]*?)</a>`).exec(markup);
  if (found === null) return null;
  return (found[1] ?? '')
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('the About screen on an instance whose content folder holds the legal pages', () => {
  const markup = renderAbout(true);

  it('draws the group heading from the catalog', () => {
    assert.ok(markup.includes(`>${enCommon.settings.about.legalHeading}<`), 'the Legal heading is missing');
  });

  for (const { href, text } of LEGAL_LINKS) {
    it(`links ${href} with the footer's own words`, () => {
      assert.equal(anchorText(markup, href)?.includes(text), true, `${href} is missing or says something else`);
    });
  }

  it('draws the five links in the footer order', () => {
    const positions = LEGAL_LINKS.map(({ href }) => markup.indexOf(`href="${href}"`));
    assert.ok(
      positions.every((at) => at > 0),
      `a link is missing, positions ${positions.join(', ')}`,
    );
    assert.deepEqual(
      positions,
      positions.toSorted((a, b) => a - b),
    );
  });

  it('puts the group under the provenance rows and above the Updates card', () => {
    const lastProvenanceRow = markup.indexOf(SOURCE_ROW);
    const heading = markup.indexOf(`>${enCommon.settings.about.legalHeading}<`);
    const updates = markup.indexOf(`>${enCommon.about.updates.title}<`);
    assert.ok(lastProvenanceRow > 0 && heading > 0 && updates > 0, 'a landmark is missing from the markup');
    assert.ok(lastProvenanceRow < heading, 'the group must come after the provenance rows');
    assert.ok(heading < updates, 'the group must come before the Updates card, which grows after a network read');
  });

  it('gives every row a target of 44 px or more and no rounded corner', () => {
    const classLists = LEGAL_LINKS.map(({ href }) => {
      const found = new RegExp(`<a\\b[^>]*\\bclass="([^"]*)"[^>]*\\bhref="${href}"`).exec(markup);
      return (found?.[1] ?? '').split(/\s+/);
    });
    for (const tokens of classLists) {
      assert.ok(tokens.includes('min-h-13'), `a legal row has no 52 px floor: ${tokens.join(' ')}`);
      assert.equal(
        tokens.some((token) => /(?:^|:)rounded/.test(token)),
        false,
        'a legal row wears a radius',
      );
    }
  });
});

describe('the About screen on an instance with no content folder', () => {
  const markup = renderAbout(false);

  it('draws none of the five links', () => {
    for (const { href } of LEGAL_LINKS) {
      assert.equal(anchorText(markup, href), null, `${href} is drawn with no legal pages`);
    }
  });

  it('draws no Legal heading', () => {
    assert.equal(markup.includes(`>${enCommon.settings.about.legalHeading}<`), false);
  });

  it('CONTROL: the same render still draws the provenance rows and the Updates card, so the absence above is not an empty page', () => {
    assert.ok(markup.includes(SOURCE_ROW), 'the source code row is missing');
    assert.ok(markup.includes(`>${enCommon.about.title}<`), 'the About section heading is missing');
    assert.ok(markup.includes(`>${enCommon.about.updates.title}<`), 'the Updates card heading is missing');
  });
});

describe('the release notes row in a server render', () => {
  const markup = renderAbout(true);

  it("is hidden, because the What's new switch resolves an unset choice and no account to hidden", () => {
    assert.equal(markup.includes(RELEASE_NOTES_ROW), false, 'the release notes row is drawn with the switch unset');
  });

  it('CONTROL: the same render draws the source code row, so the absence above is not an empty page', () => {
    assert.ok(markup.includes(SOURCE_ROW), 'the source code row is missing');
  });
});

describe('the helpers that read the markup', () => {
  it('CONTROL: anchorText finds a link that is there and reports null for one that is not', () => {
    const sample = '<a class="x" href="/imprint"><span>Imprint</span></a>';
    assert.equal(anchorText(sample, '/imprint'), 'Imprint');
    assert.equal(anchorText(sample, '/terms'), null);
  });

  it('CONTROL: the on and off renders differ only by the group, so the assertions can fail', () => {
    assert.notEqual(renderAbout(true), renderAbout(false));
  });
});
