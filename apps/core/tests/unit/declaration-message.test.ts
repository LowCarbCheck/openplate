/**
 * The two declaration letters (M246/04): the neutral fallback this public
 * repo keeps, and the fill of a template from the mounted content folder.
 *
 * The templates here are neutral markers built inline; the real text lives in
 * a private repo. The fallback's exact lines ARE pinned: they are code-owned
 * labels copied from the app's confirmation page, not wordsmith-owned prose.
 * The two receipt sentences M270/11 added (the value of a field the receipt
 * does not repeat, and the closing line for a person who did not send the
 * form) are wordsmith-owned, so they are read from `RECEIPT_WITHHELD` and
 * `RECEIPT_NOT_YOU` rather than typed here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDeclarationOperatorAlertMessage,
  buildDeclarationReceiptMessage,
  DECLARATION_TEMPLATE_PLACEHOLDERS,
  detailLines,
  RECEIPT_NOT_YOU,
  RECEIPT_WITHHELD,
  receiptTemplateLanguages,
  type DeclarationFields,
  type DeclarationKind,
  type DeclarationLanguage,
  type DeclarationReceiptInput,
  type DeclarationTemplateName,
  type FoundMailTemplate,
} from '../../src/mail/declaration-message.js';
import { parseMailTemplate } from '../../src/mail/mail-template.js';
import { INSTANCE_LANGUAGES } from '../../src/protocol.js';

const RECEIVED_AT = new Date('2026-09-21T10:15:00.000Z');

function baseFields(overrides: Partial<DeclarationFields> = {}): DeclarationFields {
  return {
    kind: 'kuendigung',
    name: 'Anna Beispiel',
    email: 'anna@example.org',
    contractReference: 'K-1234',
    terminationType: 'ordentlich',
    reason: null,
    requestedDate: null,
    timing: 'earliest',
    receivedAt: RECEIVED_AT,
    ...overrides,
  };
}

/**
 * What the route hands the receipt builder for {@link baseFields}: the same
 * declaration with every field the sender wrote reduced to whether it was
 * given (M270/11). Written out rather than derived, so a test of the builder
 * does not lean on the function that derives it.
 */
function baseReceipt(overrides: Partial<DeclarationReceiptInput> = {}): DeclarationReceiptInput {
  return {
    kind: 'kuendigung',
    email: 'anna@example.org',
    hasContractReference: true,
    terminationType: 'ordentlich',
    hasReason: false,
    requestedDate: null,
    timing: 'earliest',
    receivedAt: RECEIVED_AT,
    receiptId: 'r',
    language: 'en',
    ...overrides,
  };
}

function foundTemplate(input: {
  name: DeclarationTemplateName;
  language: 'de' | 'en';
  subject: string;
  body: string;
}): FoundMailTemplate {
  const source = [
    '---',
    'title: Fixture',
    'updated: 2026-09-23',
    `subject: ${input.subject}`,
    '---',
    '',
    input.body,
    '',
  ].join('\n');
  return {
    template: parseMailTemplate({ source, placeholders: DECLARATION_TEMPLATE_PLACEHOLDERS[input.name] }),
    language: input.language,
  };
}

const BANNED_WORDS = ['Sync', 'sync', 'Gateway', 'gateway', 'AI connection', 'account link'];
const BANNED_DASHES = ['\u2014', '\u2013'];

test('with no template, the receipt is the neutral fallback: kind, receipt number, time, the fields it may repeat, and the line for a person who did not send it', () => {
  const withheldEn = RECEIPT_WITHHELD.en;
  const en = buildDeclarationReceiptMessage({ declaration: baseReceipt({ receiptId: 'r-1' }), template: null });
  assert.equal(en.origin, 'fallback');
  assert.equal(en.subject, 'Cancellation confirmed');
  assert.deepEqual(en.text.split('\n\n'), [
    'Type: Cancellation',
    'Receipt no.: r-1',
    'Received at: 21 September 2026 at 12:15 CEST',
    `Name: ${withheldEn}`,
    'Email: anna@example.org',
    `Contract or customer number: ${withheldEn}`,
    'Type of cancellation: regular notice',
    'Timing: as soon as legally possible',
    RECEIPT_NOT_YOU.en,
  ]);

  const de = buildDeclarationReceiptMessage({
    declaration: baseReceipt({
      kind: 'widerruf',
      terminationType: null,
      timing: null,
      receiptId: 'r-2',
      language: 'de',
    }),
    template: null,
  });
  assert.equal(de.subject, 'Widerruf bestätigt');
  assert.deepEqual(de.text.split('\n\n'), [
    'Art: Widerruf',
    'Beleg-Nr.: r-2',
    'Eingegangen am: 21. September 2026 um 12:15 MESZ',
    `Name: ${RECEIPT_WITHHELD.de}`,
    'E-Mail: anna@example.org',
    `Vertrags- oder Kundennummer: ${RECEIPT_WITHHELD.de}`,
    RECEIPT_NOT_YOU.de,
  ]);
});

