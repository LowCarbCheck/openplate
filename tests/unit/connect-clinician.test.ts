/**
 * Clinician onboarding — how a public key reaches a patient's device (M160/08).
 *
 * The whole slice is a TRANSPORT problem that must not quietly become a trust
 * one, so these tests hold three lines:
 *
 *  1. A payload that arrived in the QUERY STRING is refused, even when a
 *     perfectly good fragment sits beside it. Without this, a mail provider
 *     rewriting links downgrades the design and nothing anywhere fails —
 *     `openplate-sync` ADR-0002 prohibition 1 says the server never holds a
 *     share public key, and a query parameter puts it in the access log.
 *  2. Every fingerprint shown is computed from the KEY BYTES that actually
 *     arrived. The link carries no fingerprint field at all, and a forged one
 *     appended to the fragment changes nothing (prohibition 6).
 *  3. A pinned peer offering different bytes lands in a NEW ceremony, never an
 *     auto-accept — asserted by absence of effect, not by a status alone.
 *
 * Discrimination, verified by defect injection on 2026-08-27: making
 * `parseClinicianLink` read the query string when the fragment is empty leaves
 * every other test in this file green and fails exactly
 * "rejects a key in the query string" — recorded in that test's comment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLINICIAN_CONNECT_PATH,
  acceptsKeyChangeIn,
  buildClinicianLink,
  ceremonyPhaseFor,
  parseClinicianLink,
} from '../../app/lib/clinician-link';
import type { LocalSharePeer } from '../../app/lib/local-store';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import {
  generateShareKeyPair,
  shareFingerprintDisplay,
  shareKeyFingerprint,
  type ShareKeyPair,
} from '../../app/lib/sync/engine/crypto/share-wrap';
import type { ShareGrant } from '../../app/lib/sync/engine/client/http-client';
import { runShareCeremony, type GrantorShareTransport } from '../../app/lib/sync/sharing';

const PATIENT_ACCOUNT_ID = 41;
const CLINICIAN_ACCOUNT_ID = 77;
const APP_ORIGIN = 'https://openplate.de';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A grantor transport that records every call, so a refusal is asserted as "nothing was sent". */
interface RecordingTransport {
  transport: GrantorShareTransport;
  putShareCalls: number;
}

function recordingTransport(rows: ShareGrant[] = []): RecordingTransport {
  const recorder: RecordingTransport = {
    putShareCalls: 0,
    transport: {
      listShares: async () => ({ status: 'available', value: rows }),
      putShare: async (input) => {
        recorder.putShareCalls += 1;
        return {
          status: 'accepted',
          grant: {
            granteeAccountId: input.granteeAccountId,
            recipientKeyFingerprint: input.recipientKeyFingerprint,
            createdAt: '2026-08-27T10:00:00.000Z',
            updatedAt: '2026-08-27T10:00:00.000Z',
          },
        };
      },
      deleteShare: async () => undefined,
    },
  };
  return recorder;
}

function pinnedPeer(pair: ShareKeyPair): LocalSharePeer {
  return {
    id: String(CLINICIAN_ACCOUNT_ID),
    accountId: CLINICIAN_ACCOUNT_ID,
    publicKeyRaw: bytesToBase64(pair.publicKeyRaw),
    label: 'Dr. Meier',
    createdAt: 1_756_000_000_000,
  };
}

/** The fragment of a freshly built link, without the leading `#`. */
function fragmentFor(pair: ShareKeyPair, { label = 'Dr. Meier' }: { label?: string } = {}): string {
  const link = buildClinicianLink({
    origin: APP_ORIGIN,
    accountId: CLINICIAN_ACCOUNT_ID,
    publicKeyBase64: bytesToBase64(pair.publicKeyRaw),
    label,
  });
  return link.slice(link.indexOf('#') + 1);
}

// ---------------------------------------------------------------------------
// Building the link
// ---------------------------------------------------------------------------

describe('buildClinicianLink', () => {
  it('puts the whole payload after the # and nothing before it', async () => {
    const pair = await generateShareKeyPair();
    const link = buildClinicianLink({
      origin: APP_ORIGIN,
      accountId: CLINICIAN_ACCOUNT_ID,
      publicKeyBase64: bytesToBase64(pair.publicKeyRaw),
      label: 'Dr. Meier',
    });

    const url = new URL(link);
    assert.equal(url.pathname, CLINICIAN_CONNECT_PATH);
    // The part a server sees is empty. This is the property the design rests
    // on: a fragment is never transmitted, a query string always is.
    assert.equal(url.search, '');
    assert.ok(url.hash.startsWith('#k='));
  });

  it('round-trips through the parser', async () => {
    const pair = await generateShareKeyPair();
    const parsed = parseClinicianLink({ hash: `#${fragmentFor(pair)}`, search: '' });

    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    assert.equal(parsed.invite.accountId, CLINICIAN_ACCOUNT_ID);
    assert.equal(parsed.invite.publicKeyBase64, bytesToBase64(pair.publicKeyRaw));
    assert.equal(parsed.invite.claimedLabel, 'Dr. Meier');
  });

  it('treats a link with no name as unnamed rather than blank', async () => {
    const pair = await generateShareKeyPair();
    const parsed = parseClinicianLink({ hash: `#${fragmentFor(pair, { label: '   ' })}`, search: '' });

    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    assert.equal(parsed.invite.claimedLabel, null);
  });

  it('refuses a fragment whose key is not a share public key', async () => {
    const pair = await generateShareKeyPair();
    const truncated = bytesToBase64(pair.publicKeyRaw.slice(0, 32)).replaceAll('+', '-').replaceAll('/', '_');
    assert.equal(parseClinicianLink({ hash: `#k=${truncated}&a=77`, search: '' }).status, 'invalid');
    assert.equal(
      parseClinicianLink({ hash: `#${fragmentFor(pair)}`.replace('a=77', 'a=0'), search: '' }).status,
      'invalid',
    );
    assert.equal(parseClinicianLink({ hash: '', search: '' }).status, 'invalid');
  });
});

