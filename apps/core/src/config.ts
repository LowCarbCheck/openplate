/**
 * Environment → typed config, with a PURE parser (`parseConfig`) so the
 * validation rules are unit-testable without touching `process.env`.
 *
 * FAIL FAST, ALWAYS. Every misconfiguration below throws at boot rather than
 * degrading: a service that starts with a weak `SERVER_SECRET` or an absent
 * `DATABASE_URL` would take real accounts before anyone noticed. A container
 * that refuses to start is a five-minute incident; one that silently accepts
 * signups it can't authenticate later is not.
 *
 * `.env.example` is the operator-facing counterpart to this file and must be
 * kept in step with it.
 */
import { readFileSync } from 'node:fs';
import { isLogLevel, type LogLevel } from './logger.js';
import {
  INSTANCE_LANGUAGES,
  NUTRIENT_REFERENCE_BASES,
  isInstanceLanguage,
  isNutrientReferenceBasis,
  type InstanceLanguage,
  type NutrientReferenceBasis,
  type OperatorNotice,
} from './protocol.js';
import type { HttpMailConfig, MailConfig } from './mail/mailer.js';
import type { SmtpMailConfig, SmtpTlsMode } from './mail/smtp-transport.js';
import type { AiUpstreamConfig } from './ai/proxy.js';
import type { PlansUpstreamConfig } from './server/plans-proxy.js';
import type { VapidCredentials } from './push/web-push-sender.js';
import { isPushHostPattern } from './push/endpoint-policy.js';
import { MAX_DAILY_AI_LIMIT } from './admin/invite-store.js';
import { DEFAULT_SERVICE_MAX_DAILY_AI_LIMIT } from './server/service-principal-scope.js';
import { DEFAULT_MEMBER_INVITE_LIFETIME_CAP, type MemberInvitePolicy } from './accounts/member-invites.js';
import type { TurnstileConfig } from './accounts/captcha.js';
import { DEFAULT_TRIAL_TIME_ZONE, MAX_TRIAL_DAYS, MAX_TRIAL_SCANS, type TrialPolicy } from './accounts/scan-trial.js';
import { DEFAULT_AI_MAX_OUTPUT_TOKENS } from './ai/chat-body-policy.js';
import {
  BUNDLED_MODEL_TIERS,
  findDearUnguardedRoutes,
  loadModelTiers,
  type ModelTiers,
  type ModelTiersSource,
} from './ai/model-tiers.js';
import { DEFAULT_AI_BUDGET_ALERT_FRACTION } from './ai/budget-alert.js';
import { defaultTrialNetworkDailyLimit } from './ai/trial-network.js';
import {
  DEFAULT_AI_IMAGE_INPUT_TOKENS,
  DEFAULT_AI_MAX_IMAGE_PARTS,
  DEFAULT_AI_MAX_MESSAGES,
  DEFAULT_AI_MAX_TEXT_BYTES,
  DEFAULT_AI_UNIT_INPUT_TOKENS,
  type ChatInputPolicy,
} from './ai/chat-input-bounds.js';
import { isHealthConsentVersion } from './accounts/health-consent.js';
import { parseCapabilitySchemaMap, parseDefaultCapabilities } from './lib/capabilities.js';
import {
  LEGAL_DECLARATION_RECEIPTS_PER_DAY,
  LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY,
} from './legal/receipt-ceilings.js';

/**
 * Minimum accepted `SERVER_SECRET` length. 32 characters is the shortest
 * value that carries ~128 bits when generated the way `.env.example` tells
 * operators to (`openssl rand -hex 32` gives 64). This is a real gate: the
 * verifier pepper derived from it is the only thing standing between a
 * stolen `accounts` table and offline verification of guessed auth-hashes.
 */
export const MIN_SERVER_SECRET_LENGTH = 32;

/**
 * Minimum accepted `ADMIN_TOKEN` length, matching `openplate-gateway`'s
 * `MIN_ADMIN_TOKEN_LENGTH`. This credential lists every account on the
 * instance and erases any of them, so it is worth more to an attacker than
 * any single user's session: it must be GENERATED, not chosen, and 24
 * characters is the shortest length at which a generated value is not worth
 * guessing. A too-short value is a boot failure rather than a warning, see
 * the module header.
 */
export const MIN_ADMIN_TOKEN_LENGTH = 24;

/**
 * Longest accepted `SYNC_NOTICE`, in characters.
 *
 * THE CAP IS NOT TIDINESS. The notice is published on `GET /health`, which is
 * this container's own HEALTHCHECK path (`bay-sprqvntrs` sets
 * `healthcheck_path: /health`) and is therefore polled continuously, forever.
 * An unbounded string there is a payload the operator inflicts on their own
 * instance. 280 characters is enough for "we are moving on 1 March, details at
 * the link" and short enough that nobody is tempted to publish a changelog.
 *
 * Over-long is a BOOT FAILURE, not a truncation: silently cutting a shutdown
 * notice in half would ship a sentence the operator never wrote.
 */
export const MAX_SYNC_NOTICE_LENGTH = 280;

/** Schemes a `SYNC_NOTICE_URL` may use. Anything else (`javascript:`, `data:`) is a boot failure, never a rendered link. */
const NOTICE_URL_SCHEMES = ['https:', 'http:'];

