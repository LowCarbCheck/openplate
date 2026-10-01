/**
 * `CORE_URL` replaces `SYNC_SERVER_URL`, and the old name keeps working for one release.
 *
 * What an operator can have in their environment, and what the boot does about each case:
 *
 * - `CORE_URL` only: the address, no warning.
 * - `SYNC_SERVER_URL` only: the same address, and ONE warning that names the new setting.
 * - both, the same address: the address, no warning (the operator has already moved over).
 * - both, different addresses: the boot stops, and the message names both settings.
 * - neither: off, exactly as before (`parseAppConfig` publishes `null`).
 *
 * The cases run through `resolveCoreUrl` (the decision) and through `parseAppConfig` (the real
 * consumer), so a decision that nothing reads cannot pass. The controls at the bottom each change
 * one thing and watch a check fail: a warning that fires on the new name, a conflict that is not
 * noticed, and a "once" that says the line twice.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAppConfig } from '../../app/config';
import {
  DEPRECATED_CORE_URL_WARNING,
  resolveCoreUrl,
  warnOncePerProcess,
  type CoreUrlSetting,
} from '../../app/config/core-url';

const NEW_ADDRESS = 'https://core.example.test';
const OLD_ADDRESS = 'https://sync.example.test';

/** What `resolveCoreUrl` answered, and every warning it gave. */
interface ResolvedCoreUrl extends CoreUrlSetting {
  warnings: string[];
}

/** What `parseAppConfig` published for the address, and every warning it gave. */
interface ParsedCoreUrl {
  coreUrl: string | null;
  warnings: string[];
}

/** `resolveCoreUrl` with every warning collected, so a case can count them. */
function resolveWithWarnings(env: Record<string, string | undefined>): ResolvedCoreUrl {
  const warnings: string[] = [];
  const setting = resolveCoreUrl({ env, warn: (message) => warnings.push(message) });
  return { ...setting, warnings };
}

/** `parseAppConfig` with every warning collected. */
function parseWithWarnings(env: Record<string, string | undefined>): ParsedCoreUrl {
  const warnings: string[] = [];
  const config = parseAppConfig(env, { warn: (message) => warnings.push(message) });
  return { coreUrl: config.sync.syncServerUrl, warnings };
}

/** The error a call throws. Fails the case when the call does not throw. */
function failureOf(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected the call to throw, and it returned');
}

/** What a second copy of the module exports that this file uses. */
interface CoreUrlCopy {
  warnOncePerProcess: typeof warnOncePerProcess;
}

/** Loads `core-url.ts` again under a query string, which Node keeps as a separate module instance. */
async function loadCopyOfCoreUrl(label: string): Promise<CoreUrlCopy> {
  const url = new URL('../../app/config/core-url.ts', import.meta.url);
  url.searchParams.set('copy', label);
  const loaded: CoreUrlCopy = await import(url.href);
  return loaded;
}

describe('resolveCoreUrl', () => {
  it('reads CORE_URL when only the new name is set, with no warning', () => {
    const result = resolveWithWarnings({ CORE_URL: NEW_ADDRESS });

    assert.equal(result.raw, NEW_ADDRESS);
    assert.equal(result.name, 'CORE_URL');
    assert.deepEqual(result.warnings, []);
  });

  it('reads SYNC_SERVER_URL when only the old name is set, and warns exactly once with the exact text', () => {
    const result = resolveWithWarnings({ SYNC_SERVER_URL: OLD_ADDRESS });

    assert.equal(result.raw, OLD_ADDRESS);
    assert.equal(result.name, 'SYNC_SERVER_URL');
    assert.deepEqual(result.warnings, [
      'SYNC_SERVER_URL is deprecated, set CORE_URL instead; the old name stops working in a later release.',
    ]);
    assert.equal(DEPRECATED_CORE_URL_WARNING, result.warnings[0]);
  });

  it('is quiet when both names are set to the same address', () => {
    const result = resolveWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: NEW_ADDRESS });

    assert.equal(result.raw, NEW_ADDRESS);
    assert.deepEqual(result.warnings, []);
  });

  it('counts a trailing slash as the same address', () => {
    const result = resolveWithWarnings({ CORE_URL: `${NEW_ADDRESS}/`, SYNC_SERVER_URL: NEW_ADDRESS });

    assert.equal(result.raw, `${NEW_ADDRESS}/`);
    assert.deepEqual(result.warnings, []);
  });

  it('stops the boot when both names are set to different addresses, naming both settings and both values', () => {
    const error = failureOf(() => resolveWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: OLD_ADDRESS }));

    assert.match(error.message, /CORE_URL/);
    assert.match(error.message, /SYNC_SERVER_URL/);
    assert.ok(error.message.includes(NEW_ADDRESS), 'the message names the CORE_URL value');
    assert.ok(error.message.includes(OLD_ADDRESS), 'the message names the SYNC_SERVER_URL value');
  });

  it('answers undefined with no warning when neither name is set', () => {
    const result = resolveWithWarnings({});

    assert.equal(result.raw, undefined);
    assert.deepEqual(result.warnings, []);
  });

  it('reads an empty or blank value as unset, so an empty compose default is no conflict', () => {
    const onlyNew = resolveWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: '' });
    const onlyOld = resolveWithWarnings({ CORE_URL: '   ', SYNC_SERVER_URL: OLD_ADDRESS });

    assert.equal(onlyNew.raw, NEW_ADDRESS);
    assert.deepEqual(onlyNew.warnings, []);
    assert.equal(onlyOld.raw, OLD_ADDRESS);
    assert.equal(onlyOld.warnings.length, 1);
  });
});

