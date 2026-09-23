/**
 * The consent step: that it is a SEPARATE step, that it says what is actually
 * being sent, and that what was agreed to is recorded with the report rather
 * than left as a device-local flag.
 *
 * WHY A DIGEST PIN. `FEEDBACK_CONSENT_WORDING_VERSION` is stored on every
 * report row on the server, and it is the only thing that lets somebody
 * holding a two-year-old photograph find out what the person was shown before
 * they agreed. A version that does not move when the wording moves is worse
 * than no version at all: it names copy that never existed. So the English
 * consent strings are hashed here and pinned. Edit the copy without bumping
 * the version and this fails, which is the point.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import enCommon from '../../app/i18n/locales/en/common.json';
import deCommon from '../../app/i18n/locales/de/common.json';
import {
  FEEDBACK_CONSENT_WORDING_VERSION,
  feedbackConsentCopyKeys,
  feedbackConsentLines,
  feedbackConsentRecordSchema,
  recordFeedbackConsent,
} from '../../app/lib/feedback/feedback-consent';

const REPORT_COMPONENT = fileURLToPath(new URL('../../app/components/report-estimate.tsx', import.meta.url));
const CONSENT_MODULE = fileURLToPath(new URL('../../app/lib/feedback/feedback-consent.ts', import.meta.url));

/**
 * A window no constant in this repository has ever held.
 *
 * DELIBERATELY NOT 30. The number in the consent step is the
 * one the SYNC SERVER advertised on its `/health` handshake, and this app is
 * not entitled to one of its own. A test that fed 30 in would keep passing on
 * the day somebody restored a local default, because the copy would read the
 * same either way; 47 fails loudly.
 */
const ADVERTISED_DAYS = 47;

/**
 * A translation catalog, parsed rather than asserted, exactly as
 * `i18n-key-parity.test.ts` does it: a stray non-string leaf then fails loudly
 * here instead of being silently skipped by a shape check.
 */
type Catalog = { [key: string]: string | Catalog };

const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

/**
 * A catalog reduced to dotted key paths, e.g. `entry.report.consent.agree`.
 *
 * A named contract rather than a bare `Record<string, string>`: what matters
 * is that every bundle compared here is
 * the same KIND of thing, and naming it says so.
 */
interface FlatBundle {
  [path: string]: string;
}

function flatten(catalog: Catalog, prefix = ''): FlatBundle {
  const flat: FlatBundle = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const leaf = z.string().safeParse(value);
    if (leaf.success) flat[path] = leaf.data;
    else Object.assign(flat, flatten(catalogSchema.parse(value), path));
  }
  return flat;
}

const EN_COMMON = flatten(catalogSchema.parse(enCommon));
const DE_COMMON = flatten(catalogSchema.parse(deCommon));

function lookup(bundle: FlatBundle, path: string): string {
  const value = bundle[path];
  assert.ok(value !== undefined, `${path} is missing`);
  return value;
}

/** A `t` that reads a real shipped bundle and interpolates, so the assertions are about the SHIPPED copy. */
function translateWith(bundle: FlatBundle) {
  return (key: string, params: Readonly<Record<string, string | number>> = {}): string =>
    Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      lookup(bundle, key),
    );
}

const t = translateWith(EN_COMMON);

describe('the consent wording version is pinned to the wording', () => {
  it('matches the digest of the English consent strings', () => {
    const keys = feedbackConsentCopyKeys({ hasPhoto: true });
    const alternates = feedbackConsentCopyKeys({ hasPhoto: false });
    const uniqueKeys = new Set([...Object.values(keys), ...Object.values(alternates)]);
    const strings = [...uniqueKeys]
      .toSorted()
      .map((key) => `${key}=${lookup(EN_COMMON, key)}`)
      .join('\n');
    const digest = createHash('sha256').update(strings).digest('hex').slice(0, 16);

    assert.equal(
      digest,
      'a827a4293f4aa69e',
      `The consent copy changed. Bump FEEDBACK_CONSENT_WORDING_VERSION (currently ${FEEDBACK_CONSENT_WORDING_VERSION}) and put the new digest here.`,
    );
  });
});

