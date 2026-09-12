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
import { withI18n } from './trends-i18n-harness';
import { AvailabilityNotice, notificationsRowStatus, parseTimeInput } from '../../app/routes/settings.notifications';
import { DEFAULT_PUSH_PREFS } from '../../app/lib/push';
import type { PushAvailability } from '../../app/lib/push';

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
