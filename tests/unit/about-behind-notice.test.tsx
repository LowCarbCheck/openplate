/**
 * WHAT THE ABOUT SCREEN SAYS WHEN THIS SERVER IS BEHIND, AND TO WHOM.
 *
 * The owner ran the hosted instance on 0.34.1 while 0.35.1 existed and found
 * the screen unclear. It showed one muted line about images and a small link,
 * and a person on a hosted instance cannot change anything about the server.
 * The screen now states the fact in words, names both versions, and then says
 * the one sentence that fits the reader: how to update, or that there is
 * nothing to do.
 *
 * ── HOW IT RENDERS ───────────────────────────────────────────────────────
 *
 * `UpdatesCardView` takes the update state and the policy answer as PROPS
 * (`renderToStaticMarkup` runs no effect and there is no data router here, so
 * a hook read could only ever show the first, empty state). The container that
 * does read the hooks is two lines, and its wiring is pinned by reading the
 * source at the bottom, with a control.
 *
 * The version numbers and the block's structure are asserted, not whole
 * English sentences, because a translation rewords a sentence and cannot
 * reword `0.35.1`. The two English variants are told apart by one phrase each.
 *
 * ── EVERY NEGATIVE HAS A POSITIVE BESIDE IT ──────────────────────────────
 *
 * "The managed screen does not say to pull an image" passes on a render that
 * printed nothing at all. Each absence below is paired with the presence that
 * proves the same helper rendered the card.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';

import { getInstancePolicy } from '../../app/config/instance-policy';
import type { PublicConfig } from '../../app/config/public-config';
import type { UpdateStatus } from '../../app/lib/update-status';
import { UpdatesCardView, type UpdatesCardState } from '../../app/routes/settings.about';
import enCommon from '../../app/i18n/locales/en/common.json';
import { withI18n } from './trends-i18n-harness';

/** A server that answered: checks on, running 0.34.1, and 0.35.1 has been published. */
const BEHIND = {
  enabled: true,
  currentVersion: '0.34.1',
  sha: 'abc1234',
  builtAt: '2026-09-01T10:00:00.000Z',
  latest: '0.35.1',
  releaseUrl: 'https://github.com/LowCarbCheck/openplate/releases/tag/v0.35.1',
  checkedAt: '2026-09-20T08:00:00.000Z',
  updateAvailable: true,
  throttled: false,
  nextCheckAllowedAt: null,
} satisfies UpdateStatus;

/** The same server once the project has published nothing newer than what it runs. */
const CURRENT = { ...BEHIND, currentVersion: '0.35.1', updateAvailable: false } satisfies UpdateStatus;

/** What `/api/update-status` answers when the operator set `UPDATE_CHECK=off`: nothing was ever asked. */
const DISABLED = {
  ...BEHIND,
  enabled: false,
  latest: null,
  releaseUrl: null,
  checkedAt: null,
  updateAvailable: false,
} satisfies UpdateStatus;

/** A disabled server that still carries a cached, newer looking answer, to prove the guard is what hides it. */
const DISABLED_WITH_STALE_ANSWER = { ...BEHIND, enabled: false } satisfies UpdateStatus;

const OPEN_CONFIG = {
  syncServerUrl: null,
  instancePreset: null,
  analytics: null,
  managed: false,
} satisfies PublicConfig;

const MANAGED_CONFIG = { ...OPEN_CONFIG, managed: true } satisfies PublicConfig;

function noop(): void {
  // The card's two buttons; no assertion here presses one.
}

/** The hook's answer for one server response, or for none yet. */
function stateFor(status: UpdateStatus | null): UpdatesCardState {
  return {
    status: { status, isChecking: false, bundleStale: false, dismissedVersion: null },
    ribbon: 'none',
    checkNow: noop,
    updateNow: noop,
  };
}

/** The card as the server would print it. The policy answer comes from the REAL policy for the config. */
function renderCard({ status, config }: { status: UpdateStatus | null; config: PublicConfig }): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(UpdatesCardView, {
        state: stateFor(status),
        updatesAreSomeoneElsesJob: getInstancePolicy(config).updatesAreSomeoneElsesJob,
      }),
    ),
  );
}

/** One status element (`behind` is a block of paragraphs, `current` is one paragraph), or null. */
function statusElement(markup: string, kind: 'behind' | 'current'): string | null {
  const found = new RegExp(`<(div|p) data-release-status="${kind}"[^>]*>[\\s\\S]*?</\\1>`).exec(markup);
  return found === null ? null : found[0];
}

/** The one phrase that tells the two English variants apart. */
const NOTHING_TO_DO = 'nothing for you to do';
const PULL_THE_IMAGE = 'pull the new image';

