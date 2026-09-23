/**
 * `/settings/plan`: what this account pays for, and the order page that
 * changes it.
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
 * for the reason that route gives: the fact belongs to the sync server, and
 * this app's server must not start making a request per page load to answer
 * it. The gate reads it FRESH rather than from the tab's cache (M245/05,
 * `plans-door.ts`): a tab that once saw the door open must not keep opening
 * the page after the server shut it.
 *
 * ── The contract is concluded HERE, and Stripe only takes the payment ────
 *
 * M245/04. Somebody without a plan gets the order page, drawn from
 * `GET /plans/offer` (`plan-order.tsx`): the plans, the texts § 312j BGB wants
 * read before the button, two unticked boxes, and the biller's own button
 * label. The press posts `POST /plans/order`, and only its answer decides what
 * happens next: an address to Stripe, a booked switch, a page that went stale,
 * an account that already pays, or a failure the person can try again after.
 *
 * ── Plan changes happen on this page and only here ───────────────────────
 *
 * Owner decision, 2026-09-23 (M245/07). A monthly subscriber sees the status
 * card with a link to order the yearly plan (`?plan=yearly`); the order page
 * then shows the yearly plan alone and the biller's switch note in place of
 * the payment note. The biller answers a booked switch, and the page stays.
 * A yearly subscriber sees the status card only. "Manage" still opens the
 * Stripe Customer Portal, which since M245/06 allows cancellation only.
 *
 * ── The view is props only ───────────────────────────────────────────────
 *
 * `PlanScreen` takes everything it draws and holds no hook but `t`, so every
 * state on this page is reachable from `renderToStaticMarkup` in a unit test.
 * There is no DOM test library in this repository, so a state that can only be
 * reached by clicking is a state nothing checks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { ExternalLink, Loader2 } from 'lucide-react';

import type { Route } from './+types/settings.plan';
import { CONFIG } from '#app/config';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { SettingsSection } from '#app/components/settings/settings-section';
import { PLAN_PAGE_HREF, offerLocaleFor, requirePlansDoor } from '#app/lib/plans/plans-door';
import { currentPlansClient } from '#app/lib/plans/plans-session';
import type { OrderOutcome } from '#app/lib/sync/engine/client/plans-client';
import { PLAN_KEYS, type PlanKey, type PlanOffer, type PlanStatus } from '#app/lib/sync/engine/client/plans-wire';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { planViewOf, usePlanRead, type PlanReadState } from '#app/hooks/use-plan-standing';
import { usePlanOffer } from '#app/hooks/use-plan-offer';
import { useTrialRecap } from '#app/hooks/use-trial-recap';
import { useSyncSession } from '#app/components/sync-status';
import { planStanding, type PlanStanding } from '#app/lib/plans/plan-standing';
import { PlanStatusCard, type SubscribedStanding } from '#app/components/plans/plan-status-card';
import {
  NO_CONSENTS,
  PlanOrder,
  type ConsentKey,
  type ConsentState,
  type OrderMode,
  type OrderNotice,
  type PlanOrderProps,
} from '#app/components/plans/plan-order';
import { cn } from '#app/lib/utils';
import { trackOrderSent, trackPaymentReturned } from '#app/lib/matomo-events';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.plan') }];

export const handle = {
  titleKey: 'plan.title',
  title: 'Plan',
  backTo: '/settings',
};

/** Where a monthly subscriber orders the yearly plan. The order page reads the same parameter a link to a plan uses. */
export const ORDER_YEARLY_HREF = `${PLAN_PAGE_HREF}?plan=yearly`;

