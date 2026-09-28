/**
 * The consent gate's facts: the instance's version read once per session,
 * kept in memory, refreshed in the background, and never a question when it
 * cannot be read (2026-09-28).
 *
 * Every read goes through injected readers that count their calls, so "no
 * network wait" is a count of zero, not a guess about timing. The session is
 * injected too, so nothing here opens a vault.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSENT_GATE_FACTS_TTL_MS,
  consentGateAt,
  decideConsentScreen,
  forgetConsentGateFacts,
  peekConsentGateFacts,
  readRequiredConsent,
  refreshConsentGateFacts,
  resolveConsentGateForNavigation,
  type ConsentGateReaders,
  type ConsentGateSession,
} from '../../app/lib/health-consent/consent-gate-facts';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const SERVER_URL = 'https://core.example.test';
const VERSION = '2026-09-28';

const ASKING: InstanceDescriptor = {
  name: 'Example',
  language: 'en',
  mail: true,
  memberInvites: false,
  plans: true,
  ai: null,
  healthConsent: { version: VERSION },
};

const NOT_ASKING: InstanceDescriptor = { ...ASKING, healthConsent: null };

/** An account that never agreed. */
const NEVER_AGREED: ConsentGateSession = { serverUrl: SERVER_URL, account: { consentedVersion: null } };

/** The same account after it agreed to the wording asked for now. */
const AGREED: ConsentGateSession = { serverUrl: SERVER_URL, account: { consentedVersion: VERSION } };

/** Readers that answer what they are given, count every call, and can be held. */
function countingReaders(answer: { instance: InstanceDescriptor | null; delayMs?: number }) {
  const calls = { instance: 0 };
  const readers: ConsentGateReaders = {
    readInstance: async () => {
      calls.instance += 1;
      if (answer.delayMs !== undefined) await new Promise((settle) => setTimeout(settle, answer.delayMs));
      return answer.instance;
    },
  };
  return { readers, calls };
}

/** A navigation to the home screen. */
function navigate(options: {
  session: ConsentGateSession | null;
  readers: ConsentGateReaders;
  now?: Date;
  pathname?: string;
  timeoutMs?: number;
  isOnline?: boolean;
}) {
  return resolveConsentGateForNavigation({
    pathname: options.pathname ?? '/dashboard',
    search: '',
    now: options.now ?? NOW,
    timeoutMs: options.timeoutMs ?? 2_500,
    session: options.session,
    readers: options.readers,
    isOnline: options.isOnline ?? true,
  });
}

afterEach(() => forgetConsentGateFacts());

describe('resolveConsentGateForNavigation', () => {
  it('asks an account that never agreed, waiting for the first read of the session', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers }), {
      kind: 'consent',
      destination: '/consent?next=/dashboard',
    });
    assert.equal(calls.instance, 1);
  });

  it('THE TWIN: lets through the same account once it agreed, on the same answer', async () => {
    const { readers } = countingReaders({ instance: ASKING });
    assert.deepEqual(await navigate({ session: AGREED, readers }), { kind: 'open' });
  });

  it('THE TWIN: never asks on an instance that asks for no consent', async () => {
    const { readers } = countingReaders({ instance: NOT_ASKING });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers }), { kind: 'open' });
  });

  it('reads once per session: a second navigation decides from memory', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    await navigate({ session: NEVER_AGREED, readers });
    assert.equal((await navigate({ session: NEVER_AGREED, readers, pathname: '/diary' })).kind, 'consent');
    assert.equal(calls.instance, 1);
  });

  it('reads the account LIVE: the navigation right after agreeing is open with no read at all', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    await navigate({ session: NEVER_AGREED, readers });
    assert.deepEqual(await navigate({ session: AGREED, readers }), { kind: 'open' });
    assert.equal(calls.instance, 1);
  });

  it('opens an unreadable handshake, and does not remember it, so the next navigation reads again', async () => {
    const { readers, calls } = countingReaders({ instance: null });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers }), { kind: 'open' });
    assert.equal(peekConsentGateFacts(SERVER_URL), null);
    await navigate({ session: NEVER_AGREED, readers });
    assert.equal(calls.instance, 2);
  });

  it('opens a read that outlasts the timeout, and the read still lands for the next navigation', async () => {
    const { readers } = countingReaders({ instance: ASKING, delayMs: 50 });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers, timeoutMs: 5 }), { kind: 'open' });
    await new Promise((settle) => setTimeout(settle, 80));
    assert.equal(peekConsentGateFacts(SERVER_URL)?.requiredVersion, VERSION);
  });

  it('opens with no session, and reads nothing', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    assert.deepEqual(await navigate({ session: null, readers }), { kind: 'open' });
    assert.equal(calls.instance, 0);
  });

  it('opens offline, and reads nothing', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers, isOnline: false }), { kind: 'open' });
    assert.equal(calls.instance, 0);
  });

  it('opens an exempt page without a read, so the export never waits on the network', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    for (const pathname of ['/settings/data', '/settings/account', '/consent']) {
      assert.deepEqual(await navigate({ session: NEVER_AGREED, readers, pathname }), { kind: 'open' }, pathname);
    }
    assert.equal(calls.instance, 0);
  });

  it('re-reads stale facts that would ask before asking, so a withdrawn wording does not ask once more', async () => {
    const asking = countingReaders({ instance: ASKING });
    await navigate({ session: NEVER_AGREED, readers: asking.readers });
    const later = new Date(NOW.getTime() + CONSENT_GATE_FACTS_TTL_MS + 1);
    const withdrawn = countingReaders({ instance: NOT_ASKING });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers: withdrawn.readers, now: later }), {
      kind: 'open',
    });
    assert.equal(withdrawn.calls.instance, 1);
  });

  it('decides at once on stale facts that open, and reads again behind them', async () => {
    const first = countingReaders({ instance: NOT_ASKING });
    await navigate({ session: NEVER_AGREED, readers: first.readers });
    const later = new Date(NOW.getTime() + CONSENT_GATE_FACTS_TTL_MS + 1);
    const second = countingReaders({ instance: ASKING, delayMs: 20 });
    assert.deepEqual(await navigate({ session: NEVER_AGREED, readers: second.readers, now: later }), {
      kind: 'open',
    });
    assert.equal(second.calls.instance, 1);
    await new Promise((settle) => setTimeout(settle, 40));
    assert.equal(peekConsentGateFacts(SERVER_URL)?.requiredVersion, VERSION);
  });

  it('never answers for one server from facts read on another', async () => {
    const { readers } = countingReaders({ instance: ASKING });
    await navigate({ session: NEVER_AGREED, readers });
    assert.equal(peekConsentGateFacts('https://other.example.test'), null);
  });
});

