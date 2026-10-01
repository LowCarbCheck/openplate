/**
 * Email alias and forwarding domains (M270, spec 04).
 *
 * WHAT IT IS FOR. One person can make a new address at these services in a
 * few seconds, at no cost, and every new address would be a new free scan
 * trial. An address on one of these domains can still sign up and can still
 * buy a plan, but it gets no trial: the account is made with 0 trial scans,
 * the same shape as a mailbox whose trial is used up.
 *
 * A DOMAIN MATCHES ITSELF AND EVERY SUBDOMAIN, so `a.b.simplelogin.co` is on
 * the list because `simplelogin.co` is.
 *
 * `icloud.com` is NOT here on purpose. It is a real mailbox, and only the
 * `privaterelay.appleid.com` forwarding names are aliases.
 *
 * Keep this list sorted, one domain per line, all lowercase.
 */
export const ALIAS_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '33mail.com',
  'addy.io',
  'addymail.com',
  'aleeas.com',
  'anonaddy.com',
  'anonaddy.me',
  'burnermail.io',
  'dispostable.com',
  'duck.com',
  'emailondeck.com',
  'erine.email',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'maildrop.cc',
  'mailinator.com',
  'mohmal.com',
  'mozmail.com',
  'passfwd.com',
  'passinbox.com',
  'passmail.com',
  'passmail.net',
  'privaterelay.appleid.com',
  'relay.firefox.com',
  'sharklasers.com',
  'silomails.com',
  'simplelogin.co',
  'simplelogin.com',
  'simplelogin.fr',
  'slmail.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempmail.dev',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

/**
 * Whether the address's domain, or any parent of it with at least two labels,
 * is on {@link ALIAS_DOMAINS}.
 *
 * A single-label parent (`com`) is never checked, so no entry can ever cover a
 * whole top-level domain. The address is lowercased here, because the answer
 * must not depend on which caller already did it. An address with no `@` is
 * not an alias address.
 */
export function isAliasAddress(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const labels = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .split('.');
  for (let start = 0; start <= labels.length - 2; start += 1) {
    if (ALIAS_DOMAINS.has(labels.slice(start).join('.'))) return true;
  }
  return false;
}
