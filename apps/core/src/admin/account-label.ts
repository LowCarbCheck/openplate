/**
 * The operator's label on an account (`accounts.label`), such as
 * "Beta supporter".
 *
 * ONE BOUND, NAMED ONCE. The schema's check constraint and the admin write
 * path both read {@link MAX_ACCOUNT_LABEL_LENGTH}, so the database and the
 * route cannot disagree about what fits.
 */

/**
 * The longest label an account may carry, in Unicode code points. Postgres
 * `char_length` counts the same unit, so a label the route accepts is one the
 * check constraint accepts.
 */
export const MAX_ACCOUNT_LABEL_LENGTH = 40;
