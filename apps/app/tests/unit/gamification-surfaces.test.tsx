/**
 * The three visible surfaces (M235/06): the streak card, the note and the
 * switch that turns both off.
 *
 * ── EVERY ABSENCE ASSERTION CARRIES ITS CONTROL ──────────────────────────
 *
 * "It renders nothing when hidden" passes trivially against a component that
 * renders nothing ever, which is the failure mode this repo keeps finding. So
 * the SAME render, with the SAME props apart from the switch, is run with the
 * flag off in the test right below it and must find the card. If the render
 * stops being able to produce a card at all, both halves fail at once.
 *
 * ── AND THE INVARIANT THAT IS NOT ABOUT RENDERING ────────────────────────
 *
 * Hiding these surfaces must not stop the RECORDING, or switching them back on
 * a month later would show a hole instead of a record. That claim cannot be
 * made by a render, so the last block drives the real recorder into a real
 * store whose profile has the switch on, and its control is the same walk with
 * the switch off, which must record exactly the same fact.
 *
 * The copy is read off the shipped English catalog rather than typed in, so a
 * renamed key fails here instead of shipping a raw `trends.streak.empty`.
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
import { ActivityStreakCard } from '../../app/components/gamification/activity-streak-card';
import { AwardsScreen, type EarnedAward } from '../../app/routes/awards';
import { isGamificationHidden, selectUnseenAward } from '../../app/lib/gamification/surfaces';
import { noteActivity } from '../../app/lib/gamification/record';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { listLocalActivityMarks, listLocalAwards, putLocalProfileGoals } from '../../app/lib/local-store/primary-store';
import type { LocalActivityMark, LocalAward, LocalProfileGoals, LocalStoreHandle } from '../../app/lib/local-store';

const copySchema = z.object({
  awards: z.object({ title: z.string() }),
  trends: z.object({ streak: z.object({ title: z.string(), empty: z.string() }) }),
});

const COPY = copySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);

/** A fixed instant and the UTC day it falls on, so the suite never depends on the runner's clock or zone. */
const NOW = 1_763_000_000_000;
const TODAY = '2025-11-13';

/** Three consecutive days of use, ending today: a streak the card has to be able to say out loud. */
const MARKS: LocalActivityMark[] = [
  { id: `${TODAY}#log.food`, dayKey: TODAY, signal: 'log.food' },
  { id: '2025-11-12#log.food', dayKey: '2025-11-12', signal: 'log.food' },
  { id: '2025-11-11#weight.log', dayKey: '2025-11-11', signal: 'weight.log' },
];

