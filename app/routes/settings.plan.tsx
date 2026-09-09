/**
 * `/settings/plan` — what this account pays for, and the two buttons that
 * change it.
 *
 * ── This route does not exist unless a biller stands behind the instance ──
 *
 * Two gates, and they answer the same 404 for two different reasons. The
 * server loader 404s with no `SYNC_SERVER_URL`, exactly as `settings.account`
 * does: with no server there is no account, so there is nothing to sell one.
 * The client loader then 404s unless the handshake says `plans: true`, because
 * `/v1/plans/*` answers the ordinary unknown-path 404 on an instance with no
 * biller, to everybody, so that a deployment with plans switched off cannot be
 * told from a gateway built before plans existed (`PROTOCOL.md` §5.22). A page
 * explaining a feature this deployment does not have would give that away in
 * one screenshot, which is the same reasoning `admin.feedback.tsx` writes down.
 *
 * The handshake read happens in the CLIENT loader and not the server one,
 * for the reason that route gives: the fact belongs to the sync server, the
 * browser already has it cached for the tab, and this app's server must not
 * start making a request per page load to answer it.
 *
 * ── Two buttons, both of which leave ─────────────────────────────────────
 *
 * Neither Stripe surface is rebuilt here. "Start" opens a Checkout Session and
 * follows the address the biller answers; "Manage" opens the Customer Portal,
 * which is where cancelling, changing a card and downloading an invoice live.
 * Building those would be three more screens holding the same card and the
 * same address, in an app whose whole arrangement exists so that neither is
 * ever here.
 *
 * ── The view is props only ───────────────────────────────────────────────
 *
 * `PlanScreen` takes everything it draws and holds no hook but `t`, so every
 * state on this page is reachable from `renderToStaticMarkup` in a unit test.
 * There is no DOM test library in this repository, so a state that can only be
 * reached by clicking is a state nothing checks.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react';

import type { Route } from './+types/settings.plan';
import { CONFIG } from '#app/config';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useSyncSession } from '#app/components/sync-status';
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { checkoutLocaleFor, requirePlansDoor } from '#app/lib/plans/plans-door';
import { currentPlansClient } from '#app/lib/plans/plans-session';
import type { PlanStatus, PlanView } from '#app/lib/sync/engine/client/plans-wire';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.plan') }];

export const handle = {
  titleKey: 'plan.title',
  title: 'Plan',
  backTo: '/settings',
};

/** @throws a 404 Response on an instance with no server configured, where there is no account to sell a plan to. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

/** @throws a 404 Response on an instance with no biller behind it, which is what the service itself answers. */
export async function clientLoader({ serverLoader }: Pick<Route.ClientLoaderArgs, 'serverLoader'>): Promise<{
  syncServerUrl: string;
}> {
  const { syncServerUrl } = await serverLoader();
  requirePlansDoor(await readCachedServerInstance(syncServerUrl));
  return { syncServerUrl };
}
clientLoader.hydrate = true as const;

/** The server render has no answer yet: whether this instance sells anything is the browser's read. */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;
}

/**
 * Where the plan read is.
 *
 * `absent` IS ITS OWN STATE and not a failure: it is the biller answering 404
 * between the handshake this page passed and the read it then made, which is
 * an operator switching the door off while a tab sat open. Saying "there is no
 * plan here" is true; saying "something went wrong" is not.
 */
export type PlanReadState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'absent' }
  | { kind: 'failed' }
  | { kind: 'ready'; plan: PlanView };

/** Which button is busy, so neither can be pressed twice into two Stripe sessions. */
export type PlanAction = 'none' | 'checkout' | 'portal';

/** What the person came back from, read off the address the biller sent them to. */
export type CheckoutReturn = 'none' | 'success' | 'cancelled';

/** The one sentence each status is worth. A `Record`, so a sixth status fails to compile here. */
const STATUS_KEY_BY_PLAN = {
  none: 'plan.status.none',
  trialing: 'plan.status.trialing',
  active: 'plan.status.active',
  past_due: 'plan.status.pastDue',
  canceled: 'plan.status.canceled',
} satisfies Record<PlanStatus, string>;

/**
 * The screen, props only.
 *
 * @param props.onStart - opens a checkout. Named for what a person does, not
 *   for the request it makes, because the same button is the trial's start and
 *   a lapsed subscription's restart.
 */
