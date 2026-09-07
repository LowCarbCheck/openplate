/**
 * THE COPY AND THE CAPABILITY, TIED TOGETHER (M201 spec 06).
 *
 * ── The defect ──────────────────────────────────────────────────────────
 *
 * M196 wrote the managed instance's privacy copy by hand. Spec 04 then put two
 * new facts on the operator's screen, `lastSeenAt` and ninety days of daily
 * photo counts, and every sentence in the app about what an operator can see
 * stayed exactly as it was. Nothing could notice, because a paragraph and an
 * endpoint have nothing in common that a compiler or a test can compare.
 *
 * This file makes them share one thing: `accountViewSchema`, the client's
 * transcription of what the admin endpoint exposes. Every field it names has
 * to be answered in `OPERATOR_VISIBILITY`, either with the copy key that
 * discloses it or with a written reason for having no line, and every key that
 * table names has to exist in the shipped catalog and reach the screen.
 *
 * ── WHAT THIS CANNOT CHECK ──────────────────────────────────────────────
 *
 * Written down here rather than implied, as M199 spec 01 required of its own
 * guard. In each case the check below is still worth having, and in each case
 * a person is the only one who can do the rest.
 *
 *  1. WHETHER THE PARAGRAPH IS HONEST. A field is named or it is not. Whether
 *     "When you last signed in, or last had a photo read" describes
 *     `lastSeenAt` fairly, rather than merely mentioning it, is a reading and
 *     not a match. A line that said "the colour of your account" would pass
 *     every assertion in this file.
 *  2. WHETHER THE WIRE TRANSCRIPTION IS CURRENT. `accountViewSchema` is this
 *     repository's copy of another repository's response. A field the service
 *     adds and this client never transcribes is invisible here, exactly as it
 *     is invisible to the console. `PROTOCOL.md` §5.20 is the source and a
 *     person reads it.
 *  3. THE OTHER ENDPOINT. `accountActivitySchema` carries the day-by-day
 *     strip, and it is disclosed by one sentence rather than field by field,
 *     because its fields are a window and a list of counts rather than facts
 *     about a person. Adding a field THERE does not fail this file.
 *  4. THE RETENTION NUMBER. `USAGE_COUNTER_RETENTION_DAYS` is transcribed from
 *     `PROTOCOL.md` §5.20 and nothing reads it back off the instance this
 *     build talks to. A server that pruned at a different period would leave
 *     this copy stating the protocol's number rather than that server's.
 *  5. THE GERMAN. Parity of keys is `i18n-key-parity.test.ts`'s job; whether
 *     the German says the same thing, in the app's du and the legal page's
 *     Sie, is wordsmith's and a reader's.
 *
 * ── Why a fixture ───────────────────────────────────────────────────────
 *
 * "Adding a field without a line fails the gate" is a claim about this file,
 * so this file proves it: `unansweredAdminFields` is a pure function over a
 * field list, and one test hands it the real table together with a schema that
 * has one field more than the real one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import { accountViewSchema } from '../../app/lib/admin/admin-wire';
import {
  ADMIN_ACCOUNT_FIELDS,
  OPERATOR_VISIBILITY,
  OPERATOR_VISIBLE_LINES,
  USAGE_COUNTER_RETENTION_DAYS,
  fieldsOfSchema,
  unansweredAdminFields,
} from '../../app/lib/admin/operator-visibility';
import { OperatorVisibilityCard } from '../../app/components/operator-visibility-card';
import enCommon from '../../app/i18n/locales/en/common.json';

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/**
 * The shipped catalog, PARSED and flattened, exactly as `managed-copy-bans.test.ts`
 * does it. A dotted key that no longer exists is `undefined` here and fails,
 * rather than rendering as itself on a screen.
 */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));
const leafSchema = z.string();

function flatten(catalog: Catalog, prefix = ''): Map<string, string> {
  const found = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const leaf = leafSchema.safeParse(value);
    if (leaf.success) {
      found.set(path, leaf.data);
      continue;
    }
    for (const [nested, text] of flatten(catalogSchema.parse(value), path)) found.set(nested, text);
  }
  return found;
}

const EN = flatten(catalogSchema.parse(enCommon));

