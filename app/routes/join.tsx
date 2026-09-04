/**
 * `/join#sync=…&invite=si_…&gateway=…&ginvite=gi_…` — ONE link, one screen, up
 * to two services.
 *
 * A person is handed one address and it admits them to a sync account, to a
 * household gateway, or to both. This route reads what the link carries and
 * redeems it: SYNC FIRST, then the gateway. That order is not cosmetic — the
 * gateway member token is a setting on one device, while the sync account is
 * the thing the person actually keeps, so the half that matters is offered
 * while their attention is still on the link they followed.
 *
 * CLIENT-ONLY, and deliberately so — this route exports no `loader`, `action`,
 * `clientLoader` or `clientAction`. Both gateway calls are made BY THE BROWSER,
 * straight to the gateway's own origin (CORS is enabled on that side). The
 * openplate server must never see either invite token, the member token, or the
 * gateway address: the member token is exactly the kind of credential AGENTS.md'
 * "BYOK Security Rules" say never reaches this server. Nothing here is server
 * state.
 *
 * ── Token hygiene ────────────────────────────────────────────────────────
 *
 * The tokens ride in the FRAGMENT, which no browser sends to any server, and
 * the mount effect strips it with `history.replaceState` before a single
 * request is made — so nothing is left in the address bar for a screenshot or a
 * screen share. What was read is parked in the pending slot
 * (`app/lib/sync/invite-link.ts`), because clearing the fragment destroys the
 * only copy and the production first visit reloads the whole document when the
 * service worker takes control.
 *
 * And redeeming NEVER happens on load. Invite links get fetched by mail
 * scanners, link previewers and prefetchers; a bare GET of this URL must burn
 * nothing. The only thing a page load does is the idempotent `GET
 * /v1/gateway/info`; the POST waits for a human tapping "Join".
 *
 * ── On a managed instance this is ONE ceremony ───────────────────────────
 *
 * When this instance declares a gateway (`PublicConfig.managed`) the link is
 * the instance's own front door, and both halves came from its operator in one
 * message. So the sync step offers exactly one action, "Create my account",
 * and when the person comes back from that ceremony the gateway half is
 * redeemed without a second tap: see `app/lib/managed-join.ts` for the two
 * things that still stop it, and for why an auditing gateway keeps its card.
 * The skip is gone there too — it offers an account to somebody who, on such
 * an instance, has neither one nor a way to make one.
 *
 * ── The sync half hands off, rather than being reimplemented ─────────────
 *
 * Creating a sync account is a ceremony with a handle, a passphrase and an
 * account card, and it lives on `/settings/sync`. This screen does not repeat
 * any of it: it parks the invite and sends the person there, where the existing
 * form reads the SAME pending slot and prefills itself. A second implementation
 * of a capability-redemption screen is how one of them ends up missing a guard.
 *
 * ── The sync address in the link is a CHECK ──────────────────────────────
 *
 * This client posts its passphrase-derived verifier to the sync server ITS
 * OPERATOR configured. A link cannot redirect that; a link naming a different
 * server is reported and nothing is dialled. See `isForeignSyncServer`.
 *
 * ── CSP ──────────────────────────────────────────────────────────────────
 *
 * The gateway origin arrives in a LINK, so the production `connect-src`
 * allowlist cannot contain it: that header is built at boot from this server's
 * own configuration (`app/config/content-security-policy.ts`), and widening it
 * at runtime — or globally — would give up the exact protection that stops an
 * injected script shipping the key in this page somewhere else. A hosted
 * instance therefore needs its operator to add the gateway's origin to
 * `CSP_CONNECT_EXTRA` (see `docs/configuration.md`). A blocked request is
 * reported to `fetch` as a bare `TypeError` with no response, indistinguishable
 * from a dead host — so the detection below is explicitly best-effort: a throw
 * plus an origin the CSP could not have allowed reads as "blocked", anything
 * else reads as "unreachable", and the two get different, separately actionable
 * copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import {
  GATEWAY_API_PREFIX,
  GATEWAY_INFO_PATH,
  gatewayInfoSchema,
  isAuditDisclosureRequired,
  requiresOperatorCspAllowlisting,
  type GatewayInfo,
} from '#app/lib/gateway-invite';
import {
  GATEWAY_REQUEST_TIMEOUT_MS,
  redeemAndPark,
  redeemInvite,
  savePendingRedemption,
  type CapturedInvite,
  type RedemptionDeps,
  type RedemptionOutcome,
} from '#app/lib/gateway-redemption';
import {
  hasGatewayHalf,
  isForeignSyncServer,
  isJoinLinkEmpty,
  readPendingGatewayRedemption,
  takeJoinLinkFromUrl,
  type JoinLink,
  type ParkedGatewayRedemption,
} from '#app/lib/join-link';
import { useManagedInstance, useSyncServerUrl } from '#app/hooks/use-public-config';
import { resolveGatewayStep } from '#app/lib/managed-join';
import { readOnboardingGateKind } from '#app/lib/read-onboarding-gate';
import { resolveSignInDestination } from '#app/lib/sign-in-flow';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { getLocalAiSettings, putLocalAiSettings, putLocalGatewayConnection } from '#app/lib/local-store';
import { syncNow } from '#app/lib/sync/sync-actions';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// This route is top-level, so nothing above it supplies a `<title>` — without
// this export the document head carried an empty one. Title via the pure
// `meta-title` seam, like every other route (see `meta-title.ts`).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.join') }];

export const handle = {
  title: 'Join',
  titleKey: 'join.title',
};

type Phase =
  /** Before the mount effect has read the fragment (and during SSR). */
  | { status: 'loading' }
  /** The link carried nothing usable — mangled, truncated, or built with the two halves swapped. */
  | { status: 'invalid-link' }
  /** The link names a sync service this app is not configured for. Nothing is dialled. */
  | { status: 'foreign-server'; origin: string }
  /** Step one: the sync invite is parked, and `/settings/sync` is where it is spent. */
  | { status: 'sync'; hasGateway: boolean }
  /** Managed instance, gateway half only, signed out: the connection needs an account to belong to. */
  | { status: 'sign-in-first' }
  /** The gateway answered nothing. `reason` picks between two different fixes, by two different people. */
  | { status: 'unreachable'; reason: 'blocked' | 'network'; gatewayOrigin: string }
  | { status: 'confirm'; info: GatewayInfo; gatewayOrigin: string; replaces: string | null }
  | { status: 'joining'; info: GatewayInfo; gatewayOrigin: string; replaces: string | null }
  /** Any non-200 from redeem. Deliberately one state: the gateway's reason is never shown. */
  | { status: 'invite-invalid' }
  /**
   * The invite is SPENT and one of the two local writes failed.
   *
   * Its own state, not a return to `confirm`, because the two offer different
   * actions: the confirm button redeems, and redeeming again would post a token
   * the gateway has already burnt. This one repeats the local writes off the
   * parked answer and dials nothing — see `app/lib/gateway-redemption.ts`.
   */
  | { status: 'save-retry'; parked: ParkedGatewayRedemption; isSaving: boolean };

