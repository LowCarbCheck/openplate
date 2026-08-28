/**
 * THE STUDY CLIENT (`openplate-sync` ADR-0003, `PROTOCOL.md` §5.18 and §3.5).
 *
 * The researcher's half: pull a cohort, open what this device's keys can open,
 * and say out loud what it could not. Pure with respect to the device — the
 * transport and the key material are injected — which is what makes every rule
 * below assertable with no session and no network, exactly as `sharing.ts` is
 * for ADR-0002.
 *
 * ── 1. THE PULL IS THE PURGE ─────────────────────────────────────────────
 *
 * ADR-0003 prohibition 8 says the study client purges tombstoned pseudonyms
 * before presenting or exporting anything, "enforced mechanically on every
 * pull". A filter a caller has to remember to apply is not mechanical, so
 * there is NO function in this module that returns unpurged rows and no export
 * that could grow into one: {@link pullStudyCohort} reads the withdrawals
 * FIRST, drops every withdrawn pseudonym BEFORE any decryption is attempted,
 * and returns only survivors. A withdrawn row's ciphertext is never handed to
 * an opener at all — not as an optimisation, but so that "did we open it?" has
 * one answer and it is no.
 *
 * The raw list still exists on the transport (`listStudyContributions`), and
 * that is deliberate: it is one call below this one, documented as not being
 * the function a screen calls. Nothing above this module may reach past it.
 *
 * ── 2. A TAG FAILURE IS A KEY STATEMENT, NOT A CORRUPTION VERDICT ────────
 *
 * A study may hold more than one key generation — a rotation, or a device
 * restored from an older snapshot. AES-GCM does not say WHY a tag check
 * failed, so `contribution-wrap.ts` collapses wrong-key, wrong-AAD and corrupt
 * into one `unopenable` reason on purpose. This module reads that as "try the
 * next key I hold", and reports a row un-openable only after EVERY held key
 * has failed. Stopping at the first key would report a rotated study's whole
 * back catalogue as unreadable.
 *
 * `malformed` is the only genuine error: a body too short to hold an ephemeral
 * public key and an IV, an ephemeral point that is not on P-256, a tier this
 * protocol revision does not define, or a payload that opens and then is not
 * the tier it claims. Every one of those fails identically under every key, so
 * there is nothing to retry.
 *
 * ── 3. UN-OPENABLE ROWS ARE COUNTED OUT LOUD ─────────────────────────────
 *
 * A cohort that silently shrinks is worse than one that says "4 of 31
 * contributions are sealed to a key this device does not hold". The counts
 * ride in {@link StudyCohort} and in the export header; they are never rounded
 * away, and a non-zero count is NOT an error state. It usually means a key
 * generation is missing from this device, which is a thing a researcher can
 * act on — and only she can, since no key of hers is on the server.
 */
import type { StudyContribution, SurfaceRead, SyncHttpClient } from '../engine/client/http-client';
import { importEciesPrivateKey } from '../engine/crypto/ecies';
import { buildContributionAad, ContributionOpenError, openContribution } from './contribution-wrap';
import { decodeDailyIntakeV1Payload } from './payload';
import { DAILY_INTAKE_V1, type DailyIntakeV1Row } from './tiers';

/** What this module is allowed to touch. Narrowed from the client so nothing here can reach a blob, a key record or a contributor-side verb. */
export type StudyTransport = Pick<SyncHttpClient, 'listStudyContributions' | 'listStudyWithdrawals'>;

/**
 * ONE KEY GENERATION this study holds.
 *
 * Both halves, because both are needed: the private key derives the KEK, and
 * the PUBLIC key is what §3.5's `studyKeyFingerprint` is taken of — so a
 * contribution sealed to generation A only opens when generation A's AAD is
 * rebuilt too. Trying a private key against another generation's fingerprint
 * would fail the tag check for the wrong reason.
 */
export interface StudyKeyPair {
  /** Uncompressed SEC1 raw public key (65 bytes). Its SHA-256 is the AAD's fingerprint field. */
  publicKeyRaw: Uint8Array;
  /** PKCS#8 private key. Never sent anywhere, never logged; its whole life is a call frame in this module. */
  privateKeyPkcs8: Uint8Array;
}

/** What became of one contribution. Three values, and only the third is an error — see this module's header. */
export type ContributionOpenOutcome =
  | { status: 'opened'; rows: DailyIntakeV1Row[] }
  /** Every held key produced a tag failure. A statement about this device's keyring, not about the row. */
  | { status: 'no-key-held' }
  /** Structurally impossible under every key: short body, off-curve ephemeral point, unknown tier, or a payload that is not the tier it claims. */
  | { status: 'malformed' };

