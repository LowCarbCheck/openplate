/**
 * How an invitation or a reset link reaches a person, as pure answers the
 * admin screens draw from.
 *
 * ── A link that opens somewhere else ─────────────────────────────────────
 *
 * The core builds every link from `CLIENT_BASE_URL` and `SERVER_PUBLIC_URL`.
 * The compose files fill those from `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL`, and
 * fall back to `http://localhost:3000` and `http://localhost:3001` when they are
 * unset. So an operator who skipped them was handed a link to pass on that opens
 * only on the server itself. The administrator is looking at the app through
 * the address the family uses, so a link whose origin differs from the page's
 * is the one worth a line of warning.
 *
 * ── A link that opens the right page and then the wrong server ──────────
 *
 * The other half of a link is its `server=`, which tells the app where the
 * core server is. A link on the right app address can still name
 * `http://localhost:3001` there: it opens the right page, and the app then
 * looks for the core server on the reader's own device. The family's page is
 * https on a real host (the app signs nobody in anywhere else), so a loopback
 * or plain-http server beside it is the defect. On this machine, where page,
 * app and server are all loopback, the link is consistent and says nothing.
 *
 * ── What the invite form promises before anything is sent ────────────────
 *
 * The handshake says whether the instance sends mail (`instance.mail`), and the
 * form waits for the handshake before it draws. So the form can say the true
 * sentence from its first paint, and a third one when the handshake failed.
 */

import { isLocalHostname } from '#app/lib/secure-context';

/**
 * The origin a hand-passed link opens, when it is not the origin of the page
 * the administrator is using; `null` when it is the same, when the page origin
 * is not known yet (server render, hydration), or when the link does not parse.
 *
 * ORIGIN, NOT HOST: scheme and port count. `http://openplate.example.org` and
 * `https://openplate.example.org` are two apps with two data stores, and so
 * are two ports on one host.
 */
export function foreignLinkOrigin(input: { link: string; pageOrigin: string | null }): string | null {
  if (input.pageOrigin === null) return null;
  if (!URL.canParse(input.link)) return null;
  const linkOrigin = new URL(input.link).origin;
  // A browser hands `location.origin` over already normalised, but a caller
  // may not; one parse makes both sides the same spelling.
  const pageOrigin = URL.canParse(input.pageOrigin) ? new URL(input.pageOrigin).origin : input.pageOrigin;
  return linkOrigin === pageOrigin ? null : linkOrigin;
}

/**
 * The one warning a hand-passed link can carry, or none. One at a time: when the
 * app address is wrong, its line already names both settings.
 */
export type LinkWarning = { kind: 'other-origin'; origin: string } | { kind: 'unreachable-server'; server: string };

/** The link's `server=` value as an origin, or `null` when it has none or it does not parse. */
function linkServerOrigin(link: URL): string | null {
  const server = new URLSearchParams(link.hash.slice(1)).get('server');
  if (server === null || !URL.canParse(server)) return null;
  return new URL(server).origin;
}

/**
 * Whether the app at `app` can reach a core server at `server`: never one on
 * the reader's own device when the app is not on it too, and never plain http
 * beside an https app, which the browser blocks as mixed content.
 */
function isServerUnreachableFrom(input: { app: URL; server: URL }): boolean {
  const isAppLocal = isLocalHostname(input.app.hostname);
  if (isLocalHostname(input.server.hostname) && !isAppLocal) return true;
  return input.app.protocol === 'https:' && input.server.protocol === 'http:';
}

/**
 * What is wrong with a hand-passed link for somebody on another device, or
 * `null`. The app address first, see {@link foreignLinkOrigin}; then, on the
 * right app address, the `server=` half, see the module header.
 */
export function linkWarning(input: { link: string; pageOrigin: string | null }): LinkWarning | null {
  const origin = foreignLinkOrigin(input);
  if (origin !== null) return { kind: 'other-origin', origin };
  if (input.pageOrigin === null || !URL.canParse(input.link)) return null;
  const app = new URL(input.link);
  const server = linkServerOrigin(app);
  if (server === null) return null;
  return isServerUnreachableFrom({ app, server: new URL(server) }) ? { kind: 'unreachable-server', server } : null;
}

/** The sentence under the invite form's title, one per thing the handshake can say about mail. */
export type InviteBodyKey = 'admin.invite.body' | 'admin.invite.bodyNoMail' | 'admin.invite.bodyUnknown';

/**
 * Which sentence the invite form opens with.
 *
 * `mail` is `instance.mail` from the handshake, or `null` when the handshake did
 * not answer. `null` gets a sentence that is true either way, never one of the
 * other two: an unreachable `/health` says nothing about the mailer.
 */
export function inviteBodyKey(input: { mail: boolean | null }): InviteBodyKey {
  if (input.mail === null) return 'admin.invite.bodyUnknown';
  return input.mail ? 'admin.invite.body' : 'admin.invite.bodyNoMail';
}
