/**
 * The fake sync service, seen through openplate-core's consent rule (M266,
 * `PROTOCOL.md` §5.15.1): a `fetch` to hand a client, which makes the service
 * an instance that asks every account for the consent to health data.
 *
 * WHAT IT CHANGES, and nothing else:
 *
 *  - `/health` names the version in `instance.healthConsent`;
 *  - every account view carries `healthConsent`, `null` until the account
 *    agrees and `{ version, at }` after;
 *  - every write under `/v1/sync` answers `403 health-consent-required` until
 *    the account agrees, and nothing reaches the service. Reads pass;
 *  - `POST /v1/auth/account/health-consent` records the consent for the
 *    version asked, and answers `400 health-consent-required` for any other.
 *
 * ONE ACCOUNT PER INSTANCE of this fetch, which is all a test here needs. The
 * fake service itself stays the source of every session, key record and blob,
 * so what a test observes about those is the service's, not this file's.
 */
import { z } from 'zod';

/** The refusal's machine code, transcribed from `PROTOCOL.md` §4.1. */
export const HEALTH_CONSENT_REQUIRED = 'health-consent-required';

/** The fetch, and what it has seen. */
export interface ConsentAskingService {
  fetchImpl: typeof fetch;
  /** Whether the account has agreed to the version this service asks. */
  readonly isConsented: boolean;
  /** How many writes under `/v1/sync` were refused. */
  readonly refusedWrites: number;
}

const envelopeWithAccountSchema = z.looseObject({ account: z.looseObject({}) });
const handshakeSchema = z.looseObject({ instance: z.looseObject({}) });
const consentBodySchema = z.object({ version: z.string() });

/** The pieces of one request this file branches on, whatever form the caller passed it in. */
interface RequestFacts {
  url: URL;
  method: string;
  authorization: string | null;
  body: string | null;
}

function factsOf(input: string | URL | Request, init: RequestInit | undefined): RequestFacts {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const body = init?.body === undefined || init.body === null ? null : String(init.body);
  return { url, method, authorization: headers.get('authorization'), body };
}

function jsonResponse(input: { status: number; body: object; headers?: Headers }): Response {
  const headers = new Headers(input.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify(input.body), { status: input.status, headers });
}

/**
 * @param input.version - the consent version this instance asks every account for.
 */
export function consentAskingFetch({ version }: { version: string }): ConsentAskingService {
  let consentedAt: string | null = null;
  let refusedWrites = 0;

  /** The account's consent as the view carries it right now. */
  const accountConsent = () => (consentedAt === null ? null : { version, at: consentedAt });

  /** Rewrites a JSON answer so its account view and its handshake say what this instance says. */
  async function withConsentFacts(response: Response, path: string): Promise<Response> {
    const text = await response.text();
    // A `204` and its kin must be rebuilt with no body at all.
    if (text === '') return new Response(null, { status: response.status, headers: response.headers });
    const parsed = JSON.parse(text);
    const account = envelopeWithAccountSchema.safeParse(parsed);
    if (account.success) {
      return jsonResponse({
        status: response.status,
        headers: response.headers,
        body: { ...account.data, account: { ...account.data.account, healthConsent: accountConsent() } },
      });
    }
    const handshake = handshakeSchema.safeParse(parsed);
    if (path === '/health' && handshake.success) {
      return jsonResponse({
        status: response.status,
        headers: response.headers,
        body: { ...handshake.data, instance: { ...handshake.data.instance, healthConsent: { version } } },
      });
    }
    return new Response(text, { status: response.status, headers: response.headers });
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const facts = factsOf(input, init);
    const path = facts.url.pathname;

    if (facts.method === 'POST' && path === '/v1/auth/account/health-consent') {
      const agreed = consentBodySchema.safeParse(facts.body === null ? null : JSON.parse(facts.body));
      if (!agreed.success || agreed.data.version !== version) {
        return jsonResponse({ status: 400, body: { error: HEALTH_CONSENT_REQUIRED } });
      }
      consentedAt ??= new Date().toISOString();
      const read = await fetch(new URL('/v1/auth/account', facts.url), {
        headers: facts.authorization === null ? {} : { authorization: facts.authorization },
      });
      return withConsentFacts(read, '/v1/auth/account');
    }

    if (path.startsWith('/v1/sync/') && facts.method !== 'GET' && consentedAt === null) {
      refusedWrites += 1;
      return jsonResponse({ status: 403, body: { error: HEALTH_CONSENT_REQUIRED } });
    }

    return withConsentFacts(await fetch(input, init), path);
  };

  return {
    fetchImpl,
    get isConsented() {
      return consentedAt !== null;
    },
    get refusedWrites() {
      return refusedWrites;
    },
  };
}
