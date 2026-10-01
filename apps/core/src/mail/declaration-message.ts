/**
 * The two letters `server/legal-declarations.ts` sends, as PURE FUNCTIONS of
 * their inputs and the template the mailer found for them.
 *
 * THE PROSE IS NOT HERE (M246/04). The receipt and the operator alert take
 * their subject and body from the instance's mounted content folder,
 * `<CONTENT_DIR>/<lang>/mail/<template>.md`, found by
 * `declaration-templates.ts` and filled by `mail-template.ts`. The operator
 * writes and reviews that text; this public repo carries none of it.
 *
 * WHAT STAYS IN CODE: the field labels of the detail lines (`Name: ...`), the
 * two value labels each enum carries, and a NEUTRAL FALLBACK. The fallback is
 * what goes out when no content folder is configured, or the template file is
 * missing or refused. It states the statutory facts and nothing else: the
 * kind, the receipt number, the time of receipt in Europe/Berlin, and every
 * field the person gave (the receipt confirms the free-text ones without
 * repeating them, see below). No greeting, no outcome, no promise, because
 * those are the operator's to make; the receipt's one closing line tells a
 * reader who did not send the form what to do. Its labels are the ones the app's confirmation
 * page already shows (`legal:declarations.confirmed.*`), so a reader sees the
 * same words on the page and in the mail.
 *
 * SIX LANGUAGES, THE SIX OF `InstanceLanguage`, AND STILL SEPARATE FROM
 * `strings.ts` (2026-09-30). The request carries `language`, the language of
 * the form the person sent, and the app draws that form in all six. The two
 * statutory buttons are still German legal instruments: German law governs
 * the contract and the declaration, and the German receipt is the
 * authoritative text, which the other five render for a reader who used the
 * form in their own language. Until 2026-09-30 the route took `de` or `en`
 * only, and the app sent the other four as `de`, so a reader of the French
 * form got a German letter. A missing file falls back to German first
 * ({@link receiptTemplateLanguages}), so an instance whose folder holds only
 * the German and English receipts still sends one. The labels below are not
 * `strings.ts`'s: they are the app's, see above.
 *
 * THE RECEIPT IS THE ONLY ONE THAT IS TRANSLATED. The operator alert is
 * English only, template and fallback alike.
 *
 * THE RECEIPT REPEATS NOTHING THE SENDER WROTE (M270/11). It goes to the
 * address typed on a form that needs no sign-in, so the sender need not own
 * it. Until 2026-10-01 it echoed the name (200 characters), the contract
 * reference (200) and the reason (4000) back, which let a stranger send their
 * own words from this instance's domain to any address. Now each of those
 * fields, when given, reads `Label: received, not repeated in this email`
 * ({@link RECEIPT_WITHHELD}), in the template's `{{details}}` and the
 * fallback alike, and {@link DeclarationReceiptInput} has no field to carry
 * the text at all. The name is DROPPED rather than cut to a short, cleaned
 * form: any 80 characters, scheme and `www.` stripped, still carry a phone
 * number or a "visit evil dot example", and the typed address already says
 * whom the receipt is for. What stays is what the statutes ask the receipt to
 * confirm: the kind, the time of receipt, the address, the fixed choices
 * (type of cancellation, timing) and the date. The operator alert keeps every
 * word, and so does the stored row.
 *
 * NEITHER LETTER NAMES A SERVICE, A GATEWAY OR AN ACCOUNT LINK, and neither
 * carries an em dash or an en dash. `tests/unit/declaration-message.test.ts`
 * holds the fallback to it; the template text is the private repo's to hold.
 */
import type { InstanceLanguage } from '../protocol.js';
import { renderHtml } from './invite-message.js';
import {
  MailTemplateError,
  renderMailTemplate,
  type InlinePlaceholder,
  type MailPlaceholder,
  type MailTemplate,
} from './mail-template.js';

