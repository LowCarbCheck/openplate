/**
 * The AI budget card on the admin overview (2026-09-30): the wire, the client
 * call, what each state shows, and that every state takes the same room.
 *
 * ── THE STATES ───────────────────────────────────────────────────────────
 *
 * Loading, a read that failed, an instance with no AI (a 404), a provider that
 * is not OpenRouter (the key half blank), a key read that failed, a key with
 * no limit, and a key with one. Each is a view-model assertion and a render.
 *
 * ── NO LAYOUT SHIFT, AT THE UNIT LEVEL ───────────────────────────────────
 *
 * The browser tier is where a shift is measured. What this file pins is the
 * mechanism: in EVERY state the invisible stand-in of the tallest key layout
 * is in the markup, and the capacity list is drawn with both of its cells,
 * invisible when there is nothing to show. The controls are the ready states,
 * where the list must NOT be invisible, or the test could pass on a card that
 * never shows a number.
 *
 * ── LITTLE TRANSLATED PROSE IS PINNED ──────────────────────────────────────
 *
 * The render reads the shipped English catalog (`admin.aiBudget.*` in
 * `common.json`). The assertions look for the figures, which are this card's
 * facts, and for a few words of the English.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { AiBudgetCard } from '../../app/components/admin/ai-budget-card';
import { aiBudgetViewModel, type AiBudgetLoad } from '../../app/lib/admin/ai-budget-view';
import { aiBudgetSchema, type AdminAiBudget } from '../../app/lib/admin/admin-wire';
import { AdminClient, type AdminTransport } from '../../app/lib/admin/admin-client';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { AuthorizedMethod } from '../../app/lib/sync/engine/client/auth-client';
import type { JsonValue } from '../../app/lib/sync/engine/protocol';

/** The body `PROTOCOL.md` §5.20 prints for `GET /v1/admin/ai/budget`, copied rather than built. */
const PROTOCOL_EXAMPLE = {
  day: '2026-09-30',
  capacity: {
    paid: { used: 412, limit: 2000 },
    trial: { used: 37, limit: 500 },
  },
  upstream: {
    status: 'ok',
    limitUsd: 5,
    remainingUsd: 3.94,
    reset: 'monthly',
    usageDailyUsd: 0.12,
    usageWeeklyUsd: 0.4,
    usageMonthlyUsd: 1.06,
    checkedAt: '2026-09-30T10:00:00.000Z',
  },
};

const BUDGET: AdminAiBudget = aiBudgetSchema.parse(PROTOCOL_EXAMPLE);

const usd = (value: number): string => `$${value.toFixed(2)}`;

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, withI18n(element)));
}

function renderLoad(load: AiBudgetLoad): string {
  return render(createElement(AiBudgetCard, { load }));
}

function withUpstream(upstream: AdminAiBudget['upstream']): AiBudgetLoad {
  return { kind: 'ready', budget: { ...BUDGET, upstream } };
}

