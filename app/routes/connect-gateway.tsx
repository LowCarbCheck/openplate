/**
 * `/connect-gateway?gateway=<url>&invite=<token>` — gateway-mode onboarding.
 *
 * Somebody runs a gateway for their household and emails an invite link. That
 * link opens here, and this client configures ITSELF: it asks the gateway who
 * it is, shows what joining actually means, redeems the invite for a member
 * token on an explicit tap, and saves an ordinary `openai-compatible` BYOK row
 * pointed at the gateway.
 *
 * CLIENT-ONLY, and deliberately so — this route exports no `loader`, `action`,
 * `clientLoader` or `clientAction`. Both gateway calls are made BY THE BROWSER,
 * straight to the gateway's own origin (CORS is enabled on that side). The
 * openplate server must never see the invite token, the member token, or the
 * gateway address, and must never proxy AI traffic: the member token is exactly
 * the kind of credential AGENTS.md' "BYOK Security Rules" say never reaches
 * this server. Nothing here is server state — there is nothing to persist and
 * no secret to hold.
 *
 * ── Token hygiene ────────────────────────────────────────────────────────
 *
 * The invite token is one-shot and arrives in a URL, which is the leakiest
 * place a credential can sit: it lands in history, in a shared screenshot, in
 * a `Referer` header, and in whatever the browser syncs between devices. So the
 * mount effect captures both parameters into memory and IMMEDIATELY rewrites
 * the address bar (`history.replaceState`) before a single request is made.
 *
 * And redeeming NEVER happens on load. Invite links get fetched by mail
 * scanners, link previewers and prefetchers; a bare GET of this URL must burn
 * nothing. The only thing a page load does is the idempotent `GET
 * /v1/gateway/info`; the POST waits for a human tapping "Join".
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
import { useEffect, useRef, useState } from 'react';
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
  GATEWAY_REDEEM_PATH,
  buildGatewayAiSettings,
  gatewayInfoSchema,
  gatewayRedeemResponseSchema,
  isAuditDisclosureRequired,
  normalizeGatewayUrl,
  normalizeInviteToken,
  requiresOperatorCspAllowlisting,
  type GatewayInfo,
  type GatewayRedeemResponse,
} from '#app/lib/gateway-invite';
import { getLocalAiSettings, putLocalAiSettings } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';

export { RouteErrorBoundary as ErrorBoundary };

export const handle = {
  title: 'Join a gateway',
  titleKey: 'connectGateway.title',
};

/** How long the browser waits on a gateway before calling it unreachable. */
const GATEWAY_REQUEST_TIMEOUT_MS = 10_000;

/** The captured invite, held in a ref and never in state, URL, or storage. */
interface CapturedInvite {
  gatewayUrl: string;
  inviteToken: string;
}

type Phase =
  /** Before the mount effect has read the query string (and during SSR). */
  | { status: 'loading' }
  /** `?gateway=`/`?invite=` missing or unusable — a mangled or truncated link. */
  | { status: 'invalid-link' }
  /** The gateway answered nothing. `reason` picks between two different fixes, by two different people. */
  | { status: 'unreachable'; reason: 'blocked' | 'network'; gatewayOrigin: string }
  | { status: 'confirm'; info: GatewayInfo; gatewayOrigin: string; replaces: string | null }
  | { status: 'joining'; info: GatewayInfo; gatewayOrigin: string; replaces: string | null }
  /** Any non-200 from redeem. Deliberately one state: the gateway's reason is never shown. */
  | { status: 'invite-invalid' };

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
 * `POST /v1/invites/redeem`, or `null` for any failure.
 *
 * ONE null for every failure on purpose. The gateway answers an invalid,
 * expired or already-used invite with a generic 400, and this client keeps it
 * generic: telling someone which of the three it was tells an attacker holding
 * a guessed token the same thing.
 */
async function redeemInvite({ gatewayUrl, inviteToken }: CapturedInvite): Promise<GatewayRedeemResponse | null> {
  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}${GATEWAY_REDEEM_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ inviteToken }),
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Never carries the token: `reportError` receives the fetch failure only,
    // and this module logs nothing itself.
    reportError(error, { boundary: 'connect-gateway-redeem' });
    return null;
  }
  if (!response.ok) return null;
  const parsed = gatewayRedeemResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
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

function LoadingCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{t('connectGateway.checking')}</p>
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
      <p className="text-sm font-medium">{t('connectGateway.invalidLink.title')}</p>
      <p className="text-sm text-muted-foreground">{t('connectGateway.invalidLink.body')}</p>
      <BackToSettingsLink />
    </CardContent>
  );
}

function InviteInvalidCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('connectGateway.inviteInvalid.title')}</p>
      {/* Generic by design — the gateway never tells us which of invalid /
          expired / already-used it was, and this page would not repeat it. */}
      <p className="text-sm text-muted-foreground">{t('connectGateway.inviteInvalid.body')}</p>
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

export default function ConnectGateway() {
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

  useEffect(() => {
    // StrictMode double-mount guard: the URL is stripped below, so a second run
    // would read an empty query string and report a broken link.
    if (hasProbedRef.current) return;
    hasProbedRef.current = true;

    // Read from `window.location` rather than `useSearchParams` deliberately:
    // the very next statement rewrites the address bar, and a render-time
    // dependency on a value being erased inside an effect is a trap.
    const params = new URLSearchParams(window.location.search);
    const gatewayUrl = normalizeGatewayUrl(params.get('gateway'));
    const inviteToken = normalizeInviteToken(params.get('invite'));

    // FIRST, before any request: get the one-shot token out of the URL. This
    // runs unconditionally — even for a link this app rejects, whose token is
    // just as sensitive.
    window.history.replaceState(null, '', window.location.pathname);

    if (gatewayUrl === null || inviteToken === null) {
      setPhase({ status: 'invalid-link' });
      return;
    }
    inviteRef.current = { gatewayUrl, inviteToken };
    const gatewayOrigin = new URL(gatewayUrl).origin;

    void (async () => {
      const probe = await fetchGatewayInfo(gatewayUrl);
      if (!probe.ok) {
        const isBlocked =
          probe.kind === 'blocked' &&
          requiresOperatorCspAllowlisting({ gatewayUrl, appOrigin: window.location.origin });
        setPhase({ status: 'unreachable', reason: isBlocked ? 'blocked' : 'network', gatewayOrigin });
        return;
      }
      // Read the existing connection only once the gateway is real, so a dead
      // link never touches the settings store at all.
      const replaces = await describeReplacedConnection(gatewayUrl);
      setPhase({ status: 'confirm', info: probe.info, gatewayOrigin, replaces });
    })();
  }, []);

  async function handleJoin(): Promise<void> {
    const invite = inviteRef.current;
    if (phase.status !== 'confirm' || invite === null) return;
    setPhase({ ...phase, status: 'joining' });

    const redeemed = await redeemInvite(invite);
    if (redeemed === null) {
      setPhase({ status: 'invite-invalid' });
      return;
    }

    try {
      // The device holds one AI configuration, so this write both creates the
      // gateway connection and makes it the active provider; re-joining the
      // SAME gateway lands on the same row and simply refreshes its token.
      await putLocalAiSettings(buildGatewayAiSettings({ gatewayUrl: invite.gatewayUrl, redeemed, now: Date.now() }));
    } catch (error) {
      reportError(error, { boundary: 'connect-gateway-save' });
      setPhase({ ...phase, status: 'confirm' });
      toast.error(t('connectGateway.saveFailed'));
      return;
    }

    // The AI settings page IS the success state: it reads the row back from the
    // device and renders the connected panel (plus the standing audit notice
    // when this gateway declared one), so there is no second copy of "you are
    // connected" to keep in step here.
    toast.success(t('connectGateway.joined', { name: redeemed.gateway.name }));
    void navigate('/settings/ai');
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t('connectGateway.title')}</CardTitle>
          <CardDescription>{t('connectGateway.description')}</CardDescription>
        </CardHeader>
        {phase.status === 'loading' && <LoadingCard />}
        {phase.status === 'invalid-link' && <InvalidLinkCard />}
        {phase.status === 'unreachable' && (
          <UnreachableCard reason={phase.reason} gatewayOrigin={phase.gatewayOrigin} />
        )}
        {(phase.status === 'confirm' || phase.status === 'joining') && (
          <ConfirmCard
            info={phase.info}
            gatewayOrigin={phase.gatewayOrigin}
            replaces={phase.replaces}
            isJoining={phase.status === 'joining'}
            onJoin={() => void handleJoin()}
          />
        )}
        {phase.status === 'invite-invalid' && <InviteInvalidCard />}
      </Card>
    </div>
  );
}
