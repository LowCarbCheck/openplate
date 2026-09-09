/**
 * The operator's legal identity, as data.
 *
 * ── WHY THIS IS NOT IN THE TRANSLATION BUNDLE ───────────────────────────────
 * Everything here is an IDENTIFIER, not prose. A company name, a street, a
 * register number and a VAT id mean the same thing in every language and must
 * be byte-identical in all of them — a German Impressum that names a subtly
 * different company than the English one is worse than having only one.
 *
 * Keeping these values out of the locale bundles makes that structural
 * rather than something a test has to catch: there is only one copy, so the
 * two renders cannot disagree. It also means a translation model never sees
 * them and so can never "helpfully" localise `Straße` or reformat the number.
 *
 * ── DO NOT "FIX" THE ADDRESS ────────────────────────────────────────────────
 * "Straße 73" is a real street name in 13125 Berlin and "49" is the house
 * number. It is not a typo and it is not reversed. The values are reproduced
 * verbatim from two already-shipped, operator-verified imprints
 * (`nicotinepouch-org` and `selfhostedworld-com`).
 */
/**
 * The operator's telephone number, and it is NOT SET.
 *
 * OPTIONAL, AND EMPTY TODAY. Anlage 1 zu Artikel 246a § 1 Absatz 2 Satz 2
 * EGBGB, Gestaltungshinweis 2, has required a telephone number inside the
 * withdrawal instruction since the 2022 amendment. Nothing in this repository
 * may invent one, so `/withdrawal` prints the number only when it is present
 * and leaves no gap where it would go. Declared here, rather than inline in
 * `OPERATOR`, so the absence carries its type without a type assertion.
 *
 * TODO(owner): supply the business telephone number (M214/07).
 */
const OPERATOR_PHONE: string | undefined = undefined;

export const OPERATOR = {
  /** The legal person. Not "LowCarbCheck", which is a product name. */
  legalName: 'SPARQ VENTURES UG (haftungsbeschränkt)',
  street: 'Straße 73 49',
  postalCode: '13125',
  city: 'Berlin',
  /** In German in both locales: it is part of a postal address, not a sentence. */
  country: 'Deutschland',
  managingDirector: 'Altan Sarisin',
  registerNumber: 'HRB 174062 B',
  registerCourt: 'Amtsgericht Charlottenburg',
  vatId: 'DE312546809',
  /** The operator's telephone number, or absent. See `OPERATOR_PHONE`. */
  phone: OPERATOR_PHONE,
  imprintEmail: 'info@sprqvntrs.com',
  privacyEmail: 'partners@sportsight.de',
} as const;
