/**
 * The design contract of the lowcarbcheck restyle (M243), as names and numbers, in ONE place.
 *
 * WHY A MODULE AND NOT LITERALS IN EACH TEST. The restyle is a taste call that a person may
 * reverse: Victor Mono back to Inter, a 28 px grid to a 32 px one, a 16 px card title to 18.
 * If each test carried its own copy of `'Victor Mono Variable'` and `57`, a reversal would be
 * a hunt through a dozen files and the ones missed would fail for the wrong reason. Here it is
 * a one-line edit, and the tests that read it move together.
 *
 * WHAT DOES NOT LIVE HERE. The CSS itself. A number in this file is the number the tests
 * expect to find in the app, never a number the app reads.
 */

/** The app's voice, as `@fontsource-variable/victor-mono` names its family. */
export const VICTOR_MONO = 'Victor Mono Variable';

/** The long-form reading face, as `@fontsource-variable/inter` names its family. */
export const INTER = 'Inter Variable';

/** The wordmark face, as `app/app.css` names its own `@font-face`. */
export const FRAUNCES = 'Fraunces';

/**
 * The stack the `body` font role declares, character for character, as `app/app.css` writes
 * it. Victor Mono first, Inter behind it, then the device's monospace faces.
 */
export const BODY_STACK = `'${VICTOR_MONO}', '${INTER}', ui-monospace, monospace`;

/** The stack the `prose` font role declares. */
export const PROSE_STACK = `'${INTER}', sans-serif`;

/** The brand role's single face. */
export const BRAND_STACK = `'${FRAUNCES}', serif`;

/**
 * The section label's recipe, token by token: small, semibold, uppercase, lightly tracked and
 * muted grey. The eyebrow is grey on purpose, so `text-primary` is not in this list and the
 * tests assert its ABSENCE.
 */
export const SECTION_EYEBROW_TOKENS = [
  'text-xs',
  'font-semibold',
  'uppercase',
  'tracking-wide',
  'text-muted-foreground',
] as const;

/** The hairline that trails a section label, drawn in the border colour. */
export const SECTION_EYEBROW_RULE_TOKEN = 'bg-border';

/** The card title's recipe: 16 px semibold, in whatever face the body asks for. */
export const CARD_TITLE_TOKENS = ['text-base', 'font-semibold', 'leading-tight', 'tracking-tight', 'text-balance'] as const;

/**
 * The header page title on a phone, and the floor no fix may go under. 14 px is the largest whole
 * pixel size at which no route title in any of the six languages is clipped harder in Victor Mono than it was in
 * Inter at 18 px, at 390 px and at 360 px. It was 15 px until the clip sweep
 * (`lcc-lineage-clip-sweep.spec.ts`, M243 spec 08) found Italian and French titles clipped harder
 * at 360 px, which German and Turkish, the two languages spec 02 measured, do not show. The floor
 * stops a clip from being "fixed" by shrinking the title until it is unreadable, and the title now
 * sits ON it, so the next clip cannot be fixed by size.
 */
export const HEADER_TITLE_PX = 14;
export const HEADER_TITLE_FLOOR_PX = 14;

/** The Inter size the header title was set at before the face changed, which is the baseline a clip is judged against. */
export const HEADER_TITLE_INTER_BASELINE_PX = 18;

/** The bottom bar's fixed height: `h-14` (56 px) plus its 1 px top border. */
export const BOTTOM_BAR_HEIGHT_PX = 57;

/** The default card title size, `text-base`. Callers may still override it. */
export const CARD_TITLE_PX = 16;

/** The page grid's cell, and the alpha its hairlines are drawn at. */
export const GRID_CELL_PX = 28;
export const GRID_LINE_ALPHA = 0.7;

/**
 * A computed `font-family` stack that STARTS with `name`, written the way the browser writes
 * it: a family with a space is quoted (`"Victor Mono Variable", ...`) and a one-word family is
 * not (`Fraunces, serif`), so the quotes are optional here and the name must end at a comma or
 * at the end of the stack, which keeps `Fraunces` from matching `Fraunces Display`.
 *
 * @param name - the family name, without quotes.
 * @returns a pattern for `expect(...).toMatch`.
 */
export function familyStartsWith(name: string): RegExp {
  return new RegExp(`^"?${name}"?(?:,|$)`, 'u');
}