describe('a server behind the newest release, on a managed instance', () => {
  const markup = renderCard({ status: BEHIND, config: MANAGED_CONFIG });
  const block = statusElement(markup, 'behind');

  it('states that a newer release exists, in a block of its own', () => {
    assert.notEqual(block, null, 'no behind block was rendered');
    assert.ok(block?.includes(enCommon.about.updates.behindTitle));
  });

  it('names both versions, the one it runs and the newest', () => {
    assert.ok(block?.includes('v0.34.1'), 'the running version is missing');
    assert.ok(block?.includes('v0.35.1'), 'the newest version is missing');
  });

  it('says there is nothing for the reader to do, and does not say to pull an image', () => {
    assert.ok(block?.includes(NOTHING_TO_DO));
    assert.equal(block?.includes(PULL_THE_IMAGE), false);
  });
});

describe('a server behind the newest release, on a self-hosted instance', () => {
  const markup = renderCard({ status: BEHIND, config: OPEN_CONFIG });
  const block = statusElement(markup, 'behind');

  it('names both versions, exactly as a managed instance does', () => {
    assert.notEqual(block, null, 'no behind block was rendered');
    assert.ok(block?.includes('v0.34.1'));
    assert.ok(block?.includes('v0.35.1'));
  });

  it('says how to update, and does not say there is nothing to do', () => {
    assert.ok(block?.includes(PULL_THE_IMAGE));
    assert.equal(block?.includes(NOTHING_TO_DO), false);
  });
});

describe('a server on the newest release', () => {
  for (const [label, config] of [
    ['managed', MANAGED_CONFIG],
    ['self-hosted', OPEN_CONFIG],
  ] as const) {
    it(`says it is up to date, and nothing about being behind, on a ${label} instance`, () => {
      const markup = renderCard({ status: CURRENT, config });
      const current = statusElement(markup, 'current');
      assert.ok(current?.includes(enCommon.about.updates.upToDate), 'the up to date line is missing');
      assert.equal(statusElement(markup, 'behind'), null);
      assert.equal(markup.includes(enCommon.about.updates.behindTitle), false);
      assert.equal(markup.includes(NOTHING_TO_DO), false);
      assert.equal(markup.includes(PULL_THE_IMAGE), false);
    });
  }

  it('the control: the same helper, one release behind, prints the behind block and not the up to date line', () => {
    const markup = renderCard({ status: BEHIND, config: OPEN_CONFIG });
    assert.notEqual(statusElement(markup, 'behind'), null);
    assert.equal(statusElement(markup, 'current'), null);
    assert.equal(markup.includes(enCommon.about.updates.upToDate), false);
  });
});

describe('a server whose checks are off, or that never answered', () => {
  it('shows the disabled hint and no status of either kind', () => {
    const markup = renderCard({ status: DISABLED, config: MANAGED_CONFIG });
    assert.ok(markup.includes(enCommon.about.updates.disabledHint));
    assert.ok(markup.includes(enCommon.about.updates.disabled));
    assert.equal(markup.includes('data-release-status'), false);
  });

  it('keeps a cached newer answer out of the card once checks are off', () => {
    const markup = renderCard({ status: DISABLED_WITH_STALE_ANSWER, config: OPEN_CONFIG });
    assert.ok(markup.includes(enCommon.about.updates.disabledHint));
    assert.equal(markup.includes('data-release-status'), false);
    assert.equal(markup.includes(PULL_THE_IMAGE), false);
  });

  it('shows no status before the first answer, and the rows the card always had', () => {
    const markup = renderCard({ status: null, config: OPEN_CONFIG });
    assert.equal(markup.includes('data-release-status'), false);
    assert.ok(markup.includes(enCommon.about.updates.running));
    assert.ok(markup.includes(enCommon.about.updates.never));
    assert.equal(markup.includes(enCommon.about.updates.disabledHint), false);
  });

  it('shows no status when checks are on but no release is known', () => {
    const markup = renderCard({
      status: { ...CURRENT, latest: null, releaseUrl: null, checkedAt: null },
      config: OPEN_CONFIG,
    });
    assert.equal(markup.includes('data-release-status'), false);
  });

  it('the control: the same helper with checks on and a release known does print a status', () => {
    assert.ok(renderCard({ status: DISABLED_WITH_STALE_ANSWER, config: OPEN_CONFIG }).length > 0);
    assert.ok(renderCard({ status: { ...DISABLED_WITH_STALE_ANSWER, enabled: true }, config: OPEN_CONFIG }).includes('data-release-status'));
  });
});

/** Classes that would make a newer release read as an alarm. */
const ALARM = /\b(?:text|bg|border|ring|fill|stroke)-(?:red|amber|yellow|orange|rose|destructive)|\bborder-l(?:-|\b)/;

