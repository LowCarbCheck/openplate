/**
 * One shard of `scripts/repro-e2e-shard-isolation.sh`: the real global setup, no browser.
 *
 * It does what a Playwright shard does before its first page opens, and nothing after it: it
 * points FONTCONFIG_FILE at its fonts.conf the way `playwright.config.ts` does, then runs the
 * tier's own `global-setup.ts`, which wipes the shard's fontconfig cache, starts the fake core
 * server and the fake food database on the shard's ports, and creates the fixture account.
 *
 * ── The protocol ─────────────────────────────────────────────────────────
 *
 * The shards are separate processes and the order they run their setups in decides whether a
 * shared resource is visible, so the order is made on purpose with files in `PROBE_DIR`:
 *
 *  1. shard 1 runs its setup and writes a CANARY into its fontconfig cache directory,
 *  2. every other shard then runs its setup, which wipes ITS cache directory and binds ITS ports,
 *  3. shard 1 checks that its canary survived the others' wipes and that every shard's two fake
 *     services still answer, and writes the verdict; everyone tears down.
 *
 * With a cache directory of its own per shard the canary survives; with one shared directory,
 * step 2 deletes it, every time, whatever the timing. With ports of their own every setup binds;
 * on one port base the second shard's setup throws `EADDRINUSE` naming the port. The script runs
 * both of those as controls and requires them to fail.
 *
 * Variables, all set by the script: `PROBE_INDEX` (this shard, from 1), `PROBE_COUNT`,
 * `PROBE_DIR`, `XDG_CACHE_HOME` (a scratch folder, so the host's real cache is never touched),
 * and the tier's own `OPENPLATE_E2E_SHARD` and `OPENPLATE_E2E_PORT_BASE`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { E2E_FOOD_DB_PORT, E2E_SYNC_PORT, canonicalRepoRoot } from '../tests/e2e/env';
import { fontconfigCacheDirName, writeFontsConfFor } from '../tests/e2e/font-cache';
import globalSetup from '../tests/e2e/global-setup';
import globalTeardown from '../tests/e2e/global-teardown';
import { E2E_SHARD_VAR, parseShardNumber } from '../tests/e2e/shard';

/** How long a shard waits for a sibling before it gives up and says so. */
const WAIT_TIMEOUT_MS = 60_000;

/** How often a wait looks again. */
const POLL_INTERVAL_MS = 100;

/** A whole number from the environment, or a thrown sentence naming the variable. */
function readNumber(name: string): number {
  const raw = process.env[name] ?? '';
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} is not set to a whole number (${raw}).`);
  return Number(raw);
}

/** A string from the environment, or a thrown sentence naming the variable. */
function readText(name: string): string {
  const raw = process.env[name] ?? '';
  if (raw === '') throw new Error(`${name} is not set.`);
  return raw;
}

const index = readNumber('PROBE_INDEX');
const count = readNumber('PROBE_COUNT');
const probeDir = readText('PROBE_DIR');
const cacheHome = readText('XDG_CACHE_HOME');
const shard = parseShardNumber(process.env[E2E_SHARD_VAR]);

// What `playwright.config.ts` does at module load, for the same reason: the global setup's reset
// only acts when FONTCONFIG_FILE names THIS run's config.
process.env.FONTCONFIG_FILE ??= writeFontsConfFor(shard);

/** Where this shard's canary lives: inside its own fontconfig cache directory. */
const canaryPath = join(
  cacheHome,
  fontconfigCacheDirName({ shard, repoRoot: canonicalRepoRoot(fileURLToPath(new URL('../', import.meta.url))) }),
  'canary',
);

/** A marker file in the probe directory. */
function markerPath(name: string): string {
  return join(probeDir, name);
}

/** Waits until one of the files exists and returns its name, or throws after the timeout. */
async function waitForAny(names: readonly string[]): Promise<string> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = names.find((name) => existsSync(markerPath(name)));
    if (found !== undefined) return found;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`shard ${index}: none of ${names.join(', ')} appeared within ${WAIT_TIMEOUT_MS} ms.`);
}

/** Whether something accepts a connection on a loopback port. */
async function isListening(port: number): Promise<boolean> {
  return new Promise((settle) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      settle(true);
    });
    socket.once('error', () => settle(false));
  });
}

/** The first shard's whole job: plant, wait for the others, judge. */
async function runFirstShard(): Promise<void> {
  try {
    await globalSetup();
  } catch (error) {
    writeFileSync(markerPath('failed-1'), error instanceof Error ? error.message : String(error));
    throw error;
  }
  writeFileSync(canaryPath, 'written by shard 1 after its setup');
  writeFileSync(markerPath('planted'), `${E2E_FOOD_DB_PORT} ${E2E_SYNC_PORT}\n`);

  const problems: string[] = [];
  for (let other = 2; other <= count; other += 1) {
    const result = await waitForAny([`done-${other}`, `failed-${other}`]);
    if (result.startsWith('failed-'))
      problems.push(`shard ${other} could not finish its setup: ${readFileSync(markerPath(result), 'utf8').trim()}`);
  }

  if (!existsSync(canaryPath))
    problems.push('shard 1 canary was deleted by a sibling: the shards share a fontconfig cache');
  const ports = [`${E2E_FOOD_DB_PORT} ${E2E_SYNC_PORT}`];
  for (let other = 2; other <= count; other += 1) {
    if (existsSync(markerPath(`done-${other}`))) ports.push(readFileSync(markerPath(`done-${other}`), 'utf8').trim());
  }
  for (const pair of ports) {
    for (const port of pair.split(' ').map(Number)) {
      if (!(await isListening(port))) problems.push(`nothing answers on port ${port}`);
    }
  }

  writeFileSync(markerPath('verdict'), problems.length === 0 ? 'ok\n' : `${problems.join('\n')}\n`);
  await globalTeardown();
  if (problems.length > 0) {
    console.error(`shard 1: ${problems.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`shard 1: canary survived ${count - 1} sibling setups, ${ports.length * 2} fake-service ports answer`);
}

/** Every other shard's job: wait for the canary, run the real setup, report. */
async function runOtherShard(): Promise<void> {
  if ((await waitForAny(['planted', 'failed-1'])) === 'failed-1') throw new Error('shard 1 could not finish its setup');
  try {
    await globalSetup();
  } catch (error) {
    writeFileSync(markerPath(`failed-${index}`), error instanceof Error ? error.message : String(error));
    throw error;
  }
  writeFileSync(markerPath(`done-${index}`), `${E2E_FOOD_DB_PORT} ${E2E_SYNC_PORT}\n`);
  await waitForAny(['verdict']);
  await globalTeardown();
  console.log(`shard ${index}: setup ran on ports ${E2E_FOOD_DB_PORT} and ${E2E_SYNC_PORT}`);
}

if (index === 1) await runFirstShard();
else await runOtherShard();