export function PlanScreen({
  state,
  busy,
  checkoutReturn,
  actionFailed,
  onStart,
  onManage,
}: {
  state: PlanReadState;
  busy: PlanAction;
  checkoutReturn: CheckoutReturn;
  /** `true` when the last button press did not produce an address to follow. */
  actionFailed: boolean;
  onStart: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();

  if (state.kind === 'loading') return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* WHAT JUST HAPPENED, FIRST. Somebody arriving from Stripe has a
          question this page must answer before it describes anything, and the
          success line does not claim the plan is already active: the webhook
          that records it is a separate delivery. */}
      {checkoutReturn === 'success' && <p className="text-sm">{t('plan.returned.success')}</p>}
      {checkoutReturn === 'cancelled' && <p className="text-sm text-muted-foreground">{t('plan.returned.cancelled')}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{t('plan.title')}</CardTitle>
          <CardDescription>
            {state.kind === 'ready' ? t(STATUS_KEY_BY_PLAN[state.plan.plan]) : t('plan.unknown')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.kind === 'signed-out' && <p className="text-sm text-muted-foreground">{t('plan.signedOut')}</p>}
          {state.kind === 'absent' && <p className="text-sm text-muted-foreground">{t('plan.absent')}</p>}
          {state.kind === 'failed' && <p className="text-sm text-muted-foreground">{t('plan.failed')}</p>}

          {state.kind === 'ready' && <PlanPeriod plan={state.plan} />}

          {/* THE PRICE IS NOT HERE, and its absence is deliberate: no number
              in this app is the price. The gross figure and the words that go
              with it are decided by the owner and shown by Checkout, which is
              also where the law requires them. This line states the one thing
              that is true of every price this instance charges. */}
          <p className="text-xs text-muted-foreground">{t('plan.vatNote')}</p>

          {actionFailed && <p className="text-sm text-destructive">{t('plan.actionFailed')}</p>}

          {state.kind === 'ready' && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onStart} disabled={busy !== 'none'}>
                {busy === 'checkout' ?
                  <Loader2 className="h-4 w-4 animate-spin" />
                : <CreditCard className="h-4 w-4" />}
                {t('plan.start')}
              </Button>
              {/* MANAGE IS DRAWN ONLY WHERE THERE IS SOMETHING TO MANAGE. The
                  biller answers a 404 for an account with no customer, and a
                  button whose only outcome is that 404 is a button that lies. */}
              {state.plan.portalAvailable && (
                <Button type="button" variant="secondary" onClick={onManage} disabled={busy !== 'none'}>
                  {busy === 'portal' ?
                    <Loader2 className="h-4 w-4 animate-spin" />
                  : <ExternalLink className="h-4 w-4" />}
                  {t('plan.manage')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The two date facts, which are one date and two opposite meanings.
 *
 * A CANCELLED SUBSCRIPTION STILL HAS A PERIOD END, and that end is the day
 * access stops rather than the day it renews. Saying "renews on" there would
 * be the page contradicting the cancellation the person just made.
 */
function PlanPeriod({ plan }: { plan: PlanView }) {
  const { t } = useTranslation();
  if (plan.currentPeriodEnd === null) return null;
  const date = new Date(plan.currentPeriodEnd).toLocaleDateString();
  return (
    <p className="text-sm">{plan.cancelAtPeriodEnd ? t('plan.endsOn', { date }) : t('plan.renewsOn', { date })}</p>
  );
}

/** The one place the two return values the biller sends back are decoded. */
export function readCheckoutReturn(value: string | null): CheckoutReturn {
  if (value === 'success') return 'success';
  if (value === 'cancelled') return 'cancelled';
  return 'none';
}

export default function SettingsPlan() {
  const { i18n } = useTranslation();
  // Read so a signed-out tab says so rather than reporting a failed request.
  const session = useSyncSession();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<PlanReadState>({ kind: 'loading' });
  const [busy, setBusy] = useState<PlanAction>('none');
  const [actionFailed, setActionFailed] = useState(false);
  // Read so the loader's own gate cannot be skipped by a direct render; the
  // value itself is not drawn.
  useLoaderData<typeof clientLoader>();

  const hasAccount = session.account !== null;

  useEffect(() => {
    if (!hasAccount) {
      setState({ kind: 'signed-out' });
      return;
    }
    let isMounted = true;
    const read = async (): Promise<void> => {
      const client = currentPlansClient();
      if (client === null) {
        if (isMounted) setState({ kind: 'signed-out' });
        return;
      }
      try {
        const outcome = await client.readPlan();
        if (!isMounted) return;
        setState(outcome.status === 'ok' ? { kind: 'ready', plan: outcome.value } : { kind: 'absent' });
      } catch {
        if (isMounted) setState({ kind: 'failed' });
      }
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [hasAccount]);

  /**
   * Follows an address the biller answered.
   *
   * `assign` AND NOT A ROUTER NAVIGATION: the address is Stripe's, on another
   * origin, and this app's router has nothing to do with it.
   */
  const follow = useCallback(async (open: () => Promise<string | null>, action: PlanAction): Promise<void> => {
    setBusy(action);
    setActionFailed(false);
    try {
      const url = await open();
      if (url === null) {
        setActionFailed(true);
        return;
      }
      window.location.assign(url);
    } catch {
      setActionFailed(true);
    } finally {
      setBusy('none');
    }
  }, []);

  const onStart = useCallback(() => {
    void follow(async () => {
      const client = currentPlansClient();
      if (client === null) return null;
      const outcome = await client.startCheckout({ locale: checkoutLocaleFor(i18n.language) });
      return outcome.status === 'ok' ? outcome.value.url : null;
    }, 'checkout');
  }, [follow, i18n.language]);

  const onManage = useCallback(() => {
    void follow(async () => {
      const client = currentPlansClient();
      if (client === null) return null;
      const outcome = await client.openPortal();
      return outcome.status === 'ok' ? outcome.value.url : null;
    }, 'portal');
  }, [follow]);

  return (
    <PlanScreen
      state={state}
      busy={busy}
      checkoutReturn={readCheckoutReturn(searchParams.get('checkout'))}
      actionFailed={actionFailed}
      onStart={onStart}
      onManage={onManage}
    />
  );
}
