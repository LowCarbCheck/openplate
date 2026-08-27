/**
 * The clinician-sharing ceremony, and the clinician's read view (M160/05,
 * `openplate-sync` ADR-0002).
 *
 * ADR-0002 names ONE attack as the thing that breaks the whole design:
 * grant-time key substitution with a skipped or theatrical ceremony. These
 * tests are what stop that from being a comment. They assert refusals by their
 * ABSENCE OF EFFECT — no pin written, no wrap produced, no request sent —
 * rather than by a returned status alone, because a status can be right while
 * the side effect already happened.
 *
 * The prefix case in the first test is the discriminating one: loosen
 * `shareFingerprintMatchesTyped` to accept a prefix and only that assertion
 * fails. Verified by defect injection, 2026-08-27.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { SharedDiaryView } from '../../app/components/shared-diary-view';
import { SCHEMA_VERSION, type LocalFoodLog, type LocalSharePeer } from '../../app/lib/local-store';
import { buildEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import { ENVELOPE_VERSION } from '../../app/lib/sync/engine/protocol';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import {
  generateShareKeyPair,
  shareFingerprintDisplay,
  shareKeyFingerprint,
  wrapDekForRecipient,
  type ShareKeyPair,
} from '../../app/lib/sync/engine/crypto/share-wrap';
import type { ReceivedShare, ShareGrant, SharedBlob } from '../../app/lib/sync/engine/client/http-client';
import {
  describeGrants,
  openSharedDiary,
  planRotationRewraps,
  runShareCeremony,
  type GranteeShareTransport,
  type GrantorShareTransport,
} from '../../app/lib/sync/sharing';

const GRANTOR_ACCOUNT_ID = 41;
const CLINICIAN_ACCOUNT_ID = 77;

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A grantor transport that records every call, so a refusal can be asserted as "nothing was sent". */
interface RecordingGrantorTransport {
  transport: GrantorShareTransport;
  listShareCalls: number;
  putShareCalls: { granteeAccountId: number; wrappedDek: Uint8Array; recipientKeyFingerprint: string }[];
  deleteShareCalls: number[];
}

function recordingGrantorTransport(rows: ShareGrant[] = []): RecordingGrantorTransport {
  const recorder: RecordingGrantorTransport = {
    listShareCalls: 0,
    putShareCalls: [],
    deleteShareCalls: [],
    transport: {
      listShares: async () => {
        recorder.listShareCalls += 1;
        return { status: 'available', value: rows };
      },
      putShare: async (input) => {
        recorder.putShareCalls.push({
          granteeAccountId: input.granteeAccountId,
          wrappedDek: input.wrappedDek,
          recipientKeyFingerprint: input.recipientKeyFingerprint,
        });
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
      deleteShare: async (granteeAccountId) => void recorder.deleteShareCalls.push(granteeAccountId),
    },
  };
  return recorder;
}

/** A pinned peer, exactly as a passed ceremony would have written it. */
function pinnedPeer(pair: ShareKeyPair, { label = 'Dr. Meier' }: { label?: string } = {}): LocalSharePeer {
  return {
    id: String(CLINICIAN_ACCOUNT_ID),
    accountId: CLINICIAN_ACCOUNT_ID,
    publicKeyRaw: bytesToBase64(pair.publicKeyRaw),
    label,
    createdAt: 1_756_000_000_000,
  };
}

function shareGrantRow(recipientKeyFingerprint: string): ShareGrant {
  return {
    granteeAccountId: CLINICIAN_ACCOUNT_ID,
    recipientKeyFingerprint,
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
  };
}

function foodLog(): LocalFoodLog {
  return {
    id: 'log-1',
    name: 'Greek yoghurt',
    quantityGrams: 180,
    macros: { carbs: 7, fiber: 0, sugars: 7, polyols: null, protein: 17, fat: 8, kcal: 160 },
    mealType: 'breakfast',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-08-26',
    loggedAt: 1_756_200_000_000,
    createdAt: 1_756_200_000_000,
    logBatchId: null,
  };
}

// ---------------------------------------------------------------------------
// The ceremony
// ---------------------------------------------------------------------------

test('wrong fingerprint blocks the grant', async () => {
  const clinician = await generateShareKeyPair();
  const fingerprint = await shareKeyFingerprint(clinician.publicKeyRaw);
  const recorder = recordingGrantorTransport();
  const pins: LocalSharePeer[] = [];

  const wrong = await runShareCeremony({
    transport: recorder.transport,
    dek: generateDek(),
    grantorAccountId: GRANTOR_ACCOUNT_ID,
    offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: clinician.publicKeyRaw, label: 'Dr. Meier' },
    // A different key's fingerprint — what a substituting server would have
    // the patient type without noticing.
    typedFingerprint: shareFingerprintDisplay(await shareKeyFingerprint((await generateShareKeyPair()).publicKeyRaw)),
    pinnedPeers: pins,
    pinPeer: async (peer) => void pins.push(peer),
  });

  assert.deepEqual(wrong, { status: 'fingerprint-mismatch' });
  assert.equal(pins.length, 0, 'a refused ceremony must not pin the key');
  assert.equal(recorder.putShareCalls.length, 0, 'a refused ceremony must not write a share row');
  assert.equal(recorder.listShareCalls, 0, 'a refused ceremony must not even reach the server');

  // THE DISCRIMINATING CASE. The display is 60 bits — all twelve characters —
  // and a PREFIX of the right value is not the right value. Accepting one
  // would cut the ceremony's strength by orders of magnitude while every
  // screen still looked green.
  const prefix = shareFingerprintDisplay(fingerprint).slice(0, 9);
  const truncated = await runShareCeremony({
    transport: recorder.transport,
    dek: generateDek(),
    grantorAccountId: GRANTOR_ACCOUNT_ID,
    offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: clinician.publicKeyRaw, label: 'Dr. Meier' },
    typedFingerprint: prefix,
    pinnedPeers: pins,
    pinPeer: async (peer) => void pins.push(peer),
  });

  assert.deepEqual(truncated, { status: 'fingerprint-mismatch' }, 'a prefix of the fingerprint must not pass');
  assert.equal(pins.length, 0);
  assert.equal(recorder.putShareCalls.length, 0);
});

