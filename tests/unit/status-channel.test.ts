/**
 * Unit tests for `#app/lib/status`, the app's ONE notification channel.
 *
 * There are no toasts any more; every confirmation, warning and failure goes
 * through this module and is rendered in the app header. The contracts pinned
 * here are the ones a caller relies on without being able to see them: latest
 * wins, each tone clears itself after its own window, an error does NOT clear
 * itself, and an action survives the trip intact.
 *
 * Time is driven with `node:test`'s `mock.timers`, so nothing here waits.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS_TTL_MS,
  clearStatus,
  publishStatus,
  readStatus,
  resetStatusChannel,
} from '../../app/lib/status';

describe('publishStatus', () => {
  beforeEach(() => {
    resetStatusChannel();
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
    resetStatusChannel();
  });

  it('holds the message it was given', () => {
    publishStatus({ text: 'Entry saved', description: '12 g net carbs so far today.', tone: 'success' });
    const status = readStatus();
    assert.ok(status, 'nothing was published');
    assert.equal(status.text, 'Entry saved');
    assert.equal(status.description, '12 g net carbs so far today.');
    assert.equal(status.tone, 'success');
  });

  it('defaults to info, no description and no action', () => {
    publishStatus({ text: 'Report queued' });
    const status = readStatus();
    assert.ok(status);
    assert.equal(status.tone, 'info');
    assert.equal(status.description, null, 'an absent description must read as null, never as undefined');
    assert.equal(status.action, null);
  });

  it('carries an action through to the host', () => {
    let undone = 0;
    publishStatus({ text: 'Removed Greek yogurt', action: { label: 'Undo', onClick: () => (undone += 1) } });
    const status = readStatus();
    assert.ok(status?.action, 'the action was dropped');
    assert.equal(status.action.label, 'Undo');
    status.action.onClick();
    assert.equal(undone, 1, 'the published onClick is not the one the caller passed');
  });

  it('is latest wins: a second publish replaces the first outright', () => {
    publishStatus({ text: 'First', description: 'has one', action: { label: 'Undo', onClick: () => {} } });
    publishStatus({ text: 'Second' });
    const status = readStatus();
    assert.ok(status);
    assert.equal(status.text, 'Second');
    // CONTROL for "replaces": a channel that merged, or that queued, would
    // leave the first message's description and action standing here.
    assert.equal(status.description, null, 'the replaced message kept the old description');
    assert.equal(status.action, null, 'the replaced message kept the old action');
  });

  it('gives every publish a fresh id, so a host can key on it', () => {
    publishStatus({ text: 'Saved' });
    const first = readStatus()?.id;
    publishStatus({ text: 'Saved' });
    const second = readStatus()?.id;
    assert.notEqual(first, second, 'republishing the same words reused the id, so no transition restarts');
  });
});

describe('the per-tone window', () => {
  beforeEach(() => {
    resetStatusChannel();
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
    resetStatusChannel();
  });

  it('clears an info status after its window, and not before', () => {
    publishStatus({ text: 'Report queued', tone: 'info' });
    mock.timers.tick(STATUS_TTL_MS.info - 1);
    assert.ok(readStatus(), 'the message went before its window was up');
    mock.timers.tick(1);
    assert.equal(readStatus(), null, 'the message outstayed its window');
  });

  it('clears a success status on the same window', () => {
    publishStatus({ text: 'Saved', tone: 'success' });
    mock.timers.tick(STATUS_TTL_MS.success);
    assert.equal(readStatus(), null);
  });

  it('gives a warning longer than a success', () => {
    assert.ok(STATUS_TTL_MS.warning > STATUS_TTL_MS.success, 'a warning must not be as brief as a confirmation');
    publishStatus({ text: 'Connected, could not verify', tone: 'warning' });
    mock.timers.tick(STATUS_TTL_MS.success);
    assert.ok(readStatus(), 'the warning cleared on the success window');
    mock.timers.tick(STATUS_TTL_MS.warning - STATUS_TTL_MS.success);
    assert.equal(readStatus(), null);
  });

  it('never clears an error on its own', () => {
    assert.equal(STATUS_TTL_MS.error, null, 'an error with a window is an error nobody had to handle');
    publishStatus({ text: 'Import failed', tone: 'error' });
    mock.timers.tick(STATUS_TTL_MS.warning * 100);
    const status = readStatus();
    assert.ok(status, 'the error dismissed itself');
    assert.equal(status.text, 'Import failed');
  });

  it('honours an explicit ttlMs over the tone default', () => {
    publishStatus({ text: 'Import failed', tone: 'error', ttlMs: 50 });
    mock.timers.tick(50);
    assert.equal(readStatus(), null, 'an explicit ttl was ignored');
  });

  it('honours an explicit null ttlMs on a tone that would otherwise clear', () => {
    publishStatus({ text: 'Signed out', tone: 'info', ttlMs: null });
    mock.timers.tick(STATUS_TTL_MS.info * 10);
    assert.ok(readStatus(), 'ttlMs: null did not persist the message');
  });

  it('cancels the previous timer, so a republish gets a full window', () => {
    publishStatus({ text: 'First', tone: 'info' });
    mock.timers.tick(STATUS_TTL_MS.info - 1);
    publishStatus({ text: 'Second', tone: 'info' });
    mock.timers.tick(1);
    // CONTROL: without the cancel, the FIRST message's timer would fire here
    // and clear the second one a millisecond after it was published.
    assert.equal(readStatus()?.text, 'Second', 'the old timer cleared the new message');
  });
});

describe('clearStatus', () => {
  beforeEach(() => {
    resetStatusChannel();
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
    resetStatusChannel();
  });

  it('takes down a persisting error', () => {
    publishStatus({ text: 'Import failed', tone: 'error' });
    assert.ok(readStatus());
    clearStatus();
    assert.equal(readStatus(), null);
  });

  it('leaves no timer behind that could clear a later message', () => {
    publishStatus({ text: 'First', tone: 'info' });
    clearStatus();
    publishStatus({ text: 'Second', tone: 'error' });
    mock.timers.tick(STATUS_TTL_MS.info * 10);
    assert.equal(readStatus()?.text, 'Second', 'a cleared message left its timer running');
  });
});