describe('the behind block is calm and readable', () => {
  const markup = renderCard({ status: BEHIND, config: MANAGED_CONFIG });
  const block = statusElement(markup, 'behind') ?? '';

  it('wears no warning colour, no thick left border and no icon', () => {
    assert.equal(ALARM.test(block), false);
    assert.equal(block.includes('<svg'), false);
  });

  it('the control: the alarm pattern does flag a red class and a left border', () => {
    assert.equal(ALARM.test('<div class="bg-red-100 text-red-700">'), true);
    assert.equal(ALARM.test('<div class="border-l-4 border-amber-500">'), true);
    assert.equal(ALARM.test('<div class="rounded-xl bg-muted/50 px-3 py-3">'), false);
  });

  it('keeps every line at 14 px or larger', () => {
    const sizes = [...block.matchAll(/class="([^"]*)"/g)].flatMap((found) => found[1].split(/\s+/));
    assert.equal(
      sizes.some((name) => name === 'text-xs' || /^text-\[(?:[0-9]|1[0-3])px\]$/.test(name)),
      false,
    );
    assert.ok(sizes.includes('text-sm'));
  });

  it('is the first thing in the card body, above the rows', () => {
    const at = markup.indexOf('data-release-status="behind"');
    const firstRow = markup.indexOf(`>${enCommon.about.updates.running}<`);
    assert.ok(at > 0 && firstRow > 0, 'both the block and the first row must be in the markup');
    assert.ok(at < firstRow);
  });

  it('sits in a container that spaces its children 12 px or more apart', () => {
    const container = /<div [^>]*class="[^"]*\bspace-y-(\d+)\b[^"]*"[^>]*>\s*<div data-release-status="behind"/.exec(markup);
    assert.notEqual(container, null, 'the block must be a direct child of the section content');
    // Tailwind spacing is a quarter rem step: 3 is 12 px.
    assert.ok(Number(container?.[1]) >= 3, `space-y-${container?.[1]} is under 12 px`);
  });

  it('wraps long words, so German and Turkish cannot push the card wider than the phone', () => {
    const paragraphs = [...block.matchAll(/<p class="([^"]*)">/g)].map((found) => found[1]);
    const wrapping = paragraphs.filter((classes) => classes.split(/\s+/).includes('break-words'));
    assert.equal(wrapping.length, 2, 'both prose lines must carry break-words');
  });
});

/** The route module as text, for the two facts a render cannot reach: the container's hook reads. */
function readRouteSource(): string {
  return readFileSync(fileURLToPath(new URL('../../app/routes/settings.about.tsx', import.meta.url)), 'utf8');
}

/**
 * The container asks the policy QUESTION and hands the answer to the view, and
 * the view chooses the managed twin by it. Same shape as `assertChosenByPolicy`
 * in `managed-instance-copy.test.ts`, but returns a boolean so the control can
 * run it against a mutated source.
 */
function isWiredThroughThePolicy(source: string): boolean {
  const asksTheQuestion = /const \{ updatesAreSomeoneElsesJob \} = useInstancePolicy\(\);/.test(source);
  const handsItOver = /<UpdatesCardView state=\{state\} updatesAreSomeoneElsesJob=\{updatesAreSomeoneElsesJob\} \/>/.test(source);
  // The lookbehind keeps `!updatesAreSomeoneElsesJob ? ...` (an inverted branch) from matching.
  const choosesTheTwin = /(?<![!\w])updatesAreSomeoneElsesJob \? t\('about\.updates\.behindWhoManaged'\) : t\('about\.updates\.behindWho'\)/.test(source);
  return asksTheQuestion && handsItOver && choosesTheTwin;
}

describe('the container that reads the hooks', () => {
  it('asks the instance policy question and passes the answer to the view', () => {
    assert.equal(isWiredThroughThePolicy(readRouteSource()), true);
  });

  it('the control: a container that dropped the question, or inverted it, fails the same check', () => {
    const source = readRouteSource();
    assert.equal(isWiredThroughThePolicy(source.replace('const { updatesAreSomeoneElsesJob } = useInstancePolicy();', 'const updatesAreSomeoneElsesJob = false;')), false);
    assert.equal(isWiredThroughThePolicy(source.replace("updatesAreSomeoneElsesJob ? t('about.updates.behindWhoManaged')", "!updatesAreSomeoneElsesJob ? t('about.updates.behindWhoManaged')")), false);
  });
});

/** Only the branch this file reads. Parsed, so a non-string leaf fails loudly instead of being skipped. */
const updatesCatalog = z.object({ about: z.object({ updates: z.record(z.string(), z.string()) }) });

describe('the new copy in every language', () => {
  const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'tr'] as const;
  const KEYS = ['behindTitle', 'behindVersions', 'behindWho', 'behindWhoManaged', 'upToDate'] as const;

  for (const locale of LOCALES) {
    it(`${locale} carries every key, both placeholders and no dash`, () => {
      const catalog = updatesCatalog.parse(
        JSON.parse(
          readFileSync(fileURLToPath(new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url)), 'utf8'),
        ),
      );
      for (const key of KEYS) {
        const text = catalog.about.updates[key];
        assert.ok(text !== undefined && text.length > 0, `${locale} about.updates.${key} is missing`);
        assert.equal(/[\u2013\u2014]/.test(text), false, `${locale} about.updates.${key} carries a dash`);
      }
      const versions = catalog.about.updates.behindVersions ?? '';
      assert.ok(versions.includes('{{running}}'), `${locale} lost {{running}}`);
      assert.ok(versions.includes('{{latest}}'), `${locale} lost {{latest}}`);
      assert.equal(catalog.about.updates.selfHostHint, undefined, `${locale} still carries the replaced selfHostHint`);
    });
  }
});