/** Why an info probe produced no gateway — `blocked` means `fetch` threw, i.e. no response at all. */
type InfoProbeResult = { ok: true; info: GatewayInfo } | { ok: false; kind: 'blocked' | 'network' };

/** `GET /v1/gateway/info` — idempotent, safe to run on load, burns no invite. */
async function fetchGatewayInfo(gatewayUrl: string): Promise<InfoProbeResult> {
  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}${GATEWAY_INFO_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // No response object at all: a CSP block, a dead host, a DNS miss or a
    // timeout. The caller disambiguates as far as anything can (see the header).
    return { ok: false, kind: 'blocked' };
  }
  if (!response.ok) return { ok: false, kind: 'network' };
  const parsed = gatewayInfoSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { ok: true, info: parsed.data } : { ok: false, kind: 'network' };
}

/**
 * The connection this join would take over, described for the confirm card —
 * or `null` when there is nothing to take over, or when the existing row is
 * this same gateway (a re-join, which updates that row in place).
 *
 * The device holds exactly ONE AI configuration (`local-store/ai-settings.ts`
 * is a singleton row), so joining a gateway while a hand-typed provider is
 * connected necessarily replaces it. That must never be a surprise, hence this
 * line above the button — see the summary's deviation note.
 */
async function describeReplacedConnection(gatewayUrl: string): Promise<string | null> {
  const existing = await getLocalAiSettings();
  if (existing === null) return null;
  if (existing.baseUrl === `${gatewayUrl}${GATEWAY_API_PREFIX}`) return null;
  return existing.baseUrl ?? existing.provider;
}

