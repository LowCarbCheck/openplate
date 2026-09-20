/**
 * A FAKE SERVICE WHOSE PORT IS TAKEN FAILS, IT DOES NOT HANG.
 *
 * ── THE FAILURE THIS FILE GUARDS ─────────────────────────────────────────
 *
 * Both of this repository's fake services used to start with a bare
 * `server.listen(port, host, callback)` wrapped in a promise that resolved on
 * the callback and listened for nothing else. When the port was already taken,
 * Node never called that callback; it emitted `error` with EADDRINUSE instead,
 * and the promise then neither resolved nor rejected. The caller waited for
 * ever.
 *
 * That is exactly what happened on this host: a browser tier run printed
 * `$ playwright test` and then nothing at all for sixteen minutes at nought
 * percent CPU, because a second working tree held the port. Two sessions hit
 * it independently and both read it as flakiness. A hang tells an operator
 * nothing. A rejection that names the port and the service tells them who to
 * wait for.
 *
 * ── THE PORT IS NEVER WRITTEN DOWN ───────────────────────────────────────
 *
 * This file must never bind the three ports `tests/e2e/env.ts` derives for
 * this checkout. That tier may be running right now, here or in another
 * worktree, which is the very collision under test. So every port here is
 * asked for at run time: listen on 0, let the kernel pick a free one, and read
 * back what it picked. That also keeps this file honest when the derivation
 * changes, because it names no number at all.
 *
 * ── EVERY CASE HAS ITS CONTROL ───────────────────────────────────────────
 *
 * A guard that rejected on every start would pass the two "a held port fails"
 * cases and break both tiers. So each fake is also started on a port nothing
 * holds and closed again, which is the control that keeps the failing cases
 * honest.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { startFakeSyncService } from '../integration/fake-sync-service';
import { startFakeFoodDb } from '../e2e/fake-food-db';

/**
 * The budget every case below runs under.
 *
 * It is stated because `node --test` has NO default timeout. The defect this
 * file guards is a promise that never settles, so without an explicit budget a
 * regression would hang this tier for ever rather than fail it, and a test that
 * hangs instead of failing is the same defect one level up.
 */
const TIMEOUT_MS = 5_000;

/** A port the kernel handed out, held open by a server of our own. */
type HeldPort = {
  /** The port, free at the moment it was handed out and taken from then on. */
  port: number;
  /** Gives the port back. Call it from a `finally`, so a failed case cannot keep it. */
  release: () => Promise<void>;
};

async function holdAFreePort(): Promise<HeldPort> {
  const blocker: Server = createServer();
  // `once` from `node:events` is the standard library's version of the
  // bookkeeping this file is about: it settles on `listening`, rejects on
  // `error`, and detaches both handlers either way. It is attached BEFORE
  // `listen`, because the event can already be queued by the time `listen`
  // returns.
  const listening = once(blocker, 'listening');
  blocker.listen(0, '127.0.0.1');
  await listening;
  // The blocker is unreferenced, and that is not tidiness. A regression makes
  // the start below never settle, which leaves the case suspended inside its
  // `await` so its `finally` never releases this socket. A REFERENCED socket
  // would then hold the event loop open and the whole run would hang after the
  // case had already been marked red, which is the defect one level up.
  // Unreferenced, it keeps the port but lets the process end.
  blocker.unref();
  // SAFETY: `listen(0, '127.0.0.1')` binds a TCP socket, and `Server#address()`
  // returns `AddressInfo` for every TCP bind. The `string` form is reachable
  // only from a pipe or UDS bind, which this server never performs.
  const address = blocker.address() as AddressInfo | null;
  if (address === null) throw new Error('the kernel handed out no port to hold');
  return {
    port: address.port,
    release: () => new Promise<void>((settle, fail) => blocker.close((error) => (error ? fail(error) : settle()))),
  };
}

/** A port that was free a moment ago and that nothing holds now. */
async function aFreePort(): Promise<number> {
  const held = await holdAFreePort();
  await held.release();
  return held.port;
}

describe('a fake service whose port another process holds', () => {
  it('the sync fake rejects, naming the port and the service', { timeout: TIMEOUT_MS }, async () => {
    const held = await holdAFreePort();
    try {
      await assert.rejects(
        () => startFakeSyncService({ port: held.port }),
        (cause: unknown) => {
          assert.ok(cause instanceof Error, 'a taken port must reject with an Error, not resolve and not hang');
          assert.match(cause.message, new RegExp(`127\\.0\\.0\\.1:${held.port}\\b`), 'it must name the port');
          assert.match(cause.message, /fake sync service/, 'it must name the service');
          assert.match(cause.message, /already holds that port/, 'it must say another process holds it');
          assert.match(cause.message, /ss -ltnp/, 'it must say how to name the process that holds it');
          assert.match(cause.message, /OPENPLATE_E2E_PORT_BASE/, 'it must name the escape hatch');
          return true;
        },
      );
    } finally {
      await held.release();
    }
  });

  it('the food database fake rejects, naming the port and the service', { timeout: TIMEOUT_MS }, async () => {
    const held = await holdAFreePort();
    try {
      await assert.rejects(
        () => startFakeFoodDb({ port: held.port }),
        (cause: unknown) => {
          assert.ok(cause instanceof Error, 'a taken port must reject with an Error, not resolve and not hang');
          assert.match(cause.message, new RegExp(`127\\.0\\.0\\.1:${held.port}\\b`), 'it must name the port');
          assert.match(cause.message, /fake food database/, 'it must name the service');
          assert.match(cause.message, /already holds that port/, 'it must say another process holds it');
          assert.match(cause.message, /ss -ltnp/, 'it must say how to name the process that holds it');
          assert.match(cause.message, /OPENPLATE_E2E_PORT_BASE/, 'it must name the escape hatch');
          return true;
        },
      );
    } finally {
      await held.release();
    }
  });
});

describe('a fake service on a port nothing holds', () => {
  it('the sync fake starts on it and closes again', { timeout: TIMEOUT_MS }, async () => {
    const port = await aFreePort();
    const service = await startFakeSyncService({ port });
    assert.equal(service.url, `http://127.0.0.1:${port}`, 'the service must report the port it was asked for');
    await service.close();
  });

  it('the food database fake starts on it and closes again', { timeout: TIMEOUT_MS }, async () => {
    const port = await aFreePort();
    const service = await startFakeFoodDb({ port });
    assert.equal(service.url, `http://127.0.0.1:${port}`, 'the service must report the port it was asked for');
    await service.close();
  });
});