/** The language of the form the person sent: one of the six the instance writes mail in. */
export type DeclarationLanguage = InstanceLanguage;

export type DeclarationKind = 'kuendigung' | 'widerruf';

/** Every field the person could have typed, exactly as `legal_declarations` stores them. `null` means the field was left out, not that it was blank. */
export interface DeclarationFields {
  kind: DeclarationKind;
  name: string;
  email: string;
  contractReference: string | null;
  terminationType: 'ordentlich' | 'ausserordentlich' | null;
  reason: string | null;
  requestedDate: string | null;
  timing: 'earliest' | 'onDate' | null;
  /** This service's own clock at the moment the row was written, rendered in Europe/Berlin with its offset. */
  receivedAt: Date;
}

/**
 * What a receipt may say about a declaration: every fixed-form field, and for
 * each field the sender wrote freely only whether it was given. The name is
 * required on the form, so it is always given and has no flag. See the module
 * header on why the text itself never reaches this type.
 */
export interface DeclarationReceiptFacts {
  kind: DeclarationKind;
  /** The typed address. The receipt goes to this mailbox, so it repeats only what its reader owns. */
  email: string;
  hasContractReference: boolean;
  terminationType: DeclarationFields['terminationType'];
  hasReason: boolean;
  /** A real calendar date, already checked by the route, so never free text. */
  requestedDate: string | null;
  timing: DeclarationFields['timing'];
  receivedAt: Date;
}

export interface DeclarationReceiptInput extends DeclarationReceiptFacts {
  /** The id the `202` answered with and the confirmation page shows. */
  receiptId: string;
  /** The language the person chose on the form. */
  language: DeclarationLanguage;
}

/** The receipt's view of a declaration: the stored fields, with the sender's own text reduced to whether it was given. */
export function toDeclarationReceipt(fields: DeclarationFields): DeclarationReceiptFacts {
  return {
    kind: fields.kind,
    email: fields.email,
    hasContractReference: fields.contractReference !== null,
    terminationType: fields.terminationType,
    hasReason: fields.reason !== null,
    requestedDate: fields.requestedDate,
    timing: fields.timing,
    receivedAt: fields.receivedAt,
  };
}

export interface DeclarationOperatorAlertInput extends DeclarationFields {
  /** The same id the person's own receipt carries, so an operator can find the row this letter is about. */
  receiptId: string;
  /** Whether the email matched an account on this instance. Never the account id: this letter is a notice, not a lookup tool. */
  matched: boolean;
}

/** Which of the four template files a letter reads, CONTRACT.md section 6. */
export type DeclarationTemplateName = `declaration-receipt-${DeclarationKind}` | `declaration-alert-${DeclarationKind}`;

/** A template the mailer found, and the language of the file it came from, which may be the fallback language rather than the reader's. */
export interface FoundMailTemplate {
  template: MailTemplate;
  language: DeclarationLanguage;
}

export interface BuiltDeclarationMessage {
  subject: string;
  text: string;
  html: string;
  /** Where the words came from, for the send's log line. Never the words themselves. */
  origin: 'template' | 'fallback';
}

/** The placeholders each template may use, CONTRACT.md section 6. Any other refuses the file. */
export const DECLARATION_TEMPLATE_PLACEHOLDERS = {
  'declaration-receipt-kuendigung': ['date', 'details'],
  'declaration-receipt-widerruf': ['date', 'details'],
  'declaration-alert-kuendigung': ['date', 'receiptId', 'details', 'matched'],
  'declaration-alert-widerruf': ['date', 'receiptId', 'details', 'matched'],
} as const satisfies Record<DeclarationTemplateName, readonly MailPlaceholder[]>;

export function receiptTemplateName(kind: DeclarationKind): DeclarationTemplateName {
  return kind === 'kuendigung' ? 'declaration-receipt-kuendigung' : 'declaration-receipt-widerruf';
}

export function alertTemplateName(kind: DeclarationKind): DeclarationTemplateName {
  return kind === 'kuendigung' ? 'declaration-alert-kuendigung' : 'declaration-alert-widerruf';
}

