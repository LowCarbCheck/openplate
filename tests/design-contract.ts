/**
 * The design contract of the lowcarbcheck restyle (M243), as names and numbers, in ONE place.
 *
 * WHY A MODULE AND NOT LITERALS IN EACH TEST. The restyle is a taste call that a person may
 * reverse: Victor Mono back to Inter, a 28 px grid to a 32 px one, an 18 px card title back to 16.
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

/**
 * The local face a page is painted in until Victor Mono arrives, declared by `@font-face` in
 * `app/app.css` with Victor Mono's width and line metrics, so the swap moves nothing (M256 spec 03).
 */
export const VICTOR_MONO_FALLBACK = 'Victor Mono Fallback';

/**
 * The serif the wordmark used to be set in, until 2026-09-21. It is no longer loaded or named
 * anywhere in the app. It stays here so a control can force a family that is not the body's, and
 * so a check can say that nothing on a screen computes it any more.
 */
export const RETIRED_SERIF = 'Fraunces';

/** The one weight the wordmark is set in, as a computed `font-weight` reads: Victor Mono's lowest. */
export const WORDMARK_WEIGHT = '100';

/**
 * The stack the `body` font role declares, character for character, as `app/app.css` writes
 * it. Victor Mono first, its metric-matched fallback next, Inter behind them, then the device's
 * monospace faces.
 */
export const BODY_STACK = `'${VICTOR_MONO}', '${VICTOR_MONO_FALLBACK}', '${INTER}', ui-monospace, monospace`;

/** The stack the `prose` font role declares. */
export const PROSE_STACK = `'${INTER}', sans-serif`;

/**
 * The stack the brand role declares. Victor Mono, the same face as the body, because the wordmark
 * is told apart by its weight and its two colours and no longer by a face of its own.
 */
export const BRAND_STACK = `'${VICTOR_MONO}', '${VICTOR_MONO_FALLBACK}', ui-monospace, monospace`;

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

/** The card title's recipe: 18 px semibold, in whatever face the body asks for. */
export const CARD_TITLE_TOKENS = [
  'text-lg',
  'font-semibold',
  'leading-tight',
  'tracking-tight',
  'text-balance',
] as const;

/**
 * The header page title on a phone: 18 px, weight 600, and it does not bend.
 *
 * The operator chose it on 2026-09-22 after a side by side comparison in a playground. Until then
 * it was 14 px, the largest size at which no title clipped harder in Victor Mono than it had in
 * Inter at 18 px, and a title barely larger than the body under it. That rule is gone with the
 * size: there is no Inter baseline any more and no floor to defend, because the size is fixed.
 *
 * FITTING IS A REQUIREMENT ON THE STRINGS. Victor Mono is a flat 0.6 em, so at this size every
 * character costs 10.8 px and the slot holds a fixed count of them. Every title that lands in the
 * slot must fit at `HEADER_TITLE_FIT_WIDTHS_PX` in all six languages, and one that does not is a
 * defect in its locale file, fixed by a shorter string. Never by a smaller size, a clamp or a
 * shrink to fit. `lcc-lineage-header-title.spec.ts` and `lcc-lineage-clip-sweep.spec.ts` hold it.
 */
export const HEADER_TITLE_PX = 18;

/** The two phone widths every header title must fit at: the one the app promises, and the design width. */
export const HEADER_TITLE_FIT_WIDTHS_PX = [360, 390] as const;

/** The bottom bar's fixed height: `h-14` (56 px) plus its 1 px top border. */
export const BOTTOM_BAR_HEIGHT_PX = 57;

/**
 * The default card title size, `text-lg`. Callers may still override it.
 *
 * It was 16 from M243 spec 03 until 2026-09-21, and that was a step BELOW what fourteen Insights
 * cards still set by hand, so one screen drew 16 px and 18 px titles over the same 14 px body and
 * no title stood clear of the text under it. The operator called the cards flat. 18 is the size
 * the title had before the face changed, and the overrides that said so are gone.
 */
export const CARD_TITLE_PX = 18;

/**
 * The smallest a card title may be over the text under it, as a ratio. A title 16 over a body 14 is
 * 1.14 and reads as more of the same; 18 over 14 is 1.29. The hierarchy check reads this, so a
 * future step down to 16 fails there and not in a reviewer's eye.
 */
export const CARD_TITLE_OVER_BODY_MIN_RATIO = 1.25;

/**
 * The graph paper's cell, and the alpha its hairlines are drawn at.
 *
 * ONE ALPHA FOR BOTH PLACES the paper is drawn: the page grid (`.surface-grid`) and the hero
 * panel (`.surface-brand`, M243 spec 04). A lower alpha inside the hero was tried at three tenths
 * and the paper simply vanished in both themes, so the hero reads the same number. What keeps the
 * paper off the hero's small text is the panel's content, which carries fills of its own, not a
 * weaker line. `tests/unit/lcc-lineage-foundation.test.ts` reads it out of `app.css`;
 * `tests/e2e/lcc-lineage-hero.spec.ts` reads what a browser paints on the hero.
 */
