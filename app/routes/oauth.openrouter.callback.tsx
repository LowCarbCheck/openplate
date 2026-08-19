/**
 * OpenRouter OAuth PKCE callback (M127/02) — CLIENT-ONLY. This route
 * deliberately has no `loader`/`action`/`clientLoader`/`clientAction` export:
 * the authorization `code`, the stored verifier, and the issued key must
 * never be read or written by any server code path (the BYOK key lives only
 * in this device's local store, never the openplate server — see
 * `#app/lib/local-store/ai-settings`). Everything below runs in a mount-time
 * `useEffect`.
 *
 * IDEMPOTENCY: a back-button, refresh, or restored browser tab can replay
 * this URL with a stale `?code=`. That must never surface a raw re-exchange
 * error to someone who is, in fact, already connected — see
 * `hasStaleCodeButAlreadyConnected` below, checked both before AND after a
 * failed exchange attempt.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '#app/components/ui/card';
import { beginConnect, exchangeCode, OAuthPkceError, OPENROUTER_OAUTH_CONFIG } from '#app/lib/oauth-pkce';
import type { OAuthPkceErrorCode } from '#app/lib/oauth-pkce';
import { getLocalAiSettings, putLocalAiSettings } from '#app/lib/local-store';
import { verifyProviderKey } from '#app/services/vision/verify-key';
import { reportError } from '#app/lib/report-error';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';

export { RouteErrorBoundary as ErrorBoundary };

export const handle = {
  title: 'Connecting to OpenRouter',
  titleKey: 'oauth.callback.title',
};

/**
 * The model an OAuth-connected user starts on (spec 01's owner-decided
 * recommendation, 2026-08-03) — deliberately DIFFERENT from
 * `catalog.ts`'s `getRecommendedModel()` (the manual-entry picker's own
 * default, `openai/gpt-5.6-luna`): this pick is scoped to the OAuth
 * connect flow specifically, chosen for its confirmed no-training/zero- or
 * bounded-retention provider routes (see `.reports/m127-openrouter-oauth-spike.md`).
 * A user who connects via OAuth can still pick any catalog model afterward
 * from AI settings — this is only the first-run default.
 *
 * It IS a listed, priced entry of `MODEL_CATALOG.openrouter` (differing from
 * the recommendation is not the same as being absent from the catalog): an
 * off-catalog default would price at `undefined` and leave every
 * OAuth-connected user with no cost estimate anywhere in the UI. Exported so
 * `tests/unit/vision-catalog.test.ts` can pin exactly that.
 */
export const OAUTH_DEFAULT_MODEL = 'google/gemini-3.5-flash-lite';

type CallbackPhase =
  | { status: 'working' }
  | { status: 'already-connected' }
  | { status: 'connected'; verified: true }
  | { status: 'connected'; verified: false }
  | { status: 'error'; code: OAuthPkceErrorCode };

/**
 * Catalog keys, not literals: the copy itself lives in the locale catalogs, but
 * the code → copy mapping stays here so an unhandled `OAuthPkceErrorCode` is
 * still a compile error rather than a silently missing translation.
 */
const ERROR_COPY_KEYS = {
  denied: {
    titleKey: 'oauth.callback.error.denied.title',
    bodyKey: 'oauth.callback.error.denied.body',
  },
  'missing-verifier': {
    titleKey: 'oauth.callback.error.missingVerifier.title',
    bodyKey: 'oauth.callback.error.missingVerifier.body',
  },
  'state-mismatch': {
    titleKey: 'oauth.callback.error.stateMismatch.title',
    bodyKey: 'oauth.callback.error.stateMismatch.body',
  },
  expired: {
    titleKey: 'oauth.callback.error.expired.title',
    bodyKey: 'oauth.callback.error.expired.body',
  },
  'exchange-failed': {
    titleKey: 'oauth.callback.error.exchangeFailed.title',
    bodyKey: 'oauth.callback.error.exchangeFailed.body',
  },
} satisfies Record<OAuthPkceErrorCode, { titleKey: string; bodyKey: string }>;