/**
 * The languages a receipt's file is looked up in, in order: the reader's,
 * then German, then English, each once (CONTRACT.md section 6).
 *
 * GERMAN BEFORE ENGLISH because German law governs and the German receipt is
 * the authoritative text, and because until 2026-09-30 every reader of the
 * French, Italian, Spanish or Turkish form got the German receipt: an
 * instance whose folder has not been given those four keeps sending exactly
 * that. English stays last, for a folder that holds nothing else.
 */
export function receiptTemplateLanguages(language: DeclarationLanguage): readonly DeclarationLanguage[] {
  const order: readonly DeclarationLanguage[] = [language, 'de', 'en'];
  return order.filter((candidate, index) => order.indexOf(candidate) === index);
}

/**
 * The field labels of the detail lines. Form chrome, not prose, so they stay in code (CONTRACT.md section 6).
 *
 * TWO LABELS FOR ONE DATE FIELD (2026-09-30). Both forms post their date as
 * `requestedDate`, but they ask for different dates, so the line is labelled
 * by kind: `requestedDate` for a cancellation, which asks when it should take
 * effect, and `contractDate` for a withdrawal, which asks when the contract
 * was made. Each is the app's own form label, word for word, without its
 * "(optional)" marker: `declarations.cancel.requestedDateLabel` and
 * `declarations.withdraw.requestedDateLabel`.
 * `tests/unit/declaration-message.test.ts` reads the app's catalog and holds
 * them to it. Until 2026-09-30 a withdrawal receipt carried the
 * cancellation's label.
 */
interface DetailLabels {
  name: string;
  email: string;
  contractReference: string;
  terminationType: string;
  reason: string;
  requestedDate: string;
  contractDate: string;
  timing: string;
  terminationTypeOrdentlich: string;
  terminationTypeAusserordentlich: string;
  timingEarliest: string;
  timingOnDate: string;
}