test('the neutral receipt in fr, it, es and tr uses the confirmation page labels of that language', () => {
  // The app's `legal:declarations.confirmed.*` and the title of each
  // language's confirmation page, word for word, as for de and en above.
  const cases = [
    { language: 'fr', lines: ['Résiliation confirmée', 'Type : Résiliation', 'Récépissé n° : r-3', 'Reçu le : '] },
    { language: 'it', lines: ['Disdetta confermata', 'Tipo: Disdetta', 'Ricevuta n.: r-3', 'Ricevuto il: '] },
    { language: 'es', lines: ['Cancelación confirmada', 'Tipo: Cancelación', 'N.º de recibo: r-3', 'Recibido el: '] },
    { language: 'tr', lines: ['Fesih onaylandı', 'Tür: Fesih', 'Makbuz no.: r-3', 'Alınma zamanı: '] },
  ] as const;
  for (const {
    language,
    lines: [subject, kind, receipt, received],
  } of cases) {
    const message = buildDeclarationReceiptMessage({
      declaration: baseReceipt({ receiptId: 'r-3', language }),
      template: null,
    });
    const [kindLine, receiptLine, receivedLine] = message.text.split('\n\n');
    assert.equal(message.subject, subject);
    assert.equal(kindLine, kind);
    assert.equal(receiptLine, receipt);
    assert.ok(receivedLine?.startsWith(received), `${language}: ${receivedLine}`);
    assert.ok(receivedLine?.includes('2026'), `${language}: ${receivedLine}`);
  }
});

test('the receipt is looked up in the reader language, then German, then English, each once', () => {
  assert.deepEqual(receiptTemplateLanguages('fr'), ['fr', 'de', 'en']);
  assert.deepEqual(receiptTemplateLanguages('it'), ['it', 'de', 'en']);
  assert.deepEqual(receiptTemplateLanguages('es'), ['es', 'de', 'en']);
  assert.deepEqual(receiptTemplateLanguages('tr'), ['tr', 'de', 'en']);
  // CONTROL: German and English are not asked for twice.
  assert.deepEqual(receiptTemplateLanguages('de'), ['de', 'en']);
  assert.deepEqual(receiptTemplateLanguages('en'), ['en', 'de']);
});

test('an optional field the person left out produces no line at all, and one they gave is confirmed but not repeated', () => {
  const withReason = buildDeclarationReceiptMessage({ declaration: baseReceipt({ hasReason: true }), template: null });
  const withoutReason = buildDeclarationReceiptMessage({
    declaration: baseReceipt({ hasReason: false, hasContractReference: false }),
    template: null,
  });
  assert.ok(withReason.text.includes(`Reason: ${RECEIPT_WITHHELD.en}`), withReason.text);
  assert.ok(!withoutReason.text.includes('Reason:'));
  assert.ok(!withoutReason.text.includes('Contract or customer number:'));
  // CONTROL: the name is required on the form, so its line is always there.
  assert.ok(withoutReason.text.includes(`Name: ${RECEIPT_WITHHELD.en}`));
});

test('the receipt sentences M270/11 added exist in each of the six languages, distinct from the English except in English', () => {
  for (const language of INSTANCE_LANGUAGES) {
    assert.ok(RECEIPT_WITHHELD[language].length > 0, language);
    assert.ok(RECEIPT_NOT_YOU[language].length > 0, language);
    if (language === 'en') continue;
    assert.notEqual(RECEIPT_WITHHELD[language], RECEIPT_WITHHELD.en, `${language} is still English`);
    assert.notEqual(RECEIPT_NOT_YOU[language], RECEIPT_NOT_YOU.en, `${language} is still English`);
  }
});

test('the operator alert keeps every field word for word, the reason and the name included', () => {
  const alert = buildDeclarationOperatorAlertMessage({
    declaration: {
      ...baseFields({ name: 'Anna www.example.org', reason: 'a stated reason' }),
      receiptId: 'r',
      matched: false,
    },
    template: null,
  });
  assert.ok(alert.text.includes('Name: Anna www.example.org'));
  assert.ok(alert.text.includes('Reason: a stated reason'));
  assert.ok(alert.text.includes('Contract or customer number: K-1234'));
  // CONTROL: the not-you line is the receipt's, never the operator's.
  assert.ok(!alert.text.includes(RECEIPT_NOT_YOU.en));
});

