/**
 * A MEMBER INVITES SOMEBODY, and the two facts that decide whether the card
 * exists (M212 spec 04).
 *
 * ── Why the wire shapes are transcribed here ─────────────────────────────
 *
 * The workspace rule that this file exists under: a green gate once shipped
 * accounts nobody could open, because nothing in this repository had read the
 * normative document and written down what the service actually sends. So the
 * literals below come from `openplate-core/PROTOCOL.md` §5.6, §5.15 and §5.21,
 * read on 2026-09-09, and NOT from the other repository's source, which this
 * one must not import. If the two disagree, this file is what fails.
 *
 * The three properties that matter, and each one is a decision somebody could
 * get wrong in a way nothing else would catch:
 *
 *  1. `invitesLeft: null` IS NOT ZERO. `null` is an administrator, exempt from
 *     the cap, and an instance with no such route. `0` is somebody who had
 *     five and spent them. Folding them together either hides the card from a
 *     person who should see it, or shows an administrator a spent allowance
 *     that never existed.
 *  2. BOTH GATES, not either. The instance says the route exists; the account
 *     says the cap is about it. `memberInvites: false` means the path answers
 *     the ordinary unknown-path 404 to everybody, so a card there is a button
 *     that cannot work.
 *  3. ONE ANSWER, WHATEVER IS TRUE. The service answers one fixed `202` with
 *     an empty body for a new address, for one that already holds an
 *     invitation and for one that already holds an account. A client that
 *     branched on it would hand every account an oracle for who else is here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canSendMemberInvites } from '../../app/lib/sync/member-invites';
import { accountViewSchema } from '../../app/lib/admin/admin-wire';
import { readHandshakeInstance, type JsonObject } from '../../app/lib/sync/engine/protocol';
import type { AccountViewWire } from '../../app/lib/sync/engine/client/auth-wire';

function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
}

/**
 * `AccountView`, transcribed from `PROTOCOL.md` §5.15's example body.
 *
 * TYPED AS THE CLIENT'S OWN WIRE INTERFACE, so a field the client drops or
 * renames is a compile error here rather than a screen that renders nothing.
 */
const PROTOCOL_ACCOUNT_VIEW: AccountViewWire = {
  id: 1,
  email: 'anna@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 3,
  allowanceExpiresAt: null,
  suspendedAt: null,
  invitesLeft: 5,
  createdAt: '2026-09-04T10:11:12.000Z',
};

/** The instance block of `/health`, transcribed from `PROTOCOL.md` §5.6's example body. */
const PROTOCOL_INSTANCE: JsonObject = {
  name: 'openplate',
  language: 'de',
  mail: true,
  ai: { model: 'google/gemini-3.7-flash' },
};

/** One `/health` body around a given instance block. */
function health(instance: JsonObject): JsonObject {
  return { protocolVersion: 2, envelopeVersion: 1, serviceVersion: '0.6.0', instance };
}

describe('the account view carries both new fields, as the protocol describes them', () => {
  it('accepts the exact body PROTOCOL.md §5.15 prints', () => {
    // The ADMIN decoder, which is the only one in this client that parses
    // rather than casts, so it is the one that can be asked.
    const parsed = accountViewSchema.parse({ ...PROTOCOL_ACCOUNT_VIEW, lastSeenAt: null });
    assert.equal(parsed.allowanceExpiresAt, null);
    assert.equal(parsed.invitesLeft, 5);
  });

  it('reads an ISO instant as the end date and a number as the count', () => {
    const parsed = accountViewSchema.parse({
      ...PROTOCOL_ACCOUNT_VIEW,
      allowanceExpiresAt: '2026-10-09T00:00:00.000Z',
      invitesLeft: 0,
      lastSeenAt: null,
    });
    assert.equal(parsed.allowanceExpiresAt, '2026-10-09T00:00:00.000Z');
    assert.equal(parsed.invitesLeft, 0, 'zero is a real answer, never a missing one');
  });

  it("keeps an administrator's null rather than turning it into a spent allowance", () => {
    const parsed = accountViewSchema.parse({ ...PROTOCOL_ACCOUNT_VIEW, invitesLeft: null, lastSeenAt: null });
    assert.equal(parsed.invitesLeft, null);
  });

  it('degrades a service older than the fields to null instead of failing the whole view', () => {
    // A deployment built before M212 sends neither key. `null` already means
    // "no end date" and "the cap is not about you", so degrading states a fact
    // rather than inventing one, and the console keeps working.
    //
    // WRITTEN OUT RATHER THAN DELETED FROM THE FIXTURE ABOVE, so the body is
    // readable as the body an older service actually sends.
    const older = {
      id: 1,
      email: 'anna@example.org',
      displayName: null,
      role: 'member',
      dailyAiLimit: 200,
      aiUsedToday: 3,
      suspendedAt: null,
      createdAt: '2026-09-04T10:11:12.000Z',
      lastSeenAt: null,
    };
    const parsed = accountViewSchema.parse(older);
    assert.equal(parsed.allowanceExpiresAt, null);
    assert.equal(parsed.invitesLeft, null);
  });

  it('still fails on a field whose absence would render as a wrong number, which is the control', () => {
    // The tolerance above is scoped, not a new house style: a missing
    // `aiUsedToday` renders "undefined of 200" and reads as "nobody scanned
    // today", so it must still fail at the boundary.
    const broken = {
      id: 1,
      email: 'anna@example.org',
      displayName: null,
      role: 'member',
      dailyAiLimit: 200,
      allowanceExpiresAt: null,
      suspendedAt: null,
      invitesLeft: 5,
      createdAt: '2026-09-04T10:11:12.000Z',
      lastSeenAt: null,
    };
    assert.equal(accountViewSchema.safeParse(broken).success, false);
  });
});

