/**
 * `/settings/plan`: what this account pays for, and the order page that
 * changes it.
 *
 * ── This route does not exist unless a biller stands behind the instance ──
 *
 * Two gates, and they answer the same 404 for two different reasons. The
 * server loader 404s with no `CORE_URL`, exactly as `settings.account`
 * does: with no server there is no account, so there is nothing to sell one.
 * The client loader then 404s unless the handshake says `plans: true`, because
 * `/v1/plans/*` answers the ordinary unknown-path 404 on an instance with no
 * biller, to everybody, so that a deployment with plans switched off cannot be
 * told from a gateway built before plans existed (`PROTOCOL.md` §5.22). A page
 * explaining a feature this deployment does not have would give that away in
 * one screenshot, which is the same reasoning `admin.feedback.tsx` writes down.
 *
 * The handshake read happens in the CLIENT loader and not the server one,
 * for the reason that route gives: the fact belongs to the core server, and
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
 * ── It is also where the paywall sends a locked person (2026-09-28) ──────
 *
 * When the free scans are used up, a trial has ended or a plan has lapsed, the
 * `_personal` layout sends every feature screen here (`plan-gate.ts`). So the
 * page says why ABOVE the plans, and says that the data stays the person's,
 * with the export and the account deletion one tap away. A person who still
 * has free scans is offered the way back to them instead.
 *
 * A return from a payment polls `GET /plans/me` until the plan is live
 * (`payment-return.ts`), and hands the live view to the paywall, so "Open
 * your diary" opens it. While the payment is being confirmed nothing is sold:
 * the order block would invite a second payment for the first one.
 *
 * A BUYER WHO CHOSE A PLAN FIRST ANSWERS THE QUESTIONNAIRE AFTER PAYING
 * (M265/03, decision (c) of the milestone). They arrive here from `/join`
 * before onboarding, so the link after a confirmed payment leads to the
 * questionnaire and says so, and the diary comes after it. An account that
 * answered it before it bought a plan keeps "Open your diary".
 *
 * ── The view is props only ───────────────────────────────────────────────
 *
 * `PlanScreen` takes everything it draws and holds no hook but `t`, so every
 * state on this page is reachable from `renderToStaticMarkup` in a unit test.
 * There is no DOM test library in this repository, so a state that can only be
 * reached by clicking is a state nothing checks.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { ExternalLink, Loader2 } from 'lucide-react';

import type { Route } from './+types/settings.plan';
import { CONFIG } from '#app/config';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { SETTINGS_INSET_CLASS, SettingsSection } from '#app/components/settings/settings-section';
import { PLAN_PAGE_HREF, offerLocaleFor, requirePlansDoor } from '#app/lib/plans/plans-door';
import { currentPlansClient } from '#app/lib/plans/plans-session';
import type { OrderOutcome } from '#app/lib/sync/engine/client/plans-client';
import {
  ORDER_UNKNOWN_PLAN,
  PLAN_KEYS,
  type MoveEffect,
  type PlanKey,
  type PlanOffer,
  type PlanStatus,
} from '#app/lib/sync/engine/client/plans-wire';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { planViewOf, usePlanRead, type PlanReadState } from '#app/hooks/use-plan-standing';
import { usePlanOffer } from '#app/hooks/use-plan-offer';
import { useTrialRecap } from '#app/hooks/use-trial-recap';
import { useStoredIntendedTier } from '#app/hooks/use-intended-plan';
import { readTierId } from '#app/lib/plans/intended-plan';
import { useSyncSession } from '#app/components/sync-status';
import { planStanding, type PlanStanding } from '#app/lib/plans/plan-standing';
import { hasFreeScansLeft, paywallNoticeFor, planGateStanding, type PaywallNotice } from '#app/lib/plans/plan-gate';
import { forgetPlanGateFacts, notePlanViewForSession } from '#app/lib/plans/plan-gate-facts';
import {
  PAYMENT_RETURN_HREF,
  paymentReturnDoorFor,
  type PaymentConfirmation,
  type PaymentReturnDoor,
} from '#app/lib/plans/payment-return';
import { readOnboardingGateKind } from '#app/lib/read-onboarding-gate';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { offeredTrialDays, offeredTrialScans } from '#app/lib/plans/signup-door';
import { grantedTrialDays } from '#app/lib/plans/trial-scans';
import { usePaymentConfirmation } from '#app/hooks/use-payment-confirmation';
import { recapSentenceKey } from '#app/lib/plans/trial-recap';
import { PlanStatusCard, type SubscribedStanding } from '#app/components/plans/plan-status-card';
import {
  pendingChangeOf,
  pendingFactsOf,
  type PendingChange,
  type PendingFacts,
} from '#app/lib/plans/pending-change';
import { TierList } from '#app/components/plans/tier-list';
import { useHasLegalPages } from '#app/hooks/use-public-config';
import {
  NO_OWN_PLAN,
  defaultTierIdOf,
  linkedTierIdOf,
  offerForTier,
  tiersViewOf,
  type OwnPlan,
  type TiersView,
} from '#app/lib/plans/tier-view';
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
  afterPayment: PaymentReturnDoor;
}> {
  const { syncServerUrl } = await serverLoader();
  // A SHUT DOOR IS ALSO NEWS FOR THE PAYWALL. A gate still holding the old
  // `plans: true` would go on sending the person to this page, which is about
  // to answer 404, so the gate forgets what it held and reads again.
  const instance = await requirePlansDoor({ serverUrl: syncServerUrl }).catch((cause: unknown) => {
    forgetPlanGateFacts();
    throw cause;
  });
  // WHERE THE WAY ON FROM A PAYMENT LEADS (M265/03), decided HERE and not in
  // the view, so the link's label is right from its first paint and never
  // changes under the person. Read on every run, not only on a return: the
  // page takes the `checkout` marker off its own address, which runs this
  // loader again, and the answer has to survive that. NO DIARY READ FOR A
  // STRANGER (M204 spec 09): with no session there is no payment to come back
  // from, and the page asks them to sign in instead.
  const afterPayment: PaymentReturnDoor =
    getSyncSessionSnapshot().account === null ? 'diary' : paymentReturnDoorFor(await readOnboardingGateKind());
  // The descriptor rides along so the page's standing reads the SAME answer
  // the gate just passed, rather than a second read that starts at `null`.
  return { syncServerUrl, instance, afterPayment };
}
clientLoader.hydrate = true as const;

/** The server render has no answer yet: whether this instance sells anything is the browser's read. */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;
}