describe('the consent step names what it has to name', () => {
  it('names who can see the photograph, how long it is kept, and that it is unencrypted', () => {
    const lines = feedbackConsentLines({ t, hasPhoto: true, retentionDays: ADVERTISED_DAYS });

    assert.equal(lines.points.length, 3);
    assert.match(lines.points[0] ?? '', /photo/i);
    assert.match(lines.points[0] ?? '', /administrator/i);
    assert.match(lines.points[1] ?? '', new RegExp(`${ADVERTISED_DAYS} days`));
    assert.match(lines.points[1] ?? '', /deleted/i);
    assert.match(lines.points[2] ?? '', /encrypted/i);
  });

  it('offers a plain way to decline', () => {
    const lines = feedbackConsentLines({ t, hasPhoto: true, retentionDays: ADVERTISED_DAYS });
    assert.match(lines.decline, /^No,/);
    assert.notEqual(lines.decline, lines.agree);
  });

  // The requirement stated literally: an entry added from search or typed by
  // hand has no photograph, and the step must not ask for consent to send one.
  it('does not ask about a photograph when the entry has none', () => {
    const lines = feedbackConsentLines({ t, hasPhoto: false, retentionDays: ADVERTISED_DAYS });

    assert.match(lines.points[0] ?? '', /no photo is sent/i);
    assert.doesNotMatch(lines.points[1] ?? '', /photo/i);
    assert.match(lines.points[1] ?? '', new RegExp(`${ADVERTISED_DAYS} days`));
  });

  it('imports the retention window rather than printing a number typed into the copy', () => {
    for (const bundle of [EN_COMMON, DE_COMMON]) {
      for (const key of ['entry.report.consent.retentionWithPhoto', 'entry.report.consent.retentionFiguresOnly']) {
        const value = lookup(bundle, key);
        assert.ok(value.includes('{{days}}'), `${key} must interpolate the constant`);
        assert.doesNotMatch(value, /\d/, `${key} must not carry a hardcoded number`);
      }
    }
  });

  it('renders in German too, with no placeholder left behind', () => {
    const lines = feedbackConsentLines({ t: translateWith(DE_COMMON), hasPhoto: true, retentionDays: ADVERTISED_DAYS });
    for (const point of lines.points) assert.doesNotMatch(point, /\{\{/);
    // The advertised number reached the German line. NOT `47 Tage`: wordsmith
    // owns the German and may write `47 Tagen`, or put the unit elsewhere in
    // the sentence. What must survive is that the interpolated window is the
    // one the server advertised.
    assert.ok((lines.points[1] ?? '').includes(String(ADVERTISED_DAYS)), 'the German line lost the advertised window');
    assert.doesNotMatch(lines.points[1] ?? '', /\b30\b/, 'the old default reappeared in the German line');
  });
});

describe('the consent record', () => {
  it('carries the instant and the version, and nothing device-local', () => {
    const nowMs = Date.parse('2026-09-07T09:30:00Z');
    const record = recordFeedbackConsent({ nowMs });

    assert.deepEqual(record, {
      agreedAt: '2026-09-07T09:30:00.000Z',
      wordingVersion: FEEDBACK_CONSENT_WORDING_VERSION,
    });
  });

  it('refuses a record with no wording version, so an unverifiable claim never reaches the wire', () => {
    assert.equal(feedbackConsentRecordSchema.safeParse({ agreedAt: '2026-09-07T09:30:00.000Z', wordingVersion: '' }).success, false);
    assert.equal(feedbackConsentRecordSchema.safeParse({ agreedAt: 'not-a-date', wordingVersion: 'v1' }).success, false);
    assert.equal(feedbackConsentRecordSchema.safeParse({ wordingVersion: 'v1' }).success, false);
  });
});

describe('the consent step is separate from the button', () => {
  const source = readFileSync(REPORT_COMPONENT, 'utf8');

  it('opens the step on the button, and queues nothing there', () => {
    assert.match(source, /onClick=\{\(\) => setIsOpen\(true\)\}/, 'the report button only opens the step');
    // One call site, and it is the agreeing action's handler. A second one
    // would be a path that sends without the step.
    assert.equal((source.match(/await enqueueFeedbackReport\(/g) ?? []).length, 1);
    const agreeHandler = source.slice(source.indexOf('const handleAgree'), source.indexOf('return ('));
    assert.match(agreeHandler, /await enqueueFeedbackReport\(/, 'the queue write belongs to the agreeing handler');
    assert.match(agreeHandler, /recordFeedbackConsent\(\)/, 'the record is minted at the moment of agreement');
  });

  it('offers the decline as a first-class control, not a dismissal', () => {
    assert.match(source, /<AlertDialogCancel>\{consent\.decline\}<\/AlertDialogCancel>/);
  });
});

describe('the window is the server\'s promise, never this app\'s', () => {
  it('keeps no retention constant of its own', () => {
    const source = readFileSync(CONSENT_MODULE, 'utf8');
    // The constant is gone, and the name survives only in the paragraph that
    // explains why. An `export const` of it is the defect returning.
    assert.doesNotMatch(source, /export const FEEDBACK_RETENTION_DAYS/);
    assert.doesNotMatch(source, /retentionDays\s*=\s*\d/, 'a default window here is a promise nobody made');
  });

  it('offers no report at all when the server has advertised no window', () => {
    const source = readFileSync(REPORT_COMPONENT, 'utf8');
    assert.match(source, /const retentionDays = useFeedbackRetentionDays\(\);/);
    assert.match(
      source,
      /if \(retentionDays === null\) return null;/,
      'a build that does not know the window must not draw the button that asks for consent to it',
    );
    // And the step is fed the advertised number, not a fallback.
    assert.match(source, /feedbackConsentLines\(\{ t, hasPhoto, retentionDays \}\)/);
    assert.doesNotMatch(source, /retentionDays \?\?/, 'a ?? default here would restore the invented promise');
  });
});