describe('the handshake carries memberInvites, decoded as PROTOCOL.md §5.6 describes it', () => {

  it('reads true when the instance says an ordinary account may invite people', () => {
    const descriptor = readHandshakeInstance(health({ ...PROTOCOL_INSTANCE, memberInvites: true }));
    assert.equal(descriptor?.memberInvites, true);
  });

  it('reads false for a service older than the field, and keeps the rest of the descriptor', () => {
    // The compatibility rule this whole block is optional for: a service built
    // before the field sends no key, and a decoder that required one would
    // refuse to talk to it and would take the AI model down with it.
    const descriptor = readHandshakeInstance(health(PROTOCOL_INSTANCE));
    assert.equal(descriptor?.memberInvites, false);
    assert.equal(descriptor?.ai?.model, 'google/gemini-3.7-flash', 'the model survived the missing key');
  });

  it('reads a nonsense value as false rather than dropping the whole instance block', () => {
    const descriptor = readHandshakeInstance(health({ ...PROTOCOL_INSTANCE, memberInvites: 'yes' }));
    assert.equal(descriptor?.memberInvites, false);
    assert.equal(descriptor?.name, 'openplate');
  });
});

describe('the invite card renders on both facts and neither one alone', () => {
  // ALL FOUR COMBINATIONS, because each wrong answer is a different defect: a
  // button that 404s, a card an administrator cannot use, and a person with
  // five invitations who is never told they have any.
  const CASES = [
    { memberInvites: true, invitesLeft: 5, expected: true, why: 'the ordinary case' },
    { memberInvites: true, invitesLeft: 0, expected: true, why: 'spent, and owed the sentence that says so' },
    { memberInvites: true, invitesLeft: null, expected: false, why: 'an administrator, exempt from the cap' },
    { memberInvites: false, invitesLeft: 5, expected: false, why: 'the route does not exist on this instance' },
    { memberInvites: false, invitesLeft: null, expected: false, why: "an organization's instance" },
  ] as const;

  for (const { memberInvites, invitesLeft, expected, why } of CASES) {
    it(`${expected ? 'draws' : 'draws nothing'} for memberInvites=${String(memberInvites)} invitesLeft=${String(invitesLeft)}: ${why}`, () => {
      assert.equal(canSendMemberInvites({ memberInvites, invitesLeft }), expected);
    });
  }

  it('is a rule that decides something, which is the control on the five above', () => {
    // A function that answered `true` always, or `false` always, would pass
    // some of the cases above and none of the product.
    const answers = new Set(CASES.map(({ memberInvites, invitesLeft }) => canSendMemberInvites({ memberInvites, invitesLeft })));
    assert.deepEqual([...answers].toSorted(), [false, true]);
  });
});

describe('the client asks for one invitation and learns nothing from the answer', () => {
  const AUTH_CLIENT = readSource('app/lib/sync/engine/client/auth-client.ts');
  const ACTIONS = readSource('app/lib/sync/sync-actions.ts');
  const ROUTE = readSource('app/routes/settings.account.tsx');

  it('posts the address, and only the address, to the path §5.21 names', () => {
    assert.match(AUTH_CLIENT, /path: `\$\{AUTH_API_PREFIX\}\/invites`/);
    assert.match(AUTH_CLIENT, /const request: MemberInviteRequestWire = \{ email: input\.email \}/);
    // The three fields the ADMIN mint takes are not sent here: the terms are
    // the instance's, never the caller's.
    const method = AUTH_CLIENT.split('createMemberInvite')[1]?.slice(0, 600) ?? '';
    for (const operatorField of ['dailyAiLimit', 'role', 'expiresInDays']) {
      assert.ok(!method.includes(operatorField), `a member must not choose ${operatorField}`);
    }
  });

  it('returns nothing, so no caller can branch on what was true about the address', () => {
    assert.match(AUTH_CLIENT, /async createMemberInvite\(input: \{ email: string \}\): Promise<void>/);
    assert.match(ACTIONS, /export async function sendMemberInvite\(\{ email \}: \{ email: string \}\): Promise<void>/);
  });

  it('shows one neutral sentence, and the same one for a refusal', () => {
    // The cap and the re-invite rule are enforced by the service and a refusal
    // is not a fact about the address, so both land on the same sentence.
    assert.match(ROUTE, /setMessage\(\{ kind: 'ok', text: t\('account\.invites\.sent'\) \}\)/);
    assert.match(ROUTE, /setMessage\(\{ kind: 'error', text: t\('account\.invites\.failed'\) \}\)/);
    assert.ok(!ROUTE.includes('describeErrorForUser(caught, t(\'account.invites'), 'a reason would be the oracle');
  });

  it('re-reads the account afterwards, because the count moved on the server', () => {
    // The LAST occurrence, which is the call: the first is the import.
    const chunks = ROUTE.split('sendMemberInvite');
    const submit = chunks[chunks.length - 1] ?? '';
    assert.match(submit, /refreshSyncAccount\(\)/);
  });
});