describe('consentGateAt, the synchronous verdict', () => {
  it('asks from held facts without a read, and is open with none held', async () => {
    assert.deepEqual(consentGateAt({ pathname: '/diary', search: '', session: NEVER_AGREED, isOnline: true }), {
      kind: 'open',
    });
    const { readers } = countingReaders({ instance: ASKING });
    await refreshConsentGateFacts({ session: NEVER_AGREED, now: NOW, readers });
    assert.equal(
      consentGateAt({ pathname: '/diary', search: '', session: NEVER_AGREED, isOnline: true }).kind,
      'consent',
    );
    assert.equal(consentGateAt({ pathname: '/diary', search: '', session: AGREED, isOnline: true }).kind, 'open');
    assert.equal(
      consentGateAt({ pathname: '/diary', search: '', session: NEVER_AGREED, isOnline: false }).kind,
      'open',
    );
  });
});

describe('refreshConsentGateFacts', () => {
  it('reads nothing while the held facts are fresh', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    await refreshConsentGateFacts({ session: NEVER_AGREED, now: NOW, readers });
    await refreshConsentGateFacts({ session: NEVER_AGREED, now: NOW, readers });
    assert.equal(calls.instance, 1);
  });
});

describe('decideConsentScreen', () => {
  it('asks when the gate would ask on the page it continues to', async () => {
    const { readers } = countingReaders({ instance: ASKING });
    const decision = await decideConsentScreen({
      next: '/dashboard',
      isResuming: false,
      session: NEVER_AGREED,
      readers,
      now: NOW,
      isOnline: true,
    });
    assert.deepEqual(decision, { kind: 'ask' });
  });

  it('continues to next when there is nothing to ask: a consent on record', async () => {
    const { readers } = countingReaders({ instance: ASKING });
    const decision = await decideConsentScreen({
      next: '/diary?date=2026-09-28',
      isResuming: false,
      session: AGREED,
      readers,
      now: NOW,
      isOnline: true,
    });
    assert.deepEqual(decision, { kind: 'continue', destination: '/diary?date=2026-09-28' });
  });

  it('continues with no session, and only to a guarded destination', async () => {
    const { readers } = countingReaders({ instance: ASKING });
    const decision = await decideConsentScreen({
      next: '//evil.example',
      isResuming: false,
      session: null,
      readers,
      now: NOW,
      isOnline: true,
    });
    assert.deepEqual(decision, { kind: 'continue', destination: '/dashboard' });
  });

  it('asks, and decides nothing, while the session is still reopening, so a reload does not bounce', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    const decision = await decideConsentScreen({
      next: '/dashboard',
      isResuming: true,
      session: null,
      readers,
      now: NOW,
      isOnline: true,
    });
    assert.deepEqual(decision, { kind: 'ask' });
    assert.equal(calls.instance, 0);
  });
});

describe('readRequiredConsent', () => {
  it('names the version to send, the absence of one, and an unreadable handshake, apart', async () => {
    assert.deepEqual(
      await readRequiredConsent({
        serverUrl: SERVER_URL,
        now: NOW,
        readers: countingReaders({ instance: ASKING }).readers,
      }),
      { kind: 'asks', version: VERSION },
    );
    forgetConsentGateFacts();
    assert.deepEqual(
      await readRequiredConsent({
        serverUrl: SERVER_URL,
        now: NOW,
        readers: countingReaders({ instance: NOT_ASKING }).readers,
      }),
      { kind: 'asks-nothing' },
    );
    forgetConsentGateFacts();
    assert.deepEqual(
      await readRequiredConsent({
        serverUrl: SERVER_URL,
        now: NOW,
        readers: countingReaders({ instance: null }).readers,
      }),
      { kind: 'unknown' },
    );
  });

  it('sends the held version while it is fresh, with no read', async () => {
    const { readers, calls } = countingReaders({ instance: ASKING });
    await refreshConsentGateFacts({ session: NEVER_AGREED, now: NOW, readers });
    assert.deepEqual(await readRequiredConsent({ serverUrl: SERVER_URL, now: NOW, readers }), {
      kind: 'asks',
      version: VERSION,
    });
    assert.equal(calls.instance, 1);
  });
});
