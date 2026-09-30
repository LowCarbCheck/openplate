/**
 * The operator's label on an account, against a real Postgres and the
 * committed migrations.
 *
 * THREE THINGS HERE CANNOT BE PROVEN WITH THE UNIT FAKES:
 *
 * 1. **The write reaches the row and the reads come off it.** The unit tier
 *    writes into one fake and reads out of another; only the real pair shows
 *    that `PATCH` and `GET` meet in the same column.
 * 2. **The account itself is not shown its label.** `GET /v1/auth/account` is
 *    built from a different record, and only the real row can prove that a
 *    label stored there never reaches it.
 * 3. **The check constraint is the second wall.** A tool that writes the column
 *    around the route (the account move tool does) meets the same bound, and
 *    an empty string is refused, which is a property of the migration.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { accounts } from '../../src/db/schema.js';
import { sqlstate } from '../../src/lib/storage-conflict.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type ServiceHarness } from './service-harness.js';

const ADMIN_TOKEN = 'integration-admin-token-for-labels-0123456789';
/** Postgres SQLSTATE for a violated CHECK constraint. */
const CHECK_VIOLATION = '23514';
const LABEL = 'Beta supporter';

interface LabelledAccountBody {
  account: { id: number; label: string | null };
}

/** The account's own view, read only for its id; the test looks for a `label` key it must not have. */
interface OwnAccountBody {
  account: { id: number };
}

interface LabelledAccountListBody {
  accounts: { id: number; label: string | null }[];
  total: number;
}

let database: TestDatabase;
let service: ServiceHarness;

before(async () => {
  database = await setupTestDatabase();
  service = await startService({ db: database.db, adminToken: ADMIN_TOKEN });
});