export interface ServiceConfig {
  port: number;
  /**
   * The address the listener binds to, or `null` for every interface. `HOST`,
   * unset by default.
   *
   * `null` IS THE PRODUCTION DEFAULT AND HAS TO STAY ONE. This process runs in
   * a container behind Traefik, and the only route in is the address the
   * container network hands it. A loopback bind here would make the service
   * unreachable from the proxy, so do not "harden" this default. See
   * `main.ts`, which also explains why the value is not `0.0.0.0`.
   *
   * IT IS THE DEVELOPMENT MACHINE THAT NEEDS IT SET. A dev instance binding
   * every interface publishes a seeded database, an admin token and the whole
   * `/v1/admin` tree to every machine on the operator's LAN. `HOST=127.0.0.1`
   * is what a laptop wants.
   */
  host: string | null;
  databaseUrl: string;
  databaseSsl: boolean;
  /** Root secret; `lib/server-secrets.ts` derives the domain-separated subkeys from it. Never used directly. */
  serverSecret: string;
  /** What this instance calls itself on the handshake and in its start-up log. `INSTANCE_NAME`, default `openplate`. */
  instanceName: string;
  /**
   * Which language its letters are written in when the request names no reader's language.
   * `INSTANCE_LANGUAGE`, one of `INSTANCE_LANGUAGES`, default `en`.
   */
  instanceLanguage: InstanceLanguage;
  /**
   * This service's own public base URL, or `null`. It goes into the `server=`
   * fragment of a join or reset link, so a person who clicks one lands on a
   * client already pointed at the right instance.
   *
   * Optional because a self-hosted instance reached only over a tailnet has no
   * public URL, and inventing one would produce a link that goes nowhere. A
   * link is then simply not built and the raw token is returned instead.
   */
  serverPublicUrl: string | null;
  /**
   * Where the openplate client lives, or `null`. The other half of a link.
   *
   * IT CAME BACK FROM THE DEAD, AND THAT IS DELIBERATE. M181 made this name a
   * BOOT FAILURE, because with the mailer deleted nothing in this service
   * linked into a client and the variable had become required and unread. M192
   * mails invitations and resets again, so it is read again. `SIGNUP_MODE`
   * takes its place on the fatal list.
   */
  clientBaseUrl: string | null;
  /**
   * Mail configuration, or `null` for an instance that sends none, the
   * default, and what every deployment gets until an operator points it at a
   * relay.
   *
   * ONE TRANSPORT, THE HTTP MAIL API OR SMTP, each block all-or-nothing, and
   * either requires {@link ServiceConfig.serverPublicUrl} and
   * {@link ServiceConfig.clientBaseUrl}: a letter with no link in it is not
   * worth sending, and a half-configured block is an operator who believes
   * mail works. In production both must also be https and name a host other
   * than this machine, see `refuseUnreachableLinkBases`. See `parseMail`.
   */
  mail: MailConfig | null;
  /**
   * `CONTENT_DIR`, the instance's mounted content folder, or `null` when
   * unset (M246/04). The same env name, and the same folder, the app renders
   * its legal pages from: one instance's tree of the legal file contract.
   * This service reads only `<lang>/mail/<template>.md` from it, the text of
   * the two declaration letters, see `mail/declaration-templates.ts`.
   *
   * OPTIONAL, AND NEVER CHECKED AT BOOT. A folder that is missing or half
   * mounted must not stop the service that records a statutory declaration:
   * each letter falls back to a neutral text that states the facts, and the
   * send logs why. `null` sends that neutral text on every declaration.
   */
  contentDir: string | null;
  /**
   * The AI proxy's upstream, or `null` for an instance that offers no AI ,
   * the default, and what every deployment gets until an operator sets a key.
   *
   * `null` is not "mounted but refusing": `POST /v1/chat/completions` answers
   * the ordinary unknown-path 404, to everybody, for the same reason the admin
   * and share trees do (`server/create-app.ts`).
   */
  ai: AiUpstreamConfig | null;
  /**
   * `AI_ADVERTISED_MODEL`: the model behind the proxy, or `null`.
   *
   * ENFORCED SINCE M256, not only advertised. `/health` publishes it, and the
   * proxy writes it into every forwarded chat body, for every account, so a
   * caller cannot pick a dearer model on the operator's key. `null` publishes
   * no model and passes the caller's `model` through, which is the freedom a
   * self-hosted instance may want. See `ai/chat-body-policy.ts`.
   *
   * SINCE THE TIER FILE this is the PARSED OVERRIDE, not the model that is
   * published: with `AI_TIERS_FILE` set it replaces the model of the DEFAULT
   * tier alone (the emergency knob), and without it the one implicit tier IS
   * this value. The model a request gets is the model of its tier, see
   * {@link ServiceConfig.aiTiers}.
   */
  aiAdvertisedModel: string | null;
  /**
   * The model tiers (`AI_TIERS_FILE`, see `ai/model-tiers.ts`): which model,
   * which zero retention routing and which output cap a proxied request gets.
   * Unset is LEGACY MODE, one implicit tier built from `AI_ADVERTISED_MODEL`,
   * `UPSTREAM_ZDR` and `UPSTREAM_PROVIDER_ONLY`, so an instance that sets none
   * of the new variable behaves exactly as before. Parsed even when no upstream
   * key is set, so a typo in the file is found on the day it is made.
   */
  aiTiers: ModelTiers;
  /** Where {@link ServiceConfig.aiTiers} came from, for the boot log line. */
  aiTiersSource: ModelTiersSource;
  /**
   * What the boot log prints at warn level about the tiers: each emergency
   * override that is set, and each route to a dearer tier that no
   * `CAPABILITY_SCHEMA_MAP` entry guards. Never a key.
   */
  aiTiersWarnings: readonly string[];
  /**
   * `AI_MAX_OUTPUT_TOKENS`: the most output tokens one proxied request may ask
   * for, default {@link DEFAULT_AI_MAX_OUTPUT_TOKENS}. Applied with or without
   * a model: a larger value is capped, a missing one is written in. See
   * `ai/chat-body-policy.ts` for how the default was measured.
   */
  aiMaxOutputTokens: number;
  /**
   * What one proxied request may carry IN, and what one unit of the daily
   * counters covers (2026-09-30), each a positive integer with a default
   * measured on the app's largest real request:
   *
   *  - `AI_MAX_IMAGE_PARTS`, default {@link DEFAULT_AI_MAX_IMAGE_PARTS};
   *  - `AI_MAX_TEXT_BYTES`, default {@link DEFAULT_AI_MAX_TEXT_BYTES};
   *  - `AI_MAX_MESSAGES`, default {@link DEFAULT_AI_MAX_MESSAGES};
   *  - `AI_UNIT_INPUT_TOKENS`, default {@link DEFAULT_AI_UNIT_INPUT_TOKENS};
   *  - `AI_IMAGE_INPUT_TOKENS`, default {@link DEFAULT_AI_IMAGE_INPUT_TOKENS}.
   *
   * A body over one of the first three is refused before anything is
   * counted; the last two set how many units a request weighs. See
   * `ai/chat-input-bounds.ts` for the measurement and the arithmetic.
   */
  aiInputPolicy: ChatInputPolicy;
  /** Requests per account in any trailing 60 seconds on the proxy route. `AI_RATE_LIMIT_PER_MINUTE`, default 20. */
  aiRateLimitPerMinute: number;
  /**
   * The whole instance's AI ceiling in requests per UTC day
   * (`AI_INSTANCE_DAILY_LIMIT`), or `null` for NO ceiling, which is the default
   * and what every existing deployment and every self-hoster keeps.
   *
   * IT IS THE ONLY BOUND HERE THAT IS NOT PER ACCOUNT, and that is why it
   * exists. `accounts.daily_ai_limit` and {@link ServiceConfig.aiRateLimitPerMinute}
   * both key on the caller, so ten accounts at 200 requests a day is 2000
   * requests a day against the operator's provider key. Invitations multiply
   * accounts; before M212 nothing multiplied the bound because there was no
   * bound.
   *
   * IN THE SAME UNIT AS THE PER-ACCOUNT ALLOWANCE, requests per UTC day, so an
   * operator can do the arithmetic without a second mental model.
   *
   * ZERO IS A BOOT FAILURE, not "off". See `parseAiInstanceDailyLimit`.
   */
  aiInstanceDailyLimit: number | null;
  /**
   * The low-budget alert line (`AI_BUDGET_ALERT_FRACTION`, 2026-09-30): the
   * operator gets one mail per reset period once the provider key has less
   * than this share of its limit left. Above 0 and below 1; default 0.2. Read
   * only on an OpenRouter upstream, the one with a key read, and sent only
   * with mail configured. See `ai/budget-alert.ts`.
   */
  aiBudgetAlertFraction: number;
  /**
   * What an invitation a MEMBER causes is worth, or `null` for an instance
   * where members cannot invite anybody, which is the default and what every existing
   * deployment and every self-hoster keeps.
   *
   * BOTH SETTINGS OR NEITHER (`MEMBER_INVITE_DAILY_AI_LIMIT` and
   * `MEMBER_INVITE_ALLOWANCE_DAYS`), and half of the pair is a boot failure
   * naming the missing one, exactly as the mail block is. An allowance with no
   * end date is a trial that never ends, and an end date with no allowance is a
   * letter that grants nothing; both are far more likely a typo than an
   * intention.
   *
   * `null` IS NOT "MOUNTED BUT REFUSING". `POST /v1/auth/invites` answers the
   * ordinary unknown-path 404 there, to every signed-in caller, for the same
   * reason the admin, share, research and feedback trees do
   * (`server/create-app.ts`). `InstanceInfo.memberInvites` reports it
   * descriptively so a client knows whether to draw the card.
   *
   * THE LIFETIME CAP RIDES ALONG (`MEMBER_INVITE_LIFETIME_CAP`, default 5,
   * M228). It is optional because it only narrows a door the pair opens, and
   * it travels here rather than as a constant so the route, the caller's own
   * account view and the operator's console all count to the same number.
   *
   * NEITHER VALUE IS READABLE OR WRITABLE BY THE CALLER. The member mint takes
   * an address and nothing else: the terms are the instance's, and that is the
   * one thing separating this route from the operator's.
   */
  memberInvites: MemberInvitePolicy | null;
  /**
   * The instance's scan trial (M253): `TRIAL_SCANS` free AI scans at
   * `TRIAL_DAILY_AI_LIMIT` requests a day, or `null` for an instance that runs
   * none, which is the default.
   *
   * BOTH OR NEITHER, and half is a boot failure that names the missing one. A
   * count with no daily bound is an unbounded retry loop on a flaky provider,
   * and a daily bound with no count is a standing grant nobody meant.
   *
   * `TRIAL_DAYS` (M267) is the optional third value: the trial also ends at
   * local midnight after that many days following the sign-up day, whichever
   * comes first. Unset is `days: null`, no end date, which is what every
   * instance before it keeps. Set without the pair it is a boot failure, a
   * dial with no door. `TRIAL_TIME_ZONE` names the zone of that midnight,
   * `UTC` by default, and is a boot failure without `TRIAL_DAYS`.
   *
   * WHAT READS IT: the open sign-up door, a member invite under
   * `MEMBER_INVITE_TRIAL=true`, and an operator mint with `"trial": true`.
   * Every door that creates a trial account writes exactly these values on
   * the invite row, and `/health` publishes the count as `instance.trial.scans`
   * and the day limit, when there is one, as `instance.trial.days`.
   */
  trial: TrialPolicy | null;
  /**
   * What all scan-trial accounts together may spend per UTC day
   * (`AI_TRIAL_INSTANCE_DAILY_LIMIT`, M253), or `null` for no sub-ceiling.
   *
   * IT EXISTS SO FARMING CANNOT STARVE PAYING PEOPLE. It sits below
   * `AI_INSTANCE_DAILY_LIMIT` and refuses only scan-trial accounts, with the
   * same `503 ai-instance-ceiling`, so a burst of new trials runs out of their
   * own budget first. Zero is a boot failure, and so is setting it on an
   * instance with no trial: a dial with no door.
   */
  aiTrialInstanceDailyLimit: number | null;
  /**
   * What one caller network may spend of the trial ceiling per UTC day
   * (`AI_TRIAL_NETWORK_DAILY_LIMIT`, M270 spec 12), or `null` where there is
   * no trial ceiling to take a share of.
   *
   * IT EXISTS SO A FEW FARMED ACCOUNTS CANNOT USE UP THE TRIAL CEILING. A
   * network is an IPv6 /64 or one IPv4 address (`lib/client-address.ts`).
   * Unset is a tenth of `AI_TRIAL_INSTANCE_DAILY_LIMIT`, rounded down, at
   * least 1 (owner, 2026-10-01). A refused request gets the trial ceiling's
   * own `503 ai-instance-ceiling`. Zero, a value above the trial ceiling and
   * a value with no trial ceiling are boot failures; a share equal to the
   * ceiling is how an operator turns it off.
   */
  aiTrialNetworkDailyLimit: number | null;
  /**
   * The free AI requests per UTC day every account gets that has no free
   * limit of its own (`DEFAULT_FREE_DAILY_AI_LIMIT`, 2026-10-05), or `0` for
   * none, which is the default and what every existing deployment and every
   * self-hoster keeps.
   *
   * IT IS A STANDING CAP, NOT A TRIAL. It never ends, it is never scan gated,
   * and it is counted per UTC day in `ai_usage_days` like every other limit.
   * The proxy's order is unchanged: a live paid window, then the free limit
   * (the account's own when above zero, otherwise this), then the scan trial.
   *
   * IT CANNOT STAND BESIDE A SCAN TRIAL. The cap replaces the trial, so an
   * instance that sets both is a boot failure naming both: two free grants
   * with no order between them would be a decision made by whichever door an
   * account happened to come through. See {@link parseDefaultFreeDailyAiLimit}.
   */
  defaultFreeDailyAiLimit: number;
  /**
   * `DEFAULT_CAPABILITIES`: what an account with no capability record of its own
   * may do. `null`, which is unset or empty, means no check at all, which is
   * what every instance had before capabilities existed. `[]` is the word
   * `none`: such an account may use no feature. See `lib/capabilities.ts`.
   */
  defaultCapabilities: string[] | null;
  /** `CAPABILITY_SCHEMA_MAP`: structured-output schema name to the capability its use requires. Empty when unset. */
  capabilitySchemaMap: ReadonlyMap<string, string>;
  /**
   * The secret the one mailbox, one trial rule hashes addresses with
   * (`TRIAL_ADDRESS_PEPPER`, M253), or `null`.
   *
   * REQUIRED BESIDE THE TRIAL PAIR, optional without it. With it, an invite
   * row carries a keyed hash of its mailbox, and deleting an account scrubs
   * the address from every invite row and keeps ONE thing: that hash, when
   * the account held a trial (`db/schema.ts`, `trial_address_hashes`). With
   * none, invite rows keep their address after a deletion, as they always
   * have, for the member re-invite rule.
   *
   * CHANGING IT FORGETS EVERY MAILBOX that already had its trial, because the
   * old hashes no longer match. Generate it once, like `SERVER_SECRET`.
   */
  trialAddressPepper: string | null;
  /**
   * `TRIAL_HASH_RETENTION_DAYS`: how many days the keyed mailbox hash of a
   * deleted account is kept (default 365), counted from the deletion. After it
   * the hourly sweep deletes the row (`db/trial-hash-retention.ts`, ADR-0010)
   * and the same mailbox can have a trial again.
   */
  trialHashRetentionDays: number;
  /**
   * Whether anybody may ask this instance for an account with their own
   * address (`OPEN_SIGNUP=true`, M253). `false`, the default, and what every
   * instance that did not set it keeps: invite-only.
   *
   * IT IS STILL AN INVITE. `POST /v1/auth/signup-request` mints an ordinary
   * addressed invite with the same code the operator's mint uses and MAILS it
   * to the address, so the letter is the address check. That is why this is a
   * boot failure without mail: a door that mints links nobody receives is a
   * door that only fills a table.
   *
   * `false` IS NOT "MOUNTED BUT REFUSING". The path answers the ordinary
   * unknown-path 404, like every optional tree here.
   */
  openSignup: boolean;
  /**
   * The Turnstile keys the open sign-up door checks a captcha with, or `null`
   * when this instance runs no captcha (M253).
   *
   * `TURNSTILE_SECRET_KEY` AND `TURNSTILE_SITE_KEY`, BOTH OR NEITHER, and only
   * beside `OPEN_SIGNUP=true`: the captcha guards that one door, so a pair set
   * on an invite-only instance is a dial with nothing to turn.
   *
   * OPTIONAL EVEN WITH THE DOOR OPEN, and `main.ts` says so in a boot log
   * line. This repository is self-hosted by people who may not want a
   * Cloudflare account; a managed instance that opens its door sets both.
   */
  turnstile: TurnstileConfig | null;
  /**
   * The largest request body the proxy route accepts, in bytes.
   * `AI_MAX_REQUEST_BYTES`, default 8 MB.
   *
   * IT IS NOT THE BLOB LIMIT, and the first version of this route wrongly
   * derived it from one. `MAX_BLOB_BYTES` bounds a diary, a compressed,
   * encrypted document this service stores. A completion body carries a
   * PHOTOGRAPH this service only forwards: a modern phone camera produces 3
   * to 6 MB of JPEG, base64 inflates it by 4/3, and the blob-derived figure
   * (2.73 MB) rejected every real plate scan with a 413 before the handler ran.
   * 8 MB is the bound the retired gateway used, for the same reason.
   */
  aiMaxRequestBytes: number;
  /**
   * Express `trust proxy` setting. MUST be enabled behind a reverse proxy or
   * `req.ip` is the proxy's address and the per-IP throttle collapses into
   * one global bucket that any single attacker can lock for everyone.
   */
  trustProxy: boolean | number;
  /**
   * The operator's admin credential, or `null` when the admin API is not
   * enabled on this instance, which is the default, and the state every
   * deployment is in until somebody deliberately sets the variable.
   *
   * `null` does not mean "mounted but locked". It means the entire
   * `/v1/admin` tree answers the ordinary unknown-path `404`, to everybody
   * (`server/create-app.ts`). See
   * `docs/adr/0001-an-admin-api-for-a-zero-knowledge-service.md`: this
   * service auto-deploys on push, so the commit that adds a route is the
   * commit that puts it in production, and an unconfigured deployment has to
   * be indistinguishable from one where the feature was never written.
   */
  adminToken: string | null;
  /**
   * The biller's scoped service credential, or `null` when no biller reaches
   * this instance, which is the default, and what every deployment and every
   * self-hoster has until somebody deliberately sets the variable (M213).
   *
   * IT IS NOT A SECOND `ADMIN_TOKEN`, and the difference is the point. This
   * value reaches three routes and two fields:
   * `server/service-principal-scope.ts` is the whole policy. It cannot list
   * the accounts on the instance, cannot read an address, cannot suspend,
   * cannot change a role, cannot erase and cannot open a reported
   * photograph. Setting this one alone is the shape a paid instance wants.
   *
   * IT MAY NOT EQUAL `ADMIN_TOKEN`, and that is a boot refusal. The admin door
   * tries the operator's credential first, so one string in both variables
   * would hand the biller the whole admin API. See `parseTokens`.
   *
   * `null` behaves exactly as `adminToken`'s does: with both unset the whole
   * `/v1/admin` tree answers the ordinary unknown-path `404` to everybody.
   */
  billingToken: string | null;
  /**
   * The largest `dailyAiLimit` the biller's credential may write
   * (`BILLING_MAX_DAILY_AI_LIMIT`, default 1000, at most `MAX_DAILY_AI_LIMIT`).
   * It may also never clear an allowance's end date. The operator's
   * credentials are bounded by neither. See
   * `server/service-principal-scope.ts`.
   */
  billingMaxDailyAiLimit: number;
  /**
   * The biller this instance forwards `/v1/plans/*` to, or `null` when no
   * biller stands behind it, which is the default and what every self-hoster
   * has (M213).
   *
   * `PLANS_UPSTREAM_URL` AND `PLANS_UPSTREAM_SECRET`, BOTH OR NEITHER. A URL
   * with no secret is a boot refusal rather than a silent downgrade: the
   * secret is the only thing that tells the biller this request came from a
   * gateway that authenticated somebody, so forwarding without one would ask
   * it to trust an unsigned account id.
   *
   * `null` IS NOT "MOUNTED BUT REFUSING". The whole `/v1/plans` subtree
   * answers the ordinary unknown-path 404 there, to everybody, credentialed
   * or not (`server/create-app.ts`), for the reason `adminToken`,
   * `sharingEnabled` and `feedbackEnabled` do the same.
   */
  plans: PlansUpstreamConfig | null;
  /**
   * The VAPID credentials web push signs with, or `null` for an instance that
   * sends no notifications, which is the default and what every deployment
   * gets until an operator generates a pair.
   *
   * `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` AND `VAPID_SUBJECT`, ALL OR NONE,
   * exactly as the mail, AI and plans blocks are. A half-configured block is an
   * operator who believes their users are getting a morning catch-up, so it is
   * a boot failure that names the missing variable and never a value.
   *
   * `null` IS NOT "MOUNTED BUT REFUSING". The whole `/v1/push` subtree answers
   * the ordinary unknown-path 404, and `/health` advertises `push: false`. See
   * `docs/adr/0008-push-is-a-scheduling-exception.md`.
   */
  push: VapidCredentials | null;
  /**
   * Extra push service hosts a device may register an endpoint at
   * (`PUSH_ENDPOINT_HOSTS`, comma separated, `*.` allowed as a prefix), on top
   * of the browsers' own push services in `push/endpoint-policy.ts`. Empty by
   * default, and only a self-hoster running their own push service needs it.
   */
  pushEndpointHosts: string[];
  /**
   * Whether this instance implements ADR-0002's clinician sharing.
   *
   * `false`, the default, and what every deployment gets until an operator
   * deliberately turns it on, is not "mounted but refusing". Both share
   * subtrees answer the ordinary unknown-path 404, to everybody
   * (`server/create-app.ts`), for the same reason the admin API does: this
   * service auto-deploys on push, so the commit that adds a route is the
   * commit that puts it in production, and an instance that has not opted in
   * must be indistinguishable from one where the feature was never written.
   */
  sharingEnabled: boolean;
  /**
   * Whether this instance implements ADR-0003's research contributions.
   *
   * INDEPENDENT OF {@link ServiceConfig.sharingEnabled}, neither flag implies
   * the other. A clinic instance may want sharing and no cohort graph; a study
   * host may want the reverse. `false`, the default, is not "mounted but
   * refusing": both contribution subtrees answer the ordinary unknown-path 404
   * to everybody (`server/create-app.ts`), because this service auto-deploys
   * on push and an instance that has not opted in must be indistinguishable
   * from one where the feature was never written.
   */
  researchEnabled: boolean;
  /**
   * Whether this instance accepts reported estimates (ADR-0006).
   *
   * `false` is the default, and it is the setting every deployment has until
   * an operator deliberately changes it. It is not "mounted but refusing":
   * the whole `/v1/feedback` subtree answers the ordinary unknown-path 404, to
   * everybody, with or without a valid token (`server/create-app.ts`), for the
   * reason `adminToken`, `sharingEnabled` and `researchEnabled` do the same.
   *
   * IT IS NOT LIKE THE OTHER THREE IN WHAT IT COSTS. Turning sharing or
   * research on leaves this service holding more bytes it has no key for.
   * Turning THIS on means the operator holds photographs of their users' food,
   * in the clear, and can look at them. See
   * `docs/adr/0006-a-reported-photograph-is-the-second-hole-in-the-claim.md`.
   */
  feedbackEnabled: boolean;
  /** How many reports one account may store per UTC day. `FEEDBACK_DAILY_LIMIT`, default 5. */
  feedbackDailyLimit: number;
  /**
   * The largest request body `POST /v1/feedback` accepts, in bytes.
   * `FEEDBACK_MAX_REQUEST_BYTES`, default 8 MB.
   *
   * SIZED FOR A PHOTOGRAPH AFTER BASE64, exactly as
   * {@link ServiceConfig.aiMaxRequestBytes} is, and for the same reason: the
   * decoded image cap is 5 MB and base64 inflates by 4/3, so a body limit at
   * the image cap would reject a legal maximum-size report before the handler
   * ran. It is a SEPARATE knob from the AI one because the two routes bound
   * different things: one forwards a photograph, this one keeps it.
   */
  feedbackMaxRequestBytes: number;
  /**
   * Receipts the legal declarations form may mail in any trailing 24 hours,
   * across every recipient. `LEGAL_DECLARATION_RECEIPTS_PER_DAY`, default 200.
   *
   * The form needs no sign-in (§312k BGB) and mails a receipt to whatever
   * address was typed, from this instance's sending domain. This is the
   * ceiling that keeps many senders together from spending that domain's
   * reputation, which the password resets and invitations depend on. Past it
   * a declaration is still stored, forwarded and sent to the operator; only
   * its receipt is skipped, and the response does not change. See
   * `legal/receipt-ceilings.ts`. The per-address ceiling (three a day) and
   * the burst limit (five a minute per IPv4 address or IPv6 /64) stay fixed
   * in `server/legal-declarations.ts`.
   */
  legalReceiptsPerDay: number;
  /**
   * Receipts one sender network, an IPv4 address or an IPv6 /64, may cause in
   * any trailing 24 hours. `LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY`,
   * default 10. The same past-the-ceiling rule as
   * {@link ServiceConfig.legalReceiptsPerDay}; the count lives in memory and
   * resets on a restart.
   */
  legalReceiptsPerNetworkPerDay: number;
  /**
   * The operator's message to every client, or `null`, the default, and what
   * an instance with nothing to say has.
   *
   * This is the whole of M181's notice channel, and it is deliberately static
   * config rather than a table with an admin endpoint. Both deliver the same
   * string to the same banner; only one of them needs a migration, a store, a
   * route, its own authorisation and its own tests. An operator who wants to
   * change it redeploys, exactly as they do for every other setting here.
   *
   * It is not a notification system: nobody who does not open the app will
   * ever see it, and the service cannot know who did. See `README.md`, an
   * operator who needs to be able to REACH their users keeps that list
   * themselves, outside this service.
   */
  notice: OperatorNotice | null;
  /**
   * Which body's micronutrient reference values this instance shows at BOOT
   * (`NUTRIENT_REFERENCE_BASIS`, default `dge`).
   *
   * THE ONLY KNOB IN THIS FILE THAT IS NOT THE LAST WORD (M234). Every other
   * value here is decided by the environment and changed by a redeploy; this
   * one is a DEFAULT. An administrator changes the live setting with
   * `PATCH /v1/admin/settings`, which writes the `instance_settings` row, and
   * the row wins from the moment it exists. This value is what the service
   * runs on before the row is read, and what it falls back to when the row
   * cannot be read at all, see `instance/instance-settings.ts`.
   */
  nutrientReferenceBasis: NutrientReferenceBasis;
  /**
   * The version of the health-data consent wording this instance asks every
   * account to agree to (`HEALTH_CONSENT_VERSION`), or `null`, the default,
   * for an instance that asks for none.
   *
   * `null` IS THE SELF-HOSTED DEFAULT AND IT IS NOT A GAP. An instance whose
   * operator is the person has nobody to ask. A hosted instance whose privacy
   * notice names Art. 9(2)(a) GDPR sets it, and from then on every account is
   * created with the consent recorded on it, and every existing account is
   * asked once (`accounts/health-consent.ts`).
   *
   * CHANGING IT ASKS EVERYBODY AGAIN. The stored version stops matching, so
   * the app prompts once more. Change it when the wording a person agrees to
   * changes, and not otherwise.
   */
  healthConsentVersion: string | null;
  logLevel: LogLevel;
}

