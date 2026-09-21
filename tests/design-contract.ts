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

/** The card title's recipe: 18 px semibold, in whatever face the body asks for. */
export const CARD_TITLE_TOKENS = [
  'text-lg',
  'font-semibold',
  'leading-tight',
  'tracking-tight',
  'text-balance',
] as const;

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
 * THE SHAPE LADDER (M243 spec 03), decided before a single class was edited.
 *
 * One radius used to mean everything. `rounded-2xl` was on the card, the list row, the settings
 * inset, the dialog, a textarea, a segmented control and a focus ring alike, so the shape of a
 * thing said nothing about what the thing WAS. Five steps now, and each step is one kind of object.
 * Anything at the same step is the same kind of object, which is the whole point: a person learns
 * the ladder once and then reads the screen faster.
 *
 * | Tier      | Class          | px | What wears it                                            |
 * | --------- | -------------- | -- | -------------------------------------------------------- |
 * | `dataRow` | `rounded`      |  4 | a data row inside a panel: label, value, status           |
 * | `control` | `rounded-md`   |  6 | buttons, inputs, composer keys, thumbnails                |
 * | `card`    | `rounded-lg`   |  8 | every card, every inset group, every list row, every panel |
 * | `tile`    | `rounded-xl`   | 12 | a tile in a grid                                          |
 * | `hero`    | `rounded-2xl`  | 16 | the one hero per screen, dialogs, sheets, the landing frame |
 *
 * `rounded-full` is the sixth and is not a step: pills, badges, dots and avatars are round because
 * they are round, not because of where they sit.
 *
 * This resolves DESIGN.md's own contradiction, section 1.5 said `rounded-2xl` and section 5 said
 * `rounded-lg`, in section 5's favour. `tests/unit/radius-tiers.test.ts` holds the allowlist of the
 * sites still allowed to draw 12 px and 16 px, and `tests/e2e/lcc-lineage-shape.spec.ts` reads the
 * COMPUTED radius of each tier in a real browser.
 */
export const RADIUS_TIER_PX = {
  dataRow: 4,
  control: 6,
  card: 8,
  tile: 12,
  hero: 16,
} as const;

/** A step on the ladder. */
export type RadiusTier = keyof typeof RADIUS_TIER_PX;

/** The Tailwind utility each step is written as, which is what a source guard matches on. */
export const RADIUS_TIER_CLASS = {
  dataRow: 'rounded',
  control: 'rounded-md',
  card: 'rounded-lg',
  tile: 'rounded-xl',
  hero: 'rounded-2xl',
} as const satisfies Record<RadiusTier, string>;

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
 * | `/trends`    |       4 | the two, the active tab, "Log weight"                                   |
 * | `/add`       |       5 | the two, the "Set up AI" link, the active tab's icon and its label      |
 * | `/diary`     |       9 | the two, the active tab (two), the camera key, two links, two status dots |
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
  '/diary': 9,
  '/dashboard': 12,
  '/trends': 4,
  '/settings': 2,
  '/add': 5,
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
