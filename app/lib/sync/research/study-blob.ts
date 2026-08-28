/**
 * THE STUDY ACCOUNT'S BLOB — pulled and pushed WITHOUT the sync cycle.
 *
 * `runSyncCycle` is the diary's: it reads the device snapshot, merges it with
 * the remote one and writes the result back to the local store. Every one of
 * those three is wrong for a study account on a researcher's laptop — the
 * device store holds her own diary, and the merge would carry it up and the
 * write-back would carry the study's compartment down. So the console does the
 * two things it actually needs, and nothing else: read the compartment out of
 * the account's blob, and write a blob back that is an EMPTY diary plus that
 * compartment (`study-snapshot.ts`).
 *
 * ── What is reused, and what is not ──────────────────────────────────────
 *
 * Reused: the envelope, the AAD, the schema probe (`decryptWithSchemaProbe`,
 * exported from `orchestrator.ts` precisely so a second walk cannot drift from
 * `SCHEMA_VERSION`), and the CAS. Not reused: the snapshot source, the merge
 * and the apply.
 *
 * ── The Lamport stamp is BUMPED, never re-emitted ────────────────────────
 *
 * The compartment is one entity (`PRIVATE_STORE_ENTITY_KEY`) under the
 * per-entity clock. A push that re-emitted the stamp it pulled would lose the
 * `(lamport, deviceId)` tie-break against another device's stale copy, and the
 * new key generation would be silently undone — the same defect
 * `private-store-rewrap.ts` documents.
 */
import { SCHEMA_VERSION } from '#app/lib/local-store';

import { buildEnvelope } from '../engine/envelope/build-envelope';
import type { SyncMetaPayload } from '../engine/envelope/types';
import { ENVELOPE_VERSION, MAX_BLOB_BYTES } from '../engine/protocol';
import type { SyncHttpClient } from '../engine/client/http-client';
import { SyncRequestError } from '../engine/client/sync-error';
import { decryptWithSchemaProbe } from '../orchestrator';
import { readSealedPrivateStore, type SealedPrivateStore } from '../snapshot-partition';
import { PRIVATE_STORE_ENTITY_KEY } from '../snapshot-sync';
import { buildStudySnapshot } from './study-snapshot';

/** What this module is allowed to touch: two blob verbs, and nothing that could reach a contribution or a key record. */
export type StudyBlobTransport = Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'>;

/** How many CAS rounds a study push fights for. Matches the diary cycle's bound; a study account has at most a handful of devices. */
export const MAX_STUDY_PUSH_ATTEMPTS = 5;

/** The study account's blob as this console needs it: the version to compare against, the compartment, and the compartment's stamp. */
export interface PulledStudyBlob {
  /** `0` when the account has never pushed — §5.2's 404, which is a fresh account and not an error. */
  blobVersion: number;
  sealed: SealedPrivateStore | null;
  /** The compartment entity's Lamport value on the pulled blob, or `0` when it carried none. */
  lamport: number;
}

/**
 * Reads the study account's blob.
 *
 * @throws when the blob exists and cannot be decrypted — the passphrase is wrong, or a newer build wrote it. Never degraded to "no compartment": that would lead a push to overwrite a live keyring with an empty one.
 */
export async function pullStudyBlob({
  transport,
  accountId,
  dek,
}: {
  transport: StudyBlobTransport;
  accountId: number;
  dek: Uint8Array;
}): Promise<PulledStudyBlob> {
  const pulled = await transport.pullBlob();
  if (pulled === null) return { blobVersion: 0, sealed: null, lamport: 0 };

  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId,
    dek,
  });
  return {
    blobVersion: pulled.blobVersion,
    sealed: readSealedPrivateStore({ snapshot: decrypted.payload.snapshot }),
    lamport: decrypted.payload.syncMeta.perEntity[PRIVATE_STORE_ENTITY_KEY]?.lamport ?? 0,
  };
}

/**
 * Writes a blob carrying `sealed` and an empty diary, re-reading and retrying
 * on a CAS conflict.
 *
 * The re-read on conflict deliberately does NOT merge: the caller has just
 * appended a generation to the keyring it pulled, and the only thing a
 * conflicting write could have contributed is another generation appended by a
 * second device — which this push would drop. That is why the retry hands the
 * conflict back through `reseal`, so the caller re-appends onto whatever is
 * now on the server.
 *
 * @param reseal - given the compartment now on the server, produce the one to write. Called once per attempt.
 * @returns the blob version the study account now sits at.
 */
export async function pushStudyBlob({
  transport,
  accountId,
  dek,
  deviceId,
  pulled,
  reseal,
}: {
  transport: StudyBlobTransport;
  accountId: number;
  dek: Uint8Array;
  deviceId: string;
  pulled: PulledStudyBlob;
  reseal: (current: PulledStudyBlob) => Promise<SealedPrivateStore | null>;
}): Promise<number> {
  let current = pulled;
  for (let attempt = 1; attempt <= MAX_STUDY_PUSH_ATTEMPTS; attempt += 1) {
    const sealed = await reseal(current);
    if (sealed === null) {
      throw new SyncRequestError({
        kind: 'invalid',
        message: 'This study account has no owner-private compartment, so its keys cannot be stored.',
      });
    }

    const targetVersion = current.blobVersion + 1;
    const envelope = await buildEnvelope({
      payload: {
        snapshot: buildStudySnapshot({ privateStore: sealed }),
        syncMeta: studyMeta({ deviceId, lamport: current.lamport + 1 }),
      },
      dek,
      aadFields: { accountId, blobVersion: targetVersion, payloadSchemaVersion: SCHEMA_VERSION },
    });
    if (envelope.ciphertext.byteLength > MAX_BLOB_BYTES) {
      throw new SyncRequestError({
        kind: 'too-large',
        message: `This study's encrypted keyring is ${envelope.ciphertext.byteLength} bytes, over the ${MAX_BLOB_BYTES}-byte sync limit.`,
      });
    }

    const result = await transport.pushBlob({
      baseVersion: current.blobVersion,
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: envelope.ciphertext,
    });
    if (result.status === 'accepted') return result.newVersion;

    current = await pullStudyBlob({ transport, accountId, dek });
  }

  throw new SyncRequestError({
    kind: 'conflict',
    message: `This study's keys could not be saved after ${MAX_STUDY_PUSH_ATTEMPTS} attempts — another device is writing continuously.`,
  });
}

/**
 * The study blob's sync metadata: one stamped entity, the compartment.
 *
 * A study blob has no other entity, because its diary is empty by
 * construction. Written out rather than derived through `stampSnapshot`, which
 * needs a device baseline this console deliberately does not keep.
 */
function studyMeta({ deviceId, lamport }: { deviceId: string; lamport: number }): SyncMetaPayload {
  return { perEntity: { [PRIVATE_STORE_ENTITY_KEY]: { lamport, deviceId } }, tombstones: [] };
}