const DETAIL_LABELS = {
  en: {
    name: 'Name',
    email: 'Email',
    contractReference: 'Contract or customer number',
    terminationType: 'Type of cancellation',
    reason: 'Reason',
    requestedDate: 'Requested date',
    contractDate: 'Date the contract was made',
    timing: 'Timing',
    terminationTypeOrdentlich: 'regular notice',
    terminationTypeAusserordentlich: 'extraordinary notice',
    timingEarliest: 'as soon as legally possible',
    timingOnDate: 'on the date you gave',
  },
  de: {
    name: 'Name',
    email: 'E-Mail',
    contractReference: 'Vertrags- oder Kundennummer',
    terminationType: 'Art der Kündigung',
    reason: 'Grund',
    requestedDate: 'Gewünschtes Datum',
    contractDate: 'Datum des Vertragsschlusses',
    timing: 'Zeitpunkt',
    terminationTypeOrdentlich: 'ordentliche Kündigung',
    terminationTypeAusserordentlich: 'außerordentliche Kündigung',
    timingEarliest: 'zum nächstmöglichen Zeitpunkt',
    timingOnDate: 'zum angegebenen Datum',
  },
  // fr, it, es and tr from wordsmith translate (Gemini 3.8 Flash, 2026-09-30),
  // from the English with the German as the authority, in the formal register
  // and with the app's own words for a cancellation and a withdrawal.
  // `contractDate` is copied from the app's withdrawal form in each language,
  // not translated here.
  fr: {
    name: 'Nom',
    email: 'Adresse e-mail',
    contractReference: 'Numéro de contrat ou de client',
    terminationType: 'Type de résiliation',
    reason: 'Motif',
    requestedDate: 'Date souhaitée',
    contractDate: 'Date de conclusion du contrat',
    timing: "Date d'effet",
    terminationTypeOrdentlich: 'résiliation ordinaire',
    terminationTypeAusserordentlich: 'résiliation extraordinaire',
    timingEarliest: 'à la date la plus proche possible',
    timingOnDate: 'à la date indiquée',
  },
  it: {
    name: 'Nome',
    email: 'Indirizzo e-mail',
    contractReference: 'Numero di contratto o codice cliente',
    terminationType: 'Tipo di disdetta',
    reason: 'Motivo',
    requestedDate: 'Data richiesta',
    contractDate: 'Data di stipula del contratto',
    timing: 'Decorrenza',
    terminationTypeOrdentlich: 'disdetta ordinaria',
    terminationTypeAusserordentlich: 'disdetta straordinaria',
    timingEarliest: 'alla prima data utile',
    timingOnDate: 'alla data da Lei indicata',
  },
  es: {
    name: 'Nombre',
    email: 'Correo electrónico',
    contractReference: 'Número de contrato o de cliente',
    terminationType: 'Tipo de cancelación',
    reason: 'Motivo',
    requestedDate: 'Fecha solicitada',
    contractDate: 'Fecha de celebración del contrato',
    timing: 'Momento',
    terminationTypeOrdentlich: 'cancelación ordinaria',
    terminationTypeAusserordentlich: 'cancelación extraordinaria',
    timingEarliest: 'en la fecha más próxima posible',
    timingOnDate: 'en la fecha indicada',
  },
  tr: {
    name: 'Ad Soyad',
    email: 'E-posta',
    contractReference: 'Sözleşme veya müşteri numarası',
    terminationType: 'Fesih türü',
    reason: 'Gerekçe',
    requestedDate: 'Talep edilen tarih',
    contractDate: 'Sözleşmenin yapıldığı tarih',
    timing: 'Zamanlama',
    terminationTypeOrdentlich: 'olağan fesih',
    terminationTypeAusserordentlich: 'olağanüstü fesih',
    timingEarliest: 'mümkün olan en erken tarihte',
    timingOnDate: 'belirtilen tarihte',
  },
} satisfies Record<DeclarationLanguage, DetailLabels>;

/** The neutral fallback's own lines. `{receiptId}` and `{date}` are filled in code. */
interface FallbackLabels {
  subjectKuendigung: string;
  subjectWiderruf: string;
  kindKuendigung: string;
  kindWiderruf: string;
  receiptId: string;
  receivedAt: string;
}

/**
 * The app's confirmation page labels, `legal:declarations.confirmed.*`, word
 * for word, and each language's confirmation page title as the subject.
 */
const FALLBACK_LABELS = {
  en: {
    subjectKuendigung: 'Cancellation confirmed',
    subjectWiderruf: 'Withdrawal confirmed',
    kindKuendigung: 'Type: Cancellation',
    kindWiderruf: 'Type: Withdrawal',
    receiptId: 'Receipt no.: {receiptId}',
    receivedAt: 'Received at: {date}',
  },
  de: {
    subjectKuendigung: 'Kündigung bestätigt',
    subjectWiderruf: 'Widerruf bestätigt',
    kindKuendigung: 'Art: Kündigung',
    kindWiderruf: 'Art: Widerruf',
    receiptId: 'Beleg-Nr.: {receiptId}',
    receivedAt: 'Eingegangen am: {date}',
  },
  fr: {
    subjectKuendigung: 'Résiliation confirmée',
    subjectWiderruf: 'Rétractation confirmée',
    kindKuendigung: 'Type : Résiliation',
    kindWiderruf: 'Type : Rétractation',
    receiptId: 'Récépissé n° : {receiptId}',
    receivedAt: 'Reçu le : {date}',
  },
  it: {
    subjectKuendigung: 'Disdetta confermata',
    subjectWiderruf: 'Recesso confermato',
    kindKuendigung: 'Tipo: Disdetta',
    kindWiderruf: 'Tipo: Recesso',
    receiptId: 'Ricevuta n.: {receiptId}',
    receivedAt: 'Ricevuto il: {date}',
  },
  es: {
    subjectKuendigung: 'Cancelación confirmada',
    subjectWiderruf: 'Desistimiento confirmado',
    kindKuendigung: 'Tipo: Cancelación',
    kindWiderruf: 'Tipo: Desistimiento',
    receiptId: 'N.º de recibo: {receiptId}',
    receivedAt: 'Recibido el: {date}',
  },
  tr: {
    subjectKuendigung: 'Fesih onaylandı',
    subjectWiderruf: 'Cayma onaylandı',
    kindKuendigung: 'Tür: Fesih',
    kindWiderruf: 'Tür: Cayma',
    receiptId: 'Makbuz no.: {receiptId}',
    receivedAt: 'Alınma zamanı: {date}',
  },
} satisfies Record<DeclarationLanguage, FallbackLabels>;