// ---------------------------------------------------------------------------
// 1. The query string
// ---------------------------------------------------------------------------

describe('reading a clinician link', () => {
  it('rejects a key in the query string', async () => {
    const pair = await generateShareKeyPair();
    const fragment = fragmentFor(pair);

    // The plain case: a mailer moved the payload into the transmitted half.
    const moved = parseClinicianLink({ hash: '', search: `?${fragment}` });
    assert.equal(moved.status, 'query-string');
    if (moved.status !== 'query-string') return;
    assert.deepEqual([...moved.parameters], ['k', 'a', 'n']);

    // THE DISCRIMINATING ASSERTION. A link that carries the payload in BOTH
    // halves is still refused: the fragment is fine, so an implementation that
    // reads the fragment and shrugs at the query string passes every other
    // test in this file and fails only here. Verified by defect injection —
    // making the parser fall back to the query string only when the fragment
    // is empty left this line as the sole failure.
    assert.equal(parseClinicianLink({ hash: `#${fragment}`, search: `?${fragment}` }).status, 'query-string');

    // A single stray payload name is enough. A rewriter that mangled only the
    // account id is still a rewriter, and the key it did not move this time is
    // the key it will move next time.
    assert.equal(parseClinicianLink({ hash: `#${fragment}`, search: '?a=77' }).status, 'query-string');

    // Unrelated query parameters are not the failure this looks for.
    assert.equal(parseClinicianLink({ hash: `#${fragment}`, search: '?utm_source=mail' }).status, 'ok');
  });
});

// ---------------------------------------------------------------------------
// 2. The fingerprint
// ---------------------------------------------------------------------------

describe('the fingerprint the patient is shown', () => {
  it('fingerprint is recomputed', async () => {
    const real = await generateShareKeyPair();
    const attacker = await generateShareKeyPair();

    // The link is tampered with in flight: the attacker's key, the real
    // clinician's name, and — for good measure — a forged fingerprint field
    // appended to the fragment.
    const realDisplay = shareFingerprintDisplay(await shareKeyFingerprint(real.publicKeyRaw));
    const attackerDisplay = shareFingerprintDisplay(await shareKeyFingerprint(attacker.publicKeyRaw));
    const tampered = `#${fragmentFor(attacker)}&f=${encodeURIComponent(realDisplay)}`;

    const parsed = parseClinicianLink({ hash: tampered, search: '' });
    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;

    // Nothing in the parse result came from the forged field: the invite is
    // exactly three values, and a fingerprint is not one of them.
    assert.deepEqual(Object.keys(parsed.invite).toSorted(), ['accountId', 'claimedLabel', 'publicKeyBase64']);

    // Typing what the real clinician read aloud refuses the swapped key, and
    // refuses it before any effect.
    const refusal = recordingTransport();
    const refused = await runShareCeremony({
      transport: refusal.transport,
      dek: generateDek(),
      grantorAccountId: PATIENT_ACCOUNT_ID,
      offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: attacker.publicKeyRaw, label: 'Dr. Meier' },
      typedFingerprint: realDisplay,
      pinnedPeers: [],
      pinPeer: async () => assert.fail('a refused ceremony must pin nothing'),
    });
    assert.deepEqual(refused, { status: 'fingerprint-mismatch' });
    assert.equal(refusal.putShareCalls, 0);

    // And the value the screen ends up showing is the one derived from the
    // bytes that arrived — never the string the link claimed.
    const accepting = recordingTransport();
    const granted = await runShareCeremony({
      transport: accepting.transport,
      dek: generateDek(),
      grantorAccountId: PATIENT_ACCOUNT_ID,
      offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: attacker.publicKeyRaw, label: 'Dr. Meier' },
      typedFingerprint: attackerDisplay,
      pinnedPeers: [],
      pinPeer: async () => undefined,
    });
    assert.equal(granted.status, 'granted');
    if (granted.status !== 'granted') return;
    const phase = ceremonyPhaseFor(granted);
    assert.deepEqual(phase, { status: 'granted', fingerprintDisplay: attackerDisplay });
    assert.notEqual(attackerDisplay, realDisplay);
  });
});