/** One opened contribution, ready to present. Carries the pseudonym and nothing that could become an account id. */
export interface StudyCohortRow {
  /** The only participant identifier that exists on this side. Pseudonymous — see the export header, and ADR-0003 prohibition 5. */
  pseudonym: string;
  contributionVersion: number;
  schemaTier: string;
  createdAt: string;
  /** The reduced days, in the order the contributor emitted them: one per calendar day in the window, gaps included. */
  days: DailyIntakeV1Row[];
}

/**
 * A pulled, PURGED cohort. There is no unpurged counterpart of this type,
 * anywhere, on purpose.
 */
export interface StudyCohort {
  /** The caller's own account id, echoed once by §5.18 and used to rebuild every AAD. Not a participant identifier. */
  studyAccountId: number;
  rows: StudyCohortRow[];
  /**
   * HOW MANY PARTICIPANTS WITHDREW — the tombstone count, straight from
   * `GET /study/withdrawals`.
   *
   * NOT the number of rows the client filter removed. Withdrawal on the
   * service is one transaction that hard-deletes the contribution and inserts
   * the tombstone, so a healthy deployment never returns a withdrawn row and
   * "rows my filter dropped" is structurally zero. Reporting that number would
   * print "Withdrawn: 0" on a study where ten people withdrew — a false
   * reassurance on a research artifact, and the same class of silent
   * understatement as swallowing {@link StudyCohort.unopenableCount}.
   */
  withdrawnCount: number;
  /**
   * Rows the SERVER returned that already carried a tombstone.
   *
   * Expected to be zero, always. A non-zero value is not a routine purge: it
   * means the service handed over a contribution it had already been
   * instructed to delete. The client purged it anyway — that filter is
   * defence in depth — but the fact is worth reporting rather than counting.
   * Deliberately NOT summed into {@link StudyCohort.withdrawnCount}: one is a
   * fact about participants, the other about a server.
   */
  serverRetainedWithdrawnCount: number;
  /** Rows sealed to a key this device does not hold. Not an error state; see this module's header. */
  unopenableCount: number;
  /** Rows this protocol revision cannot make sense of at all. The only count that is a bug report. */
  malformedCount: number;
}

/** The opener, as {@link pullStudyCohort} injects it. Injected so a test can prove a withdrawn body never reaches one. */
export type ContributionOpener = (input: {
  contribution: StudyContribution;
  studyAccountId: number;
  keys: readonly StudyKeyPair[];
}) => Promise<ContributionOpenOutcome>;

/**
 * Pulls the cohort and returns it purged.
 *
 * The order of the two reads is the guarantee: withdrawals FIRST, so this
 * function never holds rows it cannot yet purge, and a deployment that answers
 * `unavailable` for the tombstones never yields a cohort at all.
 *
 * @param keys - every key generation this study holds. An empty list is legal and yields a cohort of nothing but `unopenableCount`.
 * @param open - the per-row opener. Defaults to {@link openCohortContribution}; overridden only by tests.
 * @returns `unavailable` when this deployment has no research lane (ADR-0003 prohibition 9) — not an error, and not a retry.
 */
export async function pullStudyCohort({
  transport,
  keys,
  open = openCohortContribution,
}: {
  transport: StudyTransport;
  keys: readonly StudyKeyPair[];
  open?: ContributionOpener;
}): Promise<SurfaceRead<StudyCohort>> {
  const withdrawals = await transport.listStudyWithdrawals();
  if (withdrawals.status === 'unavailable') return { status: 'unavailable' };
  const page = await transport.listStudyContributions();
  if (page.status === 'unavailable') return { status: 'unavailable' };

  const withdrawn = new Set(withdrawals.value.map((tombstone) => tombstone.pseudonym));
  // THE PURGE, before the loop that decrypts and above every line that could
  // read a body. Moving it below the opener would still produce a correct
  // cohort and would still be wrong: a withdrawn person's data would have been
  // decrypted on a researcher's machine first.
  const surviving = page.value.contributions.filter((contribution) => !withdrawn.has(contribution.pseudonym));

  const rows: StudyCohortRow[] = [];
  let unopenableCount = 0;
  let malformedCount = 0;
  for (const contribution of surviving) {
    const outcome = await open({ contribution, studyAccountId: page.value.studyAccountId, keys });
    if (outcome.status === 'no-key-held') {
      unopenableCount += 1;
      continue;
    }
    if (outcome.status === 'malformed') {
      malformedCount += 1;
      continue;
    }
    rows.push({
      pseudonym: contribution.pseudonym,
      contributionVersion: contribution.contributionVersion,
      schemaTier: contribution.schemaTier,
      createdAt: contribution.createdAt,
      days: outcome.rows,
    });
  }

  return {
    status: 'available',
    value: {
      studyAccountId: page.value.studyAccountId,
      rows,
      // The tombstones ARE the withdrawals. The subtraction below counts
      // something else entirely — see both fields' doc comments.
      withdrawnCount: withdrawals.value.length,
      serverRetainedWithdrawnCount: page.value.contributions.length - surviving.length,
      unopenableCount,
      malformedCount,
    },
  };
}