/**
 * `ADMIN_TOKEN` is optional; when present it must be long enough to be worth
 * having. An absent value is not a misconfiguration, it is the default, and
 * it leaves the admin API unmounted.
 */
function parseAdminToken(env: NodeJS.ProcessEnv): string | null {
  const raw = env.ADMIN_TOKEN?.trim();
  if (raw === undefined || raw === '') return null;
  if (raw.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new Error(
      `ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters, generate it, do not choose it (see .env.example)`,
    );
  }
  return raw;
}

/**
 * `BILLING_TOKEN` is optional, and an absent value is the default rather than
 * a misconfiguration: it means no biller reaches this instance and the service
 * principal does not exist here at all.
 *
 * THE SAME MINIMUM LENGTH AS `ADMIN_TOKEN`, and the same refusal shape. A
 * shorter reason would be that this credential can only move two numbers, and
 * it is not good enough: those two numbers are what somebody pays for, so a
 * guessable value here is a free allowance for anybody who finds the host.
 * Generate it, do not choose it.
 */
function parseBillingToken(env: NodeJS.ProcessEnv): string | null {
  const raw = env.BILLING_TOKEN?.trim();
  if (raw === undefined || raw === '') return null;
  if (raw.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new Error(
      `BILLING_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters, generate it, do not choose it (see .env.example)`,
    );
  }
  return raw;
}

/** The operator's credential and the biller's, each `null` when unset. */
interface ServiceTokens {
  adminToken: string | null;
  billingToken: string | null;
}

/**
 * `BILLING_MAX_DAILY_AI_LIMIT`: a positive integer no larger than the ceiling
 * the operator's own PATCH has, because a biller ceiling above the operator's
 * would be a number no write could ever reach.
 */
function parseBillingMaxDailyAiLimit(env: NodeJS.ProcessEnv): number {
  const limit = parsePositiveInteger(env, 'BILLING_MAX_DAILY_AI_LIMIT', DEFAULT_SERVICE_MAX_DAILY_AI_LIMIT);
  if (limit > MAX_DAILY_AI_LIMIT) {
    throw new Error(`BILLING_MAX_DAILY_AI_LIMIT must be at most ${MAX_DAILY_AI_LIMIT}, got ${limit}`);
  }
  return limit;
}

/**
 * `ADMIN_TOKEN` and `BILLING_TOKEN` together, with the one rule that needs
 * both: they may not be the same string.
 *
 * THE ADMIN DOOR TRIES `ADMIN_TOKEN` FIRST (`server/admin-auth.ts`), so a
 * biller holding a token equal to the operator's would be admitted as the
 * operator, with every route and every field, and the scope in
 * `server/service-principal-scope.ts` would never run. A boot refusal is the
 * only answer an operator cannot miss. The message names both variables and
 * neither value.
 */
function parseTokens(env: NodeJS.ProcessEnv): ServiceTokens {
  const adminToken = parseAdminToken(env);
  const billingToken = parseBillingToken(env);
  if (adminToken !== null && adminToken === billingToken) {
    throw new Error(
      'BILLING_TOKEN must differ from ADMIN_TOKEN: the admin door checks ADMIN_TOKEN first, so the biller would get the whole admin API. Generate a separate value.',
    );
  }
  return { adminToken, billingToken };
}

/** The two names that make up the plans block. Listed once so every message below can name both. */
const PLANS_VARIABLES = ['PLANS_UPSTREAM_URL', 'PLANS_UPSTREAM_SECRET'] as const;

/**
 * `PLANS_UPSTREAM_URL` + `PLANS_UPSTREAM_SECRET`, both or neither, exactly as
 * the mail and AI blocks are.
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE,
 * and never a value: a shared secret in a startup log is a shared secret in a
 * log. A URL with no secret is the dangerous half, and it is the reason this
 * is a refusal rather than a downgrade to off: the secret is the only thing
 * that tells the biller the account id it is reading came from a gateway that
 * authenticated somebody. A secret with no URL is refused too, because it is a
 * typo far more often than an intention.
 *
 * NEITHER SET IS THE DEFAULT AND IT IS NOT A MISCONFIGURATION. It means no
 * biller reaches this instance, and the whole subtree answers the ordinary
 * unknown-path 404.
 */
function parsePlans(env: NodeJS.ProcessEnv): PlansUpstreamConfig | null {
  const present = PLANS_VARIABLES.filter((name) => (env[name]?.trim() ?? '') !== '');
  if (present.length === 0) return null;

  const missing = PLANS_VARIABLES.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete plans configuration: ${missing.join(', ')} is not set. ` +
        `${PLANS_VARIABLES.join(' and ')} are all-or-nothing, set both, or neither and this instance offers no plans.`,
    );
  }

  const baseUrl = env.PLANS_UPSTREAM_URL?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid PLANS_UPSTREAM_URL: expected an absolute http(s) URL, got "${baseUrl}"`);
  }
  if (!NOTICE_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(
      `Invalid PLANS_UPSTREAM_URL scheme "${parsed.protocol}": only ${NOTICE_URL_SCHEMES.join('/')} are accepted`,
    );
  }

  return {
    // Trailing slashes stripped once, here, so the proxy can concatenate a
    // path without deciding whether to.
    baseUrl: baseUrl.replace(/\/+$/, ''),
    secret: env.PLANS_UPSTREAM_SECRET?.trim() ?? '',
  };
}