function englishString(key: string): string {
  const text = EN.get(key);
  assert.ok(text !== undefined, `${key} is named in the copy table and is not in en/common.json`);
  return text;
}

describe('every field the admin account view exposes is named in the copy', () => {
  it('answers all of them, with no field left over on either side', () => {
    assert.deepEqual(
      unansweredAdminFields({ fields: ADMIN_ACCOUNT_FIELDS, visibility: OPERATOR_VISIBILITY }),
      [],
      'each field of accountViewSchema is either disclosed by a line or carries a written reason',
    );
  });

  // NON-VACUITY, the same guard `managed-copy-bans.test.ts` carries: every
  // assertion above passes on an empty schema, and an empty schema is what a
  // renamed export or a changed zod shape API would produce.
  it('is checking a real, populated set of fields', () => {
    assert.ok(ADMIN_ACCOUNT_FIELDS.length >= 9, `only ${ADMIN_ACCOUNT_FIELDS.length} admin fields were found`);
    assert.ok(ADMIN_ACCOUNT_FIELDS.includes('lastSeenAt'), 'the field M201 spec 04 added must be in the set');
    assert.ok(OPERATOR_VISIBLE_LINES.length >= 8, 'the card must draw a line per disclosed field');
  });

  it('names a shipped English string for every line, and the line reaches the card', () => {
    const html = renderToStaticMarkup(withI18n(createElement(OperatorVisibilityCard)));
    for (const line of OPERATOR_VISIBLE_LINES) {
      const text = englishString(line.copyKey);
      assert.ok(html.includes(text), `${line.copyKey} is in the table and not on the screen`);
    }
  });
});

describe('a field added to the admin view with no line fails, proven against a fixture', () => {
  // The real schema plus one field, which is exactly what spec 04 did to it
  // when it added `lastSeenAt`. Nothing else about the check changes.
  const fixtureSchema = accountViewSchema.extend({ bodyMassIndex: z.number() });

  it('reports the unnamed field', () => {
    const missing = unansweredAdminFields({
      fields: fieldsOfSchema(fixtureSchema),
      visibility: OPERATOR_VISIBILITY,
    });
    assert.deepEqual(missing, ['exposed, no line: bodyMassIndex']);
  });

  it('reports a line that describes a field the view does not expose', () => {
    const stale = unansweredAdminFields({
      fields: ADMIN_ACCOUNT_FIELDS,
      visibility: { ...OPERATOR_VISIBILITY, weightKg: { copyKey: 'account.operatorSees.weightKg' } },
    });
    assert.deepEqual(stale, ['named in the copy, not exposed: weightKg']);
  });
});

describe('the card says the two things a field list cannot say', () => {
  const html = renderToStaticMarkup(withI18n(createElement(OperatorVisibilityCard)));

  it('names the day-by-day counts and that older ones are deleted', () => {
    // The number is INTERPOLATED, so a `{{days}}` reaching a screen is a
    // failure here rather than a thing a person notices in production.
    assert.doesNotMatch(html, /\{\{days\}\}/);
    assert.ok(html.includes(`${USAGE_COUNTER_RETENTION_DAYS} days`), 'the window is named');
    assert.match(html, /deleted/);
  });

  it('says the diary itself cannot be read there', () => {
    assert.match(html, /encrypted/);
    assert.match(html, /diary/i);
  });

  it('is not the same sentence the operator is shown, which states the same fact from the other side', () => {
    // `admin.person.noDiary` is the operator-facing half. Two audiences, two
    // registers; sharing the string would put "this person" in front of the
    // person it is about.
    assert.notEqual(englishString('account.operatorSees.notTheDiary'), englishString('admin.person.noDiary'));
  });
});

describe('the statement is gated on the policy question and not on the mode', () => {
  it('renders only where an operator can see activity', () => {
    // SOURCE, not a render: the route module pulls in the local store and the
    // whole session machinery, and the branch under test is one expression.
    // The same trade `managed-instance-copy.test.ts` documents.
    const source = readFileSync(
      fileURLToPath(new URL('../../app/routes/settings.account.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(source, /operatorSeesActivity && <OperatorVisibilityCard \/>/);
    assert.match(source, /const \{ aiComesFromTheInstance, operatorSeesActivity \} = useInstancePolicy\(\)/);
  });
});