/**
 * The value of a receipt line for a field the sender filled in and the
 * receipt does not repeat (M270/11), as in `Reason: received, not repeated in
 * this email`. The English from wordsmith (Gemini 3.8 Flash, 2026-10-01), the
 * other five from wordsmith translate in the formal register.
 */
export const RECEIPT_WITHHELD = {
  en: 'received, not repeated in this email',
  de: 'erhalten, in dieser E-Mail nicht wiederholt',
  fr: 'reçu, non repris dans cet e-mail',
  it: 'ricevuto, non ripetuto in questa email',
  es: 'recibido, no repetido en este correo',
  tr: 'alındı, bu e-postada tekrarlanmadı',
} as const satisfies Record<DeclarationLanguage, string>;

/**
 * The neutral receipt's last line, for a reader who did not send the form
 * (M270/11): the receipt reaches whatever address was typed. It names no
 * channel, because the sending address may be one nobody reads, and it says
 * "declaration" because one line serves both kinds. Same provenance as
 * {@link RECEIPT_WITHHELD}. A template's closing is the operator's to write.
 */
export const RECEIPT_NOT_YOU = {
  en: 'If you did not send this, contact the business you have the contract with to reverse the declaration.',
  de: 'Wenn Sie dies nicht gesendet haben, kontaktieren Sie das Unternehmen, mit dem Sie den Vertrag haben, um die Erklärung rückgängig zu machen.',
  fr: "Si vous n'êtes pas à l'origine de cet envoi, contactez l'entreprise avec laquelle vous avez conclu le contrat pour annuler la déclaration.",
  it: "Se non ha inviato Lei questa richiesta, contatti l'azienda con cui ha stipulato il contratto per revocare la dichiarazione.",
  es: 'Si no envió esto, comuníquese con la empresa con la que tiene el contrato para revocar la declaración.',
  tr: 'Bunu siz göndermediyseniz, beyanı geri almak için sözleşmenizin bulunduğu işletmeyle iletişime geçin.',
} as const satisfies Record<DeclarationLanguage, string>;

/** The `Intl` locale each language's date is rendered in, the same as `strings.ts`'s `DATE_LOCALES`. */
const RECEIPT_DATE_LOCALES = {
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
  tr: 'tr-TR',
} satisfies Record<DeclarationLanguage, string>;

/**
 * The received instant, in Europe/Berlin with its zone name attached.
 *
 * EUROPE/BERLIN, NEVER UTC: this is "the date and time of receipt" that both
 * statutes require the acknowledgement to state, and the business, the
 * statute and the reader are all in the same zone. Explicit components rather
 * than `dateStyle`/`timeStyle`, because `Intl.DateTimeFormat` refuses to
 * combine either shorthand with `timeZoneName`.
 */
export function formatReceivedAt(input: { receivedAt: Date; language: DeclarationLanguage }): string {
  return new Intl.DateTimeFormat(RECEIPT_DATE_LOCALES[input.language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
    timeZoneName: 'short',
  }).format(input.receivedAt);
}

/** One "Label: value" line, or nothing when the field was not given. */
function detailLine(label: string, value: string | null): string[] {
  return value === null ? [] : [`${label}: ${value}`];
}

