/**
 * The AI budget card on the admin overview (2026-09-30): what the provider
 * key has left, and how much of today's AI capacity is used.
 *
 * ── PRESENTATIONAL ───────────────────────────────────────────────────────
 *
 * It takes a load and draws it. The route owns the admin client and the read,
 * and `lib/admin/ai-budget-view.ts` decides what each state shows, so this
 * file is rendered in the unit tier with no session and no network.
 *
 * ── EVERY BOX IS THERE FROM THE FIRST PAINT (DESIGN.md section 7) ───────
 *
 * The key half is two layers in one grid cell: an invisible stand-in of the
 * tallest state, a limit with its bar and two small lines, gives the cell its
 * height, and the real state is drawn over it. So loading, a failed read, a
 * provider with no key read (the half is left blank, not removed) and a key
 * with no limit all take the same room, and nothing under the card moves when
 * the answer lands. The capacity rows are always drawn and are invisible until
 * there are numbers, as the counts row above the tabs does.
 *
 * ── ENGLISH UNTIL THE CATALOGS CARRY IT ──────────────────────────────────
 *
 * Every string is `t(key, { defaultValue })`: the keys reach `common.json` in
 * a separate change, and until then the English default is what renders.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import {
  aiBudgetViewModel,
  type AiBudgetLoad,
  type AiBudgetResetKind,
  type AiCapacityLine,
  type AiKeyBudgetLine,
} from '#app/lib/admin/ai-budget-view';

export interface AiBudgetCardProps {
  load: AiBudgetLoad;
}

/** What the stand-in layer shows. Invisible; it is only there for its height, so it is wide on purpose. */
const STAND_IN_MONEY = '$000.00';

/** The translate function, narrowed to what this card calls. */
type Translate = ReturnType<typeof useTranslation>['t'];

/**
 * A square bar, per DESIGN.md section 5. `percent` is 0 to 100.
 *
 * DECORATIVE: the figure beside it says the same thing in words, so a screen
 * reader reads the words once rather than the words and a meter.
 */