// ---------------------------------------------------------------------------
// 3. A regenerated key
// ---------------------------------------------------------------------------

describe('a clinician who regenerated her key', () => {
  it('changed key requires a new ceremony', async () => {
    const pinned = await generateShareKeyPair();
    const regenerated = await generateShareKeyPair();
    const regeneratedDisplay = shareFingerprintDisplay(await shareKeyFingerprint(regenerated.publicKeyRaw));
    const pinnedDisplay = shareFingerprintDisplay(await shareKeyFingerprint(pinned.publicKeyRaw));

    // She sent a new link. The typed fingerprint is correct FOR THE NEW KEY —
    // so nothing about the ceremony itself failed, and an auto-accept here
    // would be indistinguishable from a server substituting its own key.
    const recorder = recordingTransport();
    const result = await runShareCeremony({
      transport: recorder.transport,
      dek: generateDek(),
      grantorAccountId: PATIENT_ACCOUNT_ID,
      offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: regenerated.publicKeyRaw, label: 'Dr. Meier' },
      typedFingerprint: regeneratedDisplay,
      pinnedPeers: [pinnedPeer(pinned)],
      pinPeer: async () => assert.fail('a changed key must not re-pin without an explicit new ceremony'),
    });

    assert.deepEqual(result, {
      status: 'key-changed',
      pinnedFingerprintDisplay: pinnedDisplay,
      offeredFingerprintDisplay: regeneratedDisplay,
    });
    assert.equal(recorder.putShareCalls, 0);

    // The screen routes that into a ceremony, not an error — and only that
    // phase may replace the pin.
    const phase = ceremonyPhaseFor(result);
    assert.equal(phase.status, 'key-changed');
    assert.equal(acceptsKeyChangeIn(phase), true);
    assert.equal(acceptsKeyChangeIn({ status: 'verify' }), false);
    assert.equal(acceptsKeyChangeIn({ status: 'refused', reason: 'fingerprint-mismatch' }), false);

    // The second ceremony still types the fingerprint. Acknowledging the change
    // does not skip the check: a wrong value from this phase is still refused.
    const acknowledged = recordingTransport();
    const stillRefused = await runShareCeremony({
      transport: acknowledged.transport,
      dek: generateDek(),
      grantorAccountId: PATIENT_ACCOUNT_ID,
      offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: regenerated.publicKeyRaw, label: 'Dr. Meier' },
      typedFingerprint: pinnedDisplay,
      pinnedPeers: [pinnedPeer(pinned)],
      pinPeer: async () => assert.fail('acceptsKeyChange must never skip the typed check'),
      acceptsKeyChange: true,
    });
    assert.deepEqual(stillRefused, { status: 'fingerprint-mismatch' });
    assert.equal(acknowledged.putShareCalls, 0);

    // Done properly, it re-pins and grants.
    const repinned: LocalSharePeer[] = [];
    const second = await runShareCeremony({
      transport: acknowledged.transport,
      dek: generateDek(),
      grantorAccountId: PATIENT_ACCOUNT_ID,
      offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: regenerated.publicKeyRaw, label: 'Dr. Meier' },
      typedFingerprint: regeneratedDisplay,
      pinnedPeers: [pinnedPeer(pinned)],
      pinPeer: async (peer) => void repinned.push(peer),
      acceptsKeyChange: true,
    });
    assert.equal(second.status, 'granted');
    assert.equal(repinned.length, 1);
    assert.equal(repinned[0]?.publicKeyRaw, bytesToBase64(regenerated.publicKeyRaw));
  });
});

// ---------------------------------------------------------------------------
// 4. An instance with sharing switched off
// ---------------------------------------------------------------------------

describe('a deployment with SYNC_SHARING off', () => {
  it('keeps the verification and reports only that nothing was shared', async () => {
    const pair = await generateShareKeyPair();
    const display = shareFingerprintDisplay(await shareKeyFingerprint(pair.publicKeyRaw));
    const pins: LocalSharePeer[] = [];

    const result = await runShareCeremony({
      // Every share path answers the ordinary 404 there, which the client
      // models as `unavailable` — absence, never an error.
      transport: {
        listShares: async () => ({ status: 'unavailable' }),
        putShare: async () => assert.fail('no request may be made when the surface is absent'),
        deleteShare: async () => undefined,
      },
      dek: generateDek(),
      grantorAccountId: PATIENT_ACCOUNT_ID,
      offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: pair.publicKeyRaw, label: 'Dr. Meier' },
      typedFingerprint: display,
      pinnedPeers: [],
      pinPeer: async (peer) => void pins.push(peer),
    });

    assert.deepEqual(result, { status: 'unavailable' });
    assert.deepEqual(ceremonyPhaseFor(result), { status: 'refused', reason: 'sharing-off' });
    // The two people did the ceremony. Throwing their verification away because
    // an operator has not enabled a surface would make them repeat it later.
    assert.equal(pins.length, 1);
    assert.equal(pins[0]?.publicKeyRaw, bytesToBase64(pair.publicKeyRaw));
  });
});
