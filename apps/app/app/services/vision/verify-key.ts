/**
 * Live "is this key valid" check performed before persisting BYOK settings
 * (see `app/routes/settings.ai.tsx`). Never throws — a network failure
 * resolves to `unverified` so the caller can decide to save anyway with a
 * warning, rather than blocking the user on a transient outage.
 *
 * Runs CLIENT-SIDE since M117/02 (the settings form calls it from a
 * `clientAction` — the key never touches the openplate server), so this
 * module deliberately has NO dependency on `#app/lib/logger` (pino is not
 * browser-safe — its dev pretty-transport branch reads `process.stdout` at
 * module init, which throws immediately in a browser bundle). A network
 * failure is silently downgraded to `unverified`; the caller surfaces that to
 * the user instead of a background log line.
 *
 * Security: never logs the key or forwards the request headers into any
 * thrown message.
 */
import type { AiProviderType } from '#types/enums';
import { getAnthropicAuthHeaders } from './constants';
import { getProviderDefinition } from './registry';
import type { ProviderDefinition } from './registry';

const VERIFY_TIMEOUT_MS = 5000;

export type KeyVerificationStatus = 'ok' | 'rejected' | 'unverified';

export interface KeyVerificationResult {
  status: KeyVerificationStatus;
}

export interface VerifyProviderKeyInput {
  provider: AiProviderType;
  apiKey: string;
  /** Only consulted for a provider with no fixed endpoint (`baseUrl: null` in the registry). */
  baseUrl?: string | null;
}

interface VerificationRequest {
  url: string;
  headers: HeadersInit;
}

/**
 * The URL the key check goes to, from the provider's `VerificationStrategy`.
 *
 * Why this is per-provider data and not one hardcoded path: OpenRouter's
 * `/models` is public and answers 200 to any request, key or no key
 * (confirmed directly — `curl` with a bogus key, and with no Authorization
 * header at all, both return 200), which made this whole check a silent
 * no-op; its registry entry therefore points at `/auth/key`, the
 * key-introspection endpoint that does 401 on a bad key.
 *
 * Throws when a `baseUrl: null` provider was given no base URL —
 * `verifyProviderKey` turns that into `rejected` (see its catch below).
 */
function resolveVerificationUrl({
  definition,
  requestedBaseUrl,
}: {
  definition: ProviderDefinition;
  requestedBaseUrl: string | null | undefined;
}): string {
  if (definition.verification.kind === 'absolute-url') return definition.verification.url;

  // `AiSettingsSchema` (M117/02 review fix) requires a base URL for a
  // self-hosted provider on every NEW save, but a row saved before that
  // requirement shipped could still have `baseUrl: null`. Fail loudly rather
  // than silently falling back to api.openai.com, which the browser can never
  // reach anyway (CSP/CORS).
  const configuredBaseUrl = definition.baseUrl ?? requestedBaseUrl;
  if (!configuredBaseUrl || configuredBaseUrl.trim() === '') {
    throw new Error('A base URL is required for a self-hosted / local endpoint.');
  }
  return `${configuredBaseUrl.trim().replace(/\/$/, '')}${definition.verification.path}`;
}

/**
 * Auth headers for the key check — derived from the adapter tag plus the
 * provider's call-time `extraHeaders`, so they are the same bytes the scan
 * call sends. Never logged, never echoed into a thrown message.
 */
function buildVerificationHeaders({
  definition,
  apiKey,
}: {
  definition: ProviderDefinition;
  apiKey: string;
}): HeadersInit {
  if (definition.adapter === 'anthropic') return getAnthropicAuthHeaders({ apiKey });
  return { Authorization: `Bearer ${apiKey}`, ...definition.extraHeaders?.() };
}

function buildVerificationRequest(input: VerifyProviderKeyInput): VerificationRequest {
  const definition = getProviderDefinition(input.provider);
  if (!definition) {
    // A settings row written by a newer build (see `getProviderDefinition`) —
    // a configuration problem, so the caller's catch turns it into `rejected`.
    throw new Error('Unknown AI provider.');
  }

  return {
    url: resolveVerificationUrl({ definition, requestedBaseUrl: input.baseUrl }),
    headers: buildVerificationHeaders({ definition, apiKey: input.apiKey }),
  };
}

/**
 * Checks a BYOK key against a provider endpoint that actually authenticates
 * it — Anthropic's and a caller's own `/models` already enforce auth (a
 * missing/bad key 401s); OpenRouter's `/models` doesn't, so its registry entry
 * points the check at `/auth/key` instead (see `./registry`). Resolves to
 * `rejected` on 401/403 (the key itself is bad), `ok` on any other response
 * (the provider is reachable and didn't reject the key), and `unverified`
 * if the provider couldn't be reached at all (network error/timeout).
 */
export async function verifyProviderKey(input: VerifyProviderKeyInput): Promise<KeyVerificationResult> {
  let url: string;
  let headers: HeadersInit;
  try {
    ({ url, headers } = buildVerificationRequest(input));
  } catch {
    // Missing base URL for openai-compatible — a configuration problem, not
    // a transient network issue, so this is closer to `rejected` (don't save
    // as-is) than `unverified` (save anyway with a warning).
    return { status: 'rejected' };
  }

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
  } catch {
    // Network error/timeout — never logged (no browser-safe logger here, see
    // the module doc comment); the caller surfaces `unverified` to the user.
    return { status: 'unverified' };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'rejected' };
  }

  return { status: 'ok' };
}