/** The origin of a link's address, for copy. `null` and unparseable both read as "somewhere else". */
function originOf(url: string | null): string {
  if (url === null) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function LoadingCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{t('connectGateway.checking')}</p>
    </CardContent>
  );
}

/**
 * Step one: the sync account.
 *
 * A handoff, not a form. The invite is already parked, and `/settings/sync`
 * reads the same slot and prefills itself — see the header. The skip is offered
 * only when there is a gateway half left to do, because skipping a sync-only
 * link would leave the person on a screen with nothing on it.
 *
 * "Skip, I already have an account" goes to `/sign-in` (M183 spec 03), not
 * straight on to the gateway step: the account they already have has to be
 * signed in to on this device before the gateway half means anything here. It
 * is not dropped — `/sign-in` returns to this route once the parked gateway
 * half is all that is left (owner decision, worklog `01M1KMSJXNVZFV1JFYVV`).
 *
 * ON A MANAGED INSTANCE THERE IS NO SKIP (M187 spec 03). It offers "I already
 * have an account" to somebody who, on such an instance, has neither an
 * account nor a way to make one outside this very link, so the only thing it
 * can do is send them to a sign-in form they cannot fill in. The line about
 * coming back afterwards goes too: they do not come back, the gateway half is
 * redeemed for them when the account ceremony ends.
 */
function SyncStepCard({
  hasGateway,
  managed,
  onContinue,
  onSkip,
}: {
  hasGateway: boolean;
  /** `PublicConfig.managed` — `false` renders exactly the card this route had before. */
  managed: boolean;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-base font-medium">{t('join.sync.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.sync.body')}</p>
      {hasGateway && (
        <p className="text-sm text-muted-foreground">
          {managed ? t('join.managed.thenGateway') : t('join.sync.thenGateway')}
        </p>
      )}
      <Button type="button" className="h-11 w-full" onClick={onContinue}>
        {t('join.sync.continue')}
      </Button>
      {hasGateway && !managed && (
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onSkip}>
          {t('join.sync.skip')}
        </Button>
      )}
    </CardContent>
  );
}

/**
 * A managed instance's link carrying only the gateway half, on a signed-out
 * device.
 *
 * The connection this link grants belongs to the ACCOUNT now (M187 spec 02),
 * so redeeming it here would write it onto a device that carries it nowhere.
 * `/sign-in` returns to this route as soon as the parked gateway half is all
 * that is left, and the redemption then runs by itself.
 */
function SignInFirstCard({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-base font-medium">{t('join.managed.signInFirst.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.managed.signInFirst.body')}</p>
      <Button type="button" className="h-11 w-full" onClick={onSignIn}>
        {t('join.managed.signInFirst.action')}
      </Button>
    </CardContent>
  );
}

/**
 * The link names a different sync service than this app is configured for.
 *
 * Its own card rather than the invalid-link one: nothing about this link is
 * malformed, and the person can act on it — the same link opened on the right
 * instance works. Naming both origins is what makes that actionable.
 */
function ForeignServerCard({ linkOrigin }: { linkOrigin: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.foreignServer.title')}</p>
      <p className="text-sm text-muted-foreground">
        {linkOrigin === '' ? t('join.foreignServer.bodyUnknown') : t('join.foreignServer.body', { origin: linkOrigin })}
      </p>
      <BackToSettingsLink />
    </CardContent>
  );
}

function BackToSettingsLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/settings/ai"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {t('connectGateway.backToAiSettings')}
    </Link>
  );
}

function InvalidLinkCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.invalidLink.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.invalidLink.body')}</p>
      <BackToSettingsLink />
    </CardContent>
  );
}