function terminationTypeLabel(input: {
  labels: DetailLabels;
  value: DeclarationFields['terminationType'];
}): string | null {
  if (input.value === null) return null;
  return input.value === 'ordentlich'
    ? input.labels.terminationTypeOrdentlich
    : input.labels.terminationTypeAusserordentlich;
}

/** The label of the date line: what the form of this kind asked the date for. See {@link DetailLabels}. */
function dateLabel(input: { labels: DetailLabels; kind: DeclarationKind }): string {
  return input.kind === 'widerruf' ? input.labels.contractDate : input.labels.requestedDate;
}

function timingLabel(input: { labels: DetailLabels; value: DeclarationFields['timing'] }): string | null {
  if (input.value === null) return null;
  return input.value === 'earliest' ? input.labels.timingEarliest : input.labels.timingOnDate;
}

/** A line for a field the sender wrote, given but not repeated, or nothing when it was not given. */
function withheldLine(input: { label: string; isGiven: boolean; language: DeclarationLanguage }): string[] {
  return input.isGiven ? [`${input.label}: ${RECEIPT_WITHHELD[input.language]}`] : [];
}

/**
 * The receipt's field lines, in the same order as {@link detailLines}: the
 * fixed-form fields as given, the sender's own text as given but not repeated.
 */
export function receiptDetailLines(input: {
  receipt: DeclarationReceiptFacts;
  language: DeclarationLanguage;
}): string[] {
  const { receipt, language } = input;
  const labels = DETAIL_LABELS[language];
  const terminationType = terminationTypeLabel({ labels, value: receipt.terminationType });
  const timing = timingLabel({ labels, value: receipt.timing });
  return [
    ...withheldLine({ label: labels.name, isGiven: true, language }),
    ...detailLine(labels.email, receipt.email),
    ...withheldLine({ label: labels.contractReference, isGiven: receipt.hasContractReference, language }),
    ...detailLine(labels.terminationType, terminationType),
    ...withheldLine({ label: labels.reason, isGiven: receipt.hasReason, language }),
    ...detailLine(dateLabel({ labels, kind: receipt.kind }), receipt.requestedDate),
    ...detailLine(labels.timing, timing),
  ];
}

/** Every field line the person's own submission earns, word for word, in the fixed order the form asked for them. The operator alert's, never the receipt's. */
export function detailLines(input: { fields: DeclarationFields; language: DeclarationLanguage }): string[] {
  const labels = DETAIL_LABELS[input.language];
  const { fields } = input;
  const terminationType = terminationTypeLabel({ labels, value: fields.terminationType });
  const timing = timingLabel({ labels, value: fields.timing });
  return [
    ...detailLine(labels.name, fields.name),
    ...detailLine(labels.email, fields.email),
    ...detailLine(labels.contractReference, fields.contractReference),
    ...detailLine(labels.terminationType, terminationType),
    ...detailLine(labels.reason, fields.reason),
    ...detailLine(dateLabel({ labels, kind: fields.kind }), fields.requestedDate),
    ...detailLine(labels.timing, timing),
  ];
}

/**
 * The neutral letter: kind, receipt number, time of receipt, the field lines.
 * `details` are the alert's full lines or the receipt's withheld ones;
 * `trailing` is each letter's last line: whether the address matched, for the
 * alert, and what to do if you did not send it, for the receipt.
 */
function buildFallback(input: {
  kind: DeclarationKind;
  receivedAt: Date;
  details: string[];
  receiptId: string;
  language: DeclarationLanguage;
  subject: string;
  trailing: string[];
}): BuiltDeclarationMessage {
  const labels = FALLBACK_LABELS[input.language];
  const date = formatReceivedAt({ receivedAt: input.receivedAt, language: input.language });
  const paragraphs = [
    input.kind === 'kuendigung' ? labels.kindKuendigung : labels.kindWiderruf,
    labels.receiptId.replace('{receiptId}', input.receiptId),
    labels.receivedAt.replace('{date}', date),
    ...input.details,
    ...input.trailing,
  ];
  return {
    subject: input.subject,
    text: paragraphs.join('\n\n'),
    html: renderHtml({ language: input.language, before: paragraphs, after: [], link: null }),
    origin: 'fallback',
  };
}

