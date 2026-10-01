/**
 * `pnpm core-api` is the admin CLI. `pnpm sync-api` is its old name and runs the same CLI.
 *
 * The CLI is the break-glass path when `/admin` is out of reach, so a rename must not strand it.
 * These cases run the two entry files as REAL child processes against a listener that counts
 * requests, the way `sync-api-guards.test.ts` does:
 *
 * - `core-api` reaches the server named by `CORE_URL`, and prints no notice.
 * - `sync-api` does the same work and prints ONE notice to standard error first, with the exact
 *   words, and leaves standard output alone.
 * - the old `SYNC_SERVER_URL` still names the server, with one warning on standard error.
 * - two different addresses under the two names: the OLD name wins for this release, with one
 *   warning on standard error that names both values, and the request goes to the old address.
 * - `--url` beats both, even when the two names disagree.
 * - `package.json` points `core-api` at `main.ts` and `sync-api` at the alias, and the alias file
 *   holds no CLI code of its own, so the two cannot drift.
 *
 * Every refusal is checked by request count on a listener that would have answered, so an absence
 * is never asserted against a server nobody could reach.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coreUrlConflictWarning,
  resolveCoreUrl,
  DEPRECATED_CORE_URL_WARNING,
} from '../../scripts/sync-api/core-url.js';
import { runCli, startCountingServer, type CountingServer } from './sync-api-cli-harness.js';

const ADMIN_TOKEN = 'core-api-test-admin-token-0123456789';
const DELETE_CANARY = ['accounts', 'delete', '5', '--yes'];
const EXPECTED_REQUEST = 'DELETE /v1/admin/accounts/5';

const NOTICE = 'pnpm sync-api is now pnpm core-api; the old name stops working in a later release.';
const WARNING = 'SYNC_SERVER_URL is deprecated, set CORE_URL instead; the old name stops working in a later release.';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let server: CountingServer;
let otherServer: CountingServer;

before(async () => {
  server = await startCountingServer();
  otherServer = await startCountingServer();
});

after(async () => {
  await server.close();
  await otherServer.close();
});

/** How many lines of `text` equal `line`. */
function countLines(input: { text: string; line: string }): number {
  return input.text.split('\n').filter((candidate) => candidate === input.line).length;
}

test('the warning is the exact sentence the release note promises', () => {
  assert.equal(DEPRECATED_CORE_URL_WARNING, WARNING);
});

test('core-api reaches the server named by CORE_URL and prints no notice and no warning', async () => {
  const requestsBefore = server.requests.length;

  const run = await runCli({ args: DELETE_CANARY, adminToken: ADMIN_TOKEN, env: { CORE_URL: server.baseUrl } });

  assert.equal(run.exitCode, 0, `expected success, stderr: ${run.stderr}`);
  assert.deepEqual(server.requests.slice(requestsBefore), [EXPECTED_REQUEST]);
  assert.equal(run.stderr, '', `core-api must be quiet on the new name, saw: ${run.stderr}`);
});

test('sync-api runs the same CLI, and prints the notice once, on standard error, first', async () => {
  const requestsBefore = server.requests.length;

  const run = await runCli({
    args: DELETE_CANARY,
    adminToken: ADMIN_TOKEN,
    entry: 'sync-api',
    env: { CORE_URL: server.baseUrl },
  });

  assert.equal(run.exitCode, 0, `expected success, stderr: ${run.stderr}`);
  assert.deepEqual(server.requests.slice(requestsBefore), [EXPECTED_REQUEST], 'the old name does the same work');
  assert.equal(run.stderr.split('\n')[0], NOTICE, 'the notice is the first line');
  assert.equal(countLines({ text: run.stderr, line: NOTICE }), 1, 'and it is printed once');
  assert.ok(!run.stdout.includes(NOTICE), 'standard output stays clean, so --json can be piped');
});

test('sync-api prints the same usage text as core-api, apart from the notice', async () => {
  const viaNewName = await runCli({ args: ['--help'], adminToken: null });
  const viaOldName = await runCli({ args: ['--help'], adminToken: null, entry: 'sync-api' });

  assert.equal(viaNewName.exitCode, 0, viaNewName.stderr);
  assert.equal(viaOldName.exitCode, 0, viaOldName.stderr);
  assert.equal(viaOldName.stdout, viaNewName.stdout);
  assert.ok(viaNewName.stdout.includes('core-api'), 'the usage names the new command');
  assert.ok(!viaNewName.stdout.includes('pnpm sync-api'), 'and no longer names the old one');
});

test('the old SYNC_SERVER_URL still names the server, with one warning', async () => {
  const requestsBefore = server.requests.length;

  const run = await runCli({
    args: DELETE_CANARY,
    adminToken: ADMIN_TOKEN,
    env: { SYNC_SERVER_URL: server.baseUrl },
  });

  assert.equal(run.exitCode, 0, `expected success, stderr: ${run.stderr}`);
  assert.deepEqual(server.requests.slice(requestsBefore), [EXPECTED_REQUEST]);
  assert.equal(countLines({ text: run.stderr, line: WARNING }), 1, `expected one warning, saw: ${run.stderr}`);
});

