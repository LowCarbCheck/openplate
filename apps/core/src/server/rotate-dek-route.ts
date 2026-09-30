/**
 * Express glue for `POST /v1/sync/rotate-dek` (PROTOCOL.md §5.17, ADR-0002
 * Tier 2) — one owner-authenticated submission that lands in one transaction.
 *
 * IT IS NOT BEHIND `SYNC_SHARING`, AND THAT IS A DECISION RATHER THAN AN
 * OVERSIGHT.
 *
 * The share ROUTE TREES are dark without `SYNC_SHARING` (prohibition 10), and
 * they must stay that way: their existence discloses that this instance holds
 * a care graph. Rotation discloses nothing of the sort. It rewrites the
 * account's own blob and its own two key records — rows that exist on every
 * account of every deployment — and it is useful to an owner who has never
 * shared anything at all: any belief that the DEK leaked (a restored backup,
 * a lost device, an exported snapshot) is answered by rotating it. Gating the
 * only mechanism that can retire a compromised DEK behind an unrelated
 * sharing flag would mean a self-hoster with sharing off has no way to retire
 * one, which is a worse property than the disclosure it would buy.
 *
 * On an instance with no share graph the `shares` array simply has nothing to
 * do: the keep list must be empty, the store's delete clause matches no rows,
 * and the rotation is exactly the blob-plus-key-records operation it would be
 * for an account with no grants. A NON-EMPTY keep list there is a `400` — the
 * client is asserting state that cannot exist, and accepting it silently
 * would report clinicians re-wrapped on an instance that has never held a
 * share row. That 400 is not a new oracle: it is reachable only by a
 * credentialed caller, who can already distinguish the two configurations by
 * `GET /v1/sync/shares` answering `200` or `404`.
 *
 * `resolveEntitledUser` IS the right seam here, unlike on the grantee read
 * path. This route's caller and its target are the same account by
 * definition — an owner rotating their own DEK — so the ordinary resolver
 * answers the only question there is. `SyncEntitledUser` stays a one-field
 * type; ADR-0002 rejects extending it, and nothing here needs it extended.
 *
 * A ROTATION CARRIES A NEW RECOVERY CODE, AND BOTH FIELDS ARE REQUIRED (M192
 * addendum). The `recovery` key record this submission re-wraps is wrapped
 * under a KEK derived from the account's recovery code, so a rotation that
 * left `accounts.recovery_verifier` and the escrow on the OLD code produced an
 * account whose escrowed code authenticated and then unwrapped nothing. That
 * was latent from M181 and became fatal the moment a mailed reset started
 * handing that code to people (PROTOCOL.md §5.12). A request missing either
 * field is a `400` that names it, rather than the generic body rejection: a
 * client upgrading needs to know which field it forgot.
 *
 * A ROTATION ALSO ASKS FOR THE CURRENT PASSPHRASE (`currentAuthHash`), AND
 * THE SERVER DERIVES THE RECOVERY PROOF ITSELF (2026-09). The route used to
 * write a new recovery verifier and escrow on a bearer token alone, and
 * `POST /v1/auth/recover` turns that verifier into a session. A stolen token
 * could therefore plant a code of its own and sign in with it after the owner
 * had changed their passphrase, for as long as it liked. Now:
 *
 *  - `currentAuthHash` is matched as change-passphrase matches it, throttled
 *    per account (`accounts/passphrase-gate.ts`), before anything is written;
 *    a miss is `401` and writes nothing.
 *  - The recovery verifier is computed from a proof the SERVER derives from
 *    the canonical `recoveryCode` (`lib/recovery-auth.ts`), so the verifier
 *    and the escrow cannot describe two different codes. A client whose
 *    `newRecoveryAuthHash` disagrees is refused with a `400`.
 *  - The transaction compares the account's verifier against the one matched,
 *    and revokes every session but the caller's own family.
 *
 * The caller's family comes from the bearer middleware's request session
 * (`getRequestSession`), not from `SyncEntitledUser`, which stays one field.
 */
import express from 'express';
import type { Express, Request, Response } from 'express';
import type {
  RotateDekKeyRecordInput,
  RotateDekShareInput,
  SyncEntitledUser,
  SyncRotationStore,
} from '../contract-types.js';
import { MAX_BLOB_BYTES, SYNC_API_PREFIX, isSyncKeyRecordKind } from '../protocol.js';
import { asArray, asNumber, asObject, asPositiveInteger, asString, type JsonValue } from '../lib/json.js';
import { parseAuthHashField, parseRecoveryCode } from '../accounts/auth-input.js';
import { computeVerifier } from '../lib/verifier.js';
import { sealRecoveryCode } from '../lib/escrow.js';
import { deriveRecoveryAuthHash } from '../lib/recovery-auth.js';
import { PASSPHRASE_REJECTED, sendPassphraseRefusal, type PassphraseGate } from '../accounts/passphrase-gate.js';
import { asyncHandler } from './async-handler.js';
import { getRequestSession } from './bearer-auth.js';
import { handleRotateDek } from './rotate-dek-handler.js';

