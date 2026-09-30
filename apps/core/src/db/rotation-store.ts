/**
 * Drizzle-backed `SyncRotationStore` — ADR-0002's Tier 2 revocation, and the
 * only write path in this service that crosses `accounts`, `sync_blobs`,
 * `sync_key_records` and `sync_shares` at once.
 *
 * IT IS ONE TRANSACTION, AND THAT IS THE WHOLE POINT. ADR-0002 prohibition 8
 * is literal: `rotate-dek` is atomic or it does not exist, and no sequence of
 * individually-committing endpoints may be documented or used as a rotation
 * procedure. A partial application is the "logs in fine, decrypts nothing"
 * brick PROTOCOL.md §5.14 already refuses to permit, with one extra
 * participant: a key record re-wrapped to a new DEK while the blob is still
 * sealed under the old one strands the OWNER, and a share re-wrapped while
 * the blob write lost its CAS strands the CLINICIAN.
 *
 * That is also why this is a separate store rather than four more methods on
 * `storage-adapter.ts` plus two on `share-store.ts`. Those two stores are
 * deliberately unable to reach each other's tables; composing a rotation out
 * of them would produce precisely the individually-committing sequence the
 * prohibition forbids, and it would look reasonable while doing it.
 *
 * `accounts` JOINED THE LIST IN M192. A rotation re-wraps the `recovery` key
 * record under a KEK derived from a NEW recovery code, so the account's
 * recovery verifier and its escrow have to move with it. Before that, a
 * rotation left both on the old code: the escrowed code still authenticated
 * and no longer unwrapped anything, which was latent until a mailed reset
 * began handing that code to people.
 *
 * THE PASSPHRASE GUARD AND `account_tokens` JOINED IT IN 2026-09. A rotation
 * used to be authorised by a bearer token alone, and it writes the recovery
 * verifier `POST /v1/auth/recover` accepts, so a stolen token could plant a
 * recovery code of its own and sign in with it for good. The route now
 * matches `currentAuthHash` first; this transaction compares the account's
 * verifier against the one matched and revokes every other session, so the
 * write happens only for a caller who holds the passphrase NOW, and leaves no
 * other session standing.
 *
 * SILENCE IS REVOCATION HERE, INVERTING §5.14. In a credential rotation, a
 * key-record kind that was not submitted is left untouched, because those
 * records are the owner's own and an unmentioned one is still valid. A share
 * is somebody else's capability on the owner's diary, so an unmentioned share
 * is DELETED in the same transaction. A reader arriving from §5.14 will
 * assume the other rule; it is the opposite, on purpose.
 *
 * The retained older blob versions (`BLOB_VERSION_RETENTION`) stay sealed
 * under the OLD DEK and become dead weight the moment this commits. That is
 * accepted: they are unreadable to everyone including their owner, they carry
 * no new disclosure a revoked grantee did not already have, and the prune
 * below clears them within five further pushes. Deleting them here instead
 * would throw away the owner's only defence against a bad client write during
 * the rotation itself.
 */
