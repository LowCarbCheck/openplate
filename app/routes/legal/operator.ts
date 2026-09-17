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
 * The operator's telephone number.
 *
 * Anlage 1 zu Artikel 246a § 1 Absatz 2 Satz 2 EGBGB, Gestaltungshinweis 2,
 * has required a telephone number inside the withdrawal instruction since the
 * 2022 amendment (M214/07). Declared here, rather than inline in `OPERATOR`,
 * so it is assembled into the withdrawal instruction and the imprint's
 * contact block the same way every other identifier on this page is, from
 * one place.
 *
 * Typed as `string | undefined`, not narrowed to the literal below, because
 * two call sites still branch on its presence: `operatorContactLine()` in
 * `withdrawal.tsx` filters it out of the identifier run, and the imprint's
 * contact block renders its row only when it is set. Both guards stay live
 * on purpose, the same way they would need to if a future business change
 * required pulling the number again; nothing here should have to change
 * shape to represent that.
 */
const OPERATOR_PHONE: string | undefined = '015236105896';

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