test('two different addresses under the two names: the old name wins, with one warning that names both', async () => {
  const requestsBefore = server.requests.length;
  const otherRequestsBefore = otherServer.requests.length;

  const run = await runCli({
    args: DELETE_CANARY,
    adminToken: ADMIN_TOKEN,
    env: { CORE_URL: server.baseUrl, SYNC_SERVER_URL: otherServer.baseUrl },
  });

  const warning = coreUrlConflictWarning({ current: server.baseUrl, deprecated: otherServer.baseUrl });
  assert.equal(run.exitCode, 0, `a conflict must not stop the command, stderr: ${run.stderr}`);
  assert.equal(countLines({ text: run.stderr, line: warning }), 1, `expected one conflict warning, saw: ${run.stderr}`);
  assert.ok(warning.includes('SYNC_SERVER_URL wins'), 'the warning says which name is used');
  assert.equal(server.requests.length, requestsBefore, 'nothing goes to the CORE_URL server');
  assert.deepEqual(
    otherServer.requests.slice(otherRequestsBefore),
    [EXPECTED_REQUEST],
    'the SYNC_SERVER_URL server is used',
  );
});

test('control: an equal pair under the two names gives no conflict warning', async () => {
  const requestsBefore = server.requests.length;

  const run = await runCli({
    args: DELETE_CANARY,
    adminToken: ADMIN_TOKEN,
    env: { CORE_URL: server.baseUrl, SYNC_SERVER_URL: server.baseUrl },
  });

  assert.equal(run.exitCode, 0, run.stderr);
  assert.deepEqual(server.requests.slice(requestsBefore), [EXPECTED_REQUEST]);
  assert.ok(!run.stderr.includes('are both set and differ'), `an equal pair must not warn, saw: ${run.stderr}`);
});

test('--url beats both names, even when they disagree', async () => {
  const requestsBefore = server.requests.length;

  const run = await runCli({
    args: [...DELETE_CANARY, '--url', server.baseUrl],
    adminToken: ADMIN_TOKEN,
    env: { CORE_URL: 'http://127.0.0.1:1', SYNC_SERVER_URL: 'http://127.0.0.1:2' },
  });

  assert.equal(run.exitCode, 0, `expected success, stderr: ${run.stderr}`);
  assert.deepEqual(server.requests.slice(requestsBefore), [EXPECTED_REQUEST]);
});

test('package.json starts core-api on main.ts and sync-api on the alias', () => {
  const manifest: { scripts: Record<string, string> } = JSON.parse(
    readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
  );

  assert.equal(manifest.scripts['core-api'], 'tsx scripts/sync-api/main.ts');
  assert.equal(manifest.scripts['sync-api'], 'tsx scripts/sync-api/sync-api-alias.ts');
});

test('the alias holds no CLI code of its own: it imports the notice and then main, and nothing else', () => {
  const alias = readFileSync(resolve(repoRoot, 'scripts/sync-api/sync-api-alias.ts'), 'utf8');
  const code = alias.replaceAll(/\/\*[\s\S]*?\*\//g, '').trim();

  assert.equal(code, "import './sync-api-alias-notice.js';\nimport './main.js';");
});

test('resolveCoreUrl: new name, old name, equal pair, conflict, and neither', () => {
  const warnings: string[] = [];
  const warn = (message: string): void => void warnings.push(message);

  assert.equal(resolveCoreUrl({ env: { CORE_URL: 'https://a.test' }, warn }), 'https://a.test');
  assert.deepEqual(warnings, [], 'the new name is quiet');

  assert.equal(resolveCoreUrl({ env: { SYNC_SERVER_URL: 'https://b.test' }, warn }), 'https://b.test');
  assert.deepEqual(warnings, [WARNING], 'the old name warns once');

  assert.equal(
    resolveCoreUrl({ env: { CORE_URL: 'https://c.test/', SYNC_SERVER_URL: 'https://c.test' }, warn }),
    'https://c.test/',
  );
  assert.equal(warnings.length, 1, 'an equal pair adds no warning');

  const conflictWarnings: string[] = [];
  assert.equal(
    resolveCoreUrl({
      env: { CORE_URL: 'https://a.test', SYNC_SERVER_URL: 'https://b.test' },
      warn: (message) => conflictWarnings.push(message),
    }),
    'https://b.test',
    'the old name wins on a conflict',
  );
  assert.deepEqual(conflictWarnings, [
    coreUrlConflictWarning({ current: 'https://a.test', deprecated: 'https://b.test' }),
  ]);

  assert.equal(resolveCoreUrl({ env: {}, warn }), undefined);
  assert.equal(resolveCoreUrl({ env: { CORE_URL: '', SYNC_SERVER_URL: '  ' }, warn }), undefined);
  assert.equal(warnings.length, 1, 'neither adds no warning');
});