/**
 * Fills the template, or answers `null` when the fill refuses, so the caller
 * sends the fallback instead of a letter with a hole in it.
 */
function fillTemplate(input: {
  found: FoundMailTemplate;
  receivedAt: Date;
  /** The field lines in a given language: the template's, which may be the fallback language rather than the reader's. */
  details: (language: DeclarationLanguage) => string[];
  receiptId: string;
  matched: boolean | null;
}): BuiltDeclarationMessage | null {
  const { found } = input;
  const inline = new Map<InlinePlaceholder, string>();
  inline.set('date', formatReceivedAt({ receivedAt: input.receivedAt, language: found.language }));
  inline.set('receiptId', input.receiptId);
  if (input.matched !== null) inline.set('matched', input.matched ? 'yes' : 'no');
  const values = { inline, details: input.details(found.language) };
  try {
    return {
      ...renderMailTemplate({ template: found.template, values, language: found.language }),
      origin: 'template',
    };
  } catch (cause) {
    if (cause instanceof MailTemplateError) return null;
    throw cause;
  }
}

/**
 * The receipt to the address typed on the form. From the template when one
 * was found, in the template's language; otherwise the neutral fallback in
 * the language the person chose, ending with {@link RECEIPT_NOT_YOU}. Either
 * way it repeats no text the sender wrote, see the module header.
 */
export function buildDeclarationReceiptMessage(input: {
  declaration: DeclarationReceiptInput;
  template: FoundMailTemplate | null;
}): BuiltDeclarationMessage {
  const { declaration } = input;
  const details = (language: DeclarationLanguage): string[] => receiptDetailLines({ receipt: declaration, language });
  if (input.template !== null) {
    const filled = fillTemplate({
      found: input.template,
      receivedAt: declaration.receivedAt,
      details,
      receiptId: declaration.receiptId,
      matched: null,
    });
    if (filled !== null) return filled;
  }
  const labels = FALLBACK_LABELS[declaration.language];
  return buildFallback({
    kind: declaration.kind,
    receivedAt: declaration.receivedAt,
    details: details(declaration.language),
    receiptId: declaration.receiptId,
    language: declaration.language,
    subject: declaration.kind === 'kuendigung' ? labels.subjectKuendigung : labels.subjectWiderruf,
    trailing: [RECEIPT_NOT_YOU[declaration.language]],
  });
}

/**
 * The operator's copy, English only. The fallback ends with whether the
 * address matched an account, because that is the one fact that changes what
 * the operator does next.
 */
export function buildDeclarationOperatorAlertMessage(input: {
  declaration: DeclarationOperatorAlertInput;
  template: FoundMailTemplate | null;
}): BuiltDeclarationMessage {
  const { declaration } = input;
  const details = (language: DeclarationLanguage): string[] => detailLines({ fields: declaration, language });
  if (input.template !== null) {
    const filled = fillTemplate({
      found: input.template,
      receivedAt: declaration.receivedAt,
      details,
      receiptId: declaration.receiptId,
      matched: declaration.matched,
    });
    if (filled !== null) return filled;
  }
  const kindWord = declaration.kind === 'kuendigung' ? 'cancellation' : 'withdrawal';
  return buildFallback({
    kind: declaration.kind,
    receivedAt: declaration.receivedAt,
    details: details('en'),
    receiptId: declaration.receiptId,
    language: 'en',
    subject: `New declaration: ${kindWord} (${declaration.receiptId})`,
    trailing: [`Matched to an existing account: ${declaration.matched ? 'yes' : 'no'}.`],
  });
}