/** Where the plan read is. Owned by `use-plan-standing.ts`, re-exported for the screen's own tests. */
export type { PlanReadState };

/** Which press is in flight, so none can be pressed twice. */
export type PlanAction = 'none' | 'order' | 'portal' | 'keep';

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
 * The sentence under the plan page's title.
 *
 * A STANDING FREE GRANT SAYS SO, whatever the biller holds (2026-09-30). A
 * Beta supporter who bought a plan and cancelled it is on the free part of
 * openplate again, with the AI they had before; "Your plan has ended" beside
 * a working diary would read as the lock it is not. The plans are still
 * offered below it.
 */
export function planStatusKey({ standing, plan }: { standing: PlanStanding; plan: PlanStatus }): string {
  if (standing.kind === 'free') return STATUS_KEY_BY_PLAN.none;
  return STATUS_KEY_BY_PLAN[plan];
}

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
  /** `true` when the last press on "Keep" did not take the booked change back. */
  keepFailed?: boolean;
  /**
   * A booked downgrade, drawn in the status card (M2). `undefined` draws no
   * slot, the page before tiers; `null` draws the slot empty with its box
   * reserved; an object draws the line and the button that takes it back.
   */
  pendingChange?: PendingChange | null;
  onKeepPlan?: () => void;
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
  /** Why the app is locked, drawn above the plans, or `null` when it is not locked. */
  paywallNotice: PaywallNotice | null;
  /** `true` offers "use your free AI scans first", back to the diary. */
  offersFreeScansFirst: boolean;
  /** Where a `success` return is. Read only when `checkoutReturn` is `success`. */
  paymentConfirmation: PaymentConfirmation;
  /** Where the link after a confirmed payment leads, and so what it says. */
  afterPaymentDoor: PaymentReturnDoor;
  /**
   * The tiers the biller sells, or absent/`null` for a biller that sells one
   * plan, which draws the page exactly as it was before tiers (M2/05).
   */
  tiers?: TiersView | null;
  /** The tier picked in the list, or `null`. Read only when `tiers` is set. */
  pickedTierId?: string | null;
  /** `false` lists the tiers with no pick and no switch button: a payment is being confirmed. */
  canPickTier?: boolean;
  onPickTier?: (tierId: string) => void;
  /**
   * What the biller answered to the last move between plans, or absent. Drawn in
   * the place the order block had, so the answer replaces what was pressed and
   * moves nothing above it.
   */
  moveResult?: MoveResult | null;
  onCheckAgain: () => void;
  onSelectPlan: (key: PlanKey) => void;
  onConsentChange: (key: ConsentKey, isTicked: boolean) => void;
  onOrder: () => void;
  onManage: () => void;
}