test('no fallback carries a link, names a service, or carries a dash, in any of the six languages', () => {
  const receipts = INSTANCE_LANGUAGES.map((language) =>
    buildDeclarationReceiptMessage({ declaration: baseReceipt({ hasReason: true, language }), template: null }),
  );
  const alert = buildDeclarationOperatorAlertMessage({
    declaration: { ...baseFields(), receiptId: 'r', matched: true },
    template: null,
  });
  for (const message of [...receipts, alert]) {
    assert.ok(!message.html.includes('href'), 'a fallback carries a link');
    assert.ok(!message.text.includes('http'), 'a fallback carries a url');
    for (const word of BANNED_WORDS) {
      assert.ok(!message.text.includes(word), `text carries banned word "${word}"`);
      assert.ok(!message.subject.includes(word), `subject carries banned word "${word}"`);
    }
    for (const dash of BANNED_DASHES) {
      assert.ok(!message.text.includes(dash), 'text carries a dash');
      assert.ok(!message.subject.includes(dash), 'subject carries a dash');
    }
  }
});

test('the operator alert fallback names the receipt id, every field, and whether it matched, in English', () => {
  const matched = buildDeclarationOperatorAlertMessage({
    declaration: { ...baseFields({ kind: 'widerruf' }), receiptId: 'a-receipt-id', matched: true },
    template: null,
  });
  assert.equal(matched.origin, 'fallback');
  assert.equal(matched.subject, 'New declaration: withdrawal (a-receipt-id)');
  assert.ok(matched.text.includes('Receipt no.: a-receipt-id'));
  assert.ok(matched.text.includes('Contract or customer number: K-1234'));
  assert.ok(matched.text.endsWith('Matched to an existing account: yes.'));

  const unmatched = buildDeclarationOperatorAlertMessage({
    declaration: { ...baseFields(), receiptId: 'a-receipt-id', matched: false },
    template: null,
  });
  assert.ok(unmatched.text.endsWith('Matched to an existing account: no.'));
});

test('a found template is filled, in the TEMPLATE language, with the details as one paragraph each', () => {
  const template = foundTemplate({
    name: 'declaration-receipt-kuendigung',
    language: 'en',
    subject: 'Fixture subject',
    body: 'Fixture received on {{date}}.\n\n{{details}}\n\nFixture closing.',
  });
  // A German reader, and an English file: the fallback language of the
  // lookup. The labels and the date follow the file, so the letter is in one
  // language throughout.
  const message = buildDeclarationReceiptMessage({
    declaration: baseReceipt({ language: 'de', hasReason: true }),
    template,
  });
  assert.equal(message.origin, 'template');
  assert.equal(message.subject, 'Fixture subject');
  // The template's {{details}} get the same withheld lines as the fallback,
  // and the not-you line is the fallback's alone: the template's closing is
  // the operator's to write.
  assert.deepEqual(message.text.split('\n\n'), [
    'Fixture received on 21 September 2026 at 12:15 CEST.',
    `Name: ${RECEIPT_WITHHELD.en}`,
    'Email: anna@example.org',
    `Contract or customer number: ${RECEIPT_WITHHELD.en}`,
    'Type of cancellation: regular notice',
    `Reason: ${RECEIPT_WITHHELD.en}`,
    'Timing: as soon as legally possible',
    'Fixture closing.',
  ]);
  assert.ok(message.html.includes('<html lang="en">'));
});

test('an alert template fills the receipt id and the match in subject and body', () => {
  const template = foundTemplate({
    name: 'declaration-alert-kuendigung',
    language: 'en',
    subject: 'Fixture alert ({{receiptId}})',
    body: 'Fixture {{receiptId}} on {{date}}.\n\n{{details}}\n\nFixture matched: {{matched}}.',
  });
  const message = buildDeclarationOperatorAlertMessage({
    declaration: { ...baseFields(), receiptId: 'a-9', matched: false },
    template,
  });
  assert.equal(message.origin, 'template');
  assert.equal(message.subject, 'Fixture alert (a-9)');
  assert.ok(message.text.startsWith('Fixture a-9 on 21 September 2026'));
  assert.ok(message.text.endsWith('Fixture matched: no.'));
});

