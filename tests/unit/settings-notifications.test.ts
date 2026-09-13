/**
 * The Notifications settings page and its hub row (M223 spec 04).
 *
 * The page's job is to never lie about what will arrive, so the assertions are
 * about SENTENCES: each of the five availability states renders its own, and
 * the hub row names the kinds that are actually on. Every expected string is
 * resolved out of the SHIPPED English catalog, so a renamed key fails here
 * instead of rendering `settings.notifications.state.blocked` at a person.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Each state's assertion also checks that the OTHER four sentences are absent,
 * because a page that rendered all five would pass a test that only looked for
 * one. The hub row's control is the "both kinds off" case, which reads as off,
 * since that is the truth about what would arrive.
 *
 * ── The mutation that proves these can fail ──────────────────────────────
 *
 * Pointing two entries of `AVAILABILITY_KEYS` at the same key fails the
 * absence half of the state tests while the presence half stays green.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import i18next from '../../app/i18n/i18n';
import enCommon from '../../app/i18n/locales/en/common.json';
import deCommon from '../../app/i18n/locales/de/common.json';
import { withI18n } from './trends-i18n-harness';
import {
  availabilityAfterFailure,
  AvailabilityNotice,
  notificationsRowStatus,
  parseTimeInput,
  REASON_KEYS,
  reasonKey,
} from '../../app/routes/settings.notifications';
import { DEFAULT_PUSH_PREFS } from '../../app/lib/push';
import type { PushAvailability, PushBlockedReason } from '../../app/lib/push';

/** The REAL catalog: every sentence below is resolved, not transcribed. */
const t = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) =>
  i18next.t(key, params ?? {});

/** The five states, each with the sentence the shipped catalog gives it. */
const SENTENCES = {
  unsupported: enCommon.settings.notifications.state.unsupported,
  'needs-install': enCommon.settings.notifications.state.needsInstall,
  blocked: enCommon.settings.notifications.state.blocked,
  'server-off': enCommon.settings.notifications.state.serverOff,
  ready: enCommon.settings.notifications.state.ready,
} satisfies Record<PushAvailability, string>;

/** The notice for one state, with no install controls: the four states that need none. */
function renderNotice(availability: PushAvailability): string {
  return renderToStaticMarkup(withI18n(createElement(AvailabilityNotice, { availability, install: null })));
}

describe('the availability notice', () => {
  // Written out rather than read off `SENTENCES`, so a state added to the
  // union without a sentence fails to compile here.
  const states: readonly PushAvailability[] = ['unsupported', 'needs-install', 'blocked', 'server-off', 'ready'];

  for (const availability of states) {
    const sentence = SENTENCES[availability];
    it(`says one thing, and only one thing, for ${availability}`, () => {
      const markup = renderNotice(availability);
      assert.ok(markup.includes(sentence), markup);
      // THE CONTROL: the other four sentences are not on the page, so this is
      // an assertion about one state rather than about a page that says
      // everything.
      for (const other of states) {
        if (other === availability) continue;
        assert.equal(markup.includes(SENTENCES[other]), false, `${availability} also said ${other}`);
      }
    });
  }

  it('offers the install affordance only on the iPhone state', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        createElement(AvailabilityNotice, {
          availability: 'needs-install',
          install: { affordance: 'ios-instructions', promptInstall: async () => {} },
        }),
      ),
    );
    // The affordance is asserted by its own icon rather than by its words:
    // the iOS instructions travel through `<Trans>` with two emphasised
    // fragments spliced in, so the catalog string never appears verbatim, and
    // the wording belongs to wordsmith rather than to this test.
    assert.ok(markup.includes('lucide-share'), markup);
  });

  it('the control: the same controls on a ready page draw no install step', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        createElement(AvailabilityNotice, {
          availability: 'ready',
          install: { affordance: 'ios-instructions', promptInstall: async () => {} },
        }),
      ),
    );
    assert.equal(markup.includes('lucide-share'), false, markup);
  });
});

describe('the settings hub row', () => {
  it('says nothing while the device read is in flight', () => {
    assert.equal(notificationsRowStatus({ enabled: undefined, prefs: DEFAULT_PUSH_PREFS, t }), null);
  });

  it('reads off for a device that never registered', () => {
    assert.equal(
      notificationsRowStatus({ enabled: false, prefs: DEFAULT_PUSH_PREFS, t }),
      enCommon.settings.hub.notifications.off,
    );
  });

  it('names both kinds and the hour when both are on', () => {
    const status = notificationsRowStatus({ enabled: true, prefs: DEFAULT_PUSH_PREFS, t });
    assert.equal(status, t('settings.hub.notifications.both', { time: '08:00' }));
    // The catalog really does put the hour in the sentence, so the line above
    // is not comparing two copies of an unresolved key.
    assert.ok(status?.includes('08:00'));
  });

  it('names the catch-up alone, at the hour the person picked', () => {
    const status = notificationsRowStatus({
      enabled: true,
      prefs: { catchUpMinute: 390, fastTargetEnabled: false },
      t,
    });
    assert.equal(status, t('settings.hub.notifications.catchUp', { time: '06:30' }));
  });

  it('names the fast target alone', () => {
    assert.equal(
      notificationsRowStatus({ enabled: true, prefs: { catchUpMinute: null, fastTargetEnabled: true }, t }),
      enCommon.settings.hub.notifications.fastTarget,
    );
  });

  it('the control: push on with both kinds unticked reads as off, because nothing would arrive', () => {
    assert.equal(
      notificationsRowStatus({ enabled: true, prefs: { catchUpMinute: null, fastTargetEnabled: false }, t }),
      enCommon.settings.hub.notifications.off,
    );
  });
});

