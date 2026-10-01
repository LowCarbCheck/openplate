/**
 * `CORE_URL` replaces `SYNC_SERVER_URL`, and the old name keeps working for one release.
 *
 * What an operator can have in their environment, and what the boot does about each case:
 *
 * - `CORE_URL` only: the address, no warning.
 * - `SYNC_SERVER_URL` only: the same address, and ONE warning that names the new setting.
 * - both, the same address: the address, no warning (the operator has already moved over).
 * - both, different addresses: the OLD name wins for this release, with ONE warning that names both
 *   values. The boot does not stop, so an auto-updated install nobody watches keeps running.
 * - neither: off, exactly as before (`parseAppConfig` publishes `null`).
 *
 * The cases run through `resolveCoreUrl` (the decision) and through `parseAppConfig` (the real
 * consumer), so a decision that nothing reads cannot pass. The controls at the bottom each change
 * one thing and watch a check fail: a warning that fires on the new name, a warning that fires on
 * an equal pair, a conflict resolved the other way, and a "once" that says the line twice.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAppConfig } from '../../app/config';
import {
  DEPRECATED_CORE_URL_WARNING,
  coreUrlConflictWarning,
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

  it('lets the old name win when both names are set to different addresses, with one warning that names both values', () => {
    const result = resolveWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: OLD_ADDRESS });

    assert.equal(result.raw, OLD_ADDRESS);
    assert.equal(result.name, 'SYNC_SERVER_URL');
    assert.deepEqual(result.warnings, [
      'CORE_URL (https://core.example.test) and SYNC_SERVER_URL (https://sync.example.test) are both set and differ. ' +
        'For this release SYNC_SERVER_URL wins, so the app uses https://sync.example.test. ' +
        'Remove the SYNC_SERVER_URL line before the release that drops the old name.',
    ]);
    assert.equal(result.warnings[0], coreUrlConflictWarning({ current: NEW_ADDRESS, deprecated: OLD_ADDRESS }));
  });

  it('does not log the conflict warning when the two addresses are equal', () => {
    const result = resolveWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: NEW_ADDRESS });

    assert.ok(
      !result.warnings.some((warning) => warning.includes('are both set and differ')),
      `an equal pair must not warn, saw: ${result.warnings.join(' | ')}`,
    );
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

  it('publishes the SYNC_SERVER_URL address, and warns once, when the two names differ', () => {
    const result = parseWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: `${OLD_ADDRESS}/` });

    assert.equal(result.coreUrl, OLD_ADDRESS);
    assert.deepEqual(result.warnings, [
      coreUrlConflictWarning({ current: NEW_ADDRESS, deprecated: `${OLD_ADDRESS}/` }),
    ]);
  });

  it('names SYNC_SERVER_URL when the winning old value is malformed', () => {
    assert.throws(
      () => parseWithWarnings({ CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: 'not a url' }),
      /^Error: SYNC_SERVER_URL is not a valid absolute URL/,
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

/** A reader that lets the new name win on a conflict, which the conflict case forbids. */
function letsTheNewNameWin(env: Record<string, string | undefined>): string | undefined {
  return env.CORE_URL ?? env.SYNC_SERVER_URL;
}

/** A reader that warns whenever both names are set, equal or not, which the equal pair forbids. */
function warnsWheneverBothAreSet(env: Record<string, string | undefined>): string[] {
  return env.CORE_URL !== undefined && env.SYNC_SERVER_URL !== undefined ? ['both are set'] : [];
}

describe('controls: the checks above can fail', () => {
  it('a reader that warned on the new name would be caught by the quiet case', () => {
    assert.notDeepEqual(
      warnsOnTheNewName({ CORE_URL: NEW_ADDRESS }),
      resolveWithWarnings({ CORE_URL: NEW_ADDRESS }).warnings,
    );
  });

  it('a reader that let the new name win on a conflict would be caught by the conflict case', () => {
    const conflict = { CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: OLD_ADDRESS };

    assert.equal(letsTheNewNameWin(conflict), NEW_ADDRESS);
    assert.notEqual(letsTheNewNameWin(conflict), resolveWithWarnings(conflict).raw);
  });

  it('a reader that warned on every pair would be caught by the equal pair', () => {
    const pair = { CORE_URL: NEW_ADDRESS, SYNC_SERVER_URL: NEW_ADDRESS };

    assert.equal(warnsWheneverBothAreSet(pair).length, 1);
    assert.deepEqual(resolveWithWarnings(pair).warnings, []);
  });
});
