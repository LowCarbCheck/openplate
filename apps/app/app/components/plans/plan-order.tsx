/**
 * THE ORDER PAGE, drawn from the biller's offer (M245/04).
 *
 * The contract is concluded here, and Stripe only takes the payment after. So
 * everything § 312j BGB wants a person to read before they are bound stands
 * above one button: the plan choice with each price and term, the summary
 * lines, the withdrawal notice, two consents, the payment note, and the
 * button whose label names the obligation to pay.
 *
 * ── EVERY ORDER SENTENCE IS THE BILLER'S ─────────────────────────────────
 *
 * The heading, the summary, the withdrawal notice, both consent sentences,
 * the button label and the payment or switch note are drawn verbatim from
 * `offer.texts`. This file writes no price, no plan name and no sentence about
 * the order. What it does write is chrome: the label of a link to the terms,
 * the label of a link to the withdrawal page, and the one line above the
 * button that says why it is held or what went wrong. The address of the
 * withdrawal function that the notice prints becomes a link with that same
 * address as its text, so the notice still reads exactly as served.
 *
 * ── NOTHING IS TICKED FOR THE PERSON ─────────────────────────────────────
 *
 * Both boxes start unticked, always; the caller owns them and resets them
 * when the page the person read changes. The button is held until a plan is
 * picked and both are ticked, and the held state is the `disabled` ATTRIBUTE.
 *
 * ── THE BUTTON IS LAST ───────────────────────────────────────────────────
 *
 * Nothing in the order block follows the button, so nothing a person must
 * read can sit below the press that binds them.
 *
 * ── THE LINE ABOVE THE BUTTON HAS ITS BOX FROM THE FIRST PAINT ───────────
 *
 * Two lines high, whether it says anything or not, so a failed order, a
 * stale page or a ticked box changes words and never moves the button
 * (DESIGN.md section 7).
 *
 * ── A PLAN CHOSEN BEFORE THE ACCOUNT IS PICKED HERE (2026-09-28) ─────────
 *
 * The order page takes a pick it did not make in two ways, in this order: a
 * `?plan=` link, which the caller reads (a monthly subscriber moving to yearly
 * arrives that way), and the plan the person chose on the pricing page before
 * they had an account (`intended-plan.ts`). The second is offered once, when
 * the page opens with no pick at all, through `onSelectPlan`, so the caller's
 * state is the one truth and the button's hold reads it. A plan the offer does
 * not sell is not picked. Nothing else is picked, and no box is ticked.
 *
 * Props only, apart from `t` and that one read of the stored choice, so every
 * state renders in a unit test.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { PlanChoice } from '#app/components/plans/plan-choice';
import { SelfHostCard } from '#app/components/plans/self-host-card';
import { SettingsSection } from '#app/components/settings/settings-section';
import { Button } from '#app/components/ui/button';
import { readIntendedPlan } from '#app/lib/plans/intended-plan';
import { WIDERRUFEN_PATH, splitAtWiderrufenAddress } from '#app/lib/plans/widerrufen-address';
import {
  DATE_SLOT,
  TERMS_SLOT,
  type MoveEffect,
  type OfferPlan,
  type PlanKey,
  type PlanOffer,
} from '#app/lib/sync/engine/client/plans-wire';
import { cn } from '#app/lib/utils';

/** The two boxes, as the page holds them. */
export interface ConsentState {
  terms: boolean;
  earlyStart: boolean;
}

/** Which box a change is about. */
export type ConsentKey = keyof ConsentState;

/** Both boxes unticked, which is where every order starts. */
export const NO_CONSENTS: ConsentState = { terms: false, earlyStart: false };

/**
 * What the line above the button says after a press.
 *
 * - `failed`: the order did not go through; the button works again.
 * - `stale`: the offer changed under the page; it was read again and both
 *   boxes were cleared, and the line says so.
 * - `already-subscribed`: the biller says the account already pays.
 * - `move-refused`: the biller refused a move between plans (an overdue
 *   payment, or a change somebody already booked). The plan did not change.
 * - `plan-unavailable`: the plan ordered is not on sale any more. The offer
 *   was read again.
 */
export type OrderNotice =
  | 'none'
  | 'failed'
  | 'stale'
  | 'already-subscribed'
  | 'move-refused'
  | 'plan-unavailable';

/**
 * What kind of order this page places.
 *
 * `first` is an account with no live plan: both plans, and the payment note.
 * `switch` is a monthly subscriber moving to the yearly plan (M245/07): the
 * yearly plan alone, and the switch note with the day the year starts.
 * `move` is a subscriber moving to a tier or to the yearly plan of their own
 * tier (M2/04): the plans of the picked tier, and in place of the payment note
 * one sentence that says WHEN the move takes effect (`effect`), which the
 * caller decides from the tier ranks (`moveEffectOf`).
 */
