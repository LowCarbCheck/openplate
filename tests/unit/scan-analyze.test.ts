/**
 * Unit tests for `#app/lib/scan-analyze` — the pure arm/dispatch state machine
 * behind the scan page's cancel-grace flow. No React, timers, DOM, or network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeReducer, initialAnalyzeState, LIBRARY_GRACE_MS, type AnalyzeState } from '../../app/lib/scan-analyze';

describe('LIBRARY_GRACE_MS', () => {
  it('is a short, positive window', () => {
    assert.ok(LIBRARY_GRACE_MS > 0);
    assert.ok(LIBRARY_GRACE_MS <= 3000);
  });
});

describe('analyzeReducer — pick', () => {
  it('dispatches a camera capture immediately, bumping the dispatch id', () => {
    const next = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'camera' });
    assert.strictEqual(next.phase, 'dispatching');
    assert.strictEqual(next.dispatchId, 1);
    assert.strictEqual(next.pickId, 1);
  });

  it('arms the grace window for a library pick without dispatching', () => {
    const next = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    assert.strictEqual(next.phase, 'grace');
    assert.strictEqual(next.dispatchId, 0);
    assert.strictEqual(next.pickId, 1);
  });

  it('bumps the pick id on every pick so the grace timer can restart', () => {
    const first = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    const second = analyzeReducer(first, { type: 'pick', source: 'library' });
    assert.strictEqual(second.phase, 'grace');
    assert.strictEqual(second.pickId, 2);
    assert.strictEqual(second.dispatchId, 0);
  });
});

describe('analyzeReducer — graceElapsed', () => {
  it('dispatches when the grace window elapses', () => {
    const grace = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    const next = analyzeReducer(grace, { type: 'graceElapsed' });
    assert.strictEqual(next.phase, 'dispatching');
    assert.strictEqual(next.dispatchId, 1);
    assert.strictEqual(next.pickId, grace.pickId);
  });

  it('is a no-op outside the grace phase', () => {
    const idle = initialAnalyzeState;
    assert.strictEqual(analyzeReducer(idle, { type: 'graceElapsed' }), idle);
    const dispatching = analyzeReducer(idle, { type: 'pick', source: 'camera' });
    assert.strictEqual(analyzeReducer(dispatching, { type: 'graceElapsed' }), dispatching);
  });
});

describe('analyzeReducer — cancel', () => {
  it('returns to idle from the grace window without dispatching', () => {
    const grace = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    const next = analyzeReducer(grace, { type: 'cancel' });
    assert.strictEqual(next.phase, 'idle');
    assert.strictEqual(next.dispatchId, 0);
  });

  it('cannot cancel a committed dispatch (no fake cancel)', () => {
    const dispatching = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'camera' });
    assert.strictEqual(analyzeReducer(dispatching, { type: 'cancel' }), dispatching);
  });
});

describe('analyzeReducer — retry', () => {
  it('re-dispatches from idle with a fresh dispatch id', () => {
    const grace = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    const idle = analyzeReducer(grace, { type: 'cancel' });
    const next = analyzeReducer(idle, { type: 'retry' });
    assert.strictEqual(next.phase, 'dispatching');
    assert.strictEqual(next.dispatchId, 1);
  });

  it('re-dispatching the same file yields a new dispatch id each time', () => {
    let state: AnalyzeState = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'camera' });
    assert.strictEqual(state.dispatchId, 1);
    state = analyzeReducer(state, { type: 'settled' });
    state = analyzeReducer(state, { type: 'retry' });
    assert.strictEqual(state.dispatchId, 2);
    state = analyzeReducer(state, { type: 'settled' });
    state = analyzeReducer(state, { type: 'retry' });
    assert.strictEqual(state.dispatchId, 3);
  });

  it('is a no-op while grace or dispatching is active', () => {
    const grace = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    assert.strictEqual(analyzeReducer(grace, { type: 'retry' }), grace);
    const dispatching = analyzeReducer(grace, { type: 'graceElapsed' });
    assert.strictEqual(analyzeReducer(dispatching, { type: 'retry' }), dispatching);
  });
});

describe('analyzeReducer — settled', () => {
  it('returns to idle once a dispatch resolves', () => {
    const dispatching = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'camera' });
    const next = analyzeReducer(dispatching, { type: 'settled' });
    assert.strictEqual(next.phase, 'idle');
    assert.strictEqual(next.dispatchId, dispatching.dispatchId);
  });

  it('is a no-op outside the dispatching phase', () => {
    const idle = initialAnalyzeState;
    assert.strictEqual(analyzeReducer(idle, { type: 'settled' }), idle);
    const grace = analyzeReducer(idle, { type: 'pick', source: 'library' });
    assert.strictEqual(analyzeReducer(grace, { type: 'settled' }), grace);
  });
});

describe('analyzeReducer — reset', () => {
  it('forces idle from any phase while preserving the ids', () => {
    const grace = analyzeReducer(initialAnalyzeState, { type: 'pick', source: 'library' });
    const reset = analyzeReducer(grace, { type: 'reset' });
    assert.strictEqual(reset.phase, 'idle');
    assert.strictEqual(reset.dispatchId, grace.dispatchId);
    assert.strictEqual(reset.pickId, grace.pickId);
  });
});