describe('parseAppConfig reads the address through resolveCoreUrl', () => {
  it('publishes the CORE_URL address', () => {
    assert.equal(parseWithWarnings({ CORE_URL: `${NEW_ADDRESS}/` }).coreUrl, NEW_ADDRESS);
  });

  it('publishes the SYNC_SERVER_URL address and warns once when it is the only name', () => {
    const result = parseWithWarnings({ SYNC_SERVER_URL: OLD_ADDRESS });

    assert.equal(result.coreUrl, OLD_ADDRESS);
    assert.deepEqual(result.warnings, [DEPRECATED_CORE_URL_WARNING]);
  });

  it('publishes null with neither name, as before', () => {
    assert.deepEqual(parseWithWarnings({}), { coreUrl: null, warnings: [] });
  });

  it('fails the parse when the two names differ', () => {
    assert.throws(
      () => parseWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: OLD_ADDRESS }),
      /CORE_URL and SYNC_SERVER_URL are both set/,
    );
  });

  it('names the setting the bad value came from', () => {
    assert.throws(() => parseWithWarnings({ CORE_URL: 'not a url' }), /^Error: CORE_URL is not a valid absolute URL/);
    assert.throws(
      () => parseWithWarnings({ SYNC_SERVER_URL: 'not a url' }),
      /^Error: SYNC_SERVER_URL is not a valid absolute URL/,
    );
    assert.throws(
      () => parseWithWarnings({ CORE_URL: 'ftp://core.example.test' }),
      /CORE_URL must be an http\(s\) URL/,
    );
  });

  it('asks a managed instance for CORE_URL', () => {
    assert.throws(
      () => parseWithWarnings({ INSTANCE_MODE: 'managed' }),
      /INSTANCE_MODE is "managed" but CORE_URL is not set/,
    );
  });

  it('accepts a managed instance that still uses the old name', () => {
    assert.equal(parseWithWarnings({ INSTANCE_MODE: 'managed', SYNC_SERVER_URL: OLD_ADDRESS }).coreUrl, OLD_ADDRESS);
  });
});

describe('warnOncePerProcess', () => {
  it('passes a message on the first time and drops it after that', () => {
    const said: string[] = [];
    const message = `once-per-process test line ${Math.random()}`;

    warnOncePerProcess({ message, sink: (line) => said.push(line) });
    warnOncePerProcess({ message, sink: (line) => said.push(line) });

    assert.deepEqual(said, [message]);
  });

  it('holds across two copies of the module, the way the production server loads the config twice', async () => {
    const copyA = await loadCopyOfCoreUrl('a');
    const copyB = await loadCopyOfCoreUrl('b');
    assert.notEqual(copyA.warnOncePerProcess, copyB.warnOncePerProcess, 'the control: these really are two copies');
    const said: string[] = [];
    const message = `two-copy test line ${Math.random()}`;

    copyA.warnOncePerProcess({ message, sink: (line) => said.push(line) });
    copyB.warnOncePerProcess({ message, sink: (line) => said.push(line) });

    assert.deepEqual(said, [message]);
  });

  it('control: two plain sinks without it would say the line twice', () => {
    const said: string[] = [];
    const warn = (line: string): void => void said.push(line);

    warn(DEPRECATED_CORE_URL_WARNING);
    warn(DEPRECATED_CORE_URL_WARNING);

    assert.equal(said.length, 2);
  });
});

/** A reader that warns whenever the new name is set, which the quiet case forbids. */
function warnsOnTheNewName(env: Record<string, string | undefined>): string[] {
  return env.CORE_URL === undefined ? [] : [DEPRECATED_CORE_URL_WARNING];
}

/** A reader that lets the old name win on a conflict, which the conflict case forbids. */
function letsTheOldNameWin(env: Record<string, string | undefined>): string | undefined {
  return env.SYNC_SERVER_URL ?? env.CORE_URL;
}

describe('controls: the checks above can fail', () => {
  it('a reader that warned on the new name would be caught by the quiet case', () => {
    assert.notDeepEqual(
      warnsOnTheNewName({ CORE_URL: NEW_ADDRESS }),
      resolveWithWarnings({ CORE_URL: NEW_ADDRESS }).warnings,
    );
  });

  it('a reader that let the old name win on a conflict would not throw, which the conflict case forbids', () => {
    assert.equal(letsTheOldNameWin({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: OLD_ADDRESS }), OLD_ADDRESS);
    assert.throws(() => resolveWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: OLD_ADDRESS }));
  });
});
