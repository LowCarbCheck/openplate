/**
 * Unit tests for `#app/lib/server-bind`, the opt-in `HOST` rule behind
 * `server.listen`. `server.ts` starts a listener at import time and cannot be
 * imported here, and binding a real socket in a unit test would prove nothing
 * about the decision anyway, so the decision itself is the unit.
 *
 * Two properties are load-bearing and pull in opposite directions. An unset
 * `HOST` must keep binding every interface, or the production container behind
 * Traefik stops answering. A set `HOST` must be handed to Node verbatim, or a
 * developer who asked for loopback is still serving seeded data to the whole
 * home network.
 *
 * The url is checked alongside every case, and for a set `HOST` it must be the
 * bind itself. Substituting a name for an address, `localhost` for `::1` say,
 * prints a url that a machine resolving `localhost` to `127.0.0.1` first would
 * refuse while the server ran perfectly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveServerBind } from '../../app/lib/server-bind';

const PORT = 3000;

describe('resolveServerBind, HOST absent means every interface', () => {
  it('returns no host at all when HOST is unset', () => {
    const bind = resolveServerBind({ env: {}, port: PORT });
    assert.equal(bind.host, undefined);
    assert.equal(bind.url, 'http://localhost:3000');
  });

  it('returns no host when HOST is explicitly undefined', () => {
    const bind = resolveServerBind({ env: { HOST: undefined }, port: PORT });
    assert.equal(bind.host, undefined);
  });

  it('treats an empty HOST as unset rather than binding the empty string', () => {
    const bind = resolveServerBind({ env: { HOST: '' }, port: PORT });
    assert.equal(bind.host, undefined);
    assert.equal(bind.url, 'http://localhost:3000');
  });

  it('treats a whitespace-only HOST as unset', () => {
    const bind = resolveServerBind({ env: { HOST: '   ' }, port: PORT });
    assert.equal(bind.host, undefined);
    assert.equal(bind.url, 'http://localhost:3000');
  });

  it('never substitutes 0.0.0.0, which would drop IPv6', () => {
    assert.notEqual(resolveServerBind({ env: {}, port: PORT }).host, '0.0.0.0');
  });
});

describe('resolveServerBind, a set HOST is the bind and the url', () => {
  it('prints 127.0.0.1 rather than the name localhost', () => {
    const bind = resolveServerBind({ env: { HOST: '127.0.0.1' }, port: PORT });
    assert.equal(bind.host, '127.0.0.1');
    assert.equal(bind.url, 'http://127.0.0.1:3000');
  });

  it('prints ::1 bracketed rather than the name localhost', () => {
    const bind = resolveServerBind({ env: { HOST: '::1' }, port: PORT });
    assert.equal(bind.host, '::1');
    assert.equal(bind.url, 'http://[::1]:3000');
  });

  it('prints the name localhost when that is what was asked for', () => {
    const bind = resolveServerBind({ env: { HOST: 'localhost' }, port: PORT });
    assert.equal(bind.host, 'localhost');
    assert.equal(bind.url, 'http://localhost:3000');
  });

  it('trims surrounding whitespace instead of binding a padded address', () => {
    const bind = resolveServerBind({ env: { HOST: ' 127.0.0.1 ' }, port: PORT });
    assert.equal(bind.host, '127.0.0.1');
    assert.equal(bind.url, 'http://127.0.0.1:3000');
  });

  it('prints the LAN address it actually binds', () => {
    const bind = resolveServerBind({ env: { HOST: '192.168.1.10' }, port: PORT });
    assert.equal(bind.host, '192.168.1.10');
    assert.equal(bind.url, 'http://192.168.1.10:3000');
  });

  it('prints the tailnet address it actually binds', () => {
    const bind = resolveServerBind({ env: { HOST: '100.64.0.3' }, port: 8080 });
    assert.equal(bind.host, '100.64.0.3');
    assert.equal(bind.url, 'http://100.64.0.3:8080');
  });

  it('brackets a routable IPv6 literal too', () => {
    const bind = resolveServerBind({ env: { HOST: 'fd7a:115c:a1e0::3' }, port: PORT });
    assert.equal(bind.host, 'fd7a:115c:a1e0::3');
    assert.equal(bind.url, 'http://[fd7a:115c:a1e0::3]:3000');
  });

  it('does not bracket a hostname', () => {
    const bind = resolveServerBind({ env: { HOST: 'bluefin' }, port: PORT });
    assert.equal(bind.url, 'http://bluefin:3000');
  });
});
