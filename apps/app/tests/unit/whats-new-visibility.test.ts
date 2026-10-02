/**
 * Whether the "What's new" card and its About row are shown, and the one
 * device preference behind it.
 *
 * WHAT IS CLAIMED. A stored `on` or `off` wins over the role in both
 * directions. With nothing stored only an administrator sees the card, and a
 * member, an unread role and a signed-out device do not. A stored value that is
 * neither `on` nor `off` is nothing stored.
 *
 * THE CONTROLS ARE THE TABLE ITSELF. The rule has two defaults, one per role,
 * so each row that says `true` has a sibling row that says `false` for the same
 * stored state. A rule that dropped the administrator default turns the first
 * row red, and a rule that showed the card to everybody turns the member rows
 * red. The storage cases pair every read with the write that makes it change.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  WHATS_NEW_VISIBLE_KEY,
  parseWhatsNewPreference,
  readWhatsNewPreference,
  resolveWhatsNewVisible,
  setWhatsNewVisible,
  subscribeWhatsNewPreference,
  type WhatsNewPreference,
  type WhatsNewRole,
} from '#app/lib/whats-new-visibility';

////////////////////////////////////////////////////////////////////////////////
// The rule
////////////////////////////////////////////////////////////////////////////////

describe('resolveWhatsNewVisible', () => {
  /** Every stored state against every role the session can report, and what must be shown. */
  const TABLE: ReadonlyArray<{ stored: WhatsNewPreference; role: WhatsNewRole; shown: boolean; why: string }> = [
    { stored: 'unset', role: 'admin', shown: true, why: 'an administrator is told by default' },
    { stored: 'unset', role: 'member', shown: false, why: 'a member is not told by default' },
    { stored: 'unset', role: null, shown: false, why: 'an unread role is never guessed to be an administrator' },
    { stored: 'unset', role: undefined, shown: false, why: 'no account at all is not an administrator' },
    { stored: 'on', role: 'admin', shown: true, why: 'on stays on for an administrator' },
    { stored: 'on', role: 'member', shown: true, why: 'a member can turn it on' },
    { stored: 'on', role: null, shown: true, why: 'a signed-out device can turn it on' },
    { stored: 'off', role: 'admin', shown: false, why: 'an administrator can turn it off' },
    { stored: 'off', role: 'member', shown: false, why: 'off stays off for a member' },
    { stored: 'off', role: null, shown: false, why: 'off stays off signed out' },
  ];

  for (const row of TABLE) {
    it(`${row.stored} and ${String(row.role)}: ${row.shown ? 'shown' : 'hidden'}, ${row.why}`, () => {
      assert.equal(resolveWhatsNewVisible(row.stored, row.role), row.shown);
    });
  }

  it('control: the table holds both answers for an unset device, so neither default can be dropped unseen', () => {
    const answers = new Set(
      TABLE.filter((row) => row.stored === 'unset').map((row) => resolveWhatsNewVisible(row.stored, row.role)),
    );
    assert.deepEqual([...answers].toSorted(), [false, true]);
  });

  it('control: only the role differs between the unset admin and the unset member', () => {
    assert.notEqual(resolveWhatsNewVisible('unset', 'admin'), resolveWhatsNewVisible('unset', 'member'));
  });

  it('control: an explicit choice beats the role in both directions', () => {
    assert.notEqual(resolveWhatsNewVisible('on', 'member'), resolveWhatsNewVisible('unset', 'member'));
    assert.notEqual(resolveWhatsNewVisible('off', 'admin'), resolveWhatsNewVisible('unset', 'admin'));
  });
});

describe('parseWhatsNewPreference', () => {
  it('reads on and off as they are', () => {
    assert.equal(parseWhatsNewPreference('on'), 'on');
    assert.equal(parseWhatsNewPreference('off'), 'off');
  });

  it('reads nothing, and anything else, as unset', () => {
    for (const junk of [null, '', '1', 'true', 'ON', 'yes', ' on', 'on ']) {
      assert.equal(parseWhatsNewPreference(junk), 'unset', `${JSON.stringify(junk)} must read as unset`);
    }
  });

  it('a junk stored value hands the decision to the role, in both directions', () => {
    const junk = parseWhatsNewPreference('maybe');
    assert.equal(resolveWhatsNewVisible(junk, 'admin'), true);
    assert.equal(resolveWhatsNewVisible(junk, 'member'), false);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The device
////////////////////////////////////////////////////////////////////////////////

/** What a blocked storage does to every call: it throws. */
function blocked(): never {
  throw new Error('storage is blocked');
}

/** A browser's `localStorage` and window events, installed on `globalThis` for one case and removed after. */
function withBrowser(
  state: { stored: string | null; isStorageBlocked?: boolean },
  run: (browser: { store: Map<string, string>; target: EventTarget }) => void,
): void {
  const store = new Map<string, string>();
  if (state.stored !== null) store.set(WHATS_NEW_VISIBLE_KEY, state.stored);
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', {
    value:
      state.isStorageBlocked === true ?
        { getItem: blocked, setItem: blocked }
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            store.set(key, value);
          },
        },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'addEventListener', {
    value: target.addEventListener.bind(target),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'removeEventListener', {
    value: target.removeEventListener.bind(target),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'dispatchEvent', { value: target.dispatchEvent.bind(target), configurable: true });
  try {
    run({ store, target });
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
    Reflect.deleteProperty(globalThis, 'addEventListener');
    Reflect.deleteProperty(globalThis, 'removeEventListener');
    Reflect.deleteProperty(globalThis, 'dispatchEvent');
  }
}

describe('the stored preference', () => {
  it('is unset outside a browser, where there is no device', () => {
    assert.equal(readWhatsNewPreference(), 'unset');
  });

  it('is unset on a device that never chose, and reads what was chosen once it did', () => {
    withBrowser({ stored: null }, () => {
      assert.equal(readWhatsNewPreference(), 'unset');
      setWhatsNewVisible(true);
      assert.equal(readWhatsNewPreference(), 'on');
      setWhatsNewVisible(false);
      assert.equal(readWhatsNewPreference(), 'off');
    });
  });

  it('writes an explicit value, never a removal, so an administrator can say off', () => {
    withBrowser({ stored: null }, ({ store }) => {
      setWhatsNewVisible(false);
      assert.equal(store.get(WHATS_NEW_VISIBLE_KEY), 'off');
      setWhatsNewVisible(true);
      assert.equal(store.get(WHATS_NEW_VISIBLE_KEY), 'on');
    });
  });

  it('is unset when storage is blocked, and writing does not throw', () => {
    withBrowser({ stored: null, isStorageBlocked: true }, () => {
      assert.equal(readWhatsNewPreference(), 'unset');
      assert.doesNotThrow(() => setWhatsNewVisible(true));
    });
  });

  it('announces a change on this tab, and stops announcing once unsubscribed', () => {
    withBrowser({ stored: null }, () => {
      let calls = 0;
      const unsubscribe = subscribeWhatsNewPreference(() => {
        calls += 1;
      });
      setWhatsNewVisible(true);
      assert.equal(calls, 1, 'the change event reaches the subscriber');
      unsubscribe();
      setWhatsNewVisible(false);
      assert.equal(calls, 1, 'the control: an unsubscribed listener hears nothing');
    });
  });

  it('listens for another tab writing the key, through the storage event', () => {
    withBrowser({ stored: null }, ({ target }) => {
      let calls = 0;
      const unsubscribe = subscribeWhatsNewPreference(() => {
        calls += 1;
      });
      target.dispatchEvent(new Event('storage'));
      assert.equal(calls, 1);
      unsubscribe();
    });
  });
});