/**
 * The gateway refused the invite — a dead end, but not a dead end on this
 * screen.
 *
 * Continue is the primary action because whoever followed this link wanted into
 * the app, not into a settings page. It goes to `/diary`, which is inside
 * `_personal` and therefore behind the onboarding gate: a device that is
 * already in the app lands on its diary, a blank one is routed on to
 * `/welcome`, and neither can come back here. Reusing the gate is what keeps
 * that decision in one place. The AI settings link stays as the secondary
 * action for the person who came from there.
 */
function InviteInvalidCard({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('connectGateway.inviteInvalid.title')}</p>
      {/* Generic by design — the gateway never tells us which of invalid /
          expired / already-used it was, and this page would not repeat it. */}
      <p className="text-sm text-muted-foreground">{t('connectGateway.inviteInvalid.body')}</p>
      <Button type="button" className="h-11 w-full" onClick={onContinue}>
        {t('connectGateway.inviteInvalid.continue')}
      </Button>
      <BackToSettingsLink />
    </CardContent>
  );
}

/**
 * The gateway didn't answer, in one of two ways that need two different people
 * to act.
 *
 * `blocked` (nothing came back at all, and the origin is one the CSP cannot
 * have allowed) points at THIS instance's operator and names the setting and
 * the exact origin. `network` points at the gateway itself, and at the person
 * who sent the invite. A single "something went wrong" would send both of them
 * looking in the wrong place.
 */
function UnreachableCard({ reason, gatewayOrigin }: { reason: 'blocked' | 'network'; gatewayOrigin: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      {reason === 'blocked' ?
        <>
          <p className="text-sm font-medium">{t('connectGateway.blocked.title')}</p>
          <Alert variant="warning">
            <AlertTitle>{t('connectGateway.blocked.operatorTitle')}</AlertTitle>
            <AlertDescription>{t('connectGateway.blocked.operatorBody', { origin: gatewayOrigin })}</AlertDescription>
          </Alert>
        </>
      : <>
          <p className="text-sm font-medium">{t('connectGateway.unreachable.title', { origin: gatewayOrigin })}</p>
          <p className="text-sm text-muted-foreground">{t('connectGateway.unreachable.body')}</p>
        </>
      }
      <div className="text-center">
        <BackToSettingsLink />
      </div>
    </CardContent>
  );
}

/**
 * The pre-join disclosure, shown BEFORE the join button whenever the gateway
 * declares that it audits. It is deliberately the loudest thing on the card:
 * the person about to tap "Join" is handing photographs of their meals to
 * somebody else's machine.
 *
 * Worded as the GATEWAY'S DECLARATION, never as a verified fact. This client
 * asked a server a question and is repeating the answer; a modified gateway can
 * answer `false` and audit anyway, and copy that promised otherwise would be a
 * guarantee openplate is in no position to make.
 */
function AuditDisclosure() {
  const { t } = useTranslation();
  return (
    <Alert variant="warning">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>{t('connectGateway.audit.title')}</AlertTitle>
      <AlertDescription>{t('connectGateway.audit.body')}</AlertDescription>
    </Alert>
  );
}

function ConfirmCard({
  info,
  gatewayOrigin,
  replaces,
  isJoining,
  onJoin,
}: {
  info: GatewayInfo;
  gatewayOrigin: string;
  /** The connection this join takes over, or `null` — see `describeReplacedConnection`. */
  replaces: string | null;
  isJoining: boolean;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <div className="space-y-1">
        <p className="text-base font-medium">{t('connectGateway.confirm.join', { name: info.name })}</p>
        {/* The ORIGIN, not the link's full URL: it is the part that says whose
            machine this actually is, and the only part the browser enforces. */}
        <p className="text-sm text-muted-foreground">{gatewayOrigin}</p>
      </div>
      {/* The routing consequence, stated plainly and unconditionally — this is
          the whole deal being agreed to, not a footnote. */}
      <p className="text-sm">{t('connectGateway.confirm.routing', { origin: gatewayOrigin })}</p>
      <p className="text-sm text-muted-foreground">{t('connectGateway.confirm.body')}</p>
      {isAuditDisclosureRequired(info) && <AuditDisclosure />}
      {replaces !== null && (
        <p className="text-sm text-muted-foreground">{t('connectGateway.confirm.replaces', { current: replaces })}</p>
      )}
      <Button type="button" className="h-11 w-full" disabled={isJoining} onClick={onJoin}>
        {isJoining ? t('connectGateway.confirm.joining') : t('connectGateway.confirm.button')}
      </Button>
      <div className="text-center">
        <BackToSettingsLink />
      </div>
    </CardContent>
  );
}