export const GRID_CELL_PX = 28;
export const GRID_LINE_ALPHA = 0.7;

/**
 * EVERY CORNER IS SQUARE (operator decision, 2026-09-22), which retires the five-step radius
 * ladder M243 spec 03 wrote here. From M129/01 to M243 spec 03 one radius meant everything;
 * spec 03 answered that by giving each kind of object its own step, a data row at 4 px up to a
 * hero at 16 px, so a person could learn the ladder once and read a screen faster. The operator
 * called for zero everywhere instead, so the ladder is gone rather than flattened to a five-way
 * tie at the same number, which would have kept five names for one idea.
 *
 * THE ONE EXCEPTION IS A CIRCLE, drawn as `rounded-full`, and only when the shape genuinely is
 * one: an avatar, a dot, a round icon button, a switch's thumb and track, a spinner, a radio
 * indicator. `rounded-full` on anything else, a pill-shaped chip, a segmented control, a progress
 * bar's track, a search field, is squared along with everything that used to sit on the ladder.
 *
 * `app/app.css`'s `--radius` and every token derived from it are `0`, so a component that still
 * asks Tailwind's default scale for a rounded corner draws none.
 * `tests/e2e/square-corners.spec.ts` reads the COMPUTED `border-*-radius` of every visible element
 * on a real page and fails on anything above zero that is not a circle (width equal to height and
 * a radius at least half of it).
 */
export const SQUARE_CORNER_PX = 0;

/**
 * The padding a list row draws, `p-3`. It was `p-4` while the row was 16 px round; a row that is
 * now the same 8 px as a card would look loose at a card's padding.
 */
export const LIST_ROW_PADDING_PX = 12;

/**
 * THE TEAL BUDGET (M243 spec 05b): how many things on a screen may be painted in `--primary`.
 *
 * WHY A CEILING AND NOT A RULE. "Use the accent sparingly" has never stopped a single teal icon
 * from being added, because no one addition is the one that breaks the page. These are the
 * numbers each screen MEASURED on the build that shipped, frozen exactly, so the next feature
 * that wants the brand colour has to take it away from something else or move a line here on
 * purpose. LowCarbCheck spends its accent about three times a page; openplate spends more, and
 * what it spends it on is listed beside each number so a reader can judge whether it is earned.
 *
 * WHAT A NUMBER COUNTS. One ELEMENT inside `main` whose own text colour, background colour or a
 * border it actually draws resolves to the token, at any alpha above zero.
 * `tests/e2e/lcc-lineage-teal-budget.spec.ts` holds the reader, the three rules that keep it from
 * double counting, and the injection control that proves one more element breaks the ceiling.
 *
 * EVERY SCREEN PAYS TWO before it draws anything of its own: the wordmark in the header, and the
 * raised launcher in the bottom bar. `/settings` is exactly those two, which is the floor.
 *
 * A LINK WITH A TRAILING ICON COSTS TWO, because it paints two teal marks. That is not an
 * accident of the reader, it is what a person sees, and it is why the dashboard's two hand-off
 * links account for four of its twelve.
 *
 * WHAT THE BUDGET IS SPENT ON TODAY, after the decoration sweep that came with these numbers:
 *
 * | Screen       | Ceiling | What spends it                                                        |
 * | ------------ | ------- | --------------------------------------------------------------------- |
 * | `/settings`  |       2 | the wordmark, the launcher                                              |
 * | `/trends`    |       6 | the two, the active tab, "Log weight", and the bar's active Insights tab (icon and label). It was 4 until Insights came back into the bar with the Menu tab (2026-09-24); the two added are the same pair `/add/search` and `/diary` pay for their own bar tab, raised by count and not yet measured |
 * | `/add/search`|       5 | the two, the "Set up AI" link, the active tab's icon and its label      |
 * | `/diary`     |       8 | the two, the active tab (two), the camera key, two links, the habit day's dot. It was 9 until the lead figure (layout D, 2026-09-23) dropped the budget row's status dot |
 * | `/dashboard` |      12 | the two, the camera key, two hand-off links (four), the award mark, and four data marks: the status dot, an adherence cell, the streak legend dot and a ridge bar |
 *
 * The dashboard is the one screen far above LowCarbCheck's three, and every one of its twelve
 * carries meaning: four are the traffic-light language this app is built on (DESIGN.md section 3),
 * four are two links, and the rest are the chrome every screen pays. The decoration that used to
 * sit beside them is gone: the composer's microphone and keyboard keys, four card-title icons, a
 * disclosure chevron, the glance tile's arrow and the "Just added" badge are all muted now, and
 * the chips on the review, add and settings screens are `bg-muted` (decision 3).
 */
export const TEAL_BUDGET_CEILING = {
  '/diary': 8,
  '/dashboard': 12,
  '/trends': 6,
  '/settings': 2,
  '/add/search': 5,
} as const;

/** A screen the teal budget is frozen for. */
export type TealBudgetScreen = keyof typeof TEAL_BUDGET_CEILING;

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