/** Runs one attempt of the OAuth PKCE flow from the callback URL's own `?code=`/`?state=`. */
async function runOAuthCallback(params: { code: string | null; state: string }): Promise<CallbackPhase> {
  const existing = await getLocalAiSettings();
  const hasStaleCodeButAlreadyConnected =
    existing !== null && existing.provider === 'openrouter' && existing.apiKey.length > 0;

  if (params.code === null && hasStaleCodeButAlreadyConnected) {
    return { status: 'already-connected' };
  }

  try {
    const { apiKey } = await exchangeCode(OPENROUTER_OAUTH_CONFIG, params);
    await putLocalAiSettings({
      provider: 'openrouter',
      model: OAUTH_DEFAULT_MODEL,
      baseUrl: null,
      apiKey,
      connectedVia: 'oauth',
      updatedAt: Date.now(),
    });
    const verification = await verifyProviderKey({ provider: 'openrouter', apiKey });
    return { status: 'connected', verified: verification.status !== 'rejected' };
  } catch (error) {
    // A stale/replayed callback (e.g. the back button) can fail the exchange
    // itself (missing-verifier, state-mismatch, ...) even though a real key
    // is already sitting in the local store from the original successful
    // visit — never show that as a raw error.
    if (hasStaleCodeButAlreadyConnected) {
      return { status: 'already-connected' };
    }
    if (error instanceof OAuthPkceError) {
      return { status: 'error', code: error.code };
    }
    reportError(error, { boundary: 'oauth-openrouter-callback' });
    return { status: 'error', code: 'exchange-failed' };
  }
}

function ConnectingCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{t('oauth.callback.working')}</p>
    </CardContent>
  );
}

function AlreadyConnectedCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">{t('oauth.callback.alreadyConnected')}</p>
      <Button asChild className="h-11 w-full">
        <Link to="/scan">{t('oauth.callback.goToScanning')}</Link>
      </Button>
    </CardContent>
  );
}

function ConnectedCard({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      {verified ?
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{t('oauth.callback.connectedVerified')}</p>
      : <p className="text-sm text-muted-foreground">{t('oauth.callback.connectedUnverified')}</p>}
      <Button asChild className="h-11 w-full">
        <Link to="/scan">{t('oauth.callback.goToScanning')}</Link>
      </Button>
    </CardContent>
  );
}

function ErrorCard({ code, onRetry, isRetrying }: { code: OAuthPkceErrorCode; onRetry: () => void; isRetrying: boolean }) {
  const { t } = useTranslation();
  const copy = ERROR_COPY_KEYS[code];
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t(copy.titleKey)}</p>
      <p className="text-sm text-muted-foreground">{t(copy.bodyKey)}</p>
      <div className="flex flex-col gap-2">
        <Button type="button" className="h-11 w-full" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? t('oauth.callback.redirecting') : t('oauth.callback.tryAgain')}
        </Button>
        <Link
          to="/settings/ai"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('oauth.callback.manualInstead')}
        </Link>
      </div>
    </CardContent>
  );
}

export default function OAuthOpenRouterCallback() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<CallbackPhase>({ status: 'working' });
  const [isRetrying, setIsRetrying] = useState(false);
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    const code = searchParams.get('code');
    const state = searchParams.get('state') ?? '';
    void runOAuthCallback({ code, state }).then(setPhase);
  }, [searchParams]);

  async function handleRetry(): Promise<void> {
    setIsRetrying(true);
    try {
      const { redirectUrl } = await beginConnect(OPENROUTER_OAUTH_CONFIG);
      window.location.href = redirectUrl;
    } catch (error) {
      reportError(error, { boundary: 'oauth-openrouter-callback-retry' });
      setIsRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t('oauth.callback.title')}</CardTitle>
          <CardDescription>{t('oauth.callback.description')}</CardDescription>
        </CardHeader>
        {phase.status === 'working' && <ConnectingCard />}
        {phase.status === 'already-connected' && <AlreadyConnectedCard />}
        {phase.status === 'connected' && <ConnectedCard verified={phase.verified} />}
        {phase.status === 'error' && <ErrorCard code={phase.code} onRetry={() => void handleRetry()} isRetrying={isRetrying} />}
      </Card>
    </div>
  );
}