/** The biller's answer to a move: when it takes effect, and from which instant the new plan runs. */
export interface MoveResult {
  effect: MoveEffect;
  startsAt: string;
}

/** What the page says once a move is booked or done, from the biller's own `effect`. */
function MoveResultLine({ result }: { result: MoveResult }) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'long' }).format(
    new Date(result.startsAt),
  );
  return (
    <output data-slot="plan-move-result" data-effect={result.effect} className="block border p-3 text-sm">
      {result.effect === 'now' ? t('plan.move.doneNow') : t('plan.move.donePeriodEnd', { date })}
    </output>
  );
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

/** The heading of the notice, per reason. */
function paywallHeading(notice: PaywallNotice, t: (key: string, options?: { count: number }) => string): string {
  if (notice.kind === 'scans-used') return t('paywall.heading.scansUsed', { count: notice.count });
  if (notice.kind === 'days-over') return t('paywall.heading.daysOver', { count: notice.count });
  if (notice.kind === 'lapsed') return t('paywall.heading.lapsed');
  return t('paywall.heading.choose');
}

/**
 * Why the app is locked, and that the data is still the person's.
 *
 * Square, with a hairline all round, the inset every settings block is drawn
 * in (DESIGN.md sections 5 and 11: no radius, no accent rule down one side).
 */
function PaywallNoticeView({ notice }: { notice: PaywallNotice }) {
  const { t } = useTranslation();
  const linkClass = 'text-primary underline underline-offset-4';
  return (
    <section
      data-slot="paywall-notice"
      aria-labelledby="paywall-heading"
      className={cn(SETTINGS_INSET_CLASS, 'space-y-2 p-4')}
    >
      <h2 id="paywall-heading" className="text-base font-semibold">
        {paywallHeading(notice, t)}
      </h2>
      <p className="text-sm">{t('paywall.body')}</p>
      <p className="text-sm text-muted-foreground">
        <Trans
          i18nKey="paywall.data"
          components={{
            exportLink: <Link to="/settings/data" className={linkClass} />,
            deleteLink: <Link to="/settings/account" className={linkClass} />,
          }}
        />
      </p>
    </section>
  );
}

/**
 * One state of the payment return line. Hidden states keep their size, so the
 * box is the tallest of them.
 *
 * A HIDDEN STATE IS HIDDEN IN THE SAME FRAME, BUTTONS INCLUDED (the buyer
 * walk, 2026-09-28). `invisible` reaches a state's button by inheritance, and
 * the button's own `transition-all` then animates `visibility` like any other
 * property: a discrete transition whose value stays `visible` for its whole
 * run. So the slow state's "Check again", pressed, went on painting over "Open
 * your diary" once the plan was active: for the 150 ms of the transition in
 * the browser tier, and in the buyer's screenshot besides. A hidden state
 * therefore switches every transition inside it off, and is `inert` too, so
 * nothing in it takes a tap or the focus while it is only there for its size.
 * `paywall-plan-page.spec.ts` watches every frame of that change.
 */
function ReturnState({ isShown, children }: { isShown: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!isShown}
      inert={!isShown}
      className={cn(
        'col-start-1 row-start-1 flex flex-col gap-3',
        !isShown && 'invisible [&_*]:transition-none',
      )}
    >
      {children}
    </div>
  );
}

/** The label of the link after a confirmed payment. A `Record`, so a third door fails to compile here. */
const RETURN_DOOR_LABEL_KEY = {
  onboarding: 'paywall.returned.setUp',
  diary: 'paywall.returned.openDiary',
} satisfies Record<PaymentReturnDoor, string>;

