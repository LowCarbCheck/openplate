/**
 * The ONLY file under `src/mail/` that writes a colour. Every mail's layout
 * (`mail-layout.ts`) reads its colours from here, and
 * `tests/unit/mail-palette.test.ts` enforces both halves of that:
 *
 * 1. Each constant that mirrors an app token equals the light-theme value of
 *    that token in `apps/app/app/app.css`, converted from its HSL triple to hex
 *    (a mail client cannot read a CSS variable or an HSL triple). A palette
 *    change in the app fails the core's unit tests until this file follows.
 * 2. The set of colour literals under `src/mail/` is frozen to this file's
 *    values, so a hand-typed colour in a letter fails instead of arriving
 *    unnoticed.
 *
 * The mail is always light: the layout asks mail clients for a light scheme, so
 * the dark theme of the app has no counterpart here.
 */

/** The page behind the card. Mirrors `--background` in `apps/app/app/app.css`, light theme. */
export const MAIL_PAGE_BACKGROUND = '#f1f7f8';

/** Body text, the "plate" half of the wordmark and headings. Mirrors `--foreground`. */
export const MAIL_TEXT = '#111618';

/** The "open" half of the wordmark, the button ground and every link. Mirrors `--primary`. */
export const MAIL_PRIMARY = '#057a78';

/** The footer text under the card. Mirrors `--muted-foreground`. */
export const MAIL_MUTED_TEXT = '#53676e';

/** The card's one-pixel outline. Mirrors `--border`. */
export const MAIL_BORDER = '#d0dee1';

/**
 * The card's ground and the button's label. Mirrors no app token: the app's
 * card is a tinted white, but a mail card sits on a tinted page and is plain
 * white. White on `MAIL_PRIMARY` is about 5:1, which is why the button uses
 * the UI primary and not the mark's own teal.
 */
export const MAIL_WHITE = '#ffffff';