/** The streak card under a router (it is one link) and the real English catalog. */
function renderCard(hidden: boolean): string {
  const element = createElement(ActivityStreakCard, { marks: MARKS, today: TODAY, hidden });
  const router = createMemoryRouter([{ path: '/trends', element: withI18n(element) }], {
    initialEntries: ['/trends'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The awards screen for a device holding exactly these awards. */
function renderAwards(earned: EarnedAward[]): string {
  const element = createElement(AwardsScreen, { earned });
  const router = createMemoryRouter([{ path: '/awards', element: withI18n(element) }], {
    initialEntries: ['/awards'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** One earned, unacknowledged award. */
function unseen(key: string): LocalAward {
  return { key, earnedAt: NOW, earnedOnDay: TODAY, seenAt: null };
}

/** A profile whose only load-bearing fields are the zone and the switch. */
function profile(gamificationHidden: boolean): LocalProfileGoals {
  return {
    timezone: 'UTC',
    goalNetCarbsCeilingG: null,
    goalProteinFloorG: null,
    goalKcalTarget: null,
    targetWeightKg: null,
    trackingFocus: null,
    onboardingCompletedAt: null,
    updatedAt: NOW,
    gamificationHidden,
  };
}

/** A store carrying nothing but that profile. */
async function device(gamificationHidden: boolean): Promise<LocalStoreHandle> {
  const store = createPrimaryStore();
  await putLocalProfileGoals(profile(gamificationHidden), { store });
  return store;
}

describe('the streak card', () => {
  it('renders nothing when hidden', () => {
    assert.equal(renderCard(true), '');
  });

  it('control: the flag off renders the card', () => {
    // The same three marks, the same day, one boolean apart from the test
    // above. Without this, "nothing rendered" would pass against a card that
    // had stopped rendering for everybody.
    const markup = renderCard(false);
    assert.ok(markup.includes(COPY.trends.streak.title), 'the card lost its title');
    assert.ok(markup.includes('3 days in a row.'), `the streak number is missing: ${markup}`);
    assert.ok(markup.includes('href="/awards"'), 'the card is the only door to the record');
    assert.ok(markup.includes(COPY.awards.title), 'the door is not named');
  });

  it('says nothing about an ended streak, it simply reads lower', () => {
    // No loss language: a person whose last use was three days ago reads the
    // invitation, never an announcement that something ended.
    const stale = createElement(ActivityStreakCard, { marks: MARKS, today: '2025-11-20', hidden: false });
    const router = createMemoryRouter([{ path: '/trends', element: withI18n(stale) }], {
      initialEntries: ['/trends'],
    });
    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
    assert.ok(markup.includes(COPY.trends.streak.empty));
    assert.ok(!markup.includes('in a row'), 'a dead streak must not be announced');
  });
});

describe('the awards screen', () => {
  it('lists the catalog, marking what is held and what is not', () => {
    const markup = renderAwards([{ key: 'explorer.log.food', earnedOnDay: TODAY }]);
    assert.ok(markup.includes('First food'), 'the earned award is missing');
    assert.ok(markup.includes('You logged your first food.'), 'an earned award carries its note');
    assert.ok(markup.includes('Earned'), 'an earned award says when');
    // The control that makes the line above mean something: the same render
    // also draws an award this device does NOT hold, so "Earned" cannot be
    // coming from a screen that marks everything earned.
    assert.ok(markup.includes('First plate'), 'an unearned award is still listed');
    assert.ok(markup.includes('Not yet'), 'an unearned award says so');
  });

  it('renders no row for an award key this build does not know', () => {
    const markup = renderAwards([{ key: 'explorer.telepathy', earnedOnDay: TODAY }]);
    assert.ok(!markup.includes('telepathy'), 'an unknown key reached the screen');
    // ... and it is not an error either: the three sections are still there.
    assert.ok(markup.includes('First food'), 'the screen stopped rendering');
    assert.ok(!markup.includes('Earned'), 'nothing on this device is earned');
  });
});

describe('the award note', () => {
  it('has nothing to say while the surfaces are hidden', () => {
    assert.equal(selectUnseenAward({ awards: [unseen('explorer.log.food')], hidden: true }), null);
  });

  it('control: the same award with the flag off is the one to note', () => {
    const award = selectUnseenAward({ awards: [unseen('explorer.log.food')], hidden: false });
    assert.equal(award?.key, 'explorer.log.food');
  });

  it('skips an award key this build does not know, without failing', () => {
    const awards = [unseen('explorer.telepathy'), unseen('streak.active.7')];
    assert.equal(selectUnseenAward({ awards, hidden: false })?.key, 'streak.active.7');
  });

  it('says nothing about an award already acknowledged', () => {
    const seen: LocalAward = { key: 'streak.active.3', earnedAt: NOW, earnedOnDay: TODAY, seenAt: NOW };
    assert.equal(selectUnseenAward({ awards: [seen], hidden: false }), null);
  });
});

describe('the switch', () => {
  it('still records while hidden', async () => {
    const hiddenDevice = await device(true);
    assert.equal(isGamificationHidden(profile(true)), true, 'the fixture must actually be hidden');

    await noteActivity({ store: hiddenDevice, signal: 'log.food', now: NOW });

    assert.deepEqual(await listLocalActivityMarks({ store: hiddenDevice }), [
      { id: `${TODAY}#log.food`, dayKey: TODAY, signal: 'log.food' },
    ]);
    assert.deepEqual(
      (await listLocalAwards({ store: hiddenDevice })).map((award) => award.key),
      ['explorer.log.food'],
      'the award is earned while hidden, so switching back on shows a record and not a hole',
    );
  });

  it('control: the same walk with the switch off records the same fact', async () => {
    // The control for the test above. Without it, "it recorded while hidden"
    // would pass just as happily against a recorder that ignored the switch
    // because it had stopped working altogether.
    const shownDevice = await device(false);
    await noteActivity({ store: shownDevice, signal: 'log.food', now: NOW });

    assert.deepEqual(await listLocalActivityMarks({ store: shownDevice }), [
      { id: `${TODAY}#log.food`, dayKey: TODAY, signal: 'log.food' },
    ]);
  });
});