/**
 * What the person came back from.
 *
 * A PAYMENT RETURN RESERVES ITS BOX FROM THE FIRST PAINT. Its three states,
 * checking, active and slow, are drawn in ONE grid cell and only one is
 * visible, so the cell is as tall as the tallest from the start and a state
 * change moves nothing below it, in any language (DESIGN.md section 7). The
 * link in the active state says where it leads, the questionnaire or the
 * diary, and which of the two is known before the first paint.
 */
function CheckoutReturnLine({
  checkoutReturn,
  confirmation,
  door,
  onCheckAgain,
}: {
  checkoutReturn: CheckoutReturn;
  confirmation: PaymentConfirmation;
  door: PaymentReturnDoor;
  onCheckAgain: () => void;
}) {
  const { t } = useTranslation();
  if (checkoutReturn === 'cancelled')
    return <p className="text-sm text-muted-foreground">{t('plan.returned.cancelled')}</p>;
  if (checkoutReturn !== 'success') return null;
  return (
    <div data-slot="plan-return" aria-live="polite" className="grid">
      <ReturnState isShown={confirmation === 'checking'}>
        <p className="flex items-start gap-2 text-sm">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
          <span>{t('plan.returned.success')}</span>
        </p>
      </ReturnState>
      <ReturnState isShown={confirmation === 'confirmed'}>
        <p className="text-sm font-medium">{t('paywall.returned.active')}</p>
        <Button asChild className="h-11 self-start">
          <Link to={PAYMENT_RETURN_HREF[door]}>{t(RETURN_DOOR_LABEL_KEY[door])}</Link>
        </Button>
      </ReturnState>
      <ReturnState isShown={confirmation === 'slow'}>
        <p className="text-sm">{t('paywall.returned.slow')}</p>
        <Button type="button" variant="secondary" className="h-11 self-start" onClick={onCheckAgain}>
          {t('paywall.returned.checkAgain')}
        </Button>
      </ReturnState>
    </div>
  );
}

/** The screen, props only. */
export function PlanScreen(props: PlanScreenProps) {
  const { checkoutReturn, paymentConfirmation } = props;
  // WHILE A PAYMENT IS BEING CONFIRMED, only the line that says so. Nothing is
  // sold to somebody who has just paid, and no lock is explained to them.
  const isAwaitingPayment = checkoutReturn === 'success' && paymentConfirmation !== 'confirmed';
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <CheckoutReturnLine
        checkoutReturn={checkoutReturn}
        confirmation={paymentConfirmation}
        door={props.afterPaymentDoor}
        onCheckAgain={props.onCheckAgain}
      />
      {!isAwaitingPayment && <PlanBody {...props} />}
    </div>
  );
}