/** The three names that make up the push block. Listed once so every message below can name all of them. */
const VAPID_VARIABLES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

/** Schemes a `VAPID_SUBJECT` may use. RFC 8292 asks for a way to reach the operator, not for a web page. */
const VAPID_SUBJECT_SCHEMES = ['mailto:', 'https:'];

/**
 * `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT`, all or none.
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE,
 * and never a value: the private key is a signing credential and a signing
 * credential in a startup log is a signing credential in a log. Two of three is
 * an operator who has generated a pair, pasted one line, and believes push
 * works; the failure that would follow is silent, because nothing about a
 * notification that never arrives reaches the person expecting it.
 *
 * NONE SET IS THE DEFAULT AND IT IS NOT A MISCONFIGURATION. It means this
 * instance sends no notifications, the whole `/v1/push` subtree answers the
 * ordinary unknown-path 404, and `/health` says `push: false`.
 */
function parsePush(env: NodeJS.ProcessEnv): VapidCredentials | null {
  const present = VAPID_VARIABLES.filter((name) => (env[name]?.trim() ?? '') !== '');
  if (present.length === 0) return null;

  const missing = VAPID_VARIABLES.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete push configuration: ${missing.join(', ')} is not set. ` +
        `${VAPID_VARIABLES.join(', ')} are all-or-nothing, set all three, or none and this instance sends no notifications. ` +
        'Generate a pair with `pnpm core-api push keygen`.',
    );
  }

  const subject = env.VAPID_SUBJECT?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(subject);
  } catch {
    throw new Error(`Invalid VAPID_SUBJECT: expected a mailto: address or an absolute https URL, got "${subject}"`);
  }
  if (!VAPID_SUBJECT_SCHEMES.includes(parsed.protocol)) {
    throw new Error(
      `Invalid VAPID_SUBJECT scheme "${parsed.protocol}": only ${VAPID_SUBJECT_SCHEMES.join(' and ')} are accepted`,
    );
  }

  return {
    publicKey: env.VAPID_PUBLIC_KEY?.trim() ?? '',
    privateKey: env.VAPID_PRIVATE_KEY?.trim() ?? '',
    subject,
  };
}

/**
 * `PUSH_ENDPOINT_HOSTS`: host names, or `*.` and a host name, separated by
 * commas. Lower-cased here, because `URL` lower-cases the host it compares.
 * A malformed entry is a boot failure that names it: a typo here would leave
 * a self-hoster's devices refused at registration with nothing in the log to
 * say why. A bare `*` is malformed, on purpose.
 */
function parsePushEndpointHosts(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PUSH_ENDPOINT_HOSTS?.trim() ?? '';
  if (raw === '') return [];
  const hosts = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  const malformed = hosts.filter((host) => !isPushHostPattern(host));
  if (malformed.length > 0) {
    throw new Error(
      `Invalid PUSH_ENDPOINT_HOSTS entry "${malformed.join('", "')}": expected a host name such as push.example.org, or *.example.org`,
    );
  }
  return hosts;
}

/**
 * `HOST`, the address the listener binds to. Unset, empty or whitespace-only
 * all mean `null`, which binds every interface: the behaviour this service has
 * always had, and the one its container needs.
 *
 * DELIBERATELY NOT VALIDATED BEYOND THE TRIM. The legal set is every IPv4
 * address, every IPv6 address and every name this box resolves, so a pattern
 * here would reject a working value more often than it would catch a typo.
 * Node refuses an address it cannot bind, at listen time, with a message that
 * names it.
 */
function parseOptionalHost(env: NodeJS.ProcessEnv): string | null {
  const raw = env.HOST?.trim();
  if (raw === undefined || raw === '') return null;
  return raw;
}

/** `INSTANCE_NAME`, what an instance calls itself on the `/health` handshake and in its start-up log. */
const DEFAULT_INSTANCE_NAME = 'openplate';

/**
 * A ceiling on `INSTANCE_NAME`, for the reason {@link MAX_SYNC_NOTICE_LENGTH}
 * exists: this value is published on `/health`, which the container's own
 * healthcheck polls continuously.
 */
export const MAX_INSTANCE_NAME_LENGTH = 64;

function parseInstanceName(env: NodeJS.ProcessEnv): string {
  const raw = env.INSTANCE_NAME?.trim();
  if (raw === undefined || raw === '') return DEFAULT_INSTANCE_NAME;
  if (raw.length > MAX_INSTANCE_NAME_LENGTH) {
    throw new Error(`INSTANCE_NAME must be at most ${MAX_INSTANCE_NAME_LENGTH} characters (got ${raw.length})`);
  }
  return raw;
}

/** `INSTANCE_LANGUAGE`, which of the six languages the invite and reset mails are written in. */
function parseInstanceLanguage(env: NodeJS.ProcessEnv): InstanceLanguage {
  const raw = env.INSTANCE_LANGUAGE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return 'en';
  if (!isInstanceLanguage(raw)) {
    throw new Error(`Invalid INSTANCE_LANGUAGE: expected ${INSTANCE_LANGUAGES.join('/')}, got "${raw}"`);
  }
  return raw;
}

/** The basis an instance starts on when no `instance_settings` row can be read. */
export const DEFAULT_NUTRIENT_REFERENCE_BASIS: NutrientReferenceBasis = 'dge';

/**
 * `NUTRIENT_REFERENCE_BASIS`, the boot default for M234's reference values.
 *
 * A TYPO IS A BOOT FAILURE, exactly as `INSTANCE_LANGUAGE` is, and not a
 * silent fall back to `dge`. The three values name three different sets of
 * numbers a person is shown beside their food, and an operator who typed
 * `dach` meant something by it.
 */
function parseNutrientReferenceBasis(env: NodeJS.ProcessEnv): NutrientReferenceBasis {
  const raw = env.NUTRIENT_REFERENCE_BASIS?.trim().toLowerCase();
  if (raw === undefined || raw === '') return DEFAULT_NUTRIENT_REFERENCE_BASIS;
  if (!isNutrientReferenceBasis(raw)) {
    throw new Error(`Invalid NUTRIENT_REFERENCE_BASIS: expected ${NUTRIENT_REFERENCE_BASES.join('/')}, got "${raw}"`);
  }
  return raw;
}

/**
 * An absolute `http(s)` base URL, or `null` when the variable is unset.
 *
 * A RELATIVE OR MISSPELLED VALUE IS A BOOT FAILURE, not a link that goes
 * nowhere. These two values end up in a letter somebody clicks, and a broken
 * one is discovered by the invited person rather than by the operator.
 */
function parseOptionalBaseUrl(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${key}: expected an absolute http(s) URL, got "${raw}"`);
  }
  if (!NOTICE_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Invalid ${key} scheme "${parsed.protocol}": only ${NOTICE_URL_SCHEMES.join('/')} are accepted`);
  }
  // Trailing slashes are stripped once, here, so every caller can concatenate
  // a path without deciding whether to.
  return raw.replace(/\/+$/, '');
}

/**
 * `SYNC_NOTICE` (and the optional `SYNC_NOTICE_URL` beside it), the message
 * every client shows on connect. Absent, which is the default, means the
 * handshake carries no notice field at all and an older client is unaffected.
 *
 * Three things are refused at boot rather than shipped:
 *  - a notice longer than {@link MAX_SYNC_NOTICE_LENGTH}, see that constant;
 *  - a URL whose scheme is not `https:`/`http:`, because the client will not
 *    render it either and a `javascript:` value in an operator's env is worth
 *    saying out loud;
 *  - a URL with no notice, which is a link with nothing to say and is far more
 *    likely a typo in the variable name than an intention.
 */
function parseNotice(env: NodeJS.ProcessEnv): OperatorNotice | null {
  const text = env.SYNC_NOTICE?.trim() ?? '';
  const url = env.SYNC_NOTICE_URL?.trim() ?? '';

  if (text === '') {
    if (url === '') return null;
    throw new Error('SYNC_NOTICE_URL is set without SYNC_NOTICE: a link with no message is never published');
  }
  if (text.length > MAX_SYNC_NOTICE_LENGTH) {
    throw new Error(
      `SYNC_NOTICE must be at most ${MAX_SYNC_NOTICE_LENGTH} characters (got ${text.length}), it is published on /health, which the container healthcheck polls continuously`,
    );
  }
  if (url === '') return { text };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid SYNC_NOTICE_URL: expected an absolute https:// URL, got "${url}"`);
  }
  if (!NOTICE_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(
      `Invalid SYNC_NOTICE_URL scheme "${parsed.protocol}": only ${NOTICE_URL_SCHEMES.join('/')} are published`,
    );
  }
  return { text, url };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

/** Parses a boolean env var. Anything other than the two accepted spellings is a config error, never a silent `false`. */
function parseBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Invalid boolean for ${key}: expected true/false, got "${raw}"`);
}

/**
 * Like {@link parsePositiveInteger}, but zero is a value rather than a
 * mistake. `MEMBER_INVITE_LIFETIME_CAP=0` leaves the route mounted and gives
 * every member nothing to spend, which is a different statement from unsetting
 * the pair and taking the route away.
 */
function parseNonNegativeInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer for ${key}: expected an integer of 0 or more, got "${raw}"`);
  }
  return parsed;
}

function parsePositiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${key}: expected a positive integer, got "${raw}"`);
  }
  return parsed;
}

/**
 * `TRUST_PROXY` accepts `true`/`false` or a hop count (`1` = one reverse
 * proxy in front). A hop count is the correct value behind Traefik/nginx;
 * bare `true` trusts every hop and lets a client spoof `X-Forwarded-For`.
 */
function parseTrustProxy(env: NodeJS.ProcessEnv): boolean | number {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(`Invalid TRUST_PROXY: expected true/false or a hop count, got "${raw}"`);
  }
  return hops;
}

/**
 * One of the two link bases a mailed letter is built from: the variable this
 * service reads, the variable the docker compose files fill it from, and what
 * it should name instead of the value it has.
 */
interface LinkBase {
  variable: 'CLIENT_BASE_URL' | 'SERVER_PUBLIC_URL';
  composeVariable: 'PUBLIC_APP_URL' | 'PUBLIC_SYNC_URL';
  target: string;
}

const CLIENT_LINK_BASE: LinkBase = {
  variable: 'CLIENT_BASE_URL',
  composeVariable: 'PUBLIC_APP_URL',
  target: 'the https:// address where your family opens the openplate app',
};

const SERVER_LINK_BASE: LinkBase = {
  variable: 'SERVER_PUBLIC_URL',
  composeVariable: 'PUBLIC_SYNC_URL',
  target: "this service's own https:// address",
};

/** `127.0.0.0/8` as the WHATWG parser writes it: `127.1`, `0x7f.1` and `2130706433` all come out dotted. */
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

/** `::ffff:127.0.0.0/104`, an IPv4 loopback address mapped into IPv6, as the parser writes it. */
const LOOPBACK_IPV4_MAPPED = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u;

/**
 * Whether a URL's `hostname` names this machine and nothing else: `localhost`,
 * a `*.localhost` name (RFC 6761 reserves the whole tree for loopback), an
 * address in `127.0.0.0/8`, or `::1`.
 *
 * READS A PARSED HOSTNAME, never the raw value. The parser has already
 * lowercased it, bracketed and shortened an IPv6 address (`[0:0:0:0:0:0:0:1]`
 * is `[::1]`), and turned every IPv4 spelling into dotted decimal, so the
 * patterns above see one form each.
 */
function isLoopbackHost(hostname: string): boolean {
  // A trailing dot is the fully qualified spelling of the same name.
  const name = hostname.replace(/\.$/u, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name === '[::1]') return true;
  return LOOPBACK_IPV4.test(name) || LOOPBACK_IPV4_MAPPED.test(name);
}

/**
 * What is wrong with one link base for a letter read on somebody else's
 * device, as one sentence, or `null` when nothing is.
 *
 * The value was already accepted by `parseOptionalBaseUrl`, so it parses.
 */
function linkBaseProblem(input: { base: LinkBase; value: string }): string | null {
  const { hostname, protocol } = new URL(input.value);
  const fix = `Set it to ${input.base.target} (${input.base.composeVariable} in the .env of the docker compose files).`;
  if (isLoopbackHost(hostname)) {
    return `${input.base.variable} is "${input.value}". That is a loopback address that opens only on this machine. ${fix}`;
  }
  if (protocol !== 'https:') {
    return `${input.base.variable} is "${input.value}". It is a plain http:// address, and on another device the app cannot sign anyone in over plain http. ${fix}`;
  }
  return null;
}

