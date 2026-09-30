/**
 * `MOVED_TO_URL`: which values turn moved mode on, which stop the boot, and that unset changes
 * nothing (`app/config/moved.ts`).
 *
 * THE CONTROLS. Every refusal below sits next to an accepted value that differs from it in the one
 * thing the rule is about (`http` and `https`, a user name and none, this instance's origin and
 * another one), so a parser that refused everything, or nothing, fails a case here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAppConfig } from '../../app/config/index';
import { parseMovedConfig } from '../../app/config/moved';

/** An address this instance does not serve, the shape the brief's example has. */
const NEW_ADDRESS = 'https://app.openplate.example';

/** What `APP_URL` resolves to when it is unset. */
const DEFAULT_APP_URL = 'http://localhost:3000';

describe('parseMovedConfig', () => {
  it('is off for unset, empty and whitespace-only values', () => {
    for (const movedToUrl of [undefined, '', '   ', '\t\n']) {
      assert.equal(parseMovedConfig({ movedToUrl, appUrl: DEFAULT_APP_URL }), null, JSON.stringify(movedToUrl));
    }
  });

  it('reads an absolute https address into the address, its host and the sign-in page there', () => {
    assert.deepEqual(parseMovedConfig({ movedToUrl: NEW_ADDRESS, appUrl: DEFAULT_APP_URL }), {
      url: 'https://app.openplate.example/',
      host: 'app.openplate.example',
      signInUrl: 'https://app.openplate.example/sign-in',
    });
  });

  it('trims the value and keeps a port in the host it prints', () => {
    const moved = parseMovedConfig({ movedToUrl: '  https://app.openplate.example:8443/  ', appUrl: DEFAULT_APP_URL });
    assert.equal(moved?.host, 'app.openplate.example:8443');
    assert.equal(moved?.signInUrl, 'https://app.openplate.example:8443/sign-in');
  });

  it('sends the button to /sign-in on that origin whatever path the address carries', () => {
    const moved = parseMovedConfig({ movedToUrl: `${NEW_ADDRESS}/welcome`, appUrl: DEFAULT_APP_URL });
    assert.equal(moved?.url, 'https://app.openplate.example/welcome');
    assert.equal(moved?.signInUrl, 'https://app.openplate.example/sign-in');
  });

  it('refuses plain http, and the control with https passes', () => {
    assert.throws(
      () => parseMovedConfig({ movedToUrl: 'http://app.openplate.example', appUrl: DEFAULT_APP_URL }),
      /MOVED_TO_URL must be an absolute https:\/\/ address/,
    );
    assert.notEqual(parseMovedConfig({ movedToUrl: NEW_ADDRESS, appUrl: DEFAULT_APP_URL }), null);
  });

  it('refuses a value with no scheme, a relative path and a schemeless https', () => {
    for (const movedToUrl of ['app.openplate.example', '/sign-in', 'https:app.openplate.example', 'https://']) {
      assert.throws(
        () => parseMovedConfig({ movedToUrl, appUrl: DEFAULT_APP_URL }),
        /MOVED_TO_URL must be an absolute https:\/\/ address/,
        movedToUrl,
      );
    }
  });

  it('refuses another scheme', () => {
    assert.throws(
      () => parseMovedConfig({ movedToUrl: 'ftp://app.openplate.example', appUrl: DEFAULT_APP_URL }),
      /MOVED_TO_URL must be an absolute https:\/\/ address/,
    );
  });

  it('refuses an address that carries a user name or a password, and the control without one passes', () => {
    for (const movedToUrl of ['https://ops@app.openplate.example', 'https://ops:secret@app.openplate.example']) {
      assert.throws(
        () => parseMovedConfig({ movedToUrl, appUrl: DEFAULT_APP_URL }),
        /MOVED_TO_URL carries a user name or password/,
      );
    }
    assert.notEqual(parseMovedConfig({ movedToUrl: NEW_ADDRESS, appUrl: DEFAULT_APP_URL }), null);
  });

  it("refuses this instance's own origin, and the control with another host passes", () => {
    assert.throws(
      () => parseMovedConfig({ movedToUrl: 'https://beta.openplate.example/sign-in', appUrl: 'https://beta.openplate.example' }),
      /this instance's own address/,
    );
    assert.notEqual(
      parseMovedConfig({ movedToUrl: NEW_ADDRESS, appUrl: 'https://beta.openplate.example' }),
      null,
      'a different host on the same scheme is somewhere else',
    );
  });
});

describe('parseAppConfig and MOVED_TO_URL', () => {
  it('leaves moved mode off when the variable is unset', () => {
    assert.equal(parseAppConfig({}).moved, null);
  });

  it('leaves moved mode off when the variable is empty, as every compose file forwards it', () => {
    assert.equal(parseAppConfig({ MOVED_TO_URL: '' }).moved, null);
  });

  it('turns moved mode on from the variable', () => {
    assert.equal(parseAppConfig({ MOVED_TO_URL: NEW_ADDRESS }).moved?.host, 'app.openplate.example');
  });

  it('compares against APP_URL as the config resolved it, so a boot on its own address stops', () => {
    assert.throws(
      () => parseAppConfig({ APP_URL: 'https://beta.openplate.example', MOVED_TO_URL: 'https://beta.openplate.example' }),
      /this instance's own address/,
    );
  });

  it('stops the boot on a refused value instead of starting with the mode off', () => {
    assert.throws(() => parseAppConfig({ MOVED_TO_URL: 'http://app.openplate.example' }), /MOVED_TO_URL/);
  });
});
