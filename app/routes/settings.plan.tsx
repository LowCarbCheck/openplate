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
import { useCallback, useState } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react';

import type { Route } from './+types/settings.plan';
import { CONFIG } from '#app/config';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { SettingsSection } from '#app/components/settings/settings-section';
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { checkoutLocaleFor, requirePlansDoor } from '#app/lib/plans/plans-door';
import { currentPlansClient } from '#app/lib/plans/plans-session';
import {
  PLAN_KEYS,
  type PlanKey,
  type PlanOffer,
  type PlanStatus,
  type PlanView,
} from '#app/lib/sync/engine/client/plans-wire';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { planViewOf, usePlanRead, type PlanReadState } from '#app/hooks/use-plan-standing';
import { usePlanOffer } from '#app/hooks/use-plan-offer';
import { PlanChoice } from '#app/components/plans/plan-choice';
import { useSyncSession } from '#app/components/sync-status';
import { planStanding } from '#app/lib/plans/plan-standing';
import { offerLocaleFor } from '#app/lib/plans/plans-door';
import { cn } from '#app/lib/utils';
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
  instance: InstanceDescriptor | null;
}> {
  const { syncServerUrl } = await serverLoader();
  const instance = await readCachedServerInstance(syncServerUrl);
  requirePlansDoor(instance);
  // The descriptor rides along so the page's standing reads the SAME answer
  // the gate just passed, rather than a second read that starts at `null`.
  return { syncServerUrl, instance };
}
clientLoader.hydrate = true as const;

/** The server render has no answer yet: whether this instance sells anything is the browser's read. */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;
}

/** Where the plan read is. Owned by `use-plan-standing.ts`, re-exported for the screen's own tests. */
export type { PlanReadState };

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
  offer,
  selectedPlan,
  busy,
  checkoutReturn,
  actionFailed,
  onSelectPlan,
  onStart,
  onManage,
}: {
  state: PlanReadState;
  /** What this instance sells, or `null` when there is no offer to draw. */
  offer: PlanOffer | null;
  /** The picked plan, `null` until the person picks one or a link named one. */
  selectedPlan: PlanKey | null;
  busy: PlanAction;
  checkoutReturn: CheckoutReturn;
  /** `true` when the last button press did not produce an address to follow. */
  actionFailed: boolean;
  onSelectPlan: (key: PlanKey) => void;
  onStart: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  // With an offer on screen the person picks first, so the plan they read is
  // the plan they asked for. With none (a biller older than the offer) the
  // button works as it always did.
  const needsPick = offer !== null && selectedPlan === null;

  if (state.kind === 'loading') return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {/* WHAT JUST HAPPENED, FIRST. Somebody arriving from Stripe has a
          question this page must answer before it describes anything, and the
          success line does not claim the plan is already active: the webhook
          that records it is a separate delivery. */}
      {checkoutReturn === 'success' && <p className="text-sm">{t('plan.returned.success')}</p>}
      {checkoutReturn === 'cancelled' && (
        <p className="text-sm text-muted-foreground">{t('plan.returned.cancelled')}</p>
      )}

      <SettingsSection
        label={t('plan.title')}
        description={state.kind === 'ready' ? t(STATUS_KEY_BY_PLAN[state.plan.plan]) : t('plan.unknown')}
        contentClassName="space-y-3"
      >
        {state.kind === 'signed-out' && <p className="text-sm text-muted-foreground">{t('plan.signedOut')}</p>}
        {state.kind === 'absent' && <p className="text-sm text-muted-foreground">{t('plan.absent')}</p>}
        {state.kind === 'failed' && <p className="text-sm text-muted-foreground">{t('plan.failed')}</p>}

        {state.kind === 'ready' && <PlanPeriod plan={state.plan} />}

        {/* THE PRICES ARE DATA. No number in this app is a price: every
            figure on the cards is the biller's `grossCents`, or arithmetic on
            it (`plan-prices.ts`), and the term under each is the biller's own
            sentence. */}
        {state.kind === 'ready' && offer !== null && (
          <PlanChoice plans={offer.plans} selectedKey={selectedPlan} onSelect={onSelectPlan} />
        )}

        <p className="text-xs text-muted-foreground">{t('plan.vatNote')}</p>

        {/* ONE RESERVED LINE for the two things that can appear above the
            buttons, so neither a failed press nor a pick moves them. */}
        {state.kind === 'ready' && (
          <p
            data-slot="plan-action-line"
            role={actionFailed ? 'alert' : undefined}
            className={cn(
              'min-h-5 text-sm',
              actionFailed ? 'text-destructive' : 'text-muted-foreground',
              !actionFailed && !needsPick && 'invisible',
            )}
          >
            {actionFailed && t('plan.actionFailed')}
            {!actionFailed && needsPick && t('plan.choice.pickFirst')}
            {!actionFailed && !needsPick && '\u00a0'}
          </p>
        )}

        {state.kind === 'ready' && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onStart} disabled={busy !== 'none' || needsPick}>
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
      </SettingsSection>
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

/**
 * The plan a link named, `?plan=yearly`, or `null`.
 *
 * THE ONLY WAY A PLAN IS PICKED BEFORE THE PERSON PICKS ONE: they followed a
 * link that already said which. Anything else in the parameter is ignored.
 */
export function readPlanParam(value: string | null): PlanKey | null {
  return PLAN_KEYS.find((key) => key === value) ?? null;
}

export default function SettingsPlan() {
  const { i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const session = useSyncSession();
  // The loader has already passed the door, so the read is always enabled
  // here, and the descriptor it passed is the one the standing reads.
  const { instance } = useLoaderData<typeof clientLoader>();
  const read = usePlanRead({ isEnabled: true });
  const standing = planStanding({
    instance,
    account: session.account,
    planView: planViewOf(read),
    now: new Date(),
  });
  // A paying person is not sold a second plan, so their page never asks.
  const offerRead = usePlanOffer({
    isEnabled: read.kind === 'ready' && standing.kind !== 'subscribed',
    locale: offerLocaleFor(i18n.language),
  });
  const [pickedPlan, setPickedPlan] = useState<PlanKey | null>(() => readPlanParam(searchParams.get('plan')));
  const [busy, setBusy] = useState<PlanAction>('none');
  const [actionFailed, setActionFailed] = useState(false);

  const offer = offerRead.settled ? offerRead.offer : null;
  // A linked plan the offer does not contain is no pick at all.
  const selectedPlan = offer?.plans.some((plan) => plan.key === pickedPlan) ? pickedPlan : null;
  // HELD UNTIL THE OFFER IS IN, so the cards never arrive underneath a page
  // that is already drawn and push its buttons down.
  const isWaitingForOffer = read.kind === 'ready' && standing.kind !== 'subscribed' && !offerRead.settled;
  const state: PlanReadState = isWaitingForOffer ? { kind: 'loading' } : read;

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
      offer={offer}
      selectedPlan={selectedPlan}
      onSelectPlan={setPickedPlan}
      busy={busy}
      checkoutReturn={readCheckoutReturn(searchParams.get('checkout'))}
      actionFailed={actionFailed}
      onStart={onStart}
      onManage={onManage}
    />
  );
}