test('the typed fingerprint grants, pins the key and wraps the DEK to it', async () => {
  const clinician = await generateShareKeyPair();
  const fingerprint = await shareKeyFingerprint(clinician.publicKeyRaw);
  const recorder = recordingGrantorTransport();
  const pins: LocalSharePeer[] = [];

  const result = await runShareCeremony({
    transport: recorder.transport,
    dek: generateDek(),
    grantorAccountId: GRANTOR_ACCOUNT_ID,
    offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: clinician.publicKeyRaw, label: 'Dr. Meier' },
    // Lower case and spaces instead of dashes: a person retyping what they
    // heard groups it however they like, and none of that carries information.
    typedFingerprint: shareFingerprintDisplay(fingerprint).replaceAll('-', ' ').toLowerCase(),
    pinnedPeers: pins,
    pinPeer: async (peer) => void pins.push(peer),
  });

  assert.equal(result.status, 'granted');
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.publicKeyRaw, bytesToBase64(clinician.publicKeyRaw));
  assert.equal(recorder.putShareCalls.length, 1);
  assert.equal(recorder.putShareCalls[0]?.recipientKeyFingerprint, fingerprint);
  assert.equal(recorder.putShareCalls[0]?.wrappedDek.byteLength, 125);
});

test('changed fingerprint voids the share', async () => {
  const verified = await generateShareKeyPair();
  const substituted = await generateShareKeyPair();
  const pins = [pinnedPeer(verified)];
  // The row on file names a key this device did not verify — a rotation, or a
  // substitution. They are indistinguishable, and both void the share.
  const grants = [shareGrantRow(await shareKeyFingerprint(substituted.publicKeyRaw))];

  const [view] = await describeGrants({ grants, pinnedPeers: pins });
  assert.equal(view?.status, 'key-changed');
  assert.equal(
    view?.pinnedFingerprintDisplay,
    shareFingerprintDisplay(await shareKeyFingerprint(verified.publicKeyRaw)),
    'the fingerprint shown is always the PINNED key’s, computed here — never the server’s string',
  );

  // A rotation cannot carry a voided share across: it would have to re-wrap to
  // a key nobody verified. Silence is revocation (ADR-0002 Tier 2).
  const plan = await planRotationRewraps({ grants, pinnedPeers: pins });
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.drop, [{ granteeAccountId: CLINICIAN_ACCOUNT_ID, reason: 'key-changed' }]);

  // And the client never auto-accepts the new key, even when the typed value
  // matches it: replacing a pin is a fresh, explicit trust decision.
  const recorder = recordingGrantorTransport(grants);
  const written: LocalSharePeer[] = [];
  const attempt = await runShareCeremony({
    transport: recorder.transport,
    dek: generateDek(),
    grantorAccountId: GRANTOR_ACCOUNT_ID,
    offered: { accountId: CLINICIAN_ACCOUNT_ID, publicKeyRaw: substituted.publicKeyRaw, label: 'Dr. Meier' },
    typedFingerprint: shareFingerprintDisplay(await shareKeyFingerprint(substituted.publicKeyRaw)),
    pinnedPeers: pins,
    pinPeer: async (peer) => void written.push(peer),
  });

  assert.equal(attempt.status, 'key-changed');
  assert.equal(written.length, 0, 'a changed key must not silently replace the pin');
  assert.equal(recorder.putShareCalls.length, 0, 'a changed key must not be wrapped to');
});

