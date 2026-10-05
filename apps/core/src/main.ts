/**
 * Service entry point, the only module in `src/` that reads `process.env`,
 * opens sockets, or decides when the process should die.
 *
 * Boot order is deliberate and strict:
 *   1. Parse config. A misconfiguration must kill the process here, before
 *      anything downstream has a chance to half-work.
 *   2. Wait for Postgres (bounded retry, a `docker compose up` starts both
 *      at once and the database is not ready for a second or two).
 *   3. Run migrations. A self-hoster pulling a newer image must never have to
 *      run a second command, and a half-migrated schema must never serve a
 *      request.
 *   4. Only then open the listener.
 *
 * Anything that fails in 1-3 exits non-zero with a scrubbed message, so a
 * container orchestrator restarts (or, for a genuinely bad config, backs off
 * and reports) rather than a broken instance quietly accepting signups.
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { parseConfig, type ServiceConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDatabase, runMigrations, waitForDatabase } from './db/client.js';
import { createDrizzleAccountStore } from './db/account-store.js';
import { createDrizzleStorageAdapter } from './db/storage-adapter.js';
import { createDrizzleBlobRollbackStore } from './db/blob-rollback-store.js';
import { createDrizzleAdminStore } from './db/admin-store.js';
import { createDrizzleInviteStore } from './db/invite-store.js';
import { scrubFinishedInvites } from './db/invite-retention.js';
import { purgeExpiredTrialHashes } from './db/trial-hash-retention.js';
import { createDrizzleShareStore } from './db/share-store.js';
import { createDrizzleRotationStore } from './db/rotation-store.js';
import { createDrizzleResearchStore } from './db/research-store.js';
import { createDrizzleInstanceSettingsStore } from './db/settings-store.js';
import { startInstanceSettings } from './instance/instance-settings.js';
import { deriveServerSecrets } from './lib/server-secrets.js';
import { createThrottleStore } from './lib/throttle.js';
import { SIGNUP_LETTER_THROTTLE, type OpenSignupSurface } from './accounts/open-signup.js';
import { createTurnstileVerifier } from './accounts/captcha.js';
import { createTrialAddressHasher } from './accounts/trial-address.js';
import { DEFAULT_TRIAL_TIME_ZONE, instanceTrialOf } from './accounts/scan-trial.js';
import { generateFamilyId, generatePasswordResetToken, generateToken } from './lib/tokens.js';
import { createMailer } from './mail/mailer.js';
import { createDeclarationTemplateSource } from './mail/declaration-templates.js';
import { createDrizzleAiCapacityReader, createDrizzleAiQuotaStore } from './ai/quota-store.js';
import { createTrialNetworkHasher, type TrialNetworkShare } from './ai/trial-network.js';
import { defaultTierOf, describeModelTiers } from './ai/model-tiers.js';
import { createUpstreamBudgetSource, upstreamBudgetKeyUrl } from './ai/upstream-budget.js';
import { createBudgetAlerter, startBudgetWatch, type BudgetWatch } from './ai/budget-alert.js';
import { createDrizzleBudgetAlertStore } from './db/budget-alert-store.js';
import { AI_USAGE_RETENTION_DAYS, startAiUsageRetention } from './ai/usage-retention.js';
import { createDrizzleFeedbackStore } from './feedback/feedback-store.js';
import { createDrizzleFeedbackAdminStore } from './feedback/feedback-admin-store.js';
import { createDrizzleFeedbackImageStore } from './feedback/feedback-image-store.js';
import {
  FEEDBACK_RETENTION_DAYS,
  feedbackRetentionAdvertisement,
  startFeedbackRetention,
} from './feedback/feedback-retention.js';
import { createDrizzlePulseStore } from './pulse/pulse-store.js';
import { PULSE_RETENTION_DAYS, startPulseRetention } from './pulse/pulse-retention.js';
import { createDrizzlePushStore } from './push/push-store.js';
import { createPushEndpointPolicy } from './push/endpoint-policy.js';
import { createWebPushSender } from './push/web-push-sender.js';
import { createPlansEraseNotifier } from './accounts/erase-notifier.js';
import { createPigeonRecipientEraser } from './mail/recipient-eraser.js';
import { PUSH_DAILY_SEND_CAP, startPushScheduler } from './push/push-scheduler.js';
import { createApp } from './server/create-app.js';
import { createDrizzleLegalDeclarationsStore } from './legal/legal-declarations-store.js';
import type { AuthContext } from './accounts/auth-handlers.js';
import type { InstanceHealthConsent, InstanceInfo } from './protocol.js';
import type { InstanceStanding } from './accounts/instance-standing.js';
import { toWireCapabilities } from './lib/capabilities.js';
import { SERVICE_VERSION } from './version.js';
import { errorFields, scrubbedErrorMessage } from './log-error.js';

/** How long a fully-expired token row is kept before the sweeper drops it. */
const TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** How often the sweeper runs. Hourly is far more often than necessary and costs one indexed DELETE. */
const TOKEN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * One caller network's share of the trial ceiling (M270 spec 12), or `null`
 * without one. `config.ts` only sets the share beside a trial ceiling, which
 * needs the trial, which needs the pepper; a share with no pepper is
 * therefore a wiring bug, and it fails the boot rather than storing addresses.
 */