/**
 * THE LINKS IN A LETTER HAVE TO OPEN ON THE READER'S DEVICE, so in production a
 * mail block beside a loopback or plain-http link base is a BOOT FAILURE.
 *
 * The compose files fill both bases from `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL`,
 * and fall back to `http://localhost:3000` and `http://localhost:3001` when
 * those are unset. An operator who turned mail on and forgot them got a service
 * that booted and mailed a family member a link that opens nothing on any other
 * device, and heard of it from that person. Both bases are checked before
 * anything is thrown, so one message names every value to change.
 *
 * PRODUCTION ONLY. The image sets `NODE_ENV=production`. A development machine
 * and the test suites mail localhost links on purpose, and an instance without
 * mail is not checked at all: its administrator copies each link by hand, and
 * the app's admin screen says when that link names another address.
 */
function refuseUnreachableLinkBases(urls: { clientBaseUrl: string; serverPublicUrl: string }): void {
  const problems = [
    linkBaseProblem({ base: CLIENT_LINK_BASE, value: urls.clientBaseUrl }),
    linkBaseProblem({ base: SERVER_LINK_BASE, value: urls.serverPublicUrl }),
  ].filter((problem): problem is string => problem !== null);
  if (problems.length === 0) return;
  throw new Error(
    `Mail is configured. Its messages would carry links that recipients cannot open. ${problems.join(' ')} ` +
      'This check runs because NODE_ENV is production.',
  );
}

/** The HTTP mail API's three names. Listed once so every message below can name them. */
const MAIL_API_VARIABLES = ['MAIL_API_URL', 'MAIL_API_KEY', 'MAIL_API_FROM'] as const;

/** The HTTP block as it has been since M214/09: the three names and the operator address, all or nothing. */
const MAIL_VARIABLES = [...MAIL_API_VARIABLES, 'MAIL_OPERATOR_EMAIL'] as const;

/** SMTP's five names. `SMTP_PORT` has a default, and the login pair is optional. */
const SMTP_VARIABLES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;

/** What SMTP cannot run without. `MAIL_OPERATOR_EMAIL` is shared with the HTTP transport. */
const SMTP_REQUIRED_VARIABLES = ['SMTP_HOST', 'SMTP_FROM', 'MAIL_OPERATOR_EMAIL'] as const;

/** The submission port, which must upgrade with STARTTLS. What an unset `SMTP_PORT` means. */
const DEFAULT_SMTP_PORT = 587;

/** The one port that speaks TLS from the first byte. */
const IMPLICIT_TLS_SMTP_PORT = 465;

/** The highest TCP port. */
const MAX_PORT = 65_535;

/** Whether a variable holds anything but whitespace. An empty value, as the compose files pass one, is unset. */
function isSet(env: NodeJS.ProcessEnv, name: string): boolean {
  return (env[name]?.trim() ?? '') !== '';
}

/** `is` or `are`, for a message that names one variable or several. */
function isOrAre(names: readonly string[]): string {
  return names.length === 1 ? 'is' : 'are';
}

/**
 * The HTTP mail API: `MAIL_API_URL` + `MAIL_API_KEY` + `MAIL_API_FROM` +
 * `MAIL_OPERATOR_EMAIL`, all or none. Called only when one of them is set and
 * no SMTP variable is.
 *
 * `MAIL_OPERATOR_EMAIL` JOINED THE GROUP IN M214/09, and it is all-or-nothing
 * with the other three for the same reason: an instance that can mail at all
 * can name who reads a cancellation or a withdrawal notice, and a mailer
 * configured to send everything else but silently drop the operator's own
 * copy is exactly the half-configured state this whole block refuses.
 */
function parseHttpMail(env: NodeJS.ProcessEnv): HttpMailConfig {
  const missing = MAIL_VARIABLES.filter((name) => !isSet(env, name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete mail configuration: ${missing.join(', ')} ${isOrAre(missing)} not set. ` +
        `${MAIL_VARIABLES.join(', ')} are all-or-nothing, set all four, or none and hand out links yourself.`,
    );
  }
  // SAFETY: every name was checked non-empty just above.
  return {
    url: env.MAIL_API_URL?.trim() ?? '',
    apiKey: env.MAIL_API_KEY?.trim() ?? '',
    from: env.MAIL_API_FROM?.trim() ?? '',
    operatorEmail: env.MAIL_OPERATOR_EMAIL?.trim() ?? '',
  };
}

/** `SMTP_PORT`, 587 when unset, and a boot failure for anything that is not a TCP port. */
function parseSmtpPort(env: NodeJS.ProcessEnv): number {
  const raw = env.SMTP_PORT?.trim() ?? '';
  if (raw === '') return DEFAULT_SMTP_PORT;
  const port = Number(raw);
  if (!/^\d+$/u.test(raw) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid SMTP_PORT: expected a port number from 1 to ${MAX_PORT}, got "${raw}"`);
  }
  return port;
}

/** `SMTP_HOST` as nodemailer takes it, and whether it names this machine. */
interface SmtpHost {
  host: string;
  isLoopback: boolean;
}

/**
 * `SMTP_HOST`: a bare name or address, and a boot failure for anything with a
 * scheme, a port, a login or a path in it, because each of those is a value
 * meant for another variable and nodemailer would try to resolve it as a name.
 *
 * Parsed as the host of an `http:` URL, which lowercases a name and writes
 * every IPv4 spelling out in dotted decimal, so {@link isLoopbackHost} sees the
 * one form it expects. An IPv6 address may be written with or without its
 * brackets; nodemailer gets it without.
 */
function parseSmtpHost(raw: string): SmtpHost {
  const bracketed = raw.includes(':') && !raw.startsWith('[') ? `[${raw}]` : raw;
  const parsed = URL.canParse(`http://${bracketed}`) ? new URL(`http://${bracketed}`) : null;
  const isBare =
    parsed !== null &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    !raw.endsWith('/');
  if (parsed === null || !isBare) {
    throw new Error(
      `Invalid SMTP_HOST: expected a host name or address like smtp.example.org, with no scheme, port, or path, got "${raw}"`,
    );
  }
  return { host: raw.replace(/^\[(.*)\]$/u, '$1'), isLoopback: isLoopbackHost(parsed.hostname) };
}

/**
 * The port decides TLS. 465 is TLS from the first byte; every other port must
 * upgrade with STARTTLS, and a server that does not offer it gets nothing.
 * Only a host that is this machine, a local catcher such as Mailpit, may stay
 * plain, and it still upgrades when the catcher offers STARTTLS. There is no
 * variable that turns TLS off, so there is none an operator can leave off.
 */
function smtpTlsMode(input: { port: number; isLoopback: boolean }): SmtpTlsMode {
  if (input.port === IMPLICIT_TLS_SMTP_PORT) return 'implicit-tls';
  return input.isLoopback ? 'starttls-if-offered' : 'starttls-required';
}

/**
 * SMTP (2026-09-29, owner decision): `SMTP_HOST` + `SMTP_FROM` +
 * `MAIL_OPERATOR_EMAIL`, with `SMTP_PORT` defaulting to 587 and
 * `SMTP_USER` + `SMTP_PASSWORD` both or neither. Called only when one SMTP
 * variable is set and no HTTP one is.
 *
 * THE LOGIN PAIR IS BOTH OR NEITHER, and neither is allowed, because a local
 * catcher takes no login. One without the other is a typo that would fail on
 * the first letter, at the server, instead of here.
 *
 * A MISSING VARIABLE IS NAMED, AND A VALUE NEVER IS, for the reason the HTTP
 * block gives: a password in a startup log is a password in a log.
 */
function parseSmtpMail(env: NodeJS.ProcessEnv): SmtpMailConfig {
  const missing = SMTP_REQUIRED_VARIABLES.filter((name) => !isSet(env, name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete SMTP configuration: ${missing.join(', ')} ${isOrAre(missing)} not set. ` +
        `SMTP requires SMTP_HOST, SMTP_FROM, and MAIL_OPERATOR_EMAIL. SMTP_PORT defaults to ${DEFAULT_SMTP_PORT}. ` +
        'SMTP_USER and SMTP_PASSWORD go together.',
    );
  }
  const hasUser = isSet(env, 'SMTP_USER');
  if (hasUser !== isSet(env, 'SMTP_PASSWORD')) {
    throw new Error(
      `SMTP_USER and SMTP_PASSWORD go together, and ${hasUser ? 'SMTP_PASSWORD' : 'SMTP_USER'} is not set. ` +
        'Set both for a server that requires a login. Leave both unset for a local catcher that does not.',
    );
  }
  const port = parseSmtpPort(env);
  const { host, isLoopback } = parseSmtpHost(env.SMTP_HOST?.trim() ?? '');
  return {
    transport: 'smtp',
    host,
    port,
    tls: smtpTlsMode({ port, isLoopback }),
    auth: hasUser ? { user: env.SMTP_USER?.trim() ?? '', password: env.SMTP_PASSWORD?.trim() ?? '' } : null,
    from: env.SMTP_FROM?.trim() ?? '',
    operatorEmail: env.MAIL_OPERATOR_EMAIL?.trim() ?? '',
  };
}

/**
 * The mail block: the HTTP mail API or SMTP, EXACTLY ONE, or none, and only
 * alongside the two base URLs a link is built from.
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE,
 * and never a value: a key, a password or a URL in a startup log is a
 * credential in a log. The alternative, starting with mail half-configured, is
 * an operator who believes invitations are being delivered while every one of
 * them silently comes back as a link nobody looks at.
 *
 * BOTH TRANSPORTS AT ONCE IS A BOOT FAILURE TOO. Picking one silently would be
 * an operator who believes their letters leave through the one they tested.
 * `MAIL_OPERATOR_EMAIL` belongs to both and decides nothing on its own.
 *
 * REQUIRING THE LINK BASES IS THE SAME ARGUMENT ONE STEP OUT. Both account
 * letters carry a link. Configured mail with no `CLIENT_BASE_URL` would send
 * one of them with nothing in it to click. The two declaration letters carry
 * no link at all, so they do not depend on the base URLs, only on the mail
 * block itself. In production the same argument goes one step further: a link
 * that names `localhost` or plain http is a link with nothing to click on the
 * reader's device, see `refuseUnreachableLinkBases`.
 */
function parseMail(
  env: NodeJS.ProcessEnv,
  urls: { serverPublicUrl: string | null; clientBaseUrl: string | null },
): MailConfig | null {
  const httpSet = MAIL_API_VARIABLES.filter((name) => isSet(env, name));
  const smtpSet = SMTP_VARIABLES.filter((name) => isSet(env, name));
  if (httpSet.length === 0 && smtpSet.length === 0) {
    if (!isSet(env, 'MAIL_OPERATOR_EMAIL')) return null;
    throw new Error(
      'MAIL_OPERATOR_EMAIL is set, but no mail transport is. Set MAIL_API_URL, MAIL_API_KEY, and MAIL_API_FROM for a mail API. ' +
        'Or set SMTP_HOST and SMTP_FROM for SMTP. Otherwise, unset MAIL_OPERATOR_EMAIL and hand out links yourself.',
    );
  }
  if (httpSet.length > 0 && smtpSet.length > 0) {
    throw new Error(
      `Two mail transports are configured: ${httpSet.join(', ')} for a mail API, and ${smtpSet.join(', ')} for SMTP. ` +
        'Set one transport and leave the other unset.',
    );
  }
  const mail = smtpSet.length > 0 ? parseSmtpMail(env) : parseHttpMail(env);

  if (urls.serverPublicUrl === null || urls.clientBaseUrl === null) {
    const missingUrls = [
      urls.serverPublicUrl === null ? 'SERVER_PUBLIC_URL' : null,
      urls.clientBaseUrl === null ? 'CLIENT_BASE_URL' : null,
    ].filter((name): name is string => name !== null);
    throw new Error(
      `Mail is configured but ${missingUrls.join(' and ')} ${isOrAre(missingUrls)} not set. ` +
        'The invitation and the password reset both carry a link, and a link needs both values.',
    );
  }
  if (env.NODE_ENV?.trim() === 'production') {
    refuseUnreachableLinkBases({ clientBaseUrl: urls.clientBaseUrl, serverPublicUrl: urls.serverPublicUrl });
  }
  return mail;
}

/** The two names that make up the upstream block. Listed once so every message below can name both. */
const AI_VARIABLES = ['UPSTREAM_BASE_URL', 'UPSTREAM_API_KEY'] as const;

/** How long the proxy waits for headers, and then between chunks. See `ai/proxy.ts` on why undici and not global fetch. */
const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000;

/**
 * 8 MB, the figure the retired `openplate-gateway` used (`MAX_REQUEST_BYTES`).
 * Sized for a camera photograph after base64, not for anything this service
 * stores. See `Config.aiMaxRequestBytes`.
 */
const DEFAULT_AI_MAX_REQUEST_BYTES = 8_000_000;

/** The same 8 MB, for the same reason, on a route that KEEPS the photograph. See `Config.feedbackMaxRequestBytes`. */
const DEFAULT_FEEDBACK_MAX_REQUEST_BYTES = 8_000_000;

/**
 * Reports per account per UTC day, by default.
 *
 * FIVE IS A BOUND ON ABUSE, NOT ON USEFULNESS. A person reporting a wrong
 * estimate does it once for the entry in front of them; a compromised client
 * looping on the endpoint is what this stops, and at five reports a day it
 * cannot drain the operator's disk or bandwidth. An operator who wants more
 * raises it knowing what each row costs them.
 */
const DEFAULT_FEEDBACK_DAILY_LIMIT = 5;

/**
 * `UPSTREAM_BASE_URL` + `UPSTREAM_API_KEY`, both or neither.
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE,
 * and never a value: a provider key in a startup log is a provider key in a
 * log. The alternative is an instance that mounts an AI route it cannot
 * authenticate, so every scan fails with a 502 the operator reads as a provider
 * outage.
 */
function parseAi(env: NodeJS.ProcessEnv): AiUpstreamConfig | null {
  const present = AI_VARIABLES.filter((name) => (env[name]?.trim() ?? '') !== '');
  if (present.length === 0) return null;

  const missing = AI_VARIABLES.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete AI configuration: ${missing.join(', ')} is not set. ` +
        `${AI_VARIABLES.join(' and ')} are all-or-nothing, set both, or neither and this instance offers no AI.`,
    );
  }

  const baseUrl = env.UPSTREAM_BASE_URL?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid UPSTREAM_BASE_URL: expected an absolute http(s) URL, got "${baseUrl}"`);
  }
  if (!NOTICE_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Invalid UPSTREAM_BASE_URL scheme "${parsed.protocol}": only ${NOTICE_URL_SCHEMES.join('/')} work`);
  }

  return {
    // Trailing slashes stripped once, here, so `proxy.ts` can concatenate a
    // path without deciding whether to.
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: env.UPSTREAM_API_KEY?.trim() ?? '',
    timeoutMs: parsePositiveInteger(env, 'UPSTREAM_TIMEOUT_MS', DEFAULT_UPSTREAM_TIMEOUT_MS),
  };
}