/** The attribute the card puts on the real key layer, which names the state drawn. */
function keyStateOf(markup: string): string | null {
  return /data-ai-budget-key="([a-z-]+)"/.exec(markup)?.[1] ?? null;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// The wire and the call
// ---------------------------------------------------------------------------

test('the protocol example parses, and a wrapped body does not', () => {
  assert.equal(BUDGET.capacity.paid.used, 412);
  assert.equal(aiBudgetSchema.parse({ ...PROTOCOL_EXAMPLE, upstream: null }).upstream, null);
  assert.equal(
    aiBudgetSchema.parse({ ...PROTOCOL_EXAMPLE, upstream: { status: 'unavailable', checkedAt: 'x' } }).upstream?.status,
    'unavailable',
  );
  // THE CONTROL: the contract is unwrapped, so `{"budget": ...}` must not parse.
  assert.equal(aiBudgetSchema.safeParse({ budget: PROTOCOL_EXAMPLE }).success, false);
  assert.equal(aiBudgetSchema.safeParse({ ...PROTOCOL_EXAMPLE, upstream: { status: 'ok' } }).success, false);
});

interface RecordedRequest {
  path: string;
  method: AuthorizedMethod;
}

function clientAnswering(input: { answer: JsonValue | Error; recorded: RecordedRequest[] }): AdminClient {
  const transport: AdminTransport = {
    async requestAsAccount(request: { path: string; method: AuthorizedMethod; body?: JsonValue }): Promise<JsonValue> {
      input.recorded.push({ path: request.path, method: request.method });
      if (input.answer instanceof Error) throw input.answer;
      return input.answer;
    },
    requestBytesAsAccount(): Promise<never> {
      throw new Error('the budget card reads no bytes');
    },
  };
  return new AdminClient({ transport });
}

test('aiBudget reads the route, answers null for a 404, forbidden for a 403, and throws a 500', async () => {
  const recorded: RecordedRequest[] = [];
  const ok = await clientAnswering({ answer: PROTOCOL_EXAMPLE, recorded }).aiBudget();
  assert.deepEqual(recorded, [{ path: '/v1/admin/ai/budget', method: 'GET' }]);
  assert.equal(ok.status === 'ok' ? ok.value?.upstream?.status : null, 'ok');

  const notFound = await clientAnswering({
    answer: new SyncRequestError({ kind: 'not-found', status: 404, message: 'Not Found' }),
    recorded: [],
  }).aiBudget();
  assert.deepEqual(notFound, { status: 'ok', value: null });

  const forbidden = await clientAnswering({
    answer: new SyncRequestError({ kind: 'forbidden', status: 403, message: 'no' }),
    recorded: [],
  }).aiBudget();
  assert.deepEqual(forbidden, { status: 'forbidden' });

  // THE CONTROL: a server failure is not an instance with no AI.
  await assert.rejects(
    clientAnswering({
      answer: new SyncRequestError({ kind: 'server', status: 500, message: 'it fell over' }),
      recorded: [],
    }).aiBudget(),
  );
});

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

test('a key with a limit shows what is left, of what, the reset and the spend', () => {
  const view = aiBudgetViewModel({ load: { kind: 'ready', budget: BUDGET }, formatUsd: usd });
  assert.deepEqual(view.key, {
    kind: 'limited',
    remaining: '$3.94',
    limit: '$5.00',
    leftPercent: 79,
    reset: 'monthly',
    spentToday: '$0.12',
    spentMonth: '$1.06',
  });
  assert.deepEqual(view.capacity, [
    { id: 'paid', used: 412, limit: 2000, usedPercent: 21 },
    { id: 'trial', used: 37, limit: 500, usedPercent: 7 },
  ]);
});

test('each state has its own key line, and capacity only when there are numbers', () => {
  const cases: { name: string; load: AiBudgetLoad; key: string; hasCapacity: boolean }[] = [
    { name: 'loading', load: { kind: 'loading' }, key: 'blank', hasCapacity: false },
    { name: 'failed', load: { kind: 'failed' }, key: 'message', hasCapacity: false },
    { name: 'no AI', load: { kind: 'ready', budget: null }, key: 'message', hasCapacity: false },
    { name: 'not OpenRouter', load: withUpstream(null), key: 'blank', hasCapacity: true },
    {
      name: 'unavailable',
      load: withUpstream({ status: 'unavailable', checkedAt: '2026-09-30T10:00:00.000Z' }),
      key: 'message',
      hasCapacity: true,
    },
    {
      name: 'no limit',
      load: withUpstream({
        ...PROTOCOL_EXAMPLE.upstream,
        status: 'ok',
        reset: null,
        limitUsd: null,
        remainingUsd: null,
      }),
      key: 'unlimited',
      hasCapacity: true,
    },
  ];
  for (const testCase of cases) {
    const view = aiBudgetViewModel({ load: testCase.load, formatUsd: usd });
    assert.equal(view.key.kind, testCase.key, testCase.name);
    assert.equal(view.capacity !== null, testCase.hasCapacity, testCase.name);
  }
  const noAi = aiBudgetViewModel({ load: { kind: 'ready', budget: null }, formatUsd: usd });
  assert.deepEqual(noAi.key, { kind: 'message', message: 'no-ai' });
});

test('bars stay inside 0 to 100, and a ceiling of none draws no bar', () => {
  const over = aiBudgetViewModel({
    load: {
      kind: 'ready',
      budget: {
        ...BUDGET,
        capacity: { paid: { used: 2600, limit: 2000 }, trial: { used: 3, limit: null } },
        upstream: { ...PROTOCOL_EXAMPLE.upstream, status: 'ok', reset: 'monthly', remainingUsd: -0.4 },
      },
    },
    formatUsd: usd,
  });
  assert.equal(over.capacity?.[0]?.usedPercent, 100);
  assert.equal(over.capacity?.[1]?.usedPercent, null);
  assert.equal(over.key.kind === 'limited' ? over.key.leftPercent : -1, 0);
});

// ---------------------------------------------------------------------------
// The render, and the room it takes
// ---------------------------------------------------------------------------

test('the limited card shows the figures in words and draws both bars and the key bar', () => {
  const markup = renderLoad({ kind: 'ready', budget: BUDGET });
  assert.equal(keyStateOf(markup), 'limited');
  assert.match(markup, /\$3\.94 left of \$5\.00/);
  assert.match(markup, /Resets every month/);
  assert.match(markup, /Spent today \$0\.12, this month \$1\.06/);
  assert.match(markup, /412 of 2,000 units/);
  assert.match(markup, /37 of 500 units/);
  assert.match(markup, /data-ai-budget-bar="79"/);
  assert.match(markup, /data-ai-budget-bar="21"/);
  assert.match(markup, /data-ai-budget-bar="7"/);
  // THE CONTROL for the reserve test below: with numbers, the list is visible.
  assert.doesNotMatch(markup, /<dl class="[^"]*invisible/);
});