/**
 * The invite is spent and the device did not manage to write it down.
 *
 * Deliberately NOT the confirm card with an error on it. That card's button
 * redeems, and redeeming again posts a token the gateway has already burnt —
 * which is precisely how this failure used to turn into a lost join. This one
 * has a single action that repeats the two local writes off the parked answer
 * and dials nothing.
 *
 * The copy leads with "nothing is lost", because from where the person is
 * standing the join looked like it failed and the truthful thing to say is that
 * it did not: they are already a member, and only their device is behind.
 */
function SaveRetryCard({ isSaving, onRetry }: { isSaving: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <Alert variant="warning">
        <AlertTitle>{t('connectGateway.saveFailed')}</AlertTitle>
        <AlertDescription>{t('connectGateway.saveRetry')}</AlertDescription>
      </Alert>
      <Button type="button" className="h-11 w-full" disabled={isSaving} onClick={onRetry}>
        {isSaving ? t('connectGateway.confirm.joining') : t('connectGateway.retry')}
      </Button>
      <div className="text-center">
        <BackToSettingsLink />
      </div>
    </CardContent>
  );
}

/** Everything the confirm card and the redemption both need about this gateway. */
interface GatewayOffer {
  info: GatewayInfo;
  gatewayOrigin: string;
  /** The connection this join takes over, or `null` — see `describeReplacedConnection`. */
  replaces: string | null;
}

/**
 * The live boundaries a redemption is handed: the gateway, this device's two
 * stores, and the clock.
 *
 * Named here rather than built inside the component so the identity is stable
 * across renders, and so the one place production wires the network to the
 * store is one readable object. `app/lib/gateway-redemption.ts` holds the
 * sequence; this holds only what it acts on.
 */
const LIVE_REDEMPTION_DEPS: RedemptionDeps = {
  redeem: (invite: CapturedInvite) => redeemInvite(invite),
  // Wrapped rather than passed by reference: both store functions hand back the
  // row they wrote, and the redemption has no use for it.
  putAiSettings: async (settings) => {
    await putLocalAiSettings(settings);
  },
  putGatewayConnection: async (connection) => {
    await putLocalGatewayConnection(connection);
  },
  now: () => Date.now(),
};