/** Everything below the return line. */
function PlanBody(props: PlanScreenProps) {
  const { state, standing, order, busy } = props;
  const { t } = useTranslation();
  const subscribed: SubscribedStanding | null =
    state.kind === 'ready' && standing.kind === 'subscribed' ? standing : null;

  if (state.kind === 'loading') return <p className="text-sm text-muted-foreground">{t('plan.loading')}</p>;

  const portalAvailable = state.kind === 'ready' && state.plan.portalAvailable;
  // The account section above an order: drawn for every state that is not an
  // answer, and for an answer with something to say besides the order.
  //
  // WITH TIERS it is drawn for the whole visit: the order block appears only
  // once a tier is picked, and a section that vanished at that moment would pull
  // the list the person just tapped up the screen (M2/05, no layout shift).
  const hasTierList = props.tiers !== undefined && props.tiers !== null && state.kind === 'ready';
  const showsAccountSection =
    subscribed === null && (state.kind !== 'ready' || order === null || portalAvailable || hasTierList);

  return (
    <>
      {/* WHY THE APP IS LOCKED, FIRST, above the plans. Somebody sent here
          from the diary has a question this page must answer before it sells
          anything. Drawn in the same render as the order below it, never
          after, so it cannot push the plans down. */}
      {props.paywallNotice !== null && <PaywallNoticeView notice={props.paywallNotice} />}
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
            pendingChange={props.pendingChange}
            isKeeping={busy === 'keep'}
            keepFailed={props.keepFailed === true}
            onKeepPlan={props.onKeepPlan}
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
          description={state.kind === 'ready' ? t(planStatusKey({ standing, plan: state.plan.plan })) : t('plan.unknown')}
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
          {t(recapSentenceKey(standing), { count: props.recapMealCount })}
        </p>
      )}

      {/* THE TIERS, listed as the biller sent them, above the order they open
          (M2/05). Absent for a biller that sells one plan, and then this is
          the page as it was. A subscriber on a tier reads the list with their
          own marked and nothing to pick. */}
      {props.tiers !== undefined && props.tiers !== null && state.kind === 'ready' && (
        <TierList
          rows={props.tiers.rows}
          pickedTierId={props.pickedTierId ?? null}
          canPick={props.canPickTier === true}
          onPick={props.onPickTier ?? (() => {})}
        />
      )}

      {order === null && props.moveResult !== undefined && props.moveResult !== null && (
        <MoveResultLine result={props.moveResult} />
      )}

      {order !== null && (
        <PlanOrder
          {...order}
          onSelectPlan={props.onSelectPlan}
          onConsentChange={props.onConsentChange}
          onOrder={props.onOrder}
        />
      )}

      {/* THE WAY BACK, for somebody who came to look and still has free
          scans. Below the order, the "not now" beside the offer. */}
      {props.offersFreeScansFirst && (
        <Button asChild variant="secondary" className="h-11">
          <Link to="/dashboard">{t('paywall.freeScansFirst')}</Link>
        </Button>
      )}
    </>
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
 * The tier a link named, `?tier=<id>`, or `null`.
 *
 * Only the SHAPE of an id is checked here (`TIER_ID_PATTERN`, a label), because
 * no tier name is compiled into the app. Whether the offer sells the tier is
 * `linkedTierIdOf`'s question, asked of the offer once it is read. Anything in
 * the parameter that is not a label is ignored.
 */