export type OrderMode =
  | { kind: 'first' }
  | { kind: 'switch'; startsAt: string }
  | { kind: 'move'; effect: MoveEffect };

/** The catalog key of each notice. A `Record`, so a fifth notice fails to compile here. */
const NOTICE_KEY = {
  none: null,
  failed: 'plan.order.failed',
  stale: 'plan.order.stale',
  'already-subscribed': 'plan.order.alreadySubscribed',
  'move-refused': 'plan.order.moveRefused',
  'plan-unavailable': 'plan.order.planUnavailable',
} satisfies Record<OrderNotice, string | null>;

/** The sentence that says when a move takes effect, in place of the payment note. A `Record`, so a third effect fails to compile here. */
const MOVE_NOTE_KEY = {
  now: 'plan.move.effectNow',
  'period-end': 'plan.move.effectPeriodEnd',
} satisfies Record<MoveEffect, string>;

/** A link to a legal page, opened beside the order so neither the pick nor a tick is lost. */
function LegalLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} target="_blank" rel="noopener" className="text-primary underline underline-offset-4">
      {children}
    </Link>
  );
}

/**
 * A served sentence with its slot replaced by a node.
 *
 * Sliced, never `replace`d into a string, so the node stays a node and the
 * served text is never parsed as markup. The offer's schema guarantees the
 * slot is there; the first one is the link.
 */
function withSlot(text: string, slot: string, node: ReactNode): ReactNode {
  const at = text.indexOf(slot);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      {node}
      {text.slice(at + slot.length)}
    </>
  );
}

/**
 * The withdrawal notice with the address it prints drawn as a link (M265 spec 05).
 *
 * The biller prints the full address of the withdrawal function inside the
 * sentence. That address becomes a link to the app's own `/widerrufen` route,
 * and stays the link's text, so the sentence reads exactly as served. A notice
 * that prints no such address is drawn as plain text, as before.
 */
function withWiderrufenLink(text: string): ReactNode {
  const parts = splitAtWiderrufenAddress(text);
  if (parts === null) return text;
  return (
    <>
      {parts.before}
      <LegalLink to={WIDERRUFEN_PATH}>{parts.address}</LegalLink>
      {parts.after}
    </>
  );
}

/** Why the button is held, or `null` when it is not. */
function holdReason(input: { selectedPlan: PlanKey | null; consents: ConsentState }): string | null {
  if (input.selectedPlan === null) return 'plan.choice.pickFirst';
  if (!input.consents.terms || !input.consents.earlyStart) return 'plan.order.confirmFirst';
  return null;
}

/**
 * Offers the plan chosen before sign-up as the pick, once per mount, when the
 * page has none: no link named a plan and the person has not picked. See the
 * file header.
 */
function useIntendedPlanPick({
  plans,
  mode,
  selectedPlan,
  onSelectPlan,
}: {
  plans: readonly OfferPlan[];
  mode: OrderMode;
  selectedPlan: PlanKey | null;
  onSelectPlan: (key: PlanKey) => void;
}): void {
  const hasOffered = useRef(false);
  useEffect(() => {
    if (hasOffered.current) return;
    hasOffered.current = true;
    // A switch is the yearly plan by construction, and a pick already made wins.
    if (mode.kind !== 'first' || selectedPlan !== null) return;
    const intended = readIntendedPlan();
    if (intended === null || !plans.some((plan) => plan.key === intended)) return;
    onSelectPlan(intended);
  }, [plans, mode, selectedPlan, onSelectPlan]);
}

export interface PlanOrderProps {
  offer: PlanOffer;
  mode: OrderMode;
  /** The picked plan, `null` until the person picks one, a link named one, or the plan chosen before sign-up is offered. */
  selectedPlan: PlanKey | null;
  consents: ConsentState;
  notice: OrderNotice;
  /** `true` while the order is in flight, and after it answered an address, until the browser leaves. */
  isOrdering: boolean;
  /**
   * `true` adds the link to the instance's privacy notice to that box. The
   * page passes `useHasLegalPages()`: an instance with no legal pages has no
   * notice to link, and the box then says its lines and nothing more.
   */
  hasLegalPages?: boolean;
  onSelectPlan: (key: PlanKey) => void;
  onConsentChange: (key: ConsentKey, isTicked: boolean) => void;
  onOrder: () => void;
}