/** What {@link parseAiTiers} makes of `AI_TIERS_FILE`. */
interface ParsedAiTiers {
  tiers: ModelTiers;
  source: ModelTiersSource;
  warnings: string[];
}

/**
 * `AI_TIERS_FILE`: unset is legacy mode, `bundled` is the file in the image,
 * an absolute path is a mounted file read once. Every failure stops the boot
 * and names the variable (a relative path, a file that cannot be read, JSON
 * that is not JSON, a rule of the file that fails). THE FILE IS PARSED EVEN
 * WITH NO UPSTREAM KEY, like the routing variables: a typo is found on the day
 * it is made, not the day somebody adds the provider key.
 *
 * The one place that reads a file; the rest of `parseConfig` reads `env` alone.
 */
function parseAiTiers(input: {
  env: NodeJS.ProcessEnv;
  capabilitySchemaMap: ReadonlyMap<string, string>;
}): ParsedAiTiers {
  const loaded = loadModelTiers({
    env: input.env,
    bundled: BUNDLED_MODEL_TIERS,
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  const warnings = [
    ...loaded.warnings,
    ...findDearUnguardedRoutes({ tiers: loaded.tiers, schemaMap: input.capabilitySchemaMap }),
  ];
  return { tiers: loaded.tiers, source: loaded.source, warnings };
}

/**
 * `AI_INSTANCE_DAILY_LIMIT`, the whole instance's ceiling in requests per UTC
 * day. Unset or empty is `null`, which means NO ceiling.
 *
 * IT IS OPTIONAL RATHER THAN DEFAULTED, unlike every other numeric variable in
 * this file. A default here would be a bound arriving on somebody's running
 * instance during an ordinary upgrade, and the first they would hear of it is
 * their users being refused. An operator opts in.
 *
 * ZERO IS A BOOT FAILURE AND THE MESSAGE SAYS WHY. It is the value that reads
 * most like "no ceiling" and means the exact opposite: it would refuse every
 * request on an instance that still has a provider key configured, which an
 * operator reads as a provider outage and debugs at the wrong end. Somebody who
 * wants no AI at all unsets `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY`, which
 * takes the route away instead of leaving one that always says no.
 */
function parseAiInstanceDailyLimit(env: NodeJS.ProcessEnv): number | null {
  const raw = env.AI_INSTANCE_DAILY_LIMIT?.trim();
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid AI_INSTANCE_DAILY_LIMIT: expected a positive integer, got "${raw}". ` +
        'Zero is not "no ceiling" and not "AI off": it would refuse every request on an instance ' +
        'that still has a provider key. Unset it for no ceiling, or unset UPSTREAM_BASE_URL and ' +
        'UPSTREAM_API_KEY for no AI at all.',
    );
  }
  return parsed;
}

/**
 * `AI_BUDGET_ALERT_FRACTION`: a share of the provider key's limit, above 0 and
 * below 1. `0` would never alert and `1` would alert on a full key, so both
 * are refused rather than read as "off" or "always".
 */
function parseAiBudgetAlertFraction(env: NodeJS.ProcessEnv): number {
  const raw = env.AI_BUDGET_ALERT_FRACTION?.trim();
  if (raw === undefined || raw === '') return DEFAULT_AI_BUDGET_ALERT_FRACTION;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(
      `Invalid AI_BUDGET_ALERT_FRACTION: expected a number above 0 and below 1, got "${raw}". ` +
        `Unset it for the default of ${DEFAULT_AI_BUDGET_ALERT_FRACTION}.`,
    );
  }
  return parsed;
}

/** The two names that make up the member-invite block. Listed once so every message below can name both. */
const MEMBER_INVITE_VARIABLES = ['MEMBER_INVITE_DAILY_AI_LIMIT', 'MEMBER_INVITE_ALLOWANCE_DAYS'] as const;

/** The optional third name. It narrows the door the pair opens; on its own it narrows nothing. */
const MEMBER_INVITE_CAP_VARIABLE = 'MEMBER_INVITE_LIFETIME_CAP';

/**
 * `MEMBER_INVITE_DAILY_AI_LIMIT` + `MEMBER_INVITE_ALLOWANCE_DAYS`, both or
 * neither. Unset is `null`, which is the default and takes the route away
 * entirely.
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE,
 * for the reason `parseMail` gives one variable up: the alternative is an
 * operator who believes their members can invite people, on an instance where
 * the route answers 404, or one who has opened the growth door and set no end
 * date on what it hands out.
 *
 * AN ALLOWANCE ABOVE THE CEILING IS A BOOT FAILURE TOO. This one number is
 * multiplied by every member on the instance times `MEMBER_INVITE_LIFETIME_CAP`
 * invitations, so a mistyped extra digit here is the largest bill any single
 * variable in this file can write.
 *
 * `MEMBER_INVITE_LIFETIME_CAP` IS OPTIONAL AND DEFAULTS TO
 * {@link DEFAULT_MEMBER_INVITE_LIFETIME_CAP}, so an upgrade changes nothing.
 * Zero is accepted for it, unlike the pair: it keeps the route mounted with
 * nothing to spend. Setting it while the pair is unset is a boot failure, for
 * the same reason half the pair is: it is a dial with no door to narrow, and
 * the operator who set it believes they have narrowed one.
 *
 * ZERO IS REFUSED FOR EITHER, and it is the value that reads most like "off".
 * A zero allowance mints letters that grant no AI at all, and a zero-day
 * window mints an allowance that has already ended when the person opens it.
 * Somebody who wants members not to invite unsets both.
 */
function parseMemberInvites(env: NodeJS.ProcessEnv, trial: TrialPolicy | null): MemberInvitePolicy | null {
  const present = MEMBER_INVITE_VARIABLES.filter((name) => (env[name]?.trim() ?? '') !== '');
  const capIsSet = (env[MEMBER_INVITE_CAP_VARIABLE]?.trim() ?? '') !== '';
  // THE SCAN-TRIAL SWITCH (M253) is the other way to open this door, and never
  // together with the day pair: a member invite grants one or the other. A
  // trial that also ends after some days is `TRIAL_DAYS` on the trial itself
  // (M267), which the switch hands on whole.
  if (parseBoolean(env, MEMBER_INVITE_TRIAL_VARIABLE, false)) {
    return parseMemberInviteTrial({ env, trial, dayPairSet: present });
  }
  if (present.length === 0) {
    if (capIsSet) {
      throw new Error(
        `Incomplete member-invite configuration: ${MEMBER_INVITE_CAP_VARIABLE} is set, but members cannot ` +
          `invite anybody on this instance, so there is nothing for it to cap. Set ` +
          `${MEMBER_INVITE_VARIABLES.join(' and ')} to open that door, or unset ${MEMBER_INVITE_CAP_VARIABLE}.`,
      );
    }
    return null;
  }

  const missing = MEMBER_INVITE_VARIABLES.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete member-invite configuration: ${missing.join(', ')} is not set. ` +
        `${MEMBER_INVITE_VARIABLES.join(' and ')} are all-or-nothing: set both to let members invite people, ` +
        'or neither and mint every invitation yourself.',
    );
  }

  // Read BEFORE the ceiling check below, which names it in its message: the
  // number an operator is warned about has to be the one their instance will
  // multiply by, not the default they did not choose.
  const lifetimeCap = parseNonNegativeInteger(env, MEMBER_INVITE_CAP_VARIABLE, DEFAULT_MEMBER_INVITE_LIFETIME_CAP);

  // The fallback is unreachable: both names are non-empty by the check above.
  // `parsePositiveInteger` is what refuses a zero, a fraction and a word.
  const dailyAiLimit = parsePositiveInteger(env, 'MEMBER_INVITE_DAILY_AI_LIMIT', 0);
  if (dailyAiLimit > MAX_DAILY_AI_LIMIT) {
    throw new Error(
      `MEMBER_INVITE_DAILY_AI_LIMIT must be at most ${MAX_DAILY_AI_LIMIT} (got ${dailyAiLimit}): ` +
        `every member may cause ${lifetimeCap} invitations, so this number is multiplied ` +
        'by the whole instance before it reaches your provider bill.',
    );
  }
  return { dailyAiLimit, allowanceDays: parsePositiveInteger(env, 'MEMBER_INVITE_ALLOWANCE_DAYS', 0), lifetimeCap };
}

/**
 * `OPEN_SIGNUP`, `true` or unset (M253). Any other value, `false` included,
 * is a boot failure that says so.
 *
 * STRICTER THAN {@link parseBoolean}, on purpose. This variable opens a door
 * to strangers, and an operator who wrote `OPEN_SIGNUP=yes` or `=1` believes
 * they opened it; one who wrote `=false` believes they closed something that
 * is closed by default. Both deserve the message rather than a guess.
 *
 * MAIL IS REQUIRED BESIDE IT. The mailed letter is the address check: without
 * it the route could only mint links that nobody receives.
 */
function parseOpenSignup(env: NodeJS.ProcessEnv, mail: MailConfig | null): boolean {
  const raw = env.OPEN_SIGNUP?.trim();
  if (raw === undefined || raw === '') return false;
  if (raw !== 'true') {
    throw new Error(`Invalid OPEN_SIGNUP: expected "true" or unset, got "${raw}". Unset it to stay invite-only.`);
  }
  if (mail === null) {
    throw new Error(
      'OPEN_SIGNUP=true requires mail. The letter with the link proves a new address is real. ' +
        'Set MAIL_API_URL, MAIL_API_KEY, MAIL_API_FROM, and MAIL_OPERATOR_EMAIL for a mail API. ' +
        'Or set SMTP_HOST, SMTP_FROM, and MAIL_OPERATOR_EMAIL for SMTP. Otherwise, unset OPEN_SIGNUP.',
    );
  }
  return true;
}

/** The two names that make up the captcha block. Listed once so every message below can name both. */
const TURNSTILE_VARIABLES = ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'] as const;

/**
 * `TURNSTILE_SECRET_KEY` + `TURNSTILE_SITE_KEY`, both or neither, and only
 * beside `OPEN_SIGNUP=true` (M253).
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE,
 * never a value, for the reason the mail block gives: a secret in a startup
 * log is a secret in a log. A pair on an instance with no open door is refused
 * too, because the operator who set it believes a captcha guards something.
 */