function trialNetworkShareOf(config: ServiceConfig): TrialNetworkShare | null {
  if (config.aiTrialNetworkDailyLimit === null) return null;
  if (config.trialAddressPepper === null) {
    throw new Error('AI_TRIAL_NETWORK_DAILY_LIMIT is set without TRIAL_ADDRESS_PEPPER to key the network counter');
  }
  return {
    dailyLimit: config.aiTrialNetworkDailyLimit,
    hashNetwork: createTrialNetworkHasher(config.trialAddressPepper),
  };
}

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const logger = createLogger({ component: 'openplate-core', level: config.logLevel });

  const secrets = deriveServerSecrets(config.serverSecret);
  const database = createDatabase({ connectionString: config.databaseUrl, ssl: config.databaseSsl });

  await waitForDatabase({ pool: database.pool, logger });
  await runMigrations({
    db: database.db,
    migrationsFolder: resolve(process.env.MIGRATIONS_DIR ?? 'drizzle/migrations'),
  });
  logger.info('Migrations applied');

  // Both or neither, by construction: `parseConfig` refuses to boot with mail
  // configured and no link bases, so this is a narrowing rather than a policy.
  // With no mail an instance gets the no-op mailer, and every invitation comes
  // back as a link for the operator to paste.
  const links =
    config.clientBaseUrl !== null && config.serverPublicUrl !== null
      ? { clientBaseUrl: config.clientBaseUrl, serverPublicUrl: config.serverPublicUrl }
      : null;
  const mailer = createMailer({
    mail: config.mail,
    links,
    language: config.instanceLanguage,
    templates: createDeclarationTemplateSource({ contentDir: config.contentDir, logger }),
    logger,
  });
  // Which of the two transports is live, and nothing else about it: the host
  // and the login stay out of the log.
  if (config.mail !== null) {
    logger.info('Mail is configured', { transport: config.mail.transport === 'smtp' ? 'smtp' : 'http' });
  }
  // Only Pigeon has the route that erases a recipient. `null` for no mail, SMTP
  // and any other HTTP mail API, which the log line below says once at boot.
  const mailRecipientEraser = createPigeonRecipientEraser({ mail: config.mail, logger });
  if (config.mail !== null && config.mail.transport !== 'smtp' && mailRecipientEraser === null) {
    logger.info('The mail API is not Pigeon, so deleting an account cannot erase its address there');
  }
  if (config.mail !== null && config.contentDir === null) {
    logger.info('CONTENT_DIR is not set, so declaration letters use the neutral text');
  }

  // BUILT BEFORE THE AUTH CONTEXT, because the member mint is on the auth
  // router and needs the same store the admin tree mints through, see
  // `AuthContext.memberInvites`.
  // THE KEYED MAILBOX HASH (M253), `null` without `TRIAL_ADDRESS_PEPPER`. Both
  // stores get the same one: the invite store writes it on every new row, and
  // the account store checks it at redemption and keeps only it at deletion.
  const hashAddress = config.trialAddressPepper === null ? null : createTrialAddressHasher(config.trialAddressPepper);
  const invites = createDrizzleInviteStore(database.db, { hashAddress });

  // THE OPEN SIGN-UP DOOR (M253), `null` unless `OPEN_SIGNUP=true`, which
  // leaves `POST /v1/auth/signup-request` answering the ordinary unknown-path
  // 404. It mints through the SAME invite store the operator's mint uses.
  const openSignup: OpenSignupSurface | null = config.openSignup
    ? {
        invites,
        // The instance's scan trial when it runs one; otherwise no AI until an
        // operator grants some, and the boot line below says so.
        grant:
          config.trial === null
            ? { dailyAiLimit: 0, trialScans: null, trialDays: null }
            : { dailyAiLimit: config.trial.dailyAiLimit, trialScans: config.trial.scans, trialDays: config.trial.days },
        captcha: config.turnstile === null ? null : createTurnstileVerifier({ config: config.turnstile }),
        letters: createThrottleStore(SIGNUP_LETTER_THROTTLE),
      }
    : null;
  if (openSignup !== null && config.trial === null && config.defaultFreeDailyAiLimit === 0) {
    logger.info('Open sign-up is on, and new accounts get no AI until an operator grants some');
  }
  if (openSignup !== null) {
    if (config.turnstile === null) {
      logger.warn(
        'Open sign-up runs without a captcha. Set TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY to require one.',
      );
    }
  }

  // THE HEALTH-DATA CONSENT, ONE BINDING FOR TWO READERS. The auth context
  // demands it on signup and records it on the prompt route; `/health`
  // publishes it below as `instance.healthConsent`. Built once here, so the
  // version a client is shown and the version the service checks cannot
  // disagree. `null` unless `HEALTH_CONSENT_VERSION` is set, which is the
  // self-hosted default and asks nobody anything.
  const healthConsent: InstanceHealthConsent | null =
    config.healthConsentVersion === null ? null : { version: config.healthConsentVersion };

  // WHAT THE INSTANCE GRANTS AN ACCOUNT WITH NO RECORD OF ITS OWN, built once
  // for the two readers of it: the account view (through the auth context) and
  // the AI proxy (which `create-app.ts` hands the same object). All-off, and so
  // today's behaviour, on an instance that set none of the variables.
  const standing: InstanceStanding = {
    defaultFreeDailyAiLimit: config.defaultFreeDailyAiLimit,
    defaultCapabilities: config.defaultCapabilities,
    capabilitySchemaMap: config.capabilitySchemaMap,
  };
  if (config.defaultFreeDailyAiLimit > 0) {
    logger.info('A standing free daily AI limit is on: accounts with no limit of their own get it, and no scan trial', {
      defaultFreeDailyAiLimit: config.defaultFreeDailyAiLimit,
    });
  }

  const authContext: AuthContext = {
    // The zone a trial's last midnight falls in (`TRIAL_TIME_ZONE`), read at
    // every redemption and never written on an invite row.
    store: createDrizzleAccountStore(database.db, {
      hashAddress,
      trialTimeZone: config.trial?.timeZone ?? DEFAULT_TRIAL_TIME_ZONE,
      // An instance with no scan trial keeps no mailbox hash on a deletion:
      // nothing would read it. See `DrizzleAccountStoreOptions.grantsScanTrial`.
      grantsScanTrial: config.trial !== null,
    }),
    pepper: secrets.verifierPepper,
    enumerationSecret: secrets.enumerationSecret,
    escrowKey: secrets.escrowKey,
    mailer,
    now: () => new Date(),
    mintToken: generateToken,
    mintResetToken: generatePasswordResetToken,
    mintFamilyId: generateFamilyId,
    logger,
    // `null` unless BOTH member-invite settings are configured, which leaves
    // `POST /v1/auth/invites` answering the ordinary unknown-path 404, see
    // `accounts/register-auth-routes.ts`.
    memberInvites: config.memberInvites === null ? null : { invites, policy: config.memberInvites },
    openSignup,
    // `null` leaves `POST /v1/auth/account/health-consent` answering the
    // ordinary unknown-path 404 and signup ignoring the field.
    healthConsent,
    standing,
    // Both erasure paths tell the biller first, when there is one, so a
    // deleted account is never charged again. `null` without a biller.
    accountEraseNotifier: config.plans === null ? null : createPlansEraseNotifier({ upstream: config.plans, logger }),
    // After a delete, Pigeon is asked to forget the address. `null` unless the mail API is Pigeon.
    mailRecipientEraser,
  };

  // ALWAYS PRESENT, because signup is invite-only and the invite store is the
  // only door onto this service. `token: null` means no static break-glass
  // credential, which leaves the tree answering the ordinary unknown-path 404
  // until an admin account signs in, see `server/admin-auth.ts`.
  const admin = {
    token: config.adminToken,
    // The biller's scoped credential (M213). `null` on every instance that has
    // not set `BILLING_TOKEN`, which means the third principal does not exist
    // there and its three routes are the operator's alone.
    billingToken: config.billingToken,
    billingMaxDailyAiLimit: config.billingMaxDailyAiLimit,
    metadata: createDrizzleAdminStore(database.db),
    invites,
    // The restore path of ADR-0009. Its own store, so nothing on the sync
    // routes can reach a delete of an accepted write.
    blobs: createDrizzleBlobRollbackStore(database.db),
    // The same pair the mailer builds its links from, so an admin response and
    // a letter can never disagree about where a link points.
    links,
  };

  // An instance with no static token and no admin account can never mint an
  // invite, so nobody can ever register on it. That is a misconfiguration worth
  // shouting about, and deliberately NOT fatal: an admin account created
  // before the token was removed still works, and refusing to boot would lock
  // out the very person who could fix it.
  if (config.adminToken === null) {
    logger.warn(
      'No ADMIN_TOKEN: only an account with role "admin" can reach /v1/admin. ' +
        'Set ADMIN_TOKEN if you need a break-glass credential that does not depend on an account.',
    );
  }

  // `null` unless UPSTREAM_API_KEY is set, which leaves
  // `POST /v1/chat/completions` answering the ordinary unknown-path 404, see
  // `server/create-app.ts`.
  // BUILT UNCONDITIONALLY, unlike the `ai` surface below. This store owns
  // `ai_usage_days` at both ends, and the retention sweep at the bottom of this
  // file has to run on every instance: one that had an upstream key last year
  // and none today still holds the counters from when it did, and a sweep wired
  // behind the flag would leave exactly those rows in place forever.
  const aiQuota = createDrizzleAiQuotaStore(database.db);

  // THE PROVIDER KEY'S BUDGET (2026-09-30), read for `GET /v1/admin/ai/budget`
  // and on a 15 minute timer that mails the operator once per reset period
  // when it runs low. Only an OpenRouter upstream has a key read; any other
  // leaves `upstream: null` and no timer. See `ai/budget-alert.ts`.
  const budgetKeyUrl = config.ai === null ? null : upstreamBudgetKeyUrl(config.ai);
  const budgetWatch: BudgetWatch | null =
    config.ai === null || budgetKeyUrl === null
      ? null
      : startBudgetWatch({
          source: createUpstreamBudgetSource({
            keyUrl: budgetKeyUrl,
            apiKey: config.ai.apiKey,
            logger,
            now: () => new Date(),
          }),
          alerter: createBudgetAlerter({
            store: createDrizzleBudgetAlertStore(database.db),
            mailer,
            mailConfigured: config.mail !== null,
            fraction: config.aiBudgetAlertFraction,
            logger,
            now: () => new Date(),
          }),
          logger,
        });
  // One read at boot, so a restart during a low period finds its claim in the
  // database rather than waiting fifteen minutes to look.
  budgetWatch?.tick().catch((cause: unknown) => {
    logger.warn('AI budget watch tick failed', { ...errorFields(cause) });
  });

  // The model `/health` publishes and the "no model" warning reads: the DEFAULT
  // tier's, after `AI_ADVERTISED_MODEL`'s override. In legacy mode that is the
  // variable itself, as it always was.
  const defaultModel = defaultTierOf(config.aiTiers).model;

  const ai =
    config.ai === null
      ? null
      : {
          upstream: config.ai,
          quota: aiQuota,
          perMinute: config.aiRateLimitPerMinute,
          maxRequestBytes: config.aiMaxRequestBytes,
          instanceDailyLimit: config.aiInstanceDailyLimit,
          trialInstanceDailyLimit: config.aiTrialInstanceDailyLimit,
          // ONE NETWORK'S SHARE OF IT (M270 spec 12), named under the pepper
          // the trial already requires, so the counter never holds an address.
          trialNetwork: trialNetworkShareOf(config),
          // THE SAME BINDING `/health` publishes below (M256): the default
          // tier's model is what `/health` names, and the proxy resolves every
          // request to a tier of this same set, so the two cannot disagree.
          tiers: config.aiTiers,
          maxOutputTokens: config.aiMaxOutputTokens,
          inputPolicy: config.aiInputPolicy,
          budget: { capacity: createDrizzleAiCapacityReader(database.db), upstream: budgetWatch },
        };

  // THE TIERS, ONE LINE AND ONE WARNING EACH (`AI_TIERS_FILE`). Names and
  // slugs only, never a key. Logged whether or not an upstream key is set, so
  // an operator sees which file a booted process runs on.
  logger.info(
    describeModelTiers({
      tiers: config.aiTiers,
      source: config.aiTiersSource,
      isModelOverridden: config.aiAdvertisedModel !== null && config.aiTiersSource.kind !== 'legacy',
    }),
  );
  for (const warning of config.aiTiersWarnings) logger.warn(warning);

  // AN UPSTREAM KEY WITH NO NAMED MODEL. Non-fatal, like the two warnings
  // above: a self-built client that sends its own `model` still gets a proxied
  // answer (a default tier with no model passes it through, see `config.ts`).
  // But openplate itself sends no model on a managed instance and refuses to
  // scan rather than pick one on the operator's bill (README, "The AI proxy"),
  // so a managed instance in this shape looks configured and never serves a
  // scan. Only legacy mode can be in this shape: a tier file always names a model.
  if (ai !== null && defaultModel === null) {
    logger.warn(
      'UPSTREAM_API_KEY is set but AI_ADVERTISED_MODEL is not: openplate will refuse to ' +
        'scan until you set AI_ADVERTISED_MODEL, because it never sends a model of its own.',
    );
  }

  const instance: InstanceInfo = {
    name: config.instanceName,
    language: config.instanceLanguage,
    // Both reported honestly rather than omitted: a client that sees
    // `mail: false` knows to show the operator a link instead of promising a
    // letter, and one that sees `ai: null` knows not to offer a scan.
    mail: config.mail !== null,
    // DESCRIPTIVE, NEVER A GRANT, like every other field here: it says whether
    // a client should draw an invite card, and the cap, the re-invite rule and
    // the throttle stay on the server whatever it says. Built from the SAME
    // config binding that decides whether the route exists at all.
    memberInvites: config.memberInvites !== null,
    // DESCRIPTIVE, NEVER A GRANT, and built from the SAME binding that mounts
    // `POST /v1/auth/signup-request`, so an instance cannot advertise a door
    // it does not have. `false` keeps the client's invite wording.
    openSignup: openSignup !== null,
    // DESCRIPTIVE, NEVER A GRANT. It says an upstream is configured, not that
    // the caller may use it: an account with `dailyAiLimit: 0` gets a 403
    // whatever this says. The model name is the one the proxy writes into
    // every forwarded body (M256), and `null` when the operator chose none,
    // in which case the caller's own model passes through.
    //
    // THE INSTANCE CEILING IS DELIBERATELY NOT HERE, and this is where a reader
    // looking for it will look. `AI_INSTANCE_DAILY_LIMIT` is the operator's
    // BUDGET, and `/health` is unauthenticated: publishing it would tell any
    // stranger how much the operator is willing to spend per day and how much
    // of it is left. A client also could not act on it, because it never learns
    // how much of the ceiling is spent, so it can neither warn nor plan. The
    // one thing it does need, "the instance is out of capacity right now", it
    // learns from the 503 the proxy answers. `GET /v1/admin/stats` reports it
    // to the operator instead, behind the admin credential.
    ai: ai === null ? null : { model: defaultModel },
    // DESCRIPTIVE, NEVER A GRANT, and built from the SAME config binding that
    // decides whether the subtree is mounted at all, so an instance cannot
    // advertise a door it does not have. `false` means `/v1/plans/*` answers
    // the ordinary unknown-path 404 here, and a client draws no plan door.
    plans: config.plans !== null,
    // DESCRIPTIVE, NEVER A GRANT, and built from the SAME config binding that
    // decides whether the subtree is mounted at all, so an instance cannot
    // advertise a door it does not have. `false` means `/v1/push/*` answers the
    // ordinary unknown-path 404 here, and a client draws no notification
    // settings. It says nothing about what a push contains, because a push
    // contains a kind. See ADR-0008.
    push: config.push !== null,
    // THE SAME BINDING THE AUTH CONTEXT ENFORCES, so an instance cannot
    // publish one version and demand another. `null` when it asks for none,
    // which a client reads as "draw no consent checkbox".
    healthConsent: healthConsent === null ? null : { version: healthConsent.version },
    // DESCRIPTIVE, NEVER A GRANT, and read from the SAME `standing` the proxy
    // checks, so a client cannot be told one default while the proxy enforces
    // another. `null` is "no check": every feature is open.
    defaultCapabilities: toWireCapabilities(standing.defaultCapabilities),
    // `nutrientReferenceBasis` IS DELIBERATELY NOT HERE, and this is where a
    // reader looking for it will look. Every field above is env config read
    // once, so a copy taken at boot stays true for the life of the process.
    // That one is a stored row an administrator changes while this process
    // runs, so `create-app.ts` merges it into the handshake per request from
    // the process-local settings surface. A copy here would keep publishing
    // the value the instance started on until somebody redeployed.
  };

  // `null` unless SYNC_SHARING is on, which leaves both share subtrees
  // answering the ordinary unknown-path 404, see `server/create-app.ts`.
  const shares = config.sharingEnabled ? createDrizzleShareStore(database.db) : null;

  // `null` unless SYNC_RESEARCH is on, which leaves both contribution
  // subtrees answering the ordinary unknown-path 404, see
  // `server/create-app.ts`. Decided independently of `shares`: neither flag
  // implies the other.
  const research = config.researchEnabled ? createDrizzleResearchStore(database.db) : null;

  // `null` unless SYNC_FEEDBACK is on, which leaves the whole `/v1/feedback`
  // subtree answering the ordinary unknown-path 404, see
  // `server/create-app.ts`. Decided independently of every other flag, and it
  // is the one whose cost is different in kind: an instance with this on holds
  // photographs of its users' food that the operator can look at.
  const feedback = config.feedbackEnabled
    ? {
        reports: createDrizzleFeedbackStore(database.db),
        review: createDrizzleFeedbackAdminStore(database.db),
        images: createDrizzleFeedbackImageStore(database.db),
        dailyLimit: config.feedbackDailyLimit,
        maxRequestBytes: config.feedbackMaxRequestBytes,
      }
    : null;

  // THE RETENTION WINDOW, ADVERTISED, AND ONLY WHEN THERE IS ONE TO KEEP.
  //
  // The app has to tell a person how long a photograph of their food is kept
  // BEFORE they hand it over, and it is a separate deployable that cannot
  // import this constant. So the promise is published here, from the same
  // binding the sweep above deletes on: change the number and both move.
  //
  // ABSENT, NOT NULL, when the feature is off. An instance with SYNC_FEEDBACK
  // unset has no promise to make and adds no key to the handshake, so it stays
  // indistinguishable from one built before this field existed, exactly as its
  // 404 keeps its `/v1/feedback` tree indistinguishable from one where the
  // feature was never written. A client that finds no window offers no report.
  if (feedback !== null) instance.feedback = feedbackRetentionAdvertisement();

  // THE SCAN TRIAL, A PROMISE AND THEREFORE ABSENT WHEN OFF (M253), from the
  // same binding every trial door writes, so the number a client shows is the
  // number the doors grant. The day limit (M267) is a promise inside it, so
  // it is absent too when unset, and a client states the scans alone.
  if (config.trial !== null) instance.trial = instanceTrialOf(config.trial);

  // THE CAPTCHA A CLIENT RENDERS, ABSENT unless the door is open AND the
  // operator configured Turnstile. The site key is public by design; the
  // secret never leaves `config.turnstile`.
  if (openSignup !== null && config.turnstile !== null) {
    instance.signupCaptcha = { provider: 'turnstile', siteKey: config.turnstile.siteKey };
  }

  // THE COMMUNITY PULSE, on every instance and with no flag to read: the opt in
  // is on the device, and the sweep at the bottom of this file has to run
  // whatever anybody's device is doing today. See ADR-0007.
  const pulse = createDrizzlePulseStore(database.db);

  // WEB PUSH (M223). `null` unless all three `VAPID_*` variables are set, which
  // leaves the whole `/v1/push` subtree answering the ordinary unknown-path
  // 404, see `server/create-app.ts`. The store is built only when there is a
  // key to sign with: unlike the AI quota store above there is no counter here
  // that outlives the feature being on, so an instance with no keys has nothing
  // to read and nothing to sweep.
  //
  // THE ENDPOINT POLICY IS ONE OBJECT for the route that registers and the
  // tick that sends, so a row cannot be accepted by one and refused by the
  // other. See `push/endpoint-policy.ts`.
  const pushEndpointPolicy = createPushEndpointPolicy({ extraHosts: config.pushEndpointHosts });
  const push =
    config.push === null
      ? null
      : {
          store: createDrizzlePushStore(database.db),
          publicKey: config.push.publicKey,
          endpointPolicy: pushEndpointPolicy,
        };

  // THE ONE SETTING AN ADMINISTRATOR CHANGES WITHOUT A REDEPLOY (M234). It is
  // read ONCE here and then served from memory, because `/health` publishes it
  // and `/health` is this container's own healthcheck: a read of the row on
  // that path would turn a database hiccup into a restart. A row this process
  // cannot read costs an error log and the environment default, never a boot
  // failure. See `instance/instance-settings.ts`.
  const settings = await startInstanceSettings({
    store: createDrizzleInstanceSettingsStore(database.db),
    fallback: config.nutrientReferenceBasis,
    logger,
  });

  // ONE store for the route that writes declarations and the sweep that
  // deletes them past their period.
  const legalDeclarations = createDrizzleLegalDeclarationsStore(database.db);

  const app = createApp({
    authContext,
    storage: createDrizzleStorageAdapter(database.db),
    rotation: createDrizzleRotationStore(database.db),
    throttle: createThrottleStore(),
    logger,
    trustProxy: config.trustProxy,
    notice: config.notice,
    instance,
    mailer,
    mailConfigured: config.mail !== null,
    admin,
    ai,
    // `null` unless PLANS_UPSTREAM_URL and PLANS_UPSTREAM_SECRET are both set,
    // which leaves the whole `/v1/plans` subtree answering the ordinary
    // unknown-path 404, see `server/create-app.ts`.
    plans: config.plans,
    shares,
    research,
    feedback,
    pulse,
    push,
    settings,
    // ALWAYS BUILT, no flag beside it, exactly as `pulse` is: the two
    // statutory buttons exist on every instance. See `server/create-app.ts`.
    legal: {
      store: legalDeclarations,
      receiptsPerNetworkPerDay: config.legalReceiptsPerNetworkPerDay,
      receiptsPerDay: config.legalReceiptsPerDay,
    },
    trial: config.trial,
  });

  // NO HOST MEANS EVERY INTERFACE, and that is the production default on
  // purpose: this process runs in a container behind Traefik, whose only route
  // in is the container network address. A loopback bind here would leave the
  // proxy unable to reach the service, so nobody should "harden" this. `HOST`
  // is the opt-in, and it is the development machine that wants it: a dev
  // instance with a seeded database and an admin token, bound to everything, is
  // reachable from every machine on the operator's LAN.
  //
  // NOT DEFAULTED TO `0.0.0.0`. That string is IPv4 only, while the no-host
  // form of `listen` takes IPv6 as well, so writing it out would quietly narrow
  // what production binds today.
  const server = app.listen({ port: config.port, host: config.host ?? undefined }, () => {
    logger.info('openplate-core listening', {
      port: config.port,
      // The bound address, honestly: `null` is not "no host", it is every one.
      host: config.host ?? 'all interfaces',
      serviceVersion: SERVICE_VERSION,
      instanceName: config.instanceName,
      instanceLanguage: config.instanceLanguage,
      // Whether a break-glass credential exists on this instance, never its value.
      adminToken: config.adminToken !== null,
      // Whether a biller reaches this instance, never its credential.
      billingToken: config.billingToken !== null,
      mail: config.mail !== null,
      ai: ai !== null,
      // Whether the provider key's budget is read and alerted on, never the key.
      aiBudgetWatch: budgetWatch !== null,
      sharing: shares !== null,
      research: research !== null,
      feedback: feedback !== null,
      memberInvites: config.memberInvites !== null,
      // Which member door, and the scan trial, never a number.
      memberInviteTrial: config.memberInvites?.kind === 'trial',
      trial: config.trial !== null,
      // Whether the trial also ends by the calendar (M267), never the number,
      // and the zone of its last midnight, which is a setting and no secret.
      trialDays: (config.trial?.days ?? null) !== null,
      trialTimeZone: config.trial?.timeZone ?? DEFAULT_TRIAL_TIME_ZONE,
      trialAddressPepper: config.trialAddressPepper !== null,
      // Whether one network's share of the trial ceiling is enforced (M270 spec 12).
      trialNetworkShare: config.aiTrialNetworkDailyLimit !== null,
      openSignup: openSignup !== null,
      // Whether a captcha guards that door, never a key.
      signupCaptcha: openSignup?.captcha != null,
      // Whether a biller stands behind this instance, never its URL and never
      // its shared secret.
      plans: config.plans !== null,
      // Whether this instance can send a notification, never a key and never the subject.
      push: config.push !== null,
      // Which consent wording this instance asks for, or `null` for none. Public on `/health` already.
      healthConsentVersion: config.healthConsentVersion,
      // What the instance is showing right now, which is the stored row when
      // there is one and `NUTRIENT_REFERENCE_BASIS` when there is not.
      nutrientReferenceBasis: settings.current(),
    });
  });

  // RETENTION, RUNNING ON ITS OWN, on every instance that holds photographs.
  // The consent wording a person read names a number of days and this is what
  // makes that sentence true without an operator remembering anything. `null`
  // when the feature is off, because there is nothing to sweep and an interval
  // that always finds nothing is still a timer somebody has to explain.
  const feedbackRetention =
    feedback === null
      ? null
      : startFeedbackRetention({
          reports: feedback.review,
          images: feedback.images,
          logger,
          now: () => new Date(),
        });
  if (feedbackRetention !== null) {
    logger.info('Feedback retention sweep started', { retentionDays: FEEDBACK_RETENTION_DAYS });
  }

  // THE COUNTERS EXPIRE, on every instance, whatever the AI surface is doing.
  // `ai_usage_days` grew without bound from the day it was added, and one row
  // per account per active day is a trace of when a person opened a health app.
  // Ninety days is the operator's decision and the same window
  // `GET /v1/admin/accounts/:id/activity` can show, so an operator never reads
  // a pruned row as an absence of activity.
  const aiUsageRetention = startAiUsageRetention({
    quota: aiQuota,
    // The declarations ride on the same hourly tick, on every instance.
    legalDeclarations,
    logger,
    now: () => new Date(),
  });
  logger.info('AI usage retention sweep started', { retentionDays: AI_USAGE_RETENTION_DAYS });

  // THE PULSE ROWS EXPIRE, on every instance, for the reason the AI counters do
  // and one more: a contributor row says an account was here on a day, and a
  // presence row says somebody is fasting right now. Thirty days for the sums,
  // thirty minutes for presence, twenty-four hours for an idempotency key.
  const pulseRetention = startPulseRetention({ pulse, logger, now: () => new Date() });
  logger.info('Community pulse retention sweep started', { retentionDays: PULSE_RETENTION_DAYS });

  // THE MINUTE TICK, and only on an instance that can send. Unlike every sweep
  // above it is not a retention job: it has nothing to expire, and a tick on an
  // instance with no keys would be a timer that finds work it cannot do. A
  // catch-up due at 08:00 is why the period is a minute rather than the hour
  // the sweeps use. See `push/push-scheduler.ts` and ADR-0008.
  const pushScheduler =
    push === null || config.push === null
      ? null
      : startPushScheduler({
          store: push.store,
          sender: createWebPushSender(config.push),
          logger,
          now: () => new Date(),
          // THE SAME BINDING the routes and `/health` use, so the tick cannot
          // push to an account the routes would refuse (M266).
          healthConsent,
          endpointPolicy: push.endpointPolicy,
        });
  if (pushScheduler !== null) {
    logger.info('Push scheduler started', { dailySendCap: PUSH_DAILY_SEND_CAP });
  }

  const accountStore = authContext.store;
  const sweeper = setInterval(() => {
    void (async () => {
      try {
        const deleted = await accountStore.purgeExpiredTokens({
          before: new Date(Date.now() - TOKEN_RETENTION_MS),
        });
        if (deleted > 0) logger.info('Purged expired token rows', { deleted });
      } catch (cause) {
        logger.error('Token sweep failed', { ...errorFields(cause) });
      }
      // THE PRIVACY NOTICE'S PROMISE: a redeemed, revoked or expired invitation keeps no address.
      // On the same hourly tick, so a finished row holds one for an hour at most.
      try {
        const scrubbed = await scrubFinishedInvites(database.db, { now: new Date(), hashAddress });
        if (scrubbed > 0) logger.info('Scrubbed finished invitation addresses', { scrubbed });
      } catch (cause) {
        logger.error('Invitation scrub failed', { ...errorFields(cause) });
      }
      // THE END OF THE MAILBOX HASH (ADR-0010): a deleted account's hash is kept
      // `TRIAL_HASH_RETENTION_DAYS` and then deleted, on every instance.
      try {
        const purged = await purgeExpiredTrialHashes(database.db, {
          now: new Date(),
          retentionDays: config.trialHashRetentionDays,
        });
        if (purged > 0) logger.info('Purged expired trial mailbox hashes', { purged });
      } catch (cause) {
        logger.error('Trial hash purge failed', { ...errorFields(cause) });
      }
    })();
  }, TOKEN_SWEEP_INTERVAL_MS);
  // Never the reason the process stays alive.
  sweeper.unref();

  async function shutdown(signal: string): Promise<void> {
    logger.info('Shutting down', { signal });
    clearInterval(sweeper);
    settings.stop();
    feedbackRetention?.stop();
    aiUsageRetention.stop();
    pulseRetention.stop();
    pushScheduler?.stop();
    budgetWatch?.stop();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await database.close();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((cause: unknown) => {
  // The one place the words of an error are written out: nothing has been
  // read from a request yet, and an operator needs "SERVER_SECRET must be at
  // least 32 characters" rather than a code. Scrubbed and capped all the same,
  // because a config or connection error can carry a connection string.
  process.stderr.write(`${scrubbedErrorMessage(cause)}\n`);
  process.exit(1);
});