test('a template that needs a value this letter lacks sends the fallback, never a half-filled letter', () => {
  // An ALERT template handed to the RECEIPT builder: it needs {{matched}},
  // which a receipt has no value for.
  const alertTemplate = foundTemplate({
    name: 'declaration-alert-kuendigung',
    language: 'en',
    subject: 'Fixture subject',
    body: 'Fixture matched: {{matched}}.\n\n{{details}}',
  });
  const message = buildDeclarationReceiptMessage({
    declaration: baseReceipt(),
    template: alertTemplate,
  });
  assert.equal(message.origin, 'fallback');
  assert.equal(message.subject, 'Cancellation confirmed');
  assert.ok(!message.text.includes('Fixture'), 'a line of the unusable template reached the letter');

  // CONTROL: the alert builder, which HAS the value, uses the same template.
  const alert = buildDeclarationOperatorAlertMessage({
    declaration: { ...baseFields(), receiptId: 'r', matched: true },
    template: alertTemplate,
  });
  assert.equal(alert.origin, 'template');
});

// ── The date field's label, by kind (2026-09-30) ───────────────────────────
//
// Both forms post their date in `requestedDate`, but they ask for different
// dates: the cancellation form for the date it should take effect, the
// withdrawal form for the date the contract was made. Until 2026-09-30 the
// receipt labelled both with the cancellation's label.

/** A date only a date line can carry, so the line is found by its value. */
const A_DATE = '2026-09-01';

/** The label in front of the date line of one kind's receipt, in one language. */
function dateLabelOf(input: { kind: DeclarationKind; language: DeclarationLanguage }): string {
  const fields = baseFields({
    kind: input.kind,
    terminationType: input.kind === 'kuendigung' ? 'ordentlich' : null,
    timing: input.kind === 'kuendigung' ? 'onDate' : null,
    requestedDate: A_DATE,
  });
  const suffix = `: ${A_DATE}`;
  const line = detailLines({ fields, language: input.language }).find((candidate) => candidate.endsWith(suffix));
  if (line === undefined) throw new Error(`no date line on the ${input.kind} receipt in ${input.language}`);
  return line.slice(0, -suffix.length);
}

test('the date line of a withdrawal receipt is labelled as the date the contract was made, in each of the six languages', () => {
  const expected = {
    en: 'Date the contract was made',
    de: 'Datum des Vertragsschlusses',
    fr: 'Date de conclusion du contrat',
    it: 'Data di stipula del contratto',
    es: 'Fecha de celebración del contrato',
    tr: 'Sözleşmenin yapıldığı tarih',
  } satisfies Record<DeclarationLanguage, string>;
  for (const language of INSTANCE_LANGUAGES) {
    assert.equal(dateLabelOf({ kind: 'widerruf', language }), expected[language], language);
  }
});

test('CONTROL: the date line of a cancellation receipt keeps the label it had, in each of the six languages', () => {
  const expected = {
    en: 'Requested date',
    de: 'Gewünschtes Datum',
    fr: 'Date souhaitée',
    it: 'Data richiesta',
    es: 'Fecha solicitada',
    tr: 'Talep edilen tarih',
  } satisfies Record<DeclarationLanguage, string>;
  for (const language of INSTANCE_LANGUAGES) {
    assert.equal(dateLabelOf({ kind: 'kuendigung', language }), expected[language], language);
  }
});

/** The two date labels the app's forms draw, as its catalog holds them. */
interface FormDateLabels {
  declarations: {
    cancel: { requestedDateLabel: string };
    withdraw: { requestedDateLabel: string };
  };
}

const APP_LOCALES = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'app/app/i18n/locales');

function formDateLabels(language: DeclarationLanguage): FormDateLabels['declarations'] {
  // SAFETY: the app's own catalog, which its i18n key parity test holds to the
  // English key set in every language. A missing key reads as undefined and
  // fails the equality below; it is never trusted past that.
  const catalog = JSON.parse(readFileSync(join(APP_LOCALES, language, 'common.json'), 'utf8')) as FormDateLabels;
  return catalog.declarations;
}

/** A form label without its trailing marker, "(optional)" and its translations, which a receipt line never repeats. */
function withoutOptionalMarker(label: string): string {
  return label.replace(/\s\([^()]*\)$/u, '');
}

test("each receipt's date label is its own form's label in the app, word for word, in each of the six languages", () => {
  for (const language of INSTANCE_LANGUAGES) {
    const form = formDateLabels(language);
    assert.equal(
      dateLabelOf({ kind: 'widerruf', language }),
      withoutOptionalMarker(form.withdraw.requestedDateLabel),
      `${language}: the withdrawal receipt and the withdrawal form disagree`,
    );
    // CONTROL: the cancellation pair is held to the same rule, and the two
    // forms really ask for different dates, so neither equality is a copy of
    // the other.
    assert.equal(
      dateLabelOf({ kind: 'kuendigung', language }),
      withoutOptionalMarker(form.cancel.requestedDateLabel),
      `${language}: the cancellation receipt and the cancellation form disagree`,
    );
    assert.notEqual(form.withdraw.requestedDateLabel, form.cancel.requestedDateLabel, language);
  }
});
