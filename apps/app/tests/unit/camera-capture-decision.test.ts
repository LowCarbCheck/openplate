/**
 * What a tap on a camera button, and a photo picked after it, decide.
 *
 * The defect these pin: after a reload the connection reads `unknown` until the
 * session has resumed, and the hook treated `unknown` like `absent`, so the tap
 * navigated to the connect screen and no camera opened. Every case below reads
 * the decision for all three connection states, so a rule that collapsed two
 * of them would fail one row.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CONNECTION_WAIT_MS, decidePick, decideTap } from '../../app/lib/camera-capture-decision';

describe('decideTap', () => {
  it('opens the camera when connected', () => {
    assert.equal(decideTap('connected'), 'open-camera');
  });

  it('opens the camera while the connection is unknown, inside the tap', () => {
    assert.equal(decideTap('unknown'), 'open-camera');
  });

  it('goes to the scan screen only for a definite absence', () => {
    assert.equal(decideTap('absent'), 'go-to-scan');
  });
});

describe('decidePick', () => {
  it('hands a photo over when connected, at any point of the wait', () => {
    assert.equal(decidePick({ connection: 'connected', hasTimedOut: false }), 'hand-over');
    assert.equal(decidePick({ connection: 'connected', hasTimedOut: true }), 'hand-over');
  });

  it('waits while the connection is unknown and the bound has not passed', () => {
    assert.equal(decidePick({ connection: 'unknown', hasTimedOut: false }), 'wait');
  });

  it('goes to the scan screen without the photo when the wait times out', () => {
    assert.equal(decidePick({ connection: 'unknown', hasTimedOut: true }), 'go-to-scan');
  });

  it('goes to the scan screen without the photo when the connection resolves to absent', () => {
    assert.equal(decidePick({ connection: 'absent', hasTimedOut: false }), 'go-to-scan');
    assert.equal(decidePick({ connection: 'absent', hasTimedOut: true }), 'go-to-scan');
  });
});

describe('CONNECTION_WAIT_MS', () => {
  it('is a bound of a few seconds, long enough for a resume and short enough to notice', () => {
    assert.ok(CONNECTION_WAIT_MS >= 5_000 && CONNECTION_WAIT_MS <= 15_000);
  });
});