import { and, desc, eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import type { RotateDekInput, RotateDekResult, SyncRotationStore } from '../contract-types.js';
import { BLOB_VERSION_RETENTION } from '../protocol.js';
import { SESSION_TOKEN_KINDS } from '../lib/tokens.js';
import { isUniqueViolation } from '../lib/storage-conflict.js';
import type { Database } from './client.js';
import { accountTokens, accounts, syncBlobs, syncKeyRecords, syncShares } from './schema.js';

/**
 * How a rotation refuses: thrown inside the transaction so Postgres rolls
 * back, caught immediately outside it and turned back into the typed result.
 *
 * A `return` from the transaction callback would COMMIT what had already been
 * written, which for this operation is the entire failure mode it exists to
 * prevent.
 */
class RotationRefused extends Error {
  readonly result: RotateDekResult;

  constructor(result: RotateDekResult) {
    super('rotation refused');
    this.name = 'RotationRefused';
    this.result = result;
  }
}

/** The transaction handle `db.transaction` passes its callback. */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Revokes every live session token of the account except the kept session's family (or, with no family, its one token). */
async function revokeOtherSessions(
  tx: Transaction,
  input: { accountId: number; keep: { tokenId: number; familyId: string | null }; revokedAt: Date },
): Promise<void> {
  const outsideKeptFamily =
    input.keep.familyId === null
      ? undefined
      : or(isNull(accountTokens.familyId), ne(accountTokens.familyId, input.keep.familyId));
  await tx
    .update(accountTokens)
    .set({ revokedAt: input.revokedAt })
    .where(
      and(
        eq(accountTokens.accountId, input.accountId),
        inArray(accountTokens.kind, [...SESSION_TOKEN_KINDS]),
        isNull(accountTokens.revokedAt),
        ne(accountTokens.id, input.keep.tokenId),
        outsideKeptFamily,
      ),
    );
}

export function createDrizzleRotationStore(db: Database): SyncRotationStore {
  /** The account's current blob version, or `0` when it has never pushed. Read inside the transaction for the CAS. */
  async function readCurrentBlobVersion(accountId: number): Promise<number> {
    const [row] = await db
      .select({ blobVersion: syncBlobs.blobVersion })
      .from(syncBlobs)
      .where(eq(syncBlobs.accountId, accountId))
      .orderBy(desc(syncBlobs.blobVersion))
      .limit(1);
    return row?.blobVersion ?? 0;
  }

  return {
    async rotateDek(input: RotateDekInput): Promise<RotateDekResult> {
      // ONE clock for the whole rotation, in millisecond precision, so every
      // CAS token this writes is exactly representable in the ISO-8601 the
      // wire carries. The columns are `timestamp(3)` for the same reason
      // (`scripts/assert-ms-precision.mts`); writing a JS `Date` here means
      // the two agree rather than merely coexist.
      const now = new Date();
      const keptGrantees = input.shares.map((share) => share.granteeAccountId);

      try {
        return await db.transaction(async (tx) => {
          // ---- The caller's passphrase, compare-and-swap on the verifier
          //
          // FIRST, so it also takes the account row lock before anything else
          // is written. The route matched `currentAuthHash` against this value
          // before the transaction opened; a passphrase change that committed
          // since then means the caller no longer holds the credential this
          // rotation was authorised by, and nothing below may run.
          const [authorised] = await tx
            .update(accounts)
            .set({
              recoveryVerifier: input.recoveryVerifier,
              recoveryCodeEscrow: Buffer.from(input.recoveryCodeEscrow),
            })
            .where(and(eq(accounts.id, input.accountId), eq(accounts.verifier, input.expectedVerifier)))
            .returning({ id: accounts.id });
          if (!authorised) throw new RotationRefused({ ok: false, reason: 'credential-superseded' });

          // ---- The blob, compare-and-swap on baseVersion (PROTOCOL.md §5.1)
          const [latest] = await tx
            .select({ blobVersion: syncBlobs.blobVersion })
            .from(syncBlobs)
            .where(eq(syncBlobs.accountId, input.accountId))
            .orderBy(desc(syncBlobs.blobVersion))
            .limit(1);
          const currentVersion = latest?.blobVersion ?? 0;
          if (currentVersion !== input.blob.baseVersion) {
            throw new RotationRefused({ ok: false, reason: 'blob-conflict', currentVersion });
          }

          const newVersion = currentVersion + 1;
          await tx.insert(syncBlobs).values({
            accountId: input.accountId,
            blobVersion: newVersion,
            envelopeVersion: input.blob.envelopeVersion,
            ciphertext: Buffer.from(input.blob.ciphertext),
            sizeBytes: input.blob.ciphertext.byteLength,
          });

          // ---- Both key records, re-wrapped under the new DEK
          //
          // An upsert rather than a CAS'd update, matching `rotateCredential`:
          // the atomic submission IS the concurrency unit here, and a
          // per-record token would only describe a moment inside a
          // transaction nobody else can observe.
          for (const record of input.keyRecords) {
            await tx
              .insert(syncKeyRecords)
              .values({
                accountId: input.accountId,
                kind: record.kind,
                kdfDescriptor: record.kdfDescriptor,
                wrappedDek: Buffer.from(record.wrappedDek),
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [syncKeyRecords.accountId, syncKeyRecords.kind],
                set: {
                  kdfDescriptor: record.kdfDescriptor,
                  wrappedDek: Buffer.from(record.wrappedDek),
                  updatedAt: now,
                },
              });
          }

          // The new recovery credential landed in the first statement of this
          // transaction, beside the verifier guard. The `recovery` key record
          // written just above is wrapped under a KEK derived from a code the
          // client has just minted, and those two columns are what that code
          // authenticates against and what a mailed reset hands back: all
          // three commit together or none does.

          // ---- Every other session, revoked in this same transaction
          //
          // A rotation is what an owner runs when they believe a key leaked,
          // and it replaces the recovery code. A session that survived it would
          // be exactly the stolen token the rotation was run against. The
          // caller's own family stays, so the rotating device stays signed in.
          await revokeOtherSessions(tx, { accountId: input.accountId, keep: input.keepSession, revokedAt: now });

          // ---- Shares not resubmitted are DELETED, in this same transaction
          //
          // SILENCE IS REVOCATION, and this is the deliberate inversion of
          // §5.14's untouched-means-kept rule — see the module header before
          // "fixing" it to match. A wrap the grantor did not re-issue holds
          // the OLD DEK and could not open the blob this transaction just
          // wrote anyway; leaving the row would be a stale capability record
          // asserting care that no longer has a key.
          const revoked = await tx
            .delete(syncShares)
            .where(
              keptGrantees.length === 0
                ? eq(syncShares.accountId, input.accountId)
                : and(eq(syncShares.accountId, input.accountId), notInArray(syncShares.granteeAccountId, keptGrantees)),
            )
            .returning({ id: syncShares.id });

          // ---- Every kept share, re-wrapped
          //
          // An UPDATE, never an upsert: rotation re-wraps grants that already
          // exist. A named share that is not there (the grantee dropped their
          // side, or the client submitted a stale list) rolls the whole
          // rotation back rather than silently creating a grant nobody made
          // in this request.
          for (const share of input.shares) {
            const [row] = await tx
              .update(syncShares)
              .set({
                wrappedDek: Buffer.from(share.wrappedDek),
                recipientKeyFingerprint: share.recipientKeyFingerprint,
                updatedAt: now,
              })
              .where(
                and(eq(syncShares.accountId, input.accountId), eq(syncShares.granteeAccountId, share.granteeAccountId)),
              )
              .returning({ id: syncShares.id });
            if (!row) {
              throw new RotationRefused({
                ok: false,
                reason: 'unknown-share',
                granteeAccountId: share.granteeAccountId,
              });
            }
          }

          // ---- Retention, last, so a rollback above never prunes anything
          const versions = await tx
            .select({ id: syncBlobs.id })
            .from(syncBlobs)
            .where(eq(syncBlobs.accountId, input.accountId))
            .orderBy(desc(syncBlobs.blobVersion));
          const staleIds = versions.slice(BLOB_VERSION_RETENTION).map((row) => row.id);
          if (staleIds.length > 0) {
            await tx.delete(syncBlobs).where(inArray(syncBlobs.id, staleIds));
          }

          return { ok: true, newVersion, keptShares: input.shares.length, revokedShares: revoked.length };
        });
      } catch (error) {
        if (error instanceof RotationRefused) return error.result;
        // Lost the blob-version race to a concurrent push that committed
        // between our read and our insert. Same answer a plain CAS mismatch
        // gives, and nothing of this rotation survived the rollback.
        if (!isUniqueViolation(error)) throw error;
        return { ok: false, reason: 'blob-conflict', currentVersion: await readCurrentBlobVersion(input.accountId) };
      }
    },
  };
}
