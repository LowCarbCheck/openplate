/**
 * Unit tests for `decideNavigation` in `#app/hooks/use-app-navigate`, the
 * pure function that decides push, replace or pop.
 *
 * The HOOK is deliberately thin over this, so the whole rule set is testable
 * with no router, no DOM and no history. Each of the four rules gets a case,
 * plus the explicit override, plus the four walks the module comment
 * documents, walked end to end as a stack.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideNavigation, type NavigationDecision } from '../../app/hooks/use-app-navigate';
import { EMPTY_LEDGER, recordLocation, type HistoryLedger } from '../../app/lib/history-ledger';

function ledgerOf(...pathnames: string[]): HistoryLedger {
  return pathnames.reduce<HistoryLedger>(
    (ledger, pathname, idx) => recordLocation({ ledger, idx, pathname }),
    EMPTY_LEDGER,
  );
}

describe('decideNavigation, rule (a), the caller decides', () => {
  it('obeys an explicit replace even where the target is one level deeper', () => {
    const decision = decideNavigation({
      from: '/settings',
      to: '/settings/ai',
      replace: true,
      ledger: ledgerOf('/settings'),
      idx: 0,
    });
    assert.deepEqual(decision, { kind: 'replace' });
  });

  it('obeys an explicit replace:false even where the rules would replace', () => {
    const decision = decideNavigation({
      from: '/diary',
      to: '/diary?date=2026-09-01',
      replace: false,
      ledger: ledgerOf('/diary'),
      idx: 0,
    });
    assert.deepEqual(decision, { kind: 'push' });
  });
});

describe('decideNavigation, rule (b), same pathname', () => {
  it('replaces on a query change', () => {
    const decision = decideNavigation({
      from: '/diary',
      to: '/diary?date=2026-09-01',
      ledger: ledgerOf('/diary'),
      idx: 0,
    });
    assert.deepEqual(decision, { kind: 'replace' });
  });

  it('replaces on a hash change', () => {
    const decision = decideNavigation({ from: '/settings', to: '/settings#sync', ledger: ledgerOf('/settings'), idx: 0 });
    assert.deepEqual(decision, { kind: 'replace' });
  });

  it('replaces even when the same pathname is also behind us', () => {
    // Rule (b) is tried before rule (d) on purpose: paging the diary must not
    // pop backwards through the days already visited.
    const decision = decideNavigation({
      from: '/diary',
      to: '/diary?date=2026-09-01',
      ledger: ledgerOf('/diary', '/settings', '/diary'),
      idx: 2,
    });
    assert.deepEqual(decision, { kind: 'replace' });
  });
});

describe('decideNavigation, rule (c), one level deeper', () => {
  it('pushes a child', () => {
    const decision = decideNavigation({ from: '/settings', to: '/settings/ai', ledger: ledgerOf('/settings'), idx: 0 });
    assert.deepEqual(decision, { kind: 'push' });
  });

  it('pushes a child even when it is also behind us', () => {
    // Deeper beats pop: the person is descending, and the entry above must be
    // the parent they came from, not an older visit from somewhere else.
    const decision = decideNavigation({
      from: '/diary',
      to: '/diary/entry/abc',
      ledger: ledgerOf('/diary/entry/abc', '/diary'),
      idx: 1,
    });
    assert.deepEqual(decision, { kind: 'push' });
  });

  it('does NOT push a jump that skipped levels', () => {
    const decision = decideNavigation({ from: '/diary', to: '/admin/feedback/7', ledger: ledgerOf('/diary'), idx: 0 });
    assert.deepEqual(decision, { kind: 'replace' });
  });
});

describe('decideNavigation, rule (d), already behind us', () => {
  it('pops to the nearest earlier copy, and parks the exact destination', () => {
    const decision = decideNavigation({
      from: '/settings/ai',
      to: '/diary',
      ledger: ledgerOf('/diary', '/settings', '/settings/ai'),
      idx: 2,
    });
    assert.deepEqual(decision, { kind: 'pop', steps: 2, settle: '/diary' });
  });

  it('parks the search too, because the ledger only remembers pathnames', () => {
    const decision = decideNavigation({
      from: '/settings',
      to: '/diary?date=2026-09-01',
      ledger: ledgerOf('/diary', '/settings'),
      idx: 1,
    });
    assert.deepEqual(decision, { kind: 'pop', steps: 1, settle: '/diary?date=2026-09-01' });
  });
});

describe('decideNavigation, rule (e), sideways', () => {
  it('replaces between two roots that are not behind us', () => {
    const decision = decideNavigation({ from: '/diary', to: '/add', ledger: ledgerOf('/diary'), idx: 0 });
    assert.deepEqual(decision, { kind: 'replace' });
  });

  it('replaces when the ledger is unreadable, so an empty note is always safe', () => {
    const decision = decideNavigation({ from: '/settings/ai', to: '/diary', ledger: EMPTY_LEDGER, idx: 4 });
    assert.deepEqual(decision, { kind: 'replace' });
  });
});

/**
 * Walk a list of destinations through the decision function, keeping a real
 * stack as the browser would: push appends, replace overwrites the top, pop
 * drops entries. The resulting stack is the claim the module comment makes.
 */
function walk(start: string, destinations: readonly string[]): string[] {
  let stack = [start];
  for (const to of destinations) {
    const idx = stack.length - 1;
    const ledger = ledgerOf(...stack.map((href) => href.split('?')[0] ?? ''));
    const decision: NavigationDecision = decideNavigation({
      from: stack[idx]?.split('?')[0] ?? '',
      to,
      ledger,
      idx,
    });
    if (decision.kind === 'push') stack.push(to);
    else if (decision.kind === 'replace') stack[idx] = to;
    else stack = [...stack.slice(0, idx - (decision.steps ?? 0)), decision.settle ?? to];
  }
  return stack;
}

describe('the four documented walks leave the documented stacks', () => {
  it('walk 1: diary, settings, settings/ai, tab Diary', () => {
    assert.deepEqual(walk('/diary', ['/settings', '/settings/ai', '/diary']), ['/settings', '/diary']);
  });

  it('walk 2: six days of diary paging cost nothing', () => {
    const days = ['01', '02', '03', '04', '05', '06'].map((day) => `/diary?date=2026-09-${day}`);
    assert.deepEqual(walk('/diary', days), ['/diary?date=2026-09-06']);
  });

  it('walk 3: a deep link into one entry, then the back link', () => {
    assert.deepEqual(walk('/diary/entry/abc', ['/diary?date=2026-09-01']), ['/diary?date=2026-09-01']);
  });

  it('walk 4: diary, add, then the save redirect (which carries replace)', () => {
    // The redirect is React Router's, not `go`'s, and it carries `replace`
    // because the submitting `<Form>` does, so it lands on rule (a).
    assert.deepEqual(walk('/diary', ['/add']), ['/add']);
    const afterSave = decideNavigation({ from: '/add', to: '/diary', replace: true, ledger: ledgerOf('/add'), idx: 0 });
    assert.deepEqual(afterSave, { kind: 'replace' });
  });

  it('and a five-tap wander leaves one entry, not five', () => {
    // The defect this whole change exists for: unshaped, every one of these
    // taps pushes and the stack ends five deep, so five Back gestures are
    // needed to leave. Shaped, the last tap POPS back onto the `/settings`
    // that is already behind us and the stack collapses to it.
    assert.deepEqual(walk('/diary', ['/settings', '/settings/ai', '/diary', '/settings']), ['/settings']);
  });
});