function parseTurnstile(env: NodeJS.ProcessEnv, openSignup: boolean): TurnstileConfig | null {
  const present = TURNSTILE_VARIABLES.filter((name) => (env[name]?.trim() ?? '') !== '');
  if (present.length === 0) return null;

  const missing = TURNSTILE_VARIABLES.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete captcha configuration: ${missing.join(', ')} is not set. ` +
        `${TURNSTILE_VARIABLES.join(' and ')} are all-or-nothing: set both, or neither and run no captcha.`,
    );
  }
  if (!openSignup) {
    throw new Error(
      `${TURNSTILE_VARIABLES.join(' and ')} are set, but OPEN_SIGNUP is not, so there is no sign-up door ` +
        'for a captcha to guard. Set OPEN_SIGNUP=true, or unset both.',
    );
  }
  return {
    secretKey: env.TURNSTILE_SECRET_KEY?.trim() ?? '',
    siteKey: env.TURNSTILE_SITE_KEY?.trim() ?? '',
  };
}

/** The switch that opens the member door on the scan trial instead of the day pair (M253). */
const MEMBER_INVITE_TRIAL_VARIABLE = 'MEMBER_INVITE_TRIAL';

/**
 * `MEMBER_INVITE_TRIAL=true`: a member's invitation grants the instance's scan
 * trial rather than a day trial (M253), its `TRIAL_DAYS` included (M267).
 *
 * A BOOT FAILURE BESIDE EITHER DAY VARIABLE, because the door grants one
 * thing: an operator with both set believes in two trials and gets neither
 * sentence right. The day pair is an allowance DATE, and a date lifts the
 * scan gate (`scan-trial.ts`), so the two together would be a trial with no
 * scan limit at all. "Ten scans or fourteen days" is the trial with
 * `TRIAL_DAYS`, and the message sends the operator there (M267, the combined
 * rule). A boot failure WITHOUT the trial pair, because the switch would open
 * a door that grants nothing. `MEMBER_INVITE_LIFETIME_CAP` narrows it exactly
 * as it narrows the day door.
 */
function parseMemberInviteTrial(input: {
  env: NodeJS.ProcessEnv;
  trial: TrialPolicy | null;
  dayPairSet: readonly string[];
}): MemberInvitePolicy {
  if (input.dayPairSet.length > 0) {
    throw new Error(
      `${MEMBER_INVITE_TRIAL_VARIABLE}=true cannot stand beside ${input.dayPairSet.join(' and ')}: a member ` +
        'invitation grants the scan trial or a day trial, never both. For a trial that ends after some scans or ' +
        `some days, whichever comes first, set TRIAL_DAYS beside TRIAL_SCANS and unset ${input.dayPairSet.join(' and ')}.`,
    );
  }
  if (input.trial === null) {
    throw new Error(
      `${MEMBER_INVITE_TRIAL_VARIABLE}=true needs the trial it grants: set TRIAL_SCANS and TRIAL_DAILY_AI_LIMIT, ` +
        `or unset ${MEMBER_INVITE_TRIAL_VARIABLE}.`,
    );
  }
  return {
    kind: 'trial',
    dailyAiLimit: input.trial.dailyAiLimit,
    trialScans: input.trial.scans,
    trialDays: input.trial.days,
    lifetimeCap: parseNonNegativeInteger(input.env, MEMBER_INVITE_CAP_VARIABLE, DEFAULT_MEMBER_INVITE_LIFETIME_CAP),
  };
}

/** The two names that make up the trial block. Listed once so every message below can name both. */
const TRIAL_VARIABLES = ['TRIAL_SCANS', 'TRIAL_DAILY_AI_LIMIT'] as const;

/**
 * `TRIAL_SCANS` (1 to {@link MAX_TRIAL_SCANS}) + `TRIAL_DAILY_AI_LIMIT` (1 to
 * `MAX_DAILY_AI_LIMIT`), both or neither (M253), and the optional
 * `TRIAL_DAYS` beside them (M267, see {@link parseTrialDays}).
 *
 * A HALF-CONFIGURED BLOCK IS A BOOT FAILURE THAT NAMES THE MISSING VARIABLE.
 * ZERO IS REFUSED FOR EITHER: a trial of no scans is not a trial, and a daily
 * bound of zero refuses every scan with `ai-not-allowed`.
 */
function parseTrial(env: NodeJS.ProcessEnv): TrialPolicy | null {
  const present = TRIAL_VARIABLES.filter((name) => (env[name]?.trim() ?? '') !== '');
  if (present.length === 0) {
    for (const dial of [TRIAL_DAYS_VARIABLE, TRIAL_TIME_ZONE_VARIABLE]) {
      if ((env[dial]?.trim() ?? '') === '') continue;
      throw new Error(
        `${dial} is set, but this instance runs no scan trial (${TRIAL_VARIABLES.join(' and ')}), ` +
          'so there is nothing for it to end. Unset it, or set the trial.',
      );
    }
    return null;
  }

  const missing = TRIAL_VARIABLES.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Incomplete trial configuration: ${missing.join(', ')} is not set. ` +
        `${TRIAL_VARIABLES.join(' and ')} are all-or-nothing: set both to give new accounts free scans, or neither.`,
    );
  }

  // The fallbacks are unreachable: both names are non-empty by the check above.
  const scans = parsePositiveInteger(env, 'TRIAL_SCANS', 0);
  if (scans > MAX_TRIAL_SCANS) {
    throw new Error(`TRIAL_SCANS must be at most ${MAX_TRIAL_SCANS} (got ${scans})`);
  }
  const dailyAiLimit = parsePositiveInteger(env, 'TRIAL_DAILY_AI_LIMIT', 0);
  if (dailyAiLimit > MAX_DAILY_AI_LIMIT) {
    throw new Error(`TRIAL_DAILY_AI_LIMIT must be at most ${MAX_DAILY_AI_LIMIT} (got ${dailyAiLimit})`);
  }
  const days = parseTrialDays(env);
  return { scans, dailyAiLimit, days, timeZone: parseTrialTimeZone({ env, days }) };
}

/** The optional day limit beside the trial pair (M267). */
const TRIAL_DAYS_VARIABLE = 'TRIAL_DAYS';

/** The zone the day limit's last midnight falls in (owner decision, 2026-09-29). */
const TRIAL_TIME_ZONE_VARIABLE = 'TRIAL_TIME_ZONE';

/**
 * `TRIAL_TIME_ZONE`: an IANA zone name, `UTC` when unset, returned the way
 * Intl writes it (`europe/berlin` is `Europe/Berlin`).
 *
 * CHECKED BY THE RUNTIME THAT WILL USE IT. `Intl.DateTimeFormat` refuses a
 * zone its ICU data does not know, and that refusal becomes a boot failure
 * naming the setting, rather than a redemption that throws weeks later.
 *
 * A BOOT FAILURE WITHOUT `TRIAL_DAYS`, for the reason `TRIAL_DAYS` is one
 * without the trial pair: a zone decides where the last day of a trial ends,
 * and a trial with no day limit has no last day. The operator who set it
 * believes a day limit is running.
 */
function parseTrialTimeZone(input: { env: NodeJS.ProcessEnv; days: number | null }): string {
  const raw = input.env[TRIAL_TIME_ZONE_VARIABLE]?.trim();
  if (raw === undefined || raw === '') return DEFAULT_TRIAL_TIME_ZONE;
  if (input.days === null) {
    throw new Error(
      `${TRIAL_TIME_ZONE_VARIABLE} is set, but ${TRIAL_DAYS_VARIABLE} is not, so the trial has no last day ` +
        `for the zone to end. Set ${TRIAL_DAYS_VARIABLE}, or unset ${TRIAL_TIME_ZONE_VARIABLE}.`,
    );
  }
  try {
    return new Intl.DateTimeFormat('en', { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    throw new Error(
      `Invalid ${TRIAL_TIME_ZONE_VARIABLE}: "${raw}" is not a time zone this runtime knows. ` +
        `Use an IANA name such as Europe/Berlin, or unset it for ${DEFAULT_TRIAL_TIME_ZONE}.`,
    );
  }
}

/**
 * `TRIAL_DAYS` (M267): 1 to {@link MAX_TRIAL_DAYS}, or unset for a trial with
 * no end date. Only reached beside the trial pair; set without it is refused
 * in {@link parseTrial}, for the reason `AI_TRIAL_INSTANCE_DAILY_LIMIT` is.
 *
 * ZERO IS REFUSED, and it is the value that reads most like "off": a trial of
 * zero days has ended when the person opens the letter. Somebody who wants no
 * day limit unsets it.
 */
function parseTrialDays(env: NodeJS.ProcessEnv): number | null {
  const raw = env[TRIAL_DAYS_VARIABLE]?.trim();
  if (raw === undefined || raw === '') return null;
  const days = parsePositiveInteger(env, TRIAL_DAYS_VARIABLE, 0);
  if (days > MAX_TRIAL_DAYS) {
    throw new Error(`${TRIAL_DAYS_VARIABLE} must be at most ${MAX_TRIAL_DAYS} (got ${days})`);
  }
  return days;
}

/**
 * `AI_TRIAL_INSTANCE_DAILY_LIMIT` (M253), optional. Zero is a boot failure for
 * the reason `AI_INSTANCE_DAILY_LIMIT`'s is, and so is a value on an instance
 * with no trial to bound.
 */
function parseAiTrialInstanceDailyLimit(env: NodeJS.ProcessEnv, trial: TrialPolicy | null): number | null {
  const raw = env.AI_TRIAL_INSTANCE_DAILY_LIMIT?.trim();
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid AI_TRIAL_INSTANCE_DAILY_LIMIT: expected a positive integer, got "${raw}". ` +
        'Zero would refuse every trial scan; unset it for no sub-ceiling.',
    );
  }
  if (trial === null) {
    throw new Error(
      'AI_TRIAL_INSTANCE_DAILY_LIMIT is set, but this instance runs no scan trial (TRIAL_SCANS and ' +
        'TRIAL_DAILY_AI_LIMIT), so there is nothing for it to bound. Unset it, or set the trial.',
    );
  }
  return parsed;
}

const TRIAL_NETWORK_LIMIT_VARIABLE = 'AI_TRIAL_NETWORK_DAILY_LIMIT';

/**
 * `AI_TRIAL_NETWORK_DAILY_LIMIT` (M270 spec 12): one network's share of the
 * trial ceiling, {@link defaultTrialNetworkDailyLimit} of it when unset.
 *
 * A BOOT FAILURE WITHOUT A TRIAL CEILING, a dial with no door: the share is a
 * part of `AI_TRIAL_INSTANCE_DAILY_LIMIT`, and the operator who set it
 * believes trial traffic is bounded. Above the ceiling it could never refuse
 * anything the ceiling did not, so it is refused too; equal is how to turn
 * the share off.
 */
function parseAiTrialNetworkDailyLimit(input: {
  env: NodeJS.ProcessEnv;
  trialInstanceDailyLimit: number | null;
}): number | null {
  const raw = input.env[TRIAL_NETWORK_LIMIT_VARIABLE]?.trim();
  const isUnset = raw === undefined || raw === '';
  if (input.trialInstanceDailyLimit === null) {
    if (isUnset) return null;
    throw new Error(
      `${TRIAL_NETWORK_LIMIT_VARIABLE} is set, but AI_TRIAL_INSTANCE_DAILY_LIMIT is not, so there is no trial ` +
        'ceiling for one network to take a share of. Set the trial ceiling, or unset the share.',
    );
  }
  if (isUnset) return defaultTrialNetworkDailyLimit(input.trialInstanceDailyLimit);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${TRIAL_NETWORK_LIMIT_VARIABLE}: expected a positive integer, got "${raw}". ` +
        'Zero would refuse every trial scan; unset it for a tenth of the trial ceiling.',
    );
  }
  if (parsed > input.trialInstanceDailyLimit) {
    throw new Error(
      `${TRIAL_NETWORK_LIMIT_VARIABLE} (${parsed}) is above AI_TRIAL_INSTANCE_DAILY_LIMIT ` +
        `(${input.trialInstanceDailyLimit}). Set it to the ceiling at most; equal turns the share off.`,
    );
  }
  return parsed;
}

/**
 * `DEFAULT_FREE_DAILY_AI_LIMIT` (2026-10-05): an integer from 0 to
 * `MAX_DAILY_AI_LIMIT`, where unset, empty and `0` all mean off.
 *
 * A BOOT FAILURE BESIDE A SCAN TRIAL. The standing cap replaces the trial, and
 * an instance with both would give a new account whichever one its door wrote
 * first. The message names both settings and says which to unset.
 */
function parseDefaultFreeDailyAiLimit(env: NodeJS.ProcessEnv, trial: TrialPolicy | null): number {
  const limit = parseNonNegativeInteger(env, 'DEFAULT_FREE_DAILY_AI_LIMIT', 0);
  if (limit > MAX_DAILY_AI_LIMIT) {
    throw new Error(`DEFAULT_FREE_DAILY_AI_LIMIT must be at most ${MAX_DAILY_AI_LIMIT} (got ${limit})`);
  }
  if (limit > 0 && trial !== null) {
    throw new Error(
      'DEFAULT_FREE_DAILY_AI_LIMIT and the scan trial (TRIAL_SCANS and TRIAL_DAILY_AI_LIMIT) cannot both be set: ' +
        'the standing daily limit replaces the trial, and an instance with both would grant a new account ' +
        'whichever one its door wrote first. Unset DEFAULT_FREE_DAILY_AI_LIMIT to keep the trial, or unset ' +
        'TRIAL_SCANS, TRIAL_DAILY_AI_LIMIT and anything that depends on them to keep the standing limit.',
    );
  }
  return limit;
}