/** @throws a 404 Response on an instance with no server configured, where there is no account to sell a plan to. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

/** @throws a 404 Response on an instance with no biller behind it, which is what the service itself answers. */
export async function clientLoader({ serverLoader }: Pick<Route.ClientLoaderArgs, 'serverLoader'>): Promise<{
  syncServerUrl: string;
  instance: InstanceDescriptor;
}> {
  const { syncServerUrl } = await serverLoader();
  const instance = await requirePlansDoor({ serverUrl: syncServerUrl });
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

/** Which press is in flight, so neither can be pressed twice. */
export type PlanAction = 'none' | 'order' | 'portal';

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

/** What the order block needs from the page, minus the handlers the page adds. */
export type OrderView = Omit<PlanOrderProps, 'onSelectPlan' | 'onConsentChange' | 'onOrder'>;

export interface PlanScreenProps {
  state: PlanReadState;
  /** Where the person stands, from `planStanding`. A subscriber gets the status card. */
  standing: PlanStanding;
  /** The order block, or `null` when this page places no order. */
  order: OrderView | null;
  /** `true` when an order was wanted and the offer is still on its way. */
  isOrderLoading: boolean;
  /** `true` when an order was wanted and the offer could not be read. */
  isOfferUnavailable: boolean;
  busy: PlanAction;
  checkoutReturn: CheckoutReturn;
  /** `true` when the last portal press did not produce an address to follow. */
  portalFailed: boolean;
  /** Where a monthly subscriber may order the yearly plan, or `null` when they may not. */
  orderYearlyHref: string | null;
  /** The ISO day a switch booked on this page starts, or `null`. */
  switchStartsAt: string | null;
  /** `true` after the biller said this account already pays, with no order block left to say it in. */
  isAlreadySubscribed: boolean;
  /**
   * The meals logged with AI during the trial (M250/05), or `null` when there
   * is no trial to sum up. Zero draws no line, like `null`.
   */
  recapMealCount: number | null;
  onSelectPlan: (key: PlanKey) => void;
  onConsentChange: (key: ConsentKey, isTicked: boolean) => void;
  onOrder: () => void;
  onManage: () => void;
}

/** The manage button and the one reserved line that says it failed. */
function PortalControls({
  busy,
  portalFailed,
  onManage,
}: Pick<PlanScreenProps, 'busy' | 'portalFailed' | 'onManage'>) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onManage} disabled={busy !== 'none'}>
          {busy === 'portal' ?
            <Loader2 className="h-4 w-4 animate-spin" />
          : <ExternalLink className="h-4 w-4" />}
          {t('plan.manage')}
        </Button>
      </div>
      <p
        data-slot="plan-portal-line"
        role={portalFailed ? 'alert' : undefined}
        className={cn('min-h-5 text-sm text-destructive', !portalFailed && 'invisible')}
      >
        {portalFailed ? t('plan.actionFailed') : '\u00a0'}
      </p>
    </>
  );
}