/**
 * Opens ONE contribution by trying every key generation this study holds.
 *
 * The AAD is rebuilt per key, from four fields of the response and a
 * fingerprint computed HERE from this device's own public key. That ordering
 * is the key-substitution defence: a server that swapped the study's key
 * cannot produce a body that opens, because the fingerprint it would need is
 * never one it supplied.
 *
 * The loop stops early only for {@link ContributionOpenOutcome}'s `malformed`,
 * which is key-independent. A tag failure NEVER stops it — that is decision 2
 * of this module's header, and stopping at the first key is the defect the
 * "key statement" test exists to catch.
 */
export async function openCohortContribution({
  contribution,
  studyAccountId,
  keys,
}: {
  contribution: StudyContribution;
  studyAccountId: number;
  keys: readonly StudyKeyPair[];
}): Promise<ContributionOpenOutcome> {
  // A tier this revision does not define cannot be presented whatever key
  // opens it, so it is structural rather than a keyring question. The server
  // rejects unknown tiers too (§5.18); this is the same refusal on the reading
  // side, for a row written by a client the protocol has since moved past.
  if (contribution.schemaTier !== DAILY_INTAKE_V1) return { status: 'malformed' };

  // Imported OUTSIDE the attempt, so a private key this device cannot import
  // throws rather than being charged to the row. A broken keyring is the
  // researcher's problem to fix; silently marking her cohort malformed would
  // hide it behind data that looks merely disappointing.
  const generations = await Promise.all(
    keys.map(async (key) => ({
      publicKeyRaw: key.publicKeyRaw,
      privateKey: await importEciesPrivateKey(key.privateKeyPkcs8),
    })),
  );

  for (const generation of generations) {
    const outcome = await tryOpenWithKey({ contribution, studyAccountId, generation });
    if (outcome.status !== 'no-key-held') return outcome;
  }
  // Every key failed its tag check. Which of the three indistinguishable
  // causes it was, this code does not know and must not guess.
  return { status: 'no-key-held' };
}

/** One key generation, ready to try: the public half for the AAD's fingerprint, the private half for the derivation. */
interface ImportedStudyKey {
  publicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
}

/** One key generation's attempt. `no-key-held` here means "this key failed", and only the caller's loop can turn that into a verdict. */
async function tryOpenWithKey({
  contribution,
  studyAccountId,
  generation,
}: {
  contribution: StudyContribution;
  studyAccountId: number;
  generation: ImportedStudyKey;
}): Promise<ContributionOpenOutcome> {
  try {
    const aad = await buildContributionAad({
      studyAccountId,
      pseudonym: contribution.pseudonym,
      contributionVersion: contribution.contributionVersion,
      schemaTier: contribution.schemaTier,
      studyPublicKeyRaw: generation.publicKeyRaw,
    });
    const payload = await openContribution({ body: contribution.body, privateKey: generation.privateKey, aad });
    const days = decodeDailyIntakeV1Payload(payload);
    // Authentic but not well-formed: the tag held, so this really is a body
    // sealed to this key — and it still is not the tier it claims to be.
    if (days === null) return { status: 'malformed' };
    return { status: 'opened', rows: days };
  } catch (error) {
    if (error instanceof ContributionOpenError && error.reason === 'unopenable') return { status: 'no-key-held' };
    // Everything else is structural and key-independent: a body shorter than
    // its own header (`ContributionOpenError` with reason `malformed`), an
    // ephemeral point WebCrypto refuses to import, or a version field that
    // cannot be canonicalised into an AAD.
    return { status: 'malformed' };
  }
}
