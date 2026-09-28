/**
 * Redeems one invite into the fixture account, in a child process.
 *
 * ── Why a child process ──────────────────────────────────────────────────
 *
 * `createSyncAccount` reaches, eight modules down, a route helper that imports
 * `app/i18n/locales/en/common.json`. Vite serves that import; node's own ESM
 * loader refuses it without an import attribute, and Playwright's TypeScript
 * loader is node's. So the ceremony runs under `tsx`, which resolves the JSON
 * the way Vite does, and `global-setup.ts` waits for it.
 *
 * The invite token is minted in the PARENT (it is an in-process seam on the
 * fake service, not an endpoint) and arrives here in the environment. It is a
 * one-shot capability against a service that exists for the length of one test
 * run, on loopback, so this is not a credential leaving the machine.
 *
 * Everything else it needs is the address of that service, which is loopback
 * and fixed by `env.ts`.
 */
import 'fake-indexeddb/auto';

import { createSyncAccount } from '../../app/lib/sync/sync-actions';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { E2E_ACCOUNT_PASSPHRASE, E2E_INVITE_TOKEN_VAR, E2E_SYNC_SERVER_URL } from './env';

/**
 * Small enough to be instant, real enough to be the same algorithm.
 *
 * THE BROWSER RUNS THE SAME ONES. The service stores the descriptor this
 * signup writes, and `/sign-in` derives from that stored descriptor, so
 * shrinking them here shrinks both sides and skips neither.
 */
const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };

const inviteToken = process.env[E2E_INVITE_TOKEN_VAR] ?? '';
if (inviteToken === '') throw new Error(`${E2E_INVITE_TOKEN_VAR} is not set: nothing to redeem.`);

await createSyncAccount({
  serverUrl: E2E_SYNC_SERVER_URL,
  inviteToken,
  passphrase: E2E_ACCOUNT_PASSPHRASE,
  displayName: null,
  deriveHash: deriveArgon2idHash,
  params: FAST_PARAMS,
});