/** The screen, props only. */
export function PlanScreen(props: PlanScreenProps) {
  const { state, standing, order, checkoutReturn, busy } = props;
  const { t } = useTranslation();
  const subscribed: SubscribedStanding | null =
    state.kind === 'ready' && standing.kind === 'subscribed' ? standing : null;

  if (state.kind === 'loading') return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;

  const portalAvailable = state.kind === 'ready' && state.plan.portalAvailable;
  // The account section above an order: drawn for every state that is not an
  // answer, and for an answer with something to say besides the order.
  const showsAccountSection =
    subscribed === null && (state.kind !== 'ready' || order === null || portalAvailable);

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
      {props.isAlreadySubscribed && order === null && (
        <p data-slot="plan-already-subscribed" className="text-sm">
          {t('plan.order.alreadySubscribed')}
        </p>
      )}

      {/* A SUBSCRIBER IS NOT SOLD A SECOND PLAN. They get what they hold, the
          date that matters next, the way to the portal, and for a monthly
          plan the one change this page offers. */}
      {subscribed !== null && (
        <div className="space-y-1">
          <PlanStatusCard
            standing={subscribed}
            portalAvailable={portalAvailable}
            isOpeningPortal={busy === 'portal'}
            isBusy={busy !== 'none'}
            onManage={props.onManage}
            orderYearlyHref={order === null && !props.isOrderLoading ? props.orderYearlyHref : null}
            switchStartsAt={props.switchStartsAt}
          />
          {portalAvailable && (
            <p
              data-slot="plan-portal-line"
              role={props.portalFailed ? 'alert' : undefined}
              className={cn('min-h-5 px-4 text-sm text-destructive', !props.portalFailed && 'invisible')}
            >
              {props.portalFailed ? t('plan.actionFailed') : '\u00a0'}
            </p>
          )}
        </div>
      )}

      {showsAccountSection && (
        <SettingsSection
          label={t('plan.title')}
          description={state.kind === 'ready' ? t(STATUS_KEY_BY_PLAN[state.plan.plan]) : t('plan.unknown')}
          contentClassName="space-y-3"
        >
          {state.kind === 'signed-out' && <p className="text-sm text-muted-foreground">{t('plan.signedOut')}</p>}
          {state.kind === 'absent' && <p className="text-sm text-muted-foreground">{t('plan.absent')}</p>}
          {state.kind === 'failed' && <p className="text-sm text-muted-foreground">{t('plan.failed')}</p>}
          {state.kind === 'ready' && props.isOfferUnavailable && (
            <p data-slot="plan-order-unavailable" className="text-sm text-muted-foreground">
              {t('plan.order.unavailable')}
            </p>
          )}
          {/* MANAGE IS DRAWN ONLY WHERE THERE IS SOMETHING TO MANAGE. The
              biller answers a 404 for an account with no customer, and a
              button whose only outcome is that 404 is a button that lies. */}
          {portalAvailable && (
            <PortalControls busy={busy} portalFailed={props.portalFailed} onManage={props.onManage} />
          )}
        </SettingsSection>
      )}

      {props.isOrderLoading && subscribed !== null && (
        <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>
      )}

      {/* WHAT THE TRIAL WAS USED FOR, above the plans, counted from this
          device's diary (M250/05). The page is held until the count is in,
          so this line never arrives above an order already drawn. */}
      {state.kind === 'ready' && props.recapMealCount !== null && props.recapMealCount > 0 && (
        <p data-slot="plan-trial-recap" className="text-sm">
          {t('plan.recap.meals', { count: props.recapMealCount })}
        </p>
      )}

      {order !== null && (
        <PlanOrder
          {...order}
          onSelectPlan={props.onSelectPlan}
          onConsentChange={props.onConsentChange}
          onOrder={props.onOrder}
        />
      )}
    </div>
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

/**
 * Whether this subscriber may order the yearly plan here, and from when it
 * would start: the end of the paid month.
 *
 * Only a monthly plan that is paid up and has a period end. The biller refuses
 * the rest with 409 anyway (`plan-switch.ts`: a debt is settled before a
 * yearly charge is booked); drawing a link whose only outcome is that refusal
 * would be a link that lies.
 */
export function switchStartFor(standing: PlanStanding): string | null {
  if (standing.kind !== 'subscribed') return null;
  if (standing.planKey !== 'monthly' || standing.isPastDue) return null;
  return standing.periodEnd;
}

/** Places the order over the open session. `null` when nobody is signed in any more. */
async function sendOrder(input: {
  offer: PlanOffer;
  plan: PlanKey;
}): Promise<OrderOutcome | null> {
  const client = currentPlansClient();
  if (client === null) return null;
  return await client.placeOrder({
    plan: input.plan,
    // THE OFFER'S OWN LANGUAGE, not the UI's: the biller rebuilds the page
    // for this language to compare versions, so it must be the page read.
    locale: input.offer.locale,
    consentVersion: input.offer.consentVersion,
    consents: { terms: true, earlyStart: true },
  });
}

export default function SettingsPlan() {
  const { i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = useSyncSession();
  // READ ONCE, AT MOUNT. The marker the biller put on the address is taken
  // off it below, and the page must go on saying what happened after that.
  const [checkoutReturn] = useState<CheckoutReturn>(() => readCheckoutReturn(searchParams.get('checkout')));
  const hasReportedReturn = useRef(false);
  const [planRefresh, setPlanRefresh] = useState(0);
  const [offerRefresh, setOfferRefresh] = useState(0);
  const [pickedPlan, setPickedPlan] = useState<PlanKey | null>(null);
  const [consents, setConsents] = useState<ConsentState>(NO_CONSENTS);
  const [notice, setNotice] = useState<OrderNotice>('none');
  const [busy, setBusy] = useState<PlanAction>('none');
  const [portalFailed, setPortalFailed] = useState(false);
  const [switchStartsAt, setSwitchStartsAt] = useState<string | null>(null);

  // The loader has already passed the door, so the read is always enabled
  // here, and the descriptor it passed is the one the standing reads.
  const { instance } = useLoaderData<typeof clientLoader>();
  const read = usePlanRead({ isEnabled: true, refresh: planRefresh });
  const standing = planStanding({
    instance,
    account: session.account,
    planView: planViewOf(read),
    now: new Date(),
  });
  const isSubscribed = read.kind === 'ready' && standing.kind === 'subscribed';
  // Read LIVE from the address, so the status card's link opens the order on
  // the page that is already mounted.
  const linkedPlan = readPlanParam(searchParams.get('plan'));
  const switchStart = switchStartsAt === null ? switchStartFor(standing) : null;
  const isSwitching = isSubscribed && switchStart !== null && linkedPlan === 'yearly';
  const wantsOrder = read.kind === 'ready' && (!isSubscribed || isSwitching);
  const offerRead = usePlanOffer({
    isEnabled: wantsOrder,
    locale: offerLocaleFor(i18n.language),
    refresh: offerRefresh,
  });

  const recap = useTrialRecap({
    standing,
    accountCreatedAt: session.account?.createdAt,
    isEnabled: read.kind === 'ready',
  });

  const offer = offerRead.settled ? offerRead.offer : null;
  const wantedPick = isSwitching ? 'yearly' : (pickedPlan ?? linkedPlan);
  // A linked plan the offer does not contain is no pick at all.
  const selectedPlan = offer?.plans.some((plan) => plan.key === wantedPick) ? wantedPick : null;
  const mode: OrderMode =
    isSwitching && switchStart !== null ? { kind: 'switch', startsAt: switchStart } : { kind: 'first' };
  const isOrderLoading = wantsOrder && !offerRead.settled;
  // HELD UNTIL THE OFFER AND THE TRIAL RECAP ARE IN for somebody without a
  // plan, so neither the order nor the recap line above it arrives underneath
  // a page that is already drawn and pushes it down.
  const isWaitingForRecap = read.kind === 'ready' && !recap.settled;
  const state: PlanReadState =
    (isOrderLoading && !isSubscribed) || isWaitingForRecap ? { kind: 'loading' } : read;
  const order: OrderView | null =
    wantsOrder && offer !== null ?
      { offer, mode, selectedPlan, consents, notice, isOrdering: busy === 'order' }
    : null;

  // ONE RETURN, ONE EVENT, ONE THANK-YOU. The `checkout` marker leaves the
  // address, replacing the history entry, so a reload or a back navigation
  // neither counts the return twice nor thanks somebody for a payment they
  // made last week.
  useEffect(() => {
    if (checkoutReturn === 'none' || hasReportedReturn.current) return;
    hasReportedReturn.current = true;
    trackPaymentReturned(checkoutReturn === 'success' ? 'paid' : 'cancelled');
    setSearchParams(
      (params) => {
        params.delete('checkout');
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [checkoutReturn, setSearchParams]);

  /** Takes the order link off the address, so the page shows the plan and not the order. */
  const leaveOrder = useCallback(() => {
    setSearchParams(
      (params) => {
        params.delete('plan');
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [setSearchParams]);

  /** What the page does with each answer. See the route header. */
  const settleOrder = useCallback(
    (outcome: OrderOutcome | null): void => {
      if (outcome === null) {
        setNotice('failed');
        setBusy('none');
        return;
      }
      switch (outcome.kind) {
        case 'redirect':
          // `assign` AND NOT A ROUTER NAVIGATION: the address is Stripe's, on
          // another origin. The button stays busy until the browser leaves.
          window.location.assign(outcome.url);
          return;
        case 'switched':
          setSwitchStartsAt(outcome.startsAt);
          setConsents(NO_CONSENTS);
          leaveOrder();
          break;
        case 'stale':
          // NOTHING IS UNTICKED SILENTLY. The page the person agreed to is not
          // the page the biller sells any more: read it again, clear both
          // boxes, keep the pick, and say why.
          setConsents(NO_CONSENTS);
          setNotice('stale');
          setOfferRefresh((count) => count + 1);
          break;
        case 'already-subscribed':
          setNotice('already-subscribed');
          setPlanRefresh((count) => count + 1);
          leaveOrder();
          break;
        case 'refused':
        case 'absent':
          setNotice('failed');
          break;
      }
      setBusy('none');
    },
    [leaveOrder],
  );

  const onOrder = useCallback(() => {
    if (offer === null || selectedPlan === null || !consents.terms || !consents.earlyStart) return;
    trackOrderSent(selectedPlan);
    setBusy('order');
    setNotice('none');
    void sendOrder({ offer, plan: selectedPlan }).then(settleOrder, () => settleOrder(null));
  }, [offer, selectedPlan, consents, settleOrder]);

  const onConsentChange = useCallback((key: ConsentKey, isTicked: boolean) => {
    setConsents((current) => ({ ...current, [key]: isTicked }));
  }, []);

  const onManage = useCallback(() => {
    setBusy('portal');
    setPortalFailed(false);
    void (async () => {
      try {
        const client = currentPlansClient();
        const outcome = client === null ? null : await client.openPortal();
        if (outcome === null || outcome.status !== 'ok') {
          setPortalFailed(true);
          setBusy('none');
          return;
        }
        window.location.assign(outcome.value.url);
      } catch {
        setPortalFailed(true);
      }
      setBusy('none');
    })();
  }, []);

  return (
    <PlanScreen
      state={state}
      standing={standing}
      order={order}
      isOrderLoading={isOrderLoading}
      isOfferUnavailable={wantsOrder && offerRead.settled && offer === null}
      busy={busy}
      checkoutReturn={checkoutReturn}
      portalFailed={portalFailed}
      orderYearlyHref={switchStart === null ? null : ORDER_YEARLY_HREF}
      switchStartsAt={switchStartsAt}
      isAlreadySubscribed={notice === 'already-subscribed'}
      onSelectPlan={setPickedPlan}
      onConsentChange={onConsentChange}
      onOrder={onOrder}
      recapMealCount={recap.settled ? recap.mealCount : null}
      onManage={onManage}
    />
  );
}
