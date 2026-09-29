/**
 * How an invitation or a reset link reaches a person, as two pure answers the
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
 * ── What the invite form promises before anything is sent ────────────────
 *
 * The handshake says whether the instance sends mail (`instance.mail`), and the
 * form waits for the handshake before it draws. So the form can say the true
 * sentence from its first paint, and a third one when the handshake failed.
 */

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
