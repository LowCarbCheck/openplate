/**
 * What the AI budget card draws, as data (2026-09-30).
 *
 * PURE, so every state is a unit test rather than a rendered page: loading, a
 * read that failed, an instance with no AI, a provider that is not OpenRouter,
 * a key read that failed, a key with no limit, and a key with one. The card
 * (`components/admin/ai-budget-card.tsx`) only lays this out.
 *
 * TWO HALVES THAT CHANGE APART. The key half comes from the provider and can
 * be unavailable while the capacity half, which is this instance's own
 * counters, is fine. So each half has its own state, and the card keeps both
 * boxes at their size in every state (DESIGN.md section 7): a half with nothing
 * to say is drawn invisible, never removed.
 */
import type { AdminAiBudget, AdminAiBudgetReset, AdminAiCapacityCounter } from './admin-wire';

/** What the route knows about the read. `null` budget is an instance with no AI. */
export type AiBudgetLoad = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; budget: AdminAiBudget | null };

/** Which reset sentence to show. `none` is a limit that never resets on its own. */
export type AiBudgetResetKind = NonNullable<AdminAiBudgetReset> | 'none';

/** The key half. `blank` keeps its box and draws nothing: loading, or a provider with no key read. */
export type AiKeyBudgetLine =
  | { kind: 'blank' }
  | { kind: 'message'; message: 'failed' | 'no-ai' | 'unavailable' }
  | {
      kind: 'limited';
      remaining: string;
      limit: string;
      /** How much of the limit is LEFT, 0 to 100, for the bar. */
      leftPercent: number;
      reset: AiBudgetResetKind;
      spentToday: string;
      spentMonth: string;
    }
  | { kind: 'unlimited'; reset: AiBudgetResetKind; spentToday: string; spentMonth: string };

/** One capacity row: today's units against the ceiling, and the bar's fill, `null` for no ceiling. */
export interface AiCapacityLine {
  id: 'paid' | 'trial';
  used: number;
  limit: number | null;
  usedPercent: number | null;
}

export interface AiBudgetViewModel {
  key: AiKeyBudgetLine;
  /** `null` while there is nothing to show: the rows keep their box and draw nothing. */
  capacity: readonly AiCapacityLine[] | null;
}

/** 0 to 100, whole, for a bar. A share past either end is drawn at the end. */
function clampPercent(share: number): number {
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

function toCapacityLine(input: { id: AiCapacityLine['id']; counter: AdminAiCapacityCounter }): AiCapacityLine {
  const { used, limit } = input.counter;
  return { id: input.id, used, limit, usedPercent: limit === null ? null : clampPercent(used / limit) };
}

function toKeyLine(input: {
  upstream: NonNullable<AdminAiBudget['upstream']>;
  formatUsd: (value: number) => string;
}): AiKeyBudgetLine {
  const { upstream, formatUsd } = input;
  if (upstream.status === 'unavailable') return { kind: 'message', message: 'unavailable' };
  const reset: AiBudgetResetKind = upstream.reset ?? 'none';
  const spentToday = formatUsd(upstream.usageDailyUsd);
  const spentMonth = formatUsd(upstream.usageMonthlyUsd);
  if (upstream.limitUsd === null) return { kind: 'unlimited', reset, spentToday, spentMonth };
  // A limit with no remainder reported is read as nothing spent against it
  // being known: the bar is drawn full rather than empty, which would alarm.
  const remainingUsd = upstream.remainingUsd ?? upstream.limitUsd;
  return {
    kind: 'limited',
    remaining: formatUsd(remainingUsd),
    limit: formatUsd(upstream.limitUsd),
    leftPercent: upstream.limitUsd > 0 ? clampPercent(remainingUsd / upstream.limitUsd) : 0,
    reset,
    spentToday,
    spentMonth,
  };
}

/** The card's content for one load. `formatUsd` is the reader's currency format, injected so a test names it. */
export function aiBudgetViewModel(input: {
  load: AiBudgetLoad;
  formatUsd: (value: number) => string;
}): AiBudgetViewModel {
  const { load, formatUsd } = input;
  if (load.kind === 'loading') return { key: { kind: 'blank' }, capacity: null };
  if (load.kind === 'failed') return { key: { kind: 'message', message: 'failed' }, capacity: null };
  const budget = load.budget;
  if (budget === null) return { key: { kind: 'message', message: 'no-ai' }, capacity: null };
  return {
    key: budget.upstream === null ? { kind: 'blank' } : toKeyLine({ upstream: budget.upstream, formatUsd }),
    capacity: [
      toCapacityLine({ id: 'paid', counter: budget.capacity.paid }),
      toCapacityLine({ id: 'trial', counter: budget.capacity.trial }),
    ],
  };
}