test('every state keeps the stand-in key layer and both capacity cells, so nothing below moves', () => {
  const loads: AiBudgetLoad[] = [
    { kind: 'loading' },
    { kind: 'failed' },
    { kind: 'ready', budget: null },
    withUpstream(null),
    withUpstream({ status: 'unavailable', checkedAt: '2026-09-30T10:00:00.000Z' }),
    withUpstream({ ...PROTOCOL_EXAMPLE.upstream, status: 'ok', reset: null, limitUsd: null, remainingUsd: null }),
    { kind: 'ready', budget: BUDGET },
  ];
  for (const load of loads) {
    const markup = renderLoad(load);
    const name = `${load.kind}/${keyStateOf(markup)}`;
    assert.match(markup, /class="invisible \[grid-area:1\/1\]" aria-hidden="true"/, `${name}: stand-in layer`);
    assert.equal(occurrences(markup, '$000.00 left of $000.00'), 1, `${name}: stand-in figures`);
    assert.equal(occurrences(markup, '<dt'), 2, `${name}: both capacity cells`);
  }
  // Without numbers the list is drawn and hidden, never removed.
  for (const load of [{ kind: 'loading' }, { kind: 'failed' }, { kind: 'ready', budget: null }] as const) {
    assert.match(renderLoad(load), /<dl class="[^"]*invisible/, load.kind);
  }
});

test('the three sentences: a failed read, no AI, and a provider that did not answer', () => {
  assert.match(renderLoad({ kind: 'failed' }), /Could not read the AI budget\./);
  assert.match(renderLoad({ kind: 'ready', budget: null }), /This instance offers no AI\./);
  const unavailable = renderLoad(withUpstream({ status: 'unavailable', checkedAt: '2026-09-30T10:00:00.000Z' }));
  assert.match(unavailable, /The provider did not answer/);
  // Capacity is this instance's own count and still shows while the provider is down.
  assert.match(unavailable, /412 of 2,000 units/);
});

test('a provider that is not OpenRouter leaves the key half blank and shows capacity', () => {
  const markup = renderLoad(withUpstream(null));
  assert.equal(keyStateOf(markup), 'blank');
  assert.doesNotMatch(markup, /data-ai-budget-bar="79"/);
  assert.match(markup, /412 of 2,000 units/);
});

test('a key with no limit says so, with its spend and no key bar', () => {
  const markup = renderLoad(
    withUpstream({ ...PROTOCOL_EXAMPLE.upstream, status: 'ok', reset: null, limitUsd: null, remainingUsd: null }),
  );
  assert.equal(keyStateOf(markup), 'unlimited');
  assert.match(markup, /No spending limit/);
  assert.match(markup, /Never resets/);
  assert.match(markup, /Spent today \$0\.12, this month \$1\.06/);
});