export const ROTATE_DEK_PATH = `${SYNC_API_PREFIX}/rotate-dek`;

/**
 * Derived from the protocol's blob cap exactly as `register-routes.ts`
 * derives its own, with extra room for both key-record wraps and a keep list:
 * base64 inflates by 4/3, and a body limit set at the raw cap would reject a
 * legitimate maximum-size rotation before any handler saw it.
 */
export const ROTATE_DEK_JSON_BODY_LIMIT = Math.ceil((MAX_BLOB_BYTES * 4) / 3) + 64 * 1024;

export interface RotateDekHostContext {
  rotation: SyncRotationStore;
  resolveEntitledUser: (req: Request) => Promise<SyncEntitledUser | null>;
  /** Whether `SYNC_SHARING` is on. Not a gate on this route — see the module header — only on what a keep list may say. */
  sharingEnabled: boolean;
  /**
   * The two `SERVER_SECRET` subkeys this route needs to turn the submitted
   * recovery credential into what the account row stores: the verifier pepper,
   * and the AES key the escrow is sealed under.
   *
   * Both come from `deriveServerSecrets`, and both are used here exactly as
   * the auth handlers use them — one `computeVerifier`, one `sealRecoveryCode`.
   * Nothing on this path derives a KEK or unwraps a DEK.
   */
  recoveryCredentials: { pepper: string; escrowKey: Buffer };
  /** Matches `currentAuthHash` against the account, throttled per account. See `accounts/passphrase-gate.ts`. */
  passphrase: PassphraseGate;
}

function fromBase64(value: JsonValue | undefined): Uint8Array | null {
  const encoded = asString(value);
  if (encoded === null) return null;
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}

function sendInvalidBody(res: Response): void {
  res.status(400).json({ error: 'invalid request body' });
}

/** One key-record entry, or `null` when its shape is wrong. `kdfDescriptor` may legitimately be absent (recovery). */
function parseKeyRecord(value: JsonValue): RotateDekKeyRecordInput | null {
  const entry = asObject(value);
  if (entry === null) return null;
  const kind = entry.kind;
  if (!isSyncKeyRecordKind(kind)) return null;
  const wrappedDek = fromBase64(entry.wrappedDek);
  if (wrappedDek === null) return null;
  return { kind, kdfDescriptor: asObject(entry.kdfDescriptor), wrappedDek };
}

/** One keep-list entry, or `null` when its shape is wrong. */
function parseShare(value: JsonValue): RotateDekShareInput | null {
  const entry = asObject(value);
  if (entry === null) return null;
  const granteeAccountId = asPositiveInteger(entry.granteeAccountId);
  const wrappedDek = fromBase64(entry.wrappedDek);
  const recipientKeyFingerprint = asString(entry.recipientKeyFingerprint);
  if (granteeAccountId === null || wrappedDek === null || recipientKeyFingerprint === null) return null;
  return { granteeAccountId, wrappedDek, recipientKeyFingerprint };
}