export default function Join() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  /**
   * The captured link. A ref, not state: the invite token is a credential, and
   * this keeps it out of the render tree entirely — nothing below reads it, the
   * join handler simply hands it to `redeemInvite`.
   */
  const inviteRef = useRef<CapturedInvite | null>(null);
  const hasProbedRef = useRef(false);

  const syncServerUrl = useSyncServerUrl();
  const managed = useManagedInstance();

  /**
   * What a finished redemption does with its outcome.
   *
   * Split out of the redemption itself so the first attempt and every retry
   * land on identical screens, and so the only place that decides "this join is
   * done" is one function.
   */
  const applyOutcome = useCallback(
    async (outcome: RedemptionOutcome, parked: ParkedGatewayRedemption | null): Promise<void> => {
      if (outcome.status === 'invite-invalid') {
        // The slot was emptied by the redemption itself, before this ran.
        setPhase({ status: 'invite-invalid' });
        return;
      }
      if (outcome.status === 'save-failed') {
        // The answer is parked — that is what `save-failed` means. Reading it
        // back rather than trusting the argument covers the resume path, where
        // this mount never held it in the first place.
        const held = parked ?? readPendingGatewayRedemption();
        if (held === null) {
          // Nothing to retry: the answer is gone, so this is a dead end like a
          // refused invite, and the card that offers a way on is the right one.
          setPhase({ status: 'invite-invalid' });
          return;
        }
        setPhase({ status: 'save-retry', parked: held, isSaving: false });
        return;
      }

      // Publish the connection now rather than waiting for the next debounce or
      // page load: nothing else on this route schedules a cycle, and the whole
      // point of the account's connection row is that the person's OTHER device
      // stops asking them to connect. A no-op when sync is not configured or
      // the vault is locked, and deliberately not awaited — a slow or offline
      // sync server must not hold up the success navigation.
      void syncNow().catch(() => undefined);
      toast.success(t('connectGateway.joined', { name: outcome.gatewayName }));
      void navigate(await destinationAfterJoin(managed));
    },
    [managed, navigate, t],
  );

  /**
   * Spend the invite, write the two rows, and leave.
   *
   * Takes the offer as an argument rather than reading `phase`, because the
   * managed flow calls it straight out of the probe — where the confirm state
   * was never entered and a `phase` read would still hold the previous value.
   *
   * A `useCallback`, like `probeGateway` below it, because the mount effect
   * calls into this chain: without a stable identity the effect would list a
   * function that changes every render.
   */
  const redeemAndSave = useCallback(
    async (offer: GatewayOffer): Promise<void> => {
      const invite = inviteRef.current;
      if (invite === null) return;
      setPhase({ status: 'joining', ...offer });
      await applyOutcome(await redeemAndPark({ invite, deps: LIVE_REDEMPTION_DEPS }), null);
    },
    [applyOutcome],
  );

  /**
   * The retry, and the resume after a reload: the two local writes and nothing
   * else.
   *
   * This is the whole reason the redeemed result is parked. It never calls
   * `redeemAndPark`, so no path through this screen can post a spent token a
   * second time.
   */
  const saveRedeemed = useCallback(
    async (parked: ParkedGatewayRedemption): Promise<void> => {
      setPhase({ status: 'save-retry', parked, isSaving: true });
      await applyOutcome(await savePendingRedemption({ parked, deps: LIVE_REDEMPTION_DEPS }), parked);
    },
    [applyOutcome],
  );

  /**
   * `GET /v1/gateway/info`, then whatever this instance does with a gateway
   * half.
   *
   * A page load still burns nothing on an open instance, and on a managed one
   * it only redeems for somebody already signed in to it (`resolveGatewayStep`).
   * That is what keeps the header's promise against link previewers and mail
   * scanners: none of them carries a session, so all of them reach
   * `sign-in-first` and stop.
   */
  const probeGateway = useCallback(
    async (link: JoinLink): Promise<void> => {
      if (link.gatewayUrl === null || link.gatewayInvite === null) {
        setPhase({ status: 'invalid-link' });
        return;
      }
      const gatewayUrl = link.gatewayUrl;
      inviteRef.current = { gatewayUrl, inviteToken: link.gatewayInvite };
      const gatewayOrigin = new URL(gatewayUrl).origin;

      const probe = await fetchGatewayInfo(gatewayUrl);
      if (!probe.ok) {
        const isBlocked =
          probe.kind === 'blocked' &&
          requiresOperatorCspAllowlisting({ gatewayUrl, appOrigin: window.location.origin });
        setPhase({ status: 'unreachable', reason: isBlocked ? 'blocked' : 'network', gatewayOrigin });
        return;
      }

      const step = resolveGatewayStep({
        managed,
        hasAccount: getSyncSessionSnapshot().account !== null,
        auditRequired: isAuditDisclosureRequired(probe.info),
      });
      if (step === 'sign-in-first') {
        setPhase({ status: 'sign-in-first' });
        return;
      }
      // Read the existing connection only once the gateway is real, so a dead
      // link never touches the settings store at all.
      const offer: GatewayOffer = {
        info: probe.info,
        gatewayOrigin,
        replaces: await describeReplacedConnection(gatewayUrl),
      };
      if (step === 'auto-redeem') {
        await redeemAndSave(offer);
        return;
      }
      setPhase({ status: 'confirm', ...offer });
    },
    [managed, redeemAndSave],
  );

  useEffect(() => {
    // StrictMode double-mount guard: the fragment is stripped below, so a
    // second run would read an empty one. (The pending slot would give the
    // tokens back, but the phase machine below must not restart mid-flow.)
    if (hasProbedRef.current) return;
    hasProbedRef.current = true;

    // Reads the fragment, strips it with `replaceState`, and parks both halves
    // — all before a single request is made, and for a rejected link too, whose
    // tokens are just as sensitive.
    const link = takeJoinLinkFromUrl({ configuredSyncUrl: syncServerUrl });

    // A join that already spent its invite and did not finish writing it down.
    // Checked BEFORE the empty-link test, because such a slot holds no invite
    // and would read as an empty link — which is how a reload in the middle of
    // this would land on "this link doesn't look right". The sync half still
    // goes first when one is parked: the account is what the person keeps, and
    // they come back through here with it spent.
    const resumable = link.gatewayInvite === null ? readPendingGatewayRedemption() : null;
    if (resumable !== null && link.syncInvite === null) {
      void saveRedeemed(resumable);
      return;
    }

    if (isJoinLinkEmpty(link)) {
      setPhase({ status: 'invalid-link' });
      return;
    }
    if (isForeignSyncServer({ linkSyncUrl: link.syncUrl, configuredSyncUrl: syncServerUrl })) {
      setPhase({ status: 'foreign-server', origin: originOf(link.syncUrl) });
      return;
    }
    // Sync first, and it is a HANDOFF: the invite is parked, and the ceremony
    // on `/settings/sync` reads the same slot. On an open instance the gateway
    // half then waits in the slot until this route is opened again, which is
    // what the banner on that page is for; on a managed one that page brings
    // the person back here itself as soon as the account card is saved.
    if (link.syncInvite !== null) {
      setPhase({ status: 'sync', hasGateway: hasGatewayHalf(link) });
      return;
    }
    void probeGateway(link);
  }, [syncServerUrl, probeGateway, saveRedeemed]);

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t('join.title')}</CardTitle>
          <CardDescription>{t('join.description')}</CardDescription>
        </CardHeader>
        {phase.status === 'loading' && <LoadingCard />}
        {phase.status === 'invalid-link' && <InvalidLinkCard />}
        {phase.status === 'foreign-server' && <ForeignServerCard linkOrigin={phase.origin} />}
        {phase.status === 'sync' && (
          <SyncStepCard
            hasGateway={phase.hasGateway}
            managed={managed}
            onContinue={() => void navigate('/settings/sync')}
            onSkip={() => void navigate('/sign-in')}
          />
        )}
        {phase.status === 'sign-in-first' && <SignInFirstCard onSignIn={() => void navigate('/sign-in')} />}
        {phase.status === 'unreachable' && (
          <UnreachableCard reason={phase.reason} gatewayOrigin={phase.gatewayOrigin} />
        )}
        {(phase.status === 'confirm' || phase.status === 'joining') && (
          <ConfirmCard
            info={phase.info}
            gatewayOrigin={phase.gatewayOrigin}
            replaces={phase.replaces}
            isJoining={phase.status === 'joining'}
            onJoin={() =>
              void redeemAndSave({ info: phase.info, gatewayOrigin: phase.gatewayOrigin, replaces: phase.replaces })
            }
          />
        )}
        {phase.status === 'save-retry' && (
          <SaveRetryCard isSaving={phase.isSaving} onRetry={() => void saveRedeemed(phase.parked)} />
        )}
        {phase.status === 'invite-invalid' && <InviteInvalidCard onContinue={() => void navigate('/diary')} />}
      </Card>
    </div>
  );
}

/**
 * Where a finished join lands.
 *
 * On an OPEN instance: the AI settings page, which IS the success state — it
 * reads the row back from the device and renders the connected panel, plus the
 * standing audit notice when this gateway declared one, so there is no second
 * copy of "you are connected" to keep in step.
 *
 * On a MANAGED instance the join is the last step of getting IN, and a settings
 * page is not where somebody who just followed an invite wants to be left. The
 * onboarding gate decides instead, exactly as it does after a sign-in: the
 * diary when this account already holds one, the questionnaire when the
 * account was created a moment ago. `hasPendingGatewayJoin` is false by
 * construction here — the slot was emptied above — and passing anything else
 * would send the person back to this screen.
 */
async function destinationAfterJoin(managed: boolean): Promise<string> {
  if (!managed) return '/settings/ai';
  return resolveSignInDestination({ gate: await readOnboardingGateKind(), hasPendingGatewayJoin: false });
}