/** The paragraphs of a served text: blank lines separate them, and nothing is parsed as markup. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

export function PlanOrder({
  offer,
  mode,
  selectedPlan,
  consents,
  notice,
  isOrdering,
  hasLegalPages = false,
  onSelectPlan,
  onConsentChange,
  onOrder,
}: PlanOrderProps) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const plans = mode.kind === 'switch' ? offer.plans.filter((plan) => plan.key === 'yearly') : offer.plans;
  useIntendedPlanPick({ plans, mode, selectedPlan, onSelectPlan });
  // THE BILLER'S PRIVACY LINES, `texts.whatHappens`, drawn as served.
  const whatHappensParagraphs = paragraphsOf(offer.texts.whatHappens ?? '');
  const held = holdReason({ selectedPlan, consents });
  const noticeKey = NOTICE_KEY[notice];
  const line = noticeKey ?? held;
  const isAlert = noticeKey !== null;
  const note =
    mode.kind === 'move' ? t(MOVE_NOTE_KEY[mode.effect])
    : mode.kind === 'switch' ?
      offer.texts.switchNote.split(DATE_SLOT).join(
        new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'long' }).format(
          new Date(mode.startsAt),
        ),
      )
    : offer.texts.paymentNote;

  return (
    <div data-slot="plan-order" data-order-mode={mode.kind}>
      <SettingsSection label={offer.texts.heading} contentClassName="space-y-4">
        {/* THE PRICES ARE DATA. Every figure on the cards is the biller's
            `grossCents`, or arithmetic on it (`plan-prices.ts`), and the term
            under each is the biller's own sentence. */}
        {/* THE FREE WAY FIRST, and only on a first order (M250/10). It is
            not part of the choice below: the radio group, the boxes and the
            button are about the paid plans alone. A subscriber moving to the
            yearly plan is not told about it again. */}
        {mode.kind === 'first' && <SelfHostCard />}
        <PlanChoice plans={plans} selectedKey={selectedPlan} onSelect={onSelectPlan} placement="plan-page" />

        <ul data-slot="plan-order-summary" className="list-disc space-y-1 pl-5 text-sm">
          {offer.texts.summary.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>

        <p data-slot="plan-order-withdrawal" className="text-sm">
          {withWiderrufenLink(offer.texts.withdrawal)}{' '}
          <LegalLink to={offer.links.withdrawal}>{t('plan.order.withdrawalLink')}</LegalLink>
        </p>

        {/* WHAT HAPPENS TO THE PERSON'S DATA, directly above the two boxes
            (M2/05): the biller's own lines, drawn as served, in the same render
            as the rest of the order so nothing arrives under it. A plain box
            with a uniform border, no accent rule. */}
        {whatHappensParagraphs.length > 0 && (
          <section
            data-slot="plan-what-happens"
            aria-label={t('plan.order.whatHappensLabel')}
            className="space-y-2 border bg-muted/40 p-3 text-sm"
          >
            {whatHappensParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {hasLegalPages && (
              <p>
                <LegalLink to={offer.links.privacy}>{t('plan.order.privacyLink')}</LegalLink>
              </p>
            )}
          </section>
        )}

        <div className="space-y-3">
          <div className="flex items-start gap-2.5">
            <input
              id={`${baseId}-terms`}
              type="checkbox"
              data-slot="plan-consent-terms"
              checked={consents.terms}
              onChange={(event) => onConsentChange('terms', event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <label htmlFor={`${baseId}-terms`} className="text-sm leading-relaxed">
              {withSlot(
                offer.texts.termsConsent,
                TERMS_SLOT,
                <LegalLink to={offer.links.terms}>{t('chrome.terms')}</LegalLink>,
              )}
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input
              id={`${baseId}-early-start`}
              type="checkbox"
              data-slot="plan-consent-early-start"
              checked={consents.earlyStart}
              onChange={(event) => onConsentChange('earlyStart', event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <label htmlFor={`${baseId}-early-start`} className="text-sm leading-relaxed">
              {offer.texts.earlyStartConsent}
            </label>
          </div>
        </div>

        <p data-slot="plan-order-note" className="text-sm text-muted-foreground">
          {note}
        </p>

        <p
          data-slot="plan-action-line"
          role={isAlert ? 'alert' : undefined}
          className={cn(
            'min-h-10 text-sm',
            isAlert ? 'text-destructive' : 'text-muted-foreground',
            line === null && 'invisible',
          )}
        >
          {line === null ? '\u00a0' : t(line)}
        </p>

        {/* LAST, and the only button in the block. Its label is the biller's. */}
        <Button
          type="button"
          data-slot="plan-order-button"
          className="w-full"
          onClick={onOrder}
          disabled={held !== null || isOrdering}
        >
          {isOrdering && <Loader2 className="h-4 w-4 animate-spin" />}
          {offer.texts.button}
        </Button>
      </SettingsSection>
    </div>
  );
}