after(async () => {
  await service.close();
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

/** A member account, signed up through the real invite path. */
async function signUpMember(email: string): Promise<{ accountId: number; accessToken: string }> {
  const session = await service.signupThroughInvite({ email, role: 'member' });
  return { accountId: session.account.id, accessToken: session.tokens.accessToken };
}

/** What the row holds, read straight out of Postgres. */
async function storedLabel(accountId: number): Promise<string | null> {
  const [row] = await database.db.select({ label: accounts.label }).from(accounts).where(eq(accounts.id, accountId));
  if (row === undefined) throw new Error(`account ${accountId} is gone`);
  return row.label;
}

async function patchLabel(input: { accountId: number; label: string | null }): Promise<number> {
  const patched = await service.request({
    method: 'PATCH',
    path: `/v1/admin/accounts/${input.accountId}`,
    adminToken: ADMIN_TOKEN,
    body: { label: input.label },
  });
  return patched.status;
}

test('an operator sets a label, and the list and the detail read it back off the row', async () => {
  const { accountId } = await signUpMember('beta-one@example.org');
  const other = await signUpMember('plain@example.org');
  assert.equal(await storedLabel(accountId), null, 'a new account has no label');

  const patched = await service.request<LabelledAccountBody>({
    method: 'PATCH',
    path: `/v1/admin/accounts/${accountId}`,
    adminToken: ADMIN_TOKEN,
    body: { label: `  ${LABEL} ` },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.account.label, LABEL, 'the PATCH answer is read back, trimmed');
  assert.equal(await storedLabel(accountId), LABEL);

  const detail = await service.request<LabelledAccountBody>({
    method: 'GET',
    path: `/v1/admin/accounts/${accountId}`,
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.account.label, LABEL);

  const list = await service.request<LabelledAccountListBody>({
    method: 'GET',
    path: '/v1/admin/accounts',
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(list.status, 200);
  const labels = new Map(list.body.accounts.map((row) => [row.id, row.label]));
  assert.equal(labels.get(accountId), LABEL);
  // THE CONTROL: the other account's row is in the same list, with null.
  assert.ok(labels.has(other.accountId));
  assert.equal(labels.get(other.accountId), null);
});

test('null clears the label, and the row holds NULL rather than an empty string', async () => {
  const { accountId } = await signUpMember('beta-two@example.org');
  assert.equal(await patchLabel({ accountId, label: LABEL }), 200);
  assert.equal(await storedLabel(accountId), LABEL);

  assert.equal(await patchLabel({ accountId, label: null }), 200);
  assert.equal(await storedLabel(accountId), null);

  // A blank string clears it too.
  assert.equal(await patchLabel({ accountId, label: LABEL }), 200);
  assert.equal(await patchLabel({ accountId, label: '  ' }), 200);
  assert.equal(await storedLabel(accountId), null);
});

test('an over-long label is a 400 and the row keeps what it had, while 40 characters are stored', async () => {
  const { accountId } = await signUpMember('beta-three@example.org');
  assert.equal(await patchLabel({ accountId, label: LABEL }), 200);

  assert.equal(await patchLabel({ accountId, label: 'x'.repeat(41) }), 400);
  assert.equal(await storedLabel(accountId), LABEL);

  // THE CONTROL: the bound itself is accepted, so the refusal is the bound.
  assert.equal(await patchLabel({ accountId, label: 'x'.repeat(40) }), 200);
  assert.equal(await storedLabel(accountId), 'x'.repeat(40));
});

test("a member's own token reaches no admin route, and its own account view never carries its label", async () => {
  const member = await signUpMember('beta-four@example.org');
  const subject = await signUpMember('subject@example.org');
  assert.equal(await patchLabel({ accountId: member.accountId, label: LABEL }), 200);

  // Not another account's label, and not its own either: the admin tree
  // refuses a member's token as it refuses a garbage one.
  for (const path of [`/v1/admin/accounts/${subject.accountId}`, `/v1/admin/accounts/${member.accountId}`]) {
    const read = await service.request({ method: 'GET', path, accessToken: member.accessToken });
    assert.equal(read.status, 401, path);
    const write = await service.request({
      method: 'PATCH',
      path,
      accessToken: member.accessToken,
      body: { label: 'Self-promoted' },
    });
    assert.equal(write.status, 401, path);
  }
  assert.equal(await storedLabel(subject.accountId), null);
  assert.equal(await storedLabel(member.accountId), LABEL);

  // The account's own view is built from a record with no label on it.
  const own = await service.request<OwnAccountBody>({
    method: 'GET',
    path: '/v1/auth/account',
    accessToken: member.accessToken,
  });
  assert.equal(own.status, 200);
  assert.equal(own.body.account.id, member.accountId, 'the view is really this account');
  assert.ok(!('label' in own.body.account), 'no label key on the account view');
  assert.ok(!JSON.stringify(own.body).includes(LABEL), 'and no label value anywhere in it');

  // Nor can the owner write it through its own PATCH, which reads displayName only.
  const ownPatch = await service.request({
    method: 'PATCH',
    path: '/v1/auth/account',
    accessToken: member.accessToken,
    body: { displayName: 'Anna', label: 'Self-promoted' },
  });
  assert.equal(ownPatch.status, 200);
  assert.equal(await storedLabel(member.accountId), LABEL);
});

test('the check constraint refuses an empty and an over-long label written around the route', async () => {
  const { accountId } = await signUpMember('beta-five@example.org');

  for (const label of ['', 'y'.repeat(41)]) {
    await assert.rejects(
      database.pool.query('UPDATE accounts SET label = $1 WHERE id = $2', [label, accountId]),
      (error: Error) => sqlstate(error) === CHECK_VIOLATION,
      JSON.stringify(label),
    );
  }
  assert.equal(await storedLabel(accountId), null);

  // THE CONTROL: NULL, one character and forty all pass the same constraint.
  for (const label of [null, 'B', 'y'.repeat(40)]) {
    await database.pool.query('UPDATE accounts SET label = $1 WHERE id = $2', [label, accountId]);
    assert.equal(await storedLabel(accountId), label);
  }
});