export function registerRotateDekRoute(app: Express, context: RotateDekHostContext): void {
  const router = express.Router();
  // SCOPED TO THE ROUTES THAT READ A BODY, NOT TO THE SYNC PREFIX. This router
  // is mounted with `app.use(router)` at the ROOT, and `express.json()` marks a
  // request as parsed, so whichever parser runs first wins and every other
  // router's declared limit becomes unreachable. An unscoped parser capped the
  // AI proxy until M192/03. A parser on `SYNC_API_PREFIX` did the same one
  // level down until 2026-09-30: the blob router is registered first, so its
  // 2.8 MB limit applied to every sync route, and cut this route's 64 KB of keep-list headroom to 4 KB.
  // `tests/integration/sync-body-limits.test.ts` proves each limit per route.
  const parseJsonBody = express.json({ limit: ROTATE_DEK_JSON_BODY_LIMIT });

  router.post(
    ROTATE_DEK_PATH,
    parseJsonBody,
    asyncHandler(async (req, res) => {
      const user = await context.resolveEntitledUser(req);
      if (user === null) {
        res.status(403).json({ error: 'sync not enabled for this account' });
        return;
      }
      // The bearer middleware set this on every request that reached here; a
      // missing one is an unauthenticated request, whatever the resolver said.
      const session = getRequestSession(req);
      if (session === null) {
        res.status(401).json({ error: 'authentication required' });
        return;
      }

      const body = asObject(req.body) ?? {};
      const blob = asObject(body.blob);
      const keyRecordEntries = asArray(body.keyRecords);
      // ABSENT IS NOT EMPTY. `shares: []` is a meaningful instruction here —
      // it revokes every share — so a caller must say it, exactly as §5.4
      // requires `expectedUpdatedAt` to be written out rather than omitted.
      const shareEntries = asArray(body.shares);
      if (blob === null || keyRecordEntries === null || shareEntries === null) {
        sendInvalidBody(res);
        return;
      }

      // THE CURRENT PASSPHRASE, named when missing for the reason the recovery
      // fields below are: a client that predates it must be told which field.
      // Parsed here, matched only once the whole body is known to be
      // well-formed, so a malformed request never spends a guess.
      const currentAuthHash = parseAuthHashField(body.currentAuthHash, 'currentAuthHash');
      if (!currentAuthHash.ok) {
        res.status(400).json({ error: `rotate-dek requires ${currentAuthHash.reason}` });
        return;
      }

      const baseVersion = asNumber(blob.baseVersion);
      const envelopeVersion = asNumber(blob.envelopeVersion);
      const ciphertext = fromBase64(blob.ciphertext);
      if (baseVersion === null || envelopeVersion === null || ciphertext === null) {
        sendInvalidBody(res);
        return;
      }
      if (ciphertext.byteLength > MAX_BLOB_BYTES) {
        res.status(413).json({ error: `blob exceeds the maximum of ${MAX_BLOB_BYTES} bytes` });
        return;
      }

      // THE NEW RECOVERY CREDENTIAL, both halves required (M192 addendum).
      // Named errors rather than the generic body rejection: a client that
      // predates the addendum needs to be told which field it is missing.
      const newRecoveryAuthHash = parseAuthHashField(body.newRecoveryAuthHash, 'newRecoveryAuthHash');
      if (!newRecoveryAuthHash.ok) {
        res.status(400).json({ error: `rotate-dek requires ${newRecoveryAuthHash.reason}` });
        return;
      }
      // THE SAME PARSER SIGNUP AND recover-rotate USE, so one recovery code has
      // one canonical form everywhere: grouped or ungrouped text in, 32
      // uppercase Crockford characters sealed.
      const recoveryCode = parseRecoveryCode(body.recoveryCode);
      if (!recoveryCode.ok) {
        res.status(400).json({ error: `rotate-dek requires ${recoveryCode.reason}` });
        return;
      }
      // THE PROOF IS THE SERVER'S, derived from the code it is about to seal,
      // so the verifier and the escrow always describe the same code. The
      // client's copy is still required and must agree: a disagreement is a
      // client whose code and proof came apart, and sealing either one would
      // leave the account with a recovery code that does not sign in.
      const recoveryAuthHash = deriveRecoveryAuthHash(recoveryCode.value);
      if (recoveryAuthHash !== newRecoveryAuthHash.value) {
        res.status(400).json({ error: 'newRecoveryAuthHash does not match recoveryCode' });
        return;
      }

      const keyRecords: RotateDekKeyRecordInput[] = [];
      for (const entry of keyRecordEntries) {
        const record = parseKeyRecord(entry);
        if (record === null) {
          sendInvalidBody(res);
          return;
        }
        keyRecords.push(record);
      }

      const shares: RotateDekShareInput[] = [];
      for (const entry of shareEntries) {
        const share = parseShare(entry);
        if (share === null) {
          sendInvalidBody(res);
          return;
        }
        shares.push(share);
      }

      // LAST BEFORE THE WRITE: every refusal above is about the request, and
      // costs no guess. A miss here is `401` and nothing was written.
      const passphrase = await context.passphrase.check({
        accountId: user.userId,
        authHash: currentAuthHash.value,
      });
      if (passphrase.status !== 'matched') {
        sendPassphraseRefusal(res, passphrase);
        return;
      }

      const result = await handleRotateDek(
        {
          accountId: user.userId,
          blob: { baseVersion, envelopeVersion, ciphertext },
          keyRecords,
          shares,
          // The raw code exists in this handler and inside `sealRecoveryCode`,
          // and nowhere else. It is never logged and never returned.
          recoveryVerifier: computeVerifier({
            authHash: recoveryAuthHash,
            pepper: context.recoveryCredentials.pepper,
          }),
          recoveryCodeEscrow: sealRecoveryCode({
            code: recoveryCode.value,
            escrowKey: context.recoveryCredentials.escrowKey,
          }),
          sharingEnabled: context.sharingEnabled,
          expectedVerifier: passphrase.verifier,
          keepSession: { tokenId: session.tokenId, familyId: session.familyId },
        },
        context.rotation,
      );

      if (result.status === 'invalid') {
        res.status(400).json({ error: result.reason });
        return;
      }
      if (result.status === 'conflict') {
        // The blob CAS, answering exactly as §5.1 does. Nothing was written:
        // the transaction rolled back before the key records or the shares.
        res.status(409).json({ currentVersion: result.currentVersion });
        return;
      }
      if (result.status === 'credential-superseded') {
        // The passphrase changed between the match above and the transaction.
        // The caller no longer holds the credential this rotation was
        // authorised by; the same answer a wrong passphrase gets.
        res.status(401).json({ error: PASSPHRASE_REJECTED });
        return;
      }
      if (result.status === 'unknown-share') {
        // A keep list naming a share that is not there — the grantee dropped
        // their side, or the client is working from a stale list. The rotation
        // was rolled back whole; re-list `GET /v1/sync/shares` and resubmit.
        res.status(400).json({ error: `no such share for grantee ${result.granteeAccountId}` });
        return;
      }
      res.status(200).json({
        newVersion: result.newVersion,
        keptShares: result.keptShares,
        revokedShares: result.revokedShares,
      });
    }),
  );

  app.use(router);
}