export function readTierParam(value: string | null): string | null {
  return readTierId(value);
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
  /** The picked tier's id, or absent for the one-plan order. */
  tier?: string;
}): Promise<OrderOutcome | null> {
  const client = currentPlansClient();
  if (client === null) return null;
  return await client.placeOrder({
    plan: input.plan,
    tier: input.tier,
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
  const [pickedTierId, setPickedTierId] = useState<string | null>(null);
  const [moveResult, setMoveResult] = useState<MoveResult | null>(null);
  const hasLegalPages = useHasLegalPages();
  const [consents, setConsents] = useState<ConsentState>(NO_CONSENTS);
  const [notice, setNotice] = useState<OrderNotice>('none');
  const [busy, setBusy] = useState<PlanAction>('none');
  const [portalFailed, setPortalFailed] = useState(false);
  const [switchStartsAt, setSwitchStartsAt] = useState<string | null>(null);
  // A booked downgrade: what this visit's order booked, and whether the person
  // took it back. Both feed `pendingFactsOf`, beside the plan read.
  const [bookedPending, setBookedPending] = useState<PendingFacts | null>(null);
  const [isPendingCancelled, setIsPendingCancelled] = useState(false);
  const [keepFailed, setKeepFailed] = useState(false);

  // The loader has already passed the door, so the read is always enabled
  // here, and the descriptor it passed is the one the standing reads.
  const { instance, afterPayment } = useLoaderData<typeof clientLoader>();
  const isReturningPaid = checkoutReturn === 'success';
  const payment = usePaymentConfirmation({ isReturning: isReturningPaid, instance });
  const pageRead = usePlanRead({ isEnabled: true, refresh: planRefresh });
  // THE POLL'S LIVE PLAN WINS over the page's own read, which was taken
  // before the webhook landed. Waiting for a second read of the same answer
  // would draw the old order for a moment under "Your plan is active."
  const read: PlanReadState =
    payment.confirmedPlan === null ? pageRead : { kind: 'ready', plan: payment.confirmedPlan };
  const standing = planStanding({
    instance,
    account: session.account,
    planView: planViewOf(read),
    now: new Date(),
  });
  const isSubscribed = read.kind === 'ready' && standing.kind === 'subscribed';
  const isAwaitingPayment = isReturningPaid && payment.confirmation !== 'confirmed';
  // THE GATE'S STANDING, not the page's: an administrator is never locked,
  // so the page must not tell one that the app is.
  const gateStanding = planGateStanding({
    instance,
    account: session.account,
    planView: planViewOf(read),
    now: new Date(),
  });
  const paywallNotice =
    read.kind === 'ready' && !isReturningPaid ?
      paywallNoticeFor({
        standing: gateStanding,
        // The account's own count first, the instance's offer second, and
        // never a typed number.
        scansGranted: session.account?.trialScans?.granted ?? offeredTrialScans(instance),
        // The same order for the days (M267): the account's own window, then the instance's.
        trialDays:
          grantedTrialDays({ createdAt: session.account?.createdAt, trialEndsAt: session.account?.trialEndsAt }) ??
          offeredTrialDays(instance),
      })
    : null;
  const offersFreeScansFirst = read.kind === 'ready' && !isReturningPaid && hasFreeScansLeft(standing);
  // Read LIVE from the address, so the status card's link opens the order on
  // the page that is already mounted.
  const linkedPlan = readPlanParam(searchParams.get('plan'));
  // THE TIER THE PRICING PAGE LINKED: the address first, what sign-up stored
  // beside the plan second. Judged against the offer below.
  const storedTierId = useStoredIntendedTier();
  const linkedTierId = readTierParam(searchParams.get('tier')) ?? storedTierId;
  // A SUBSCRIBER THE BILLER PUTS ON A TIER IS IN THE TIERS WORLD (M2/04): the
  // page lists the tiers with theirs marked and a switch button on the others,
  // and the legacy move of a monthly plan to the yearly one is not offered,
  // because an order that names no tier means the legacy plan to the biller.
  // A subscriber with no tier named keeps today's page.
  const ownTierId = isSubscribed ? (planViewOf(read)?.tier ?? null) : null;
  const isTierSubscriber = ownTierId !== null;
  const switchStart = switchStartsAt === null && !isTierSubscriber ? switchStartFor(standing) : null;
  const isSwitching = isSubscribed && switchStart !== null && linkedPlan === 'yearly';
  const wantsOrder = read.kind === 'ready' && !isAwaitingPayment && (!isSubscribed || isSwitching);
  // THE OFFER IS ALSO READ FOR A TIER SUBSCRIBER, for the tier list and the name of their own tier.
  const wantsTierList = read.kind === 'ready' && !isAwaitingPayment && isTierSubscriber;
  const offerRead = usePlanOffer({
    isEnabled: wantsOrder || wantsTierList,
    locale: offerLocaleFor(i18n.language),
    refresh: offerRefresh,
  });

  const recap = useTrialRecap({
    standing,
    accountCreatedAt: session.account?.createdAt,
    isEnabled: read.kind === 'ready',
  });

  const offer = offerRead.settled ? offerRead.offer : null;
  const ownPlan: OwnPlan =
    standing.kind === 'subscribed' ?
      { tierId: ownTierId, planKey: standing.planKey, isPastDue: standing.isPastDue }
    : NO_OWN_PLAN;
  const tiers: TiersView | null = offer === null ? null : tiersViewOf({ offer, own: ownPlan });
  // A FIRST ORDER OF A BILLER THAT SELLS ONE TIER needs no tap on it. A move is always chosen.
  // A LINKED TIER the offer sells is the pick of a first order, from the first
  // paint of the list, so nothing arrives under it. An unknown or unsold one is
  // no pick at all (`linkedTierIdOf`), and the page is as it was with no link.
  const effectiveTierId =
    pickedTierId ??
    (tiers === null || isSubscribed ?
      null
    : (linkedTierIdOf({ view: tiers, tierId: linkedTierId }) ?? defaultTierIdOf(tiers)));
  // IN THE TIERS WORLD THE ORDER IS FOR THE PICKED TIER: the order block draws
  // that tier's own prices, and none until one is picked. Without tiers it is
  // the offer as served.
  const orderOffer: PlanOffer | null =
    offer === null ? null
    : tiers === null ? offer
    : offerForTier({ offer, view: tiers, tierId: effectiveTierId });
  // THE BOOKED DOWNGRADE (M2): the slot exists, empty, for every tier subscriber
  // from the first paint, and holds the line once the offer names both tiers.
  const pendingChange: PendingChange | null | undefined =
    isTierSubscriber ?
      pendingChangeOf({
        facts: pendingFactsOf({ planView: planViewOf(read), booked: bookedPending, isCancelled: isPendingCancelled }),
        tiers,
      })
    : undefined;
  const pickedRow = tiers?.rows.find((row) => row.id === effectiveTierId) ?? null;
  const move: MoveEffect | null = isTierSubscriber ? (pickedRow?.effect ?? null) : null;
  // A MOVE TO ONE PLAN, such as the own tier's yearly one, has nothing to choose between.
  const [onlyPlan] = orderOffer?.plans ?? [];
  const soleMovePlan = move !== null && orderOffer?.plans.length === 1 ? (onlyPlan?.key ?? null) : null;
  const wantedPick = isSwitching ? 'yearly' : (soleMovePlan ?? pickedPlan ?? linkedPlan);
  // A linked plan the offer does not contain is no pick at all.
  const selectedPlan = orderOffer?.plans.some((plan) => plan.key === wantedPick) ? wantedPick : null;
  const mode: OrderMode =
    move !== null ? { kind: 'move', effect: move }
    : isSwitching && switchStart !== null ? { kind: 'switch', startsAt: switchStart }
    : { kind: 'first' };
  const isOrderLoading = (wantsOrder || wantsTierList) && !offerRead.settled;
  // HELD UNTIL THE OFFER AND THE TRIAL RECAP ARE IN for somebody without a
  // plan, so neither the order nor the recap line above it arrives underneath
  // a page that is already drawn and pushes it down.
  const isWaitingForRecap = read.kind === 'ready' && !recap.settled;
  const state: PlanReadState =
    (isOrderLoading && !isSubscribed) || isWaitingForRecap ? { kind: 'loading' } : read;
  const order: OrderView | null =
    (wantsOrder || (wantsTierList && move !== null)) && orderOffer !== null ?
      {
        offer: orderOffer,
        mode,
        selectedPlan,
        consents,
        notice,
        isOrdering: busy === 'order',
        hasLegalPages,
      }
    : null;

  // WHAT THIS PAGE READS, THE PAYWALL KNOWS. A plan read here is fresher than
  // the one the gate holds, and the gate must not send a subscriber back here
  // from a read taken before they paid. ONCE THE POLL HAS CONFIRMED, the
  // page's own read is the older of the two and is never recorded again: a
  // new descriptor from a revalidated loader would otherwise re-run this and
  // write "no plan" over the live one.
  const hasConfirmedPayment = payment.confirmedPlan !== null;
  useEffect(() => {
    if (pageRead.kind !== 'ready' || hasConfirmedPayment) return;
    notePlanViewForSession({ instance, planView: pageRead.plan, readAt: Date.now() });
  }, [pageRead, instance, hasConfirmedPayment]);

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
        params.delete('tier');
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [setSearchParams]);

  /** What the page does with each answer. See the route header. */
  const settleOrder = useCallback(
    (outcome: OrderOutcome | null, isMove: boolean): void => {
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
          setConsents(NO_CONSENTS);
          if (isMove) {
            // A MOVE BETWEEN PLANS: say what the biller says, when it takes
            // effect. An upgrade is already in the biller's books, so the plan is
            // read again and the list marks the new tier; a booked move leaves
            // the paid plan as it is until the period ends.
            setMoveResult({ effect: outcome.effect ?? 'period-end', startsAt: outcome.startsAt });
            // A BOOKED DOWNGRADE comes back named in the answer, so the status
            // card says it now and not after the next plan read.
            if (outcome.pendingTier !== undefined && outcome.pendingChangeAt !== undefined) {
              setBookedPending({ tierId: outcome.pendingTier, at: outcome.pendingChangeAt });
              setIsPendingCancelled(false);
              setKeepFailed(false);
            }
            setPickedTierId(null);
            setPickedPlan(null);
            if (outcome.effect === 'now') setPlanRefresh((count) => count + 1);
            break;
          }
          setSwitchStartsAt(outcome.startsAt);
          leaveOrder();
          break;
        case 'payment-failed':
          // THE CARD WAS DECLINED and the person is still on the old tier. The
          // order block, the pick and both ticks stay, so the next press is one
          // tap, and the line above the button says what happened.
          setNotice('payment-failed');
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
          setPlanRefresh((count) => count + 1);
          // A MOVE THE BILLER REFUSED keeps its order block, so the answer is
          // said in the line above the button, which has its box already.
          if (isMove) {
            setNotice('move-refused');
            break;
          }
          setNotice('already-subscribed');
          leaveOrder();
          break;
        case 'refused':
          // THE PLAN LEFT THE OFFER while the page was open: read the offer again.
          if (outcome.code === ORDER_UNKNOWN_PLAN) {
            setConsents(NO_CONSENTS);
            setNotice('plan-unavailable');
            setOfferRefresh((count) => count + 1);
            break;
          }
          setNotice('failed');
          break;
        case 'absent':
          setNotice('failed');
          break;
      }
      setBusy('none');
    },
    [leaveOrder],
  );

  const onOrder = useCallback(() => {
    if (orderOffer === null || selectedPlan === null || !consents.terms || !consents.earlyStart) return;
    trackOrderSent(selectedPlan);
    setBusy('order');
    setNotice('none');
    // The tier id goes only when a tier was picked: without one the order is
    // byte for byte what it was before tiers.
    const tier = tiers === null ? undefined : (effectiveTierId ?? undefined);
    const isMove = move !== null;
    void sendOrder({ offer: orderOffer, plan: selectedPlan, tier }).then(
      (outcome) => settleOrder(outcome, isMove),
      () => settleOrder(null, isMove),
    );
  }, [orderOffer, selectedPlan, consents, settleOrder, tiers, effectiveTierId, move]);

  const onPickTier = useCallback((tierId: string) => {
    setPickedTierId(tierId);
    setMoveResult(null);
    setNotice('none');
    // THE INTERVAL BELONGS TO THE TIER: a pick made on another tier's prices is dropped, and the consents with it.
    setPickedPlan(null);
    setConsents(NO_CONSENTS);
  }, []);

  const onConsentChange = useCallback((key: ConsentKey, isTicked: boolean) => {
    setConsents((current) => ({ ...current, [key]: isTicked }));
  }, []);

  // The portal opens in the page's language, the one the order is sent in.
  const portalLocale = offerLocaleFor(i18n.language);
  const onManage = useCallback(() => {
    setBusy('portal');
    setPortalFailed(false);
    void (async () => {
      try {
        const client = currentPlansClient();
        const outcome = client === null ? null : await client.openPortal({ locale: portalLocale });
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
  }, [portalLocale]);

  /** Takes the booked downgrade back. A 409 "nothing booked" is also the answer the person wanted. */
  const onKeepPlan = useCallback(() => {
    setBusy('keep');
    setKeepFailed(false);
    void (async () => {
      try {
        const client = currentPlansClient();
        const outcome = client === null ? null : await client.cancelPendingChange();
        if (outcome === null || outcome.kind === 'absent') {
          setKeepFailed(true);
        } else {
          setBookedPending(null);
          setIsPendingCancelled(true);
          setMoveResult(null);
          setPlanRefresh((count) => count + 1);
        }
      } catch {
        setKeepFailed(true);
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
      keepFailed={keepFailed}
      pendingChange={pendingChange}
      onKeepPlan={onKeepPlan}
      orderYearlyHref={switchStart === null ? null : ORDER_YEARLY_HREF}
      switchStartsAt={switchStartsAt}
      isAlreadySubscribed={notice === 'already-subscribed'}
      tiers={tiers}
      pickedTierId={effectiveTierId}
      moveResult={moveResult}
      canPickTier={(wantsOrder || wantsTierList) && !isSwitching}
      onPickTier={onPickTier}
      onSelectPlan={setPickedPlan}
      onConsentChange={onConsentChange}
      onOrder={onOrder}
      recapMealCount={recap.settled ? recap.mealCount : null}
      onManage={onManage}
      paywallNotice={paywallNotice}
      offersFreeScansFirst={offersFreeScansFirst}
      paymentConfirmation={payment.confirmation}
      afterPaymentDoor={afterPayment}
      onCheckAgain={payment.checkAgain}
    />
  );
}
