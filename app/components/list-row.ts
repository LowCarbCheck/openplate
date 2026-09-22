/**
 * The surfaces a list is made of: the navigable row, the data row inside a
 * panel, and the neutral chip that states a figure beside a label.
 *
 * ── WHY THE ROW IS NAMED ONCE ────────────────────────────────────────────
 *
 * Four lists in this app show the same thing, a name with a fact under it and
 * a control at the end, and they drew it three ways: `/diary` and `/meals` as
 * a `Card`, `/add`'s search results and `/foods`' saved foods as a
 * hand-written box, on stacks 8 and 12px apart (FRONT-22). The radius alone
 * made the two halves of the same screen look like two products.
 *
 * So the row shape is named once, here, and the hand-written lists read it. It
 * is a class string rather than a component because these rows are a `button`,
 * a `div` and a `form` in their own files, each with its own layout and its
 * own handlers: the only thing they share is the surface.
 *
 * ── THE DATA ROW IS A DIFFERENT THING ────────────────────────────────────
 *
 * A NAVIGABLE row goes somewhere: it has a card's fill and a card's hairline,
 * because it is a card you can tap. A DATA row goes nowhere: it is a label, a
 * figure and a status dot inside a panel that is already a card, so it has no
 * border at all and a quieter fill. Giving both the same surface is what made
 * a screen read as boxes inside boxes.
 *
 * Every corner here is square (operator decision, 2026-09-22): neither row
 * draws a radius any more, and the ladder that used to give the navigable row
 * 8px and the data row 4px (`tests/design-contract.ts`) is retired. The one
 * round shape left is `DATA_ROW_DOT_CLASS`'s dot, a circle by design.
 */

/** The navigable row: 12px padding, a card fill and a hairline. */
export const LIST_ROW_CLASS = 'border bg-card p-3';

/** The distance between two of those rows, the same 12px the settings groups use. */
export const LIST_STACK_CLASS = 'space-y-3';

/** A data row inside a panel: no border, a quiet fill. */
export const DATA_ROW_CLASS = 'flex items-center gap-2 bg-muted/40 p-3';

/** Its label: the quiet half of the row. */
export const DATA_ROW_LABEL_CLASS = 'text-sm font-medium text-muted-foreground';

/** Its figure, pushed to the end and lined up digit under digit. */
export const DATA_ROW_VALUE_CLASS = 'ml-auto text-sm font-semibold tabular-nums';

/** Its status dot, which carries the colour the row is allowed to have. */
export const DATA_ROW_DOT_CLASS = 'size-4 shrink-0 rounded-full';

/**
 * A chip that states a figure beside a label.
 *
 * NEUTRAL, deliberately. These chips were `bg-primary/10 text-primary`, so a
 * meal's carb subtotal, a nutrient's share of its target and a bundle's item
 * count were all painted in the brand colour. A number is a number: the teal
 * budget on a screen is the active tab, the one primary action and the links
 * (DESIGN.md section 6), and spending it on arithmetic leaves nothing to point
 * at what a person should actually do. Callers add their own `text-xs`,
 * `font-medium` and `tabular-nums`; the size and the weight are the caller's
 * business, the fill and the ink are not.
 */
export const CHIP_NEUTRAL = 'bg-muted px-2 py-0.5 text-foreground';