function Bar({ percent }: { percent: number }): ReactElement {
  return (
    <div className="h-2 w-full bg-muted" aria-hidden="true" data-ai-budget-bar={percent}>
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

function resetText(t: Translate, reset: AiBudgetResetKind): string {
  switch (reset) {
    case 'daily':
      return t('admin.aiBudget.resetDaily', { defaultValue: 'Resets every day' });
    case 'weekly':
      return t('admin.aiBudget.resetWeekly', { defaultValue: 'Resets every week' });
    case 'monthly':
      return t('admin.aiBudget.resetMonthly', { defaultValue: 'Resets every month' });
    case 'none':
      return t('admin.aiBudget.resetNever', { defaultValue: 'Never resets' });
  }
}

function spentText(t: Translate, input: { spentToday: string; spentMonth: string }): string {
  return t('admin.aiBudget.spent', {
    defaultValue: 'Spent today {{today}}, this month {{month}}',
    today: input.spentToday,
    month: input.spentMonth,
  });
}

function messageText(t: Translate, message: 'failed' | 'no-ai' | 'unavailable'): string {
  switch (message) {
    case 'failed':
      return t('admin.aiBudget.failed', { defaultValue: 'Could not read the AI budget.' });
    case 'no-ai':
      return t('admin.aiBudget.noAi', { defaultValue: 'This instance offers no AI.' });
    case 'unavailable':
      return t('admin.aiBudget.unavailable', {
        defaultValue: 'The provider did not answer. Try again in a minute.',
      });
  }
}

/**
 * One layout for the key half, used twice: by the invisible stand-in with
 * wide numbers, and by the real line. The same markup is what makes the two
 * the same height.
 */
function KeyLayout({ t, line }: { t: Translate; line: AiKeyBudgetLine }): ReactElement | null {
  if (line.kind === 'blank') return null;
  if (line.kind === 'message') return <p className="text-sm text-muted-foreground">{messageText(t, line.message)}</p>;
  const leftLabel =
    line.kind === 'limited' ?
      t('admin.aiBudget.left', {
        defaultValue: '{{remaining}} left of {{limit}}',
        remaining: line.remaining,
        limit: line.limit,
      })
    : t('admin.aiBudget.noLimit', { defaultValue: 'No spending limit' });
  return (
    <div className="space-y-2">
      <p className="text-2xl font-semibold tabular-nums">{leftLabel}</p>
      {line.kind === 'limited' ?
        <Bar percent={line.leftPercent} />
      : <div className="invisible h-2" aria-hidden="true" />}
      <p className="text-xs text-muted-foreground">{resetText(t, line.reset)}</p>
      <p className="text-xs tabular-nums text-muted-foreground">{spentText(t, line)}</p>
    </div>
  );
}

function CapacityCell({
  t,
  line,
  formatCount,
}: {
  t: Translate;
  line: AiCapacityLine;
  formatCount: (value: number) => string;
}): ReactElement {
  const label =
    line.id === 'paid' ?
      t('admin.aiBudget.paid', { defaultValue: 'Paid' })
    : t('admin.aiBudget.trial', { defaultValue: 'Trials' });
  const value =
    line.limit === null ?
      t('admin.aiBudget.unitsNoLimit', { defaultValue: '{{used}} units, no limit', used: formatCount(line.used) })
    : t('admin.aiBudget.units', {
        defaultValue: '{{used}} of {{limit}} units',
        used: formatCount(line.used),
        limit: formatCount(line.limit),
      });
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="space-y-1">
        <span className="block text-sm tabular-nums">{value}</span>
        {line.usedPercent === null ?
          <div className="invisible h-2" aria-hidden="true" />
        : <Bar percent={line.usedPercent} />}
      </dd>
    </div>
  );
}

/** Stand-in rows for the loading and failed states: the same cells, never read, invisible. */
const STAND_IN_CAPACITY: readonly AiCapacityLine[] = [
  { id: 'paid', used: 0, limit: 1, usedPercent: 0 },
  { id: 'trial', used: 0, limit: 1, usedPercent: 0 },
];

const STAND_IN_KEY: AiKeyBudgetLine = {
  kind: 'limited',
  remaining: STAND_IN_MONEY,
  limit: STAND_IN_MONEY,
  leftPercent: 0,
  reset: 'monthly',
  spentToday: STAND_IN_MONEY,
  spentMonth: STAND_IN_MONEY,
};

export function AiBudgetCard({ load }: AiBudgetCardProps): ReactElement {
  const { t, i18n } = useTranslation();
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' });
  const count = new Intl.NumberFormat(i18n.language);
  const view = aiBudgetViewModel({ load, formatUsd: (value) => money.format(value) });

  return (
    <Card data-ai-budget-state={load.kind}>
      <CardHeader>
        <CardTitle>{t('admin.aiBudget.title', { defaultValue: 'AI budget' })}</CardTitle>
        <CardDescription>
          {t('admin.aiBudget.body', {
            defaultValue: "What the provider key has left, and how much of today's AI capacity is used.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t('admin.aiBudget.keyHeading', { defaultValue: 'Provider key' })}</h3>
          <div className="grid">
            <div className="invisible [grid-area:1/1]" aria-hidden="true">
              <KeyLayout t={t} line={STAND_IN_KEY} />
            </div>
            <div className="[grid-area:1/1]" data-ai-budget-key={view.key.kind}>
              <KeyLayout t={t} line={view.key} />
            </div>
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">
            {t('admin.aiBudget.capacityHeading', { defaultValue: "Today's capacity" })}
          </h3>
          {/* `invisible` rather than `hidden`: it keeps the box, and takes the
              stand-in numbers out of the accessibility tree. */}
          <dl className={`grid gap-3 sm:grid-cols-2 ${view.capacity === null ? 'invisible' : ''}`}>
            {(view.capacity ?? STAND_IN_CAPACITY).map((line) => (
              <CapacityCell key={line.id} t={t} line={line} formatCount={(value) => count.format(value)} />
            ))}
          </dl>
        </section>
      </CardContent>
    </Card>
  );
}
