/**
 * The operator's low-budget letter (2026-09-30), sent by `ai/budget-alert.ts`
 * to `MAIL_OPERATOR_EMAIL`.
 *
 * ENGLISH ONLY, like the declaration alert's fallback: the reader is whoever
 * runs this instance, not a person who was invited to a diary. The wording
 * came out of the workspace wordsmith pass of 2026-09-30.
 *
 * NUMBERS ONLY. The letter carries the limit, what is left, the reset period,
 * today's and this month's spend and the alert line. Never the key and never
 * the key's label, which the key read does not keep in the first place
 * (`ai/upstream-budget.ts`).
 */
import { renderHtml } from './invite-message.js';
import type { UpstreamBudgetReset } from '../ai/upstream-budget.js';

export interface AiBudgetAlertInput {
  limitUsd: number;
  remainingUsd: number;
  reset: UpstreamBudgetReset | null;
  usageDailyUsd: number;
  usageMonthlyUsd: number;
  /** `AI_BUDGET_ALERT_FRACTION`, the line this letter says was crossed. */
  fraction: number;
}

export interface AiBudgetAlertMessage {
  subject: string;
  text: string;
  html: string;
}

/** One sentence per reset period, and one for a limit that never resets. */
const RESET_SENTENCES = {
  daily: 'The limit resets every day.',
  weekly: 'The limit resets every week.',
  monthly: 'The limit resets every month.',
  none: 'The limit does not reset on its own.',
} satisfies Record<UpstreamBudgetReset | 'none', string>;

/** `$3.94`. Cents, because that is how the provider bills and how the operator reads it. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** `20` for `0.2`, `12.5` for `0.125`: at most one decimal, none when it is whole. */
function formatPercent(fraction: number): string {
  return String(Number((fraction * 100).toFixed(1)));
}

export function buildAiBudgetAlertMessage(input: AiBudgetAlertInput): AiBudgetAlertMessage {
  const remaining = formatUsd(input.remainingUsd);
  const limit = formatUsd(input.limitUsd);
  const paragraphs = [
    `The AI provider key for this instance has ${remaining} left of its ${limit} limit.`,
    RESET_SENTENCES[input.reset ?? 'none'],
    `Spent today: ${formatUsd(input.usageDailyUsd)}. Spent this month: ${formatUsd(input.usageMonthlyUsd)}.`,
    'AI scans stop when the key runs out. To keep them running, raise the limit or add credit with your provider.',
    `You get this message once per reset period, when less than ${formatPercent(input.fraction)} percent of the limit remains.`,
  ];
  return {
    subject: `AI budget low: ${remaining} of ${limit} left`,
    text: paragraphs.join('\n\n'),
    html: renderHtml({ language: 'en', before: paragraphs, after: [], link: null }),
  };
}
