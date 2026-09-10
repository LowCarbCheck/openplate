/**
 * The "Wie gestern" door (M217/02), rendered.
 *
 * ── What is worth proving here ───────────────────────────────────────────
 *
 * The door's whole contract is that it is a DOOR: it decides whether to appear
 * and it submits somebody else's intent. So this file pins three things and
 * nothing else: the visibility rule, where the submit goes, and that nothing
 * on the way carries a write of its own.
 *
 * ── Every absence assertion has a control ────────────────────────────────
 *
 * "The door is not there" passes trivially against a component that renders
 * nothing ever, which is the failure mode this repo keeps finding. So the
 * SAME predicate that reports the door absent for a null offer is run against
 * an eligible offer in the same test and must report it present. If the
 * predicate stops being able to see a door, both halves fail at once.
 *
 * The copy is read off the shipped English catalog rather than typed in, so a
 * renamed key fails here instead of shipping a raw `diary.copy.door`. The
 * German bytes are never asserted: those are wordsmith's to change.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import { RepeatYesterdayDoor } from '../../app/components/repeat-yesterday-door';
import { selectRepeatYesterday, type RepeatYesterdayOffer } from '../../app/lib/copy-day';

const doorCopySchema = z.object({
  diary: z.object({
    copy: z.object({
      door: z.string(),
      doorHint: z.string(),
      copying: z.string(),
    }),
  }),
});

const COPY = doorCopySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).diary.copy;

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../app/components/repeat-yesterday-door.tsx', import.meta.url)),
  'utf8',
);

const TODAY = '2026-09-10';
const YESTERDAY = '2026-09-09';

/** An eligible offer: yesterday has four entries, today has none. */
const ELIGIBLE: RepeatYesterdayOffer = {
  sourceDate: YESTERDAY,
  targetDate: TODAY,
  sourceCount: 4,
  targetCount: 0,
};

/** The door under a router (it posts through a fetcher) and the real English catalog. */
function renderDoor(offer: RepeatYesterdayOffer | null): string {
  const element = createElement(RepeatYesterdayDoor, { offer });
  const router = createMemoryRouter([{ path: '/dashboard', element: withI18n(element) }], {
    initialEntries: ['/dashboard'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * THE ONE PREDICATE both the presence and the absence cases run through: a
 * submit button carrying the door's own label. Not `markup.includes('Like
 * yesterday')`, which a heading elsewhere would satisfy, and not
 * `markup !== ''`, which would pass on any stray wrapper.
 */
function doorButtonTag(markup: string): string | null {
  const found = new RegExp(`<button[^>]*type="submit"[^>]*>[^<]*(?:<svg[\\s\\S]*?</svg>)?${COPY.door}</button>`).exec(
    markup,
  );
  if (found === null) return null;
  return /<button[^>]*>/.exec(found[0])?.[0] ?? null;
}

describe('the Wie gestern door decides whether to appear', () => {
  it('renders nothing at all for a null offer, and the same predicate finds it for an eligible one', () => {
    // The control first: if this half fails the absence half below proves nothing.
    assert.notEqual(doorButtonTag(renderDoor(ELIGIBLE)), null, 'the predicate cannot see a door that IS there');

    assert.equal(doorButtonTag(renderDoor(null)), null, 'a null offer still drew a door');
    assert.equal(renderDoor(null), '', 'a null offer left markup behind');
  });

  it('takes its answer from the selector, so the rule lives in one place', () => {
    const offered = selectRepeatYesterday({
      logs: [{ dayKey: YESTERDAY }, { dayKey: YESTERDAY }],
      today: TODAY,
      yesterday: YESTERDAY,
    });
    const withheld = selectRepeatYesterday({ logs: [{ dayKey: TODAY }], today: TODAY, yesterday: YESTERDAY });

    assert.notEqual(doorButtonTag(renderDoor(offered)), null);
    assert.equal(doorButtonTag(renderDoor(withheld)), null);
  });

  it("names the count of what it would copy, as the button's own description", () => {
    const markup = renderDoor(ELIGIBLE);
    const tag = doorButtonTag(markup);
    assert.ok(tag !== null);

    const describedBy = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    assert.ok(describedBy !== undefined, 'the button carries no accessible description');
    // The description is a real element on the page, and it is the hint.
    const hint = new RegExp(`<p id="${describedBy}"[^>]*>([\\s\\S]*?)</p>`).exec(markup)?.[1];
    assert.ok(hint !== undefined, 'aria-describedby points at nothing');
    assert.ok(hint.includes('4'), 'the hint does not say how many entries would be copied');
  });

  it('is a live button at rest, not a disabled one', () => {
    // The standing trap: `markup.includes('disabled')` matches the
    // `disabled:opacity-60` utility class this button carries. The attribute is
    // read inside the button tag, and only as an attribute.
    const tag = doorButtonTag(renderDoor(ELIGIBLE));
    assert.ok(tag !== null);
    assert.doesNotMatch(tag, /\sdisabled(=""|\s|>)/, 'the door opens disabled');
    // The control for that regex: the class it must NOT be fooled by is present.
    assert.match(tag, /disabled:opacity-60/);
  });
});

describe("the door submits somebody else's copy intent", () => {
  it('posts the existing copy-yesterday intent to the diary action, for the whole day', () => {
    const markup = renderDoor(ELIGIBLE);

    assert.match(markup, /<form[^>]*action="\/diary"/, 'the door no longer posts to the diary');
    assert.match(markup, /<form[^>]*method="post"/);
    assert.match(markup, /<input type="hidden" name="_intent" value="copy-yesterday"\/>/);
    assert.match(markup, new RegExp(`<input type="hidden" name="date" value="${TODAY}"/>`));
    // No meal field: its ABSENCE is what makes the copy the whole day.
    assert.doesNotMatch(markup, /name="mealType"/, 'the door narrowed itself to one meal');
    // Reading 3 stays a non-goal: no source day is ever submitted.
    assert.doesNotMatch(markup, /name="sourceDate"/);
  });

  it('writes nothing itself, so there is still one copy mechanism', () => {
    for (const forbidden of ['putLocalFoodLog', 'randomUuid', 'trackFoodLogged', 'deleteLocalFoodLog']) {
      assert.ok(!SOURCE.includes(forbidden), `the door started doing the copy itself (${forbidden})`);
    }
    // And it does not clone the toast: that lives in the shared hook.
    assert.ok(!SOURCE.includes("verb: 'copied'"), 'the door cloned the copy toast');
    assert.ok(SOURCE.includes('useCopyYesterdayToast'), 'the door stopped using the shared toast hook');
  });
});