describe('the time field', () => {
  it('reads a wall clock as minutes after midnight', () => {
    assert.equal(parseTimeInput('08:00'), 480);
    assert.equal(parseTimeInput('00:00'), 0);
    assert.equal(parseTimeInput('23:59'), 1439);
  });

  it('refuses anything that is not a time, rather than rounding it into one', () => {
    assert.equal(parseTimeInput(''), null);
    assert.equal(parseTimeInput('half eight'), null);
    assert.equal(parseTimeInput('24:00'), null);
  });
});

//////////////////////////////////////////////////////////////////////////////
// Every reason an attempt can give up
//////////////////////////////////////////////////////////////////////////////

/** Where every reason's sentence lives, so a key outside it reads as missing. */
const STATE_PREFIX = 'settings.notifications.state.';

/**
 * One state sentence out of a catalog, by the key the page publishes.
 *
 * Reads the catalog JSON rather than asking i18next, so a German key that was
 * never added reads as missing instead of falling back to the English one.
 *
 * @param state - one catalog's `settings.notifications.state` record.
 * @param key - the dotted key the page publishes.
 * @returns the sentence, or null when the catalog has none.
 */
function lookupSentence(state: Record<string, string>, key: string): string | null {
  if (!key.startsWith(STATE_PREFIX)) return null;
  return state[key.slice(STATE_PREFIX.length)] ?? null;
}

describe('the reason sentences', () => {
  // Written out rather than read off `REASON_KEYS`, so a reason added to the
  // union without a sentence fails to compile here.
  const reasons: readonly PushBlockedReason[] = [
    'unsupported',
    'needs-install',
    'blocked',
    'server-off',
    'dismissed',
    'signed-out',
  ];

  for (const reason of reasons) {
    it(`gives ${reason} a sentence in both catalogs`, () => {
      const key = REASON_KEYS[reason];
      for (const [language, state] of [
        ['en', enCommon.settings.notifications.state],
        ['de', deCommon.settings.notifications.state],
      ] as const) {
        const sentence = lookupSentence(state, key);
        assert.ok(sentence !== null && sentence.length > 0, `${language} has no sentence for ${key}`);
      }
    });
  }

  it('THE CONTROL: a key the catalogs do not carry resolves to nothing', () => {
    assert.equal(lookupSentence(enCommon.settings.notifications.state, `${STATE_PREFIX}notAKey`), null);
    assert.equal(lookupSentence(deCommon.settings.notifications.state, `${STATE_PREFIX}notAKey`), null);
    assert.equal(lookupSentence(enCommon.settings.notifications.state, 'settings.notifications.title'), null);
  });

  it('names a different sentence for a dismissed prompt than for a blocked one', () => {
    assert.notEqual(REASON_KEYS.dismissed, REASON_KEYS.blocked);
    assert.notEqual(
      lookupSentence(enCommon.settings.notifications.state, REASON_KEYS.dismissed),
      lookupSentence(enCommon.settings.notifications.state, REASON_KEYS.blocked),
    );
  });
});

describe('the escalation after a second dismissal', () => {
  it('says "tap again" the first time, because one unanswered question explains itself', () => {
    assert.equal(reasonKey('dismissed', 0), REASON_KEYS.dismissed);
  });

  it('sends a person to the site settings once the browser has stopped asking', () => {
    const escalated = 'settings.notifications.state.dismissedAgain';
    assert.equal(reasonKey('dismissed', 1), escalated);
    assert.equal(reasonKey('dismissed', 5), escalated);
  });

  it('THE CONTROL: the count changes nothing for any other reason', () => {
    assert.equal(reasonKey('blocked', 5), REASON_KEYS.blocked);
    assert.equal(reasonKey('signed-out', 5), REASON_KEYS['signed-out']);
    assert.equal(reasonKey('server-off', 5), REASON_KEYS['server-off']);
  });
});

describe('what the page shows after a failed attempt', () => {
  it('keeps the switch on screen for a dismissed prompt and for an ended session', () => {
    assert.equal(availabilityAfterFailure('dismissed'), null);
    assert.equal(availabilityAfterFailure('signed-out'), null);
  });

  it('THE CONTROL: a blocked browser really does become the blocked state', () => {
    assert.equal(availabilityAfterFailure('blocked'), 'blocked');
    assert.equal(availabilityAfterFailure('unsupported'), 'unsupported');
    assert.equal(availabilityAfterFailure('needs-install'), 'needs-install');
    assert.equal(availabilityAfterFailure('server-off'), 'server-off');
  });
});

//////////////////////////////////////////////////////////////////////////////
// What the header status slot can hold
//////////////////////////////////////////////////////////////////////////////

/**
 * The longest a state sentence may be.
 *
 * These sentences are not only rendered on the page: a failed attempt
 * publishes one through the header status channel, and that slot is three
 * lines of `text-xs` at a 390 px viewport, which holds about 100 characters.
 * A longer sentence is clipped, so the reason a person cannot turn
 * notifications on is the half they cannot read.
 */
const STATE_SENTENCE_LIMIT = 100;

describe('the length of a state sentence', () => {
  for (const [language, state] of [
    ['en', enCommon.settings.notifications.state],
    ['de', deCommon.settings.notifications.state],
  ] as const) {
    for (const [name, sentence] of Object.entries(state)) {
      it(`fits the header status slot: ${language} ${name}`, () => {
        assert.ok(
          sentence.length <= STATE_SENTENCE_LIMIT,
          `${language} ${name} is ${sentence.length} characters, over ${STATE_SENTENCE_LIMIT}`,
        );
      });
    }
  }
});