/** What `TRIAL_HASH_RETENTION_DAYS` is when unset: one year after the deletion. */
export const DEFAULT_TRIAL_HASH_RETENTION_DAYS = 365;

/** The longest `TRIAL_HASH_RETENTION_DAYS`, ten years. A bound, so a typo is not a retention period nobody chose. */
const MAX_TRIAL_HASH_RETENTION_DAYS = 3650;

/** `TRIAL_HASH_RETENTION_DAYS`: a whole number of days from 1 to 3650, default 365 (ADR-0010). */
function parseTrialHashRetentionDays(env: NodeJS.ProcessEnv): number {
  const days = parsePositiveInteger(env, 'TRIAL_HASH_RETENTION_DAYS', DEFAULT_TRIAL_HASH_RETENTION_DAYS);
  if (days > MAX_TRIAL_HASH_RETENTION_DAYS) {
    throw new Error(`TRIAL_HASH_RETENTION_DAYS must be at most ${MAX_TRIAL_HASH_RETENTION_DAYS} (got ${days})`);
  }
  return days;
}

/**
 * `TRIAL_ADDRESS_PEPPER` (M253): optional, at least
 * {@link MIN_SERVER_SECRET_LENGTH} characters, and REQUIRED when the instance
 * runs a scan trial, because the one mailbox, one trial rule cannot recognise
 * a deleted mailbox without it. The message names the variable, never a value.
 */
function parseTrialAddressPepper(env: NodeJS.ProcessEnv, trial: TrialPolicy | null): string | null {
  const raw = env.TRIAL_ADDRESS_PEPPER?.trim();
  if (raw === undefined || raw === '') {
    if (trial === null) return null;
    throw new Error(
      'TRIAL_SCANS and TRIAL_DAILY_AI_LIMIT need TRIAL_ADDRESS_PEPPER: the one trial per mailbox rule keeps a ' +
        'keyed hash of each mailbox, and the key is this secret. Generate it with `openssl rand -hex 32`.',
    );
  }
  if (raw.length < MIN_SERVER_SECRET_LENGTH) {
    throw new Error(`TRIAL_ADDRESS_PEPPER must be at least ${MIN_SERVER_SECRET_LENGTH} characters, generate it`);
  }
  return raw;
}

/**
 * `HEALTH_CONSENT_VERSION`: unset or empty is `null`, which asks for no
 * consent. Anything set must be 1 to 32 letters, digits, dots, underscores or
 * hyphens, or the boot fails with a message that says so.
 *
 * A TYPO IS A BOOT FAILURE, NOT A DOWNGRADE. The value is compared byte for
 * byte with what a client sends back, so a stray quote or space would publish
 * a version nobody can agree to, and every sign-up would then answer
 * `health-consent-required` on a live instance.
 */
function parseHealthConsentVersion(env: NodeJS.ProcessEnv): string | null {
  const raw = env.HEALTH_CONSENT_VERSION?.trim();
  if (raw === undefined || raw === '') return null;
  if (!isHealthConsentVersion(raw)) {
    throw new Error(
      `Invalid HEALTH_CONSENT_VERSION: expected 1 to 32 letters, digits, ".", "_" or "-" (such as 2026-09-28), got "${raw}"`,
    );
  }
  return raw;
}

function parseLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.LOG_LEVEL?.trim().toLowerCase() ?? 'info';
  if (!isLogLevel(raw)) throw new Error(`Invalid LOG_LEVEL: expected debug/info/warn/error, got "${raw}"`);
  return raw;
}

/**
 * A variable this service used to read and no longer does. Present in the
 * environment, it is a BOOT FAILURE naming what happened, never a silent
 * no-op.
 *
 * THE ASYMMETRY IS THE ARGUMENT, and it is the one M166 first wrote down for
 * `SIGNUPS_OPEN`. A container that refuses to boot is loud and costs one
 * deploy. A variable that is quietly ignored lets an operator believe a door
 * is shut when it is open, or that mail is configured when it is not, a false
 * belief discovered by whoever needs it most, on the day they need it.
 */
function throwIfRemoved(env: NodeJS.ProcessEnv, name: string, because: string): void {
  if (env[name] === undefined) return;
  throw new Error(
    `${name} is no longer read and is rejected rather than ignored: ${because}. Delete it from the environment.`,
  );
}

/**
 * Why `SMTP_SECURE` stays refused now that SMTP is back (2026-09-29): the port
 * decides TLS, and a switch an operator could leave on "false" is the plain
 * text this service no longer sends to another host.
 */
const SMTP_SECURE_GONE =
  'TLS follows SMTP_PORT. Port 465 uses implicit TLS. Every other port must upgrade with STARTTLS. ' +
  'Configure SMTP with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM';

/**
 * Every variable this service refuses, one by one.
 *
 * `SIGNUP_MODE` JOINED THE LIST IN M192, and `CLIENT_BASE_URL` left it. An
 * account is created by redeeming an addressed invite, and there is no other
 * way to create one. An instance that booted with a stale `SIGNUP_MODE=open`
 * in its environment would be an operator believing public registration is
 * on through a variable that is unread, and, worse, an operator believing
 * they had turned it OFF with `closed`.
 *
 * `OPEN_SIGNUP` (M253) IS NOT ITS RETURN. It lets a person ask for an invite
 * addressed to themselves; the account is still created by redeeming it, and
 * an instance that does not set it stays invite-only. The message below names
 * it, so an operator with the old variable learns which one exists now.
 */
function rejectRemovedEnvVars(env: NodeJS.ProcessEnv): void {
  throwIfRemoved(
    env,
    'SIGNUP_MODE',
    'signup is invite-only unless OPEN_SIGNUP=true: an account is created by redeeming an addressed invite, minted with POST /v1/admin/invites or asked for at POST /v1/auth/signup-request (there is no open or closed mode any more)',
  );
  throwIfRemoved(
    env,
    'SIGNUPS_OPEN',
    'it was replaced by SIGNUP_MODE in M166, which M192 removed in turn: signup is invite-only, always',
  );
  throwIfRemoved(
    env,
    'REQUIRE_EMAIL_VERIFICATION',
    'the invitation IS the verification, an account is created by redeeming an invite addressed to that mailbox, so there is nothing left to confirm afterwards',
  );
  throwIfRemoved(env, 'EMAIL_FROM', 'the sending address is MAIL_API_FROM for a mail API, or SMTP_FROM for SMTP');
  throwIfRemoved(env, 'SMTP_SECURE', SMTP_SECURE_GONE);
  throwIfRemoved(
    env,
    'PIGEON_API_KEY',
    'the mail API credential is MAIL_API_KEY, and an SMTP login is SMTP_USER and SMTP_PASSWORD',
  );
  throwIfRemoved(env, 'PIGEON_BASE_URL', 'the mail API endpoint is MAIL_API_URL, and an SMTP server is SMTP_HOST');
}

/** Pure: builds the config from an arbitrary env bag. Throws on anything invalid, see the module header. */
export function parseConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  rejectRemovedEnvVars(env);

  const serverSecret = required(env, 'SERVER_SECRET');
  if (serverSecret.length < MIN_SERVER_SECRET_LENGTH) {
    throw new Error(`SERVER_SECRET must be at least ${MIN_SERVER_SECRET_LENGTH} characters (see .env.example)`);
  }

  // Read before the block below, because `parseMail` refuses a mail
  // configuration that has no link to put in a letter.
  const serverPublicUrl = parseOptionalBaseUrl(env, 'SERVER_PUBLIC_URL');
  const clientBaseUrl = parseOptionalBaseUrl(env, 'CLIENT_BASE_URL');
  // Read before the object below, because open sign-up refuses to boot
  // without mail and the captcha refuses to boot without open sign-up.
  const mail = parseMail(env, { serverPublicUrl, clientBaseUrl });
  const openSignup = parseOpenSignup(env, mail);
  // Read before the member door, which may grant it.
  const trial = parseTrial(env);
  const aiTrialInstanceDailyLimit = parseAiTrialInstanceDailyLimit(env, trial);
  const tokens = parseTokens(env);
  const capabilitySchemaMap = parseCapabilitySchemaMap(env.CAPABILITY_SCHEMA_MAP);
  const aiTiers = parseAiTiers({ env, capabilitySchemaMap });

  return {
    port: parsePositiveInteger(env, 'PORT', 3000),
    host: parseOptionalHost(env),
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseSsl: parseBoolean(env, 'DATABASE_SSL', false),
    serverSecret,
    instanceName: parseInstanceName(env),
    instanceLanguage: parseInstanceLanguage(env),
    serverPublicUrl,
    clientBaseUrl,
    mail,
    contentDir: env.CONTENT_DIR?.trim() || null,
    ai: parseAi(env),
    aiAdvertisedModel: env.AI_ADVERTISED_MODEL?.trim() || null,
    aiTiers: aiTiers.tiers,
    aiTiersSource: aiTiers.source,
    aiTiersWarnings: aiTiers.warnings,
    aiMaxOutputTokens: parsePositiveInteger(env, 'AI_MAX_OUTPUT_TOKENS', DEFAULT_AI_MAX_OUTPUT_TOKENS),
    aiInputPolicy: {
      maxImageParts: parsePositiveInteger(env, 'AI_MAX_IMAGE_PARTS', DEFAULT_AI_MAX_IMAGE_PARTS),
      maxTextBytes: parsePositiveInteger(env, 'AI_MAX_TEXT_BYTES', DEFAULT_AI_MAX_TEXT_BYTES),
      maxMessages: parsePositiveInteger(env, 'AI_MAX_MESSAGES', DEFAULT_AI_MAX_MESSAGES),
      unitInputTokens: parsePositiveInteger(env, 'AI_UNIT_INPUT_TOKENS', DEFAULT_AI_UNIT_INPUT_TOKENS),
      imageInputTokens: parsePositiveInteger(env, 'AI_IMAGE_INPUT_TOKENS', DEFAULT_AI_IMAGE_INPUT_TOKENS),
    },
    aiRateLimitPerMinute: parsePositiveInteger(env, 'AI_RATE_LIMIT_PER_MINUTE', 20),
    aiInstanceDailyLimit: parseAiInstanceDailyLimit(env),
    aiBudgetAlertFraction: parseAiBudgetAlertFraction(env),
    memberInvites: parseMemberInvites(env, trial),
    trial,
    aiTrialInstanceDailyLimit,
    aiTrialNetworkDailyLimit: parseAiTrialNetworkDailyLimit({
      env,
      trialInstanceDailyLimit: aiTrialInstanceDailyLimit,
    }),
    defaultFreeDailyAiLimit: parseDefaultFreeDailyAiLimit(env, trial),
    defaultCapabilities: parseDefaultCapabilities(env.DEFAULT_CAPABILITIES),
    capabilitySchemaMap,
    trialAddressPepper: parseTrialAddressPepper(env, trial),
    trialHashRetentionDays: parseTrialHashRetentionDays(env),
    openSignup,
    turnstile: parseTurnstile(env, openSignup),
    aiMaxRequestBytes: parsePositiveInteger(env, 'AI_MAX_REQUEST_BYTES', DEFAULT_AI_MAX_REQUEST_BYTES),
    trustProxy: parseTrustProxy(env),
    adminToken: tokens.adminToken,
    billingToken: tokens.billingToken,
    billingMaxDailyAiLimit: parseBillingMaxDailyAiLimit(env),
    plans: parsePlans(env),
    push: parsePush(env),
    pushEndpointHosts: parsePushEndpointHosts(env),
    sharingEnabled: parseBoolean(env, 'SYNC_SHARING', false),
    researchEnabled: parseBoolean(env, 'SYNC_RESEARCH', false),
    feedbackEnabled: parseBoolean(env, 'SYNC_FEEDBACK', false),
    feedbackDailyLimit: parsePositiveInteger(env, 'FEEDBACK_DAILY_LIMIT', DEFAULT_FEEDBACK_DAILY_LIMIT),
    feedbackMaxRequestBytes: parsePositiveInteger(
      env,
      'FEEDBACK_MAX_REQUEST_BYTES',
      DEFAULT_FEEDBACK_MAX_REQUEST_BYTES,
    ),
    legalReceiptsPerDay: parsePositiveInteger(
      env,
      'LEGAL_DECLARATION_RECEIPTS_PER_DAY',
      LEGAL_DECLARATION_RECEIPTS_PER_DAY,
    ),
    legalReceiptsPerNetworkPerDay: parsePositiveInteger(
      env,
      'LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY',
      LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY,
    ),
    notice: parseNotice(env),
    nutrientReferenceBasis: parseNutrientReferenceBasis(env),
    healthConsentVersion: parseHealthConsentVersion(env),
    logLevel: parseLogLevel(env),
  };
}
