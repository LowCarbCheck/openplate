/**
 * `core-api accounts set-capabilities`, and the capability record in the
 * account views.
 *
 * THREE FACTS, THREE SPELLINGS. A list is a record that grants those labels,
 * `none` is a record that grants nothing (`[]`), and `unset` takes the record
 * away (`null`). The decoder keeps the same three apart, and an older instance
 * that sends no key reads as `null`, never as `[]`: an invented empty list would
 * say "this account may use nothing" about a record nobody wrote.
 *
 * THE CONTROLS ARE THE VALID FORMS. A refusal is only proof when the listener
 * would have answered, so each refusal sits beside a valid call that IS sent.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { asArray, asObject, type JsonObject } from '../../src/lib/json.js';
import { decodeAccountPage, decodeSingleAccount, formatAccountDetail } from '../../scripts/sync-api/views.js';
import { runCli, startCountingServer, type CountingServer } from './sync-api-cli-harness.js';

const ADMIN_TOKEN = 'sync-api-test-admin-token-0123456789';

/** An account body as `GET /v1/admin/accounts/:id` sends it, with no capabilities key at all. */
function accountWithoutCapabilities(id: number): JsonObject {
  return {
    id,
    email: `person-${id}@example.org`,
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    trialScans: null,
    suspendedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    blob: null,
    keyRecordKinds: [],
  };
}

test('a capability list decodes as the list, and the detail prints it', () => {
  const account = decodeSingleAccount({
    account: { ...accountWithoutCapabilities(1), capabilities: ['recipes', 'scan'] },
  });
  assert.deepEqual(account.capabilities, ['recipes', 'scan']);
  assert.match(formatAccountDetail(account), /^capabilities {4}recipes, scan$/m);
});

test('an empty list decodes as an empty list, and prints none', () => {
  const account = decodeSingleAccount({ account: { ...accountWithoutCapabilities(2), capabilities: [] } });
  assert.deepEqual(account.capabilities, []);
  assert.match(formatAccountDetail(account), /^capabilities {4}none$/m);
});

test('null decodes as no record, and prints that the instance default decides', () => {
  const account = decodeSingleAccount({ account: { ...accountWithoutCapabilities(3), capabilities: null } });
  assert.equal(account.capabilities, null);
  assert.match(formatAccountDetail(account), /^capabilities {4}not set \(the instance default decides\)$/m);
});

test('an older instance with no capabilities key decodes as no record, not as an empty list', () => {
  const account = decodeSingleAccount({ account: accountWithoutCapabilities(4) });
  assert.equal(account.capabilities, null);
});

test('the list output carries the field for every account, in the --json shape', () => {
  const page = decodeAccountPage({
    accounts: [
      { ...accountWithoutCapabilities(5), capabilities: ['scan'] },
      { ...accountWithoutCapabilities(6), capabilities: [] },
      accountWithoutCapabilities(7),
    ],
    total: 3,
  });
  const printed = asObject(JSON.parse(JSON.stringify(page, null, 2)));
  const accounts = asArray(printed?.accounts) ?? [];
  assert.deepEqual(
    accounts.map((account) => asObject(account)?.capabilities),
    [['scan'], [], null],
  );
});

let server: CountingServer;

before(async () => {
  server = await startCountingServer();
});

after(async () => {
  await server.close();
});

test('set-capabilities sends a sorted list, [] for none and null for unset', async () => {
  const requestsBefore = server.requests.length;
  for (const value of ['scan,recipes', 'scan, recipes,scan', 'none', 'unset']) {
    await runCli({
      args: ['accounts', 'set-capabilities', '7', value, '--url', server.baseUrl],
      adminToken: ADMIN_TOKEN,
    });
  }

  assert.deepEqual(server.requests.slice(requestsBefore), Array(4).fill('PATCH /v1/admin/accounts/7'));
  // The counting server answers `{}`, so every call exits non-zero AFTER sending: the body is the subject.
  assert.deepEqual(
    server.bodies.slice(requestsBefore).map((body) => JSON.parse(body)),
    [
      { capabilities: ['recipes', 'scan'] },
      { capabilities: ['recipes', 'scan'] },
      { capabilities: [] },
      { capabilities: null },
    ],
  );
});

test('set-capabilities refuses an invalid list, names the rule, and sends nothing', async () => {
  const requestsBefore = server.requests.length;
  const refusals: [string, RegExp][] = [
    ['Scan', /lower case/],
    ['scan,9lives', /lower case/],
    ['scan,,recipes', /lower case/],
    ['scan_x', /lower case/],
    ['x'.repeat(33), /lower case/],
    ['scan,none', /reserved/],
    [Array.from({ length: 33 }, (_, index) => `label${index}`).join(','), /at most 32/],
    ['', /needs a list/],
    ['  ', /needs a list/],
  ];
  for (const [value, reason] of refusals) {
    const refused = await runCli({
      args: ['accounts', 'set-capabilities', '7', value, '--url', server.baseUrl],
      adminToken: ADMIN_TOKEN,
    });
    assert.notEqual(refused.exitCode, 0, `"${value}" must be refused`);
    assert.match(refused.stderr, reason, `stderr for "${value}" must say why, saw: ${refused.stderr}`);
  }
  const missing = await runCli({
    args: ['accounts', 'set-capabilities', '7', '--url', server.baseUrl],
    adminToken: ADMIN_TOKEN,
  });
  assert.notEqual(missing.exitCode, 0);

  assert.equal(server.requests.length, requestsBefore, 'no refused list may reach the network');

  // THE CONTROL: a valid list IS sent, so the refusals above are not vacuous.
  await runCli({
    args: ['accounts', 'set-capabilities', '7', 'scan', '--url', server.baseUrl],
    adminToken: ADMIN_TOKEN,
  });
  assert.deepEqual(server.requests.slice(requestsBefore), ['PATCH /v1/admin/accounts/7']);
});
