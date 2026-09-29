/**
 * The SMTP transport: one finished letter onto an SMTP server, through
 * nodemailer, the library the owner approved on 2026-09-29.
 *
 * ── WHY SMTP CAME BACK ───────────────────────────────────────────────────
 *
 * M181 deleted the SMTP client and said SMTP was a non-goal: this service spoke
 * pigeon's HTTP API and nothing else. A person who runs openplate for their
 * family rarely has an HTTP mail API, and nearly always has an SMTP login: a
 * Gmail app password, Amazon SES SMTP, the provider behind their domain. The
 * owner reversed the decision ("Add SMTP back"). The HTTP transport stays
 * exactly as it was; this is the second one, and `config.ts` refuses to boot
 * with both.
 *
 * ── THE PORT DECIDES TLS, AND THERE IS NO SWITCH FOR "OFF" ───────────────
 *
 * Port 465 is implicit TLS. Every other port must upgrade with STARTTLS
 * (`requireTLS`), so a server that does not offer it gets no envelope, no
 * login and no letter. The one exception is a host that is this machine, a
 * local catcher such as Mailpit, which may stay plain; it still upgrades when
 * the catcher offers STARTTLS. `config.ts` makes that call from the host and
 * the port and hands over the result as `tls`. Certificates are always
 * checked: nothing here sets `rejectUnauthorized`, and Node's default is to
 * verify.
 *
 * ── A FAILED SEND THROWS A CODE AND NOTHING THE SERVER SAID ──────────────
 *
 * The same contract as `postMail` in `mailer.ts`: the caller decides what a
 * failure means (`emailed: false` and the link, in the admin answer). An SMTP
 * server's refusal text is where a recipient address comes back
 * (`550 5.1.1 <anna@example.org>: ...`), so the thrown message carries the
 * reply code, or nodemailer's own error code, and nothing else.
 */
import { createTransport } from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';

import type { MailTransport, OutgoingMail } from './mailer.js';

/**
 * How a connection gets encrypted, decided by `config.ts` from the port and
 * the host:
 *  - `implicit-tls`: port 465, TLS from the first byte;
 *  - `starttls-required`: every other port on a host that is not this machine;
 *    a server that does not offer STARTTLS gets nothing;
 *  - `starttls-if-offered`: a loopback host, for a local catcher; plain text
 *    unless the catcher offers STARTTLS.
 */
export type SmtpTlsMode = 'implicit-tls' | 'starttls-required' | 'starttls-if-offered';

/** `SMTP_USER` and `SMTP_PASSWORD`, which are both set or both unset. */
export interface SmtpLogin {
  user: string;
  password: string;
}

/**
 * What an operator configured for SMTP, already validated by `config.ts`.
 *
 * `transport` is the discriminant against `HttpMailConfig`, which predates this
 * transport and keeps its shape.
 */
export interface SmtpMailConfig {
  transport: 'smtp';
  /** `SMTP_HOST`, as the operator wrote it: a name or an address, no scheme and no port. */
  host: string;
  /** `SMTP_PORT`, 587 when unset. */
  port: number;
  tls: SmtpTlsMode;
  /** `null` for a server that takes no login, which only a local catcher does. */
  auth: SmtpLogin | null;
  /** `SMTP_FROM`, the sending address, `Name <address>` or a bare address. */
  from: string;
  /** `MAIL_OPERATOR_EMAIL`, shared with the HTTP transport. See `HttpMailConfig.operatorEmail`. */
  operatorEmail: string;
}

/**
 * Ten seconds for the connection, the greeting and every quiet stretch after
 * it. A dead server then fails in about the time the HTTP transport's 15 s
 * bound allows, instead of nodemailer's defaults of two minutes and ten, which
 * would hold an administrator's request open long after they gave up.
 */
export const DEFAULT_SMTP_TIMEOUT_MS = 10_000;

/**
 * The nodemailer options for one config. Pure, so the TLS rules above are
 * testable without a server.
 */
export function smtpTransportOptions(input: { mail: SmtpMailConfig; timeoutMs: number }): SMTPTransportOptions {
  const { mail, timeoutMs } = input;
  const options: SMTPTransportOptions = {
    host: mail.host,
    port: mail.port,
    secure: mail.tls === 'implicit-tls',
    requireTLS: mail.tls === 'starttls-required',
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    dnsTimeout: timeoutMs,
    // Nothing from the conversation reaches a log: it carries the recipient,
    // and with `debug` the letter itself, which carries a token.
    logger: false,
    debug: false,
  };
  // Set in a statement rather than spread conditionally, so the omission is a
  // line a reader sees instead of a `{}` they have to decode.
  if (mail.auth !== null) options.auth = { user: mail.auth.user, pass: mail.auth.password };
  return options;
}

/** A nodemailer error code: capital letters after an E, nothing that could carry an address. */
const ERROR_CODE = /^E[A-Z0-9_]+$/u;

/**
 * The one line a failed send may carry: the server's reply code when it gave
 * one, else nodemailer's error code. Never `message` or `response`, which
 * quote the server, and the server quotes the recipient.
 */
function describeSendFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return 'SMTP send failed: unknown error';
  const responseCode = 'responseCode' in cause ? Number(cause.responseCode) : Number.NaN;
  if (Number.isInteger(responseCode) && responseCode >= 200 && responseCode <= 599) {
    return `SMTP server responded ${responseCode}`;
  }
  const code = 'code' in cause ? String(cause.code) : '';
  return `SMTP send failed: ${ERROR_CODE.test(code) ? code : 'unknown error'}`;
}

/**
 * Sends each letter over its own connection. No pool: a family instance sends
 * a handful of letters a week, and a pooled connection is one more thing that
 * can go stale between them.
 */
export function createSmtpTransport(input: { mail: SmtpMailConfig; timeoutMs?: number }): MailTransport {
  const transporter = createTransport(
    smtpTransportOptions({ mail: input.mail, timeoutMs: input.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS }),
  );
  return {
    async send(outgoing: OutgoingMail): Promise<void> {
      try {
        await transporter.sendMail({
          from: input.mail.from,
          to: outgoing.to,
          subject: outgoing.subject,
          text: outgoing.text,
          html: outgoing.html,
          // The letters are built from strings here; nothing in them may make
          // nodemailer read a file or fetch a URL.
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } catch (cause) {
        // NO `cause` ON PURPOSE: nodemailer's error quotes the server, and the
        // server quotes the recipient. Attached, the address would be one
        // `error.cause` away from a log line, which is what `postMail` avoids
        // by never reading an error body.
        // oxlint-disable-next-line eslint/preserve-caught-error -- the cause carries the recipient; see above.
        throw new Error(describeSendFailure(cause));
      }
    },
  };
}