test('an unpinned grant is never rendered as though it were verified', async () => {
  const clinician = await generateShareKeyPair();
  // The compartment merges whole, so a concurrent pin on another device can be
  // lost. The share is still live — but THIS device cannot vouch for the key.
  const [view] = await describeGrants({
    grants: [shareGrantRow(await shareKeyFingerprint(clinician.publicKeyRaw))],
    pinnedPeers: [],
  });

  assert.equal(view?.status, 'unpinned');
  assert.equal(view?.pinnedFingerprintDisplay, null, 'an unpinned peer has no fingerprint this device can show');

  const plan = await planRotationRewraps({
    grants: [shareGrantRow(await shareKeyFingerprint(clinician.publicKeyRaw))],
    pinnedPeers: [],
  });
  assert.deepEqual(plan.drop, [{ granteeAccountId: CLINICIAN_ACCOUNT_ID, reason: 'unpinned' }]);
});

// ---------------------------------------------------------------------------
// The clinician's read view
// ---------------------------------------------------------------------------

/** Builds a real blob for `GRANTOR_ACCOUNT_ID`, sealed at `schemaVersion`, plus the share addressed to `clinician`. */
async function sealedPatientBlob({
  clinician,
  schemaVersion,
}: {
  clinician: ShareKeyPair;
  schemaVersion: number;
}): Promise<{ blob: SharedBlob; share: ReceivedShare }> {
  const dek = generateDek();
  const blobVersion = 3;
  const envelope = await buildEnvelope({
    payload: {
      snapshot: {
        foods: [],
        foodLogs: [foodLog()],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        // The owner-private compartment as a grantee meets it: opaque, and
        // never openable with anything a share hands over.
        privateStore: null,
      },
      syncMeta: { perEntity: {}, tombstones: [] },
    },
    dek,
    aadFields: { accountId: GRANTOR_ACCOUNT_ID, blobVersion, payloadSchemaVersion: schemaVersion },
  });

  return {
    blob: {
      grantorAccountId: GRANTOR_ACCOUNT_ID,
      blobVersion,
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: envelope.ciphertext,
      createdAt: '2026-08-26T18:30:00.000Z',
    },
    share: {
      grantorAccountId: GRANTOR_ACCOUNT_ID,
      wrappedDek: await wrapDekForRecipient({
        dek,
        recipientPublicKeyRaw: clinician.publicKeyRaw,
        grantorAccountId: GRANTOR_ACCOUNT_ID,
      }),
      recipientKeyFingerprint: await shareKeyFingerprint(clinician.publicKeyRaw),
      createdAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-27T10:00:00.000Z',
    },
  };
}

function granteeTransport(blob: SharedBlob | null): GranteeShareTransport {
  return {
    listSharedWithMe: async () => ({ status: 'available', value: [] }),
    pullSharedBlob: async () => blob,
    deleteSharedWithMe: async () => undefined,
  };
}

test('clinician view decrypts a granted patient diary on this device, and refuses a revoked one', async () => {
  const clinician = await generateShareKeyPair();
  // Sealed one schema version BEHIND this build: the AAD binds
  // `payloadSchemaVersion` and a grantee cannot know the grantor's, so the
  // read has to probe. A build that only tried its own version would show a
  // clinician nothing whenever her patient was a release behind.
  const { blob, share } = await sealedPatientBlob({ clinician, schemaVersion: SCHEMA_VERSION - 1 });
  const identity = { publicKeyRaw: clinician.publicKeyRaw, privateKeyPkcs8: clinician.privateKeyPkcs8 };

  const opened = await openSharedDiary({ transport: granteeTransport(blob), share, identity });
  assert.equal(opened.status, 'opened');
  if (opened.status !== 'opened') return;
  assert.equal(opened.diary.grantorAccountId, GRANTOR_ACCOUNT_ID);
  assert.equal(opened.diary.snapshot.foodLogs[0]?.name, 'Greek yoghurt');

  // Tier 1 revocation, from the clinician's side of the glass: the row is gone
  // and the service answers the same 404 it gives for every other absence.
  const revoked = await openSharedDiary({ transport: granteeTransport(null), share, identity });
  assert.deepEqual(revoked, { status: 'unavailable' });

  // A wrap addressed to somebody else opens for nobody, and says so rather
  // than rendering an empty diary.
  const stranger = await generateShareKeyPair();
  const wrongKey = await openSharedDiary({
    transport: granteeTransport(blob),
    share,
    identity: { publicKeyRaw: stranger.publicKeyRaw, privateKeyPkcs8: stranger.privateKeyPkcs8 },
  });
  assert.equal(wrongKey.status, 'undecryptable');
});

test('clinician view renders the diary it decrypted, marked read-only', async () => {
  const clinician = await generateShareKeyPair();
  const { blob, share } = await sealedPatientBlob({ clinician, schemaVersion: SCHEMA_VERSION });
  const opened = await openSharedDiary({
    transport: granteeTransport(blob),
    share,
    identity: { publicKeyRaw: clinician.publicKeyRaw, privateKeyPkcs8: clinician.privateKeyPkcs8 },
  });
  assert.equal(opened.status, 'opened');
  if (opened.status !== 'opened') return;

  const html = renderToStaticMarkup(withI18n(createElement(SharedDiaryView, { diary: opened.diary })));
  assert.match(html, /Greek yoghurt/);
  assert.match(html, /2026-08-26/);
  assert.match(html, /Read only/);
});
