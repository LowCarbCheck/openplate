/**
 * Which push endpoints this service will ever POST to.
 *
 * WHY THERE IS A LIST AT ALL (2026-09-30). A push endpoint is a URL the device
 * hands over, and the minute tick POSTs to it. Until this module existed the
 * registration route accepted any non-empty string, so a signed-in caller
 * could register `http://10.0.0.5:6379/` or the cloud metadata address and
 * make this service send a request there every minute: a server-side request
 * forgery with a timer on it. A real browser only ever returns an endpoint at
 * one of a handful of push services, so the list below is the whole world a
 * legitimate registration comes from.
 *
 * THE RULE, checked at registration and again by the tick for rows written
 * before it existed:
 *
 *  - `https:` only, on the default port, with no user name or password in it;
 *  - a host from {@link DEFAULT_PUSH_SERVICE_HOSTS}, or from the operator's
 *    `PUSH_ENDPOINT_HOSTS` for a self-hosted push service.
 *
 * A HOST PATTERN IS EXACT, OR `*.` AND A SUFFIX. `*.push.apple.com` matches
 * `api.push.apple.com` and `a.b.push.apple.com`, never `push.apple.com` itself
 * and never `evilpush.apple.com`. There is no bare `*`.
 *
 * Pure module: no clock, no store, no network. The DNS answer for an allowed
 * host is not checked, because the hosts are the push services' own names.
 */

/**
 * Where browsers actually send their subscriptions, verified against what each
 * one returns from `pushManager.subscribe` (2026-09-30):
 *
 *  - Chrome, Brave, Opera, Samsung Internet and every other Chromium browser
 *    but Edge: Firebase Cloud Messaging, `https://fcm.googleapis.com/fcm/send/...`
 *    or `https://fcm.googleapis.com/wp/...`.
 *  - Firefox: Mozilla autopush, `https://updates.push.services.mozilla.com/wpush/v2/...`.
 *    The wildcard covers the other autopush hosts Mozilla has used.
 *  - Safari on macOS and on iOS 16.4 and later: `https://web.push.apple.com/...`.
 *    The wildcard covers Apple's other push hosts.
 *  - Edge: Windows Notification Service, `https://<region>.notify.windows.com/w/?token=...`,
 *    whose first label varies by region (`wns2-par02p`, `db5p`, ...).
 *
 * `android.googleapis.com` (the old GCM) is absent on purpose: Google shut it
 * down in 2019, and an endpoint there could only ever fail.
 */
export const DEFAULT_PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  '*.push.services.mozilla.com',
  'web.push.apple.com',
  '*.push.apple.com',
  '*.notify.windows.com',
];

/** A host name, or `*.` and a host name: letters, digits and hyphens between dots, as `URL` writes a host in lower case. */
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** What a caller asks. A policy object rather than a function so the route and the tick share one instance. */
export interface PushEndpointPolicy {
  /** Whether this service may POST to `endpoint`. Never throws: an unparseable string is simply not allowed. */
  isAllowed(endpoint: string): boolean;
}

/** Whether a host-list entry is well formed. `config.ts` refuses to boot on one that is not. */
export function isPushHostPattern(pattern: string): boolean {
  return HOST_PATTERN.test(pattern);
}

function hostMatches(input: { host: string; pattern: string }): boolean {
  if (!input.pattern.startsWith('*.')) return input.host === input.pattern;
  const suffix = input.pattern.slice(1);
  return input.host.endsWith(suffix) && input.host.length > suffix.length;
}

/**
 * The policy for this instance: the default push services plus
 * `extraHosts`, which `config.ts` has already lower-cased and validated.
 */
export function createPushEndpointPolicy(input: { extraHosts: readonly string[] }): PushEndpointPolicy {
  const patterns = [...DEFAULT_PUSH_SERVICE_HOSTS, ...input.extraHosts];
  return {
    isAllowed(endpoint: string): boolean {
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        return false;
      }
      if (url.protocol !== 'https:') return false;
      // `URL` reports the default port as the empty string, so `:443` written
      // out still passes and every other port does not.
      if (url.port !== '') return false;
      if (url.username !== '' || url.password !== '') return false;
      return patterns.some((pattern) => hostMatches({ host: url.hostname, pattern }));
    },
  };
}
