/**
 * The one surface a row in a searchable or manageable list draws.
 *
 * Four lists in this app show the same thing, a name with a fact under it and
 * a control at the end, and they drew it three ways: `/diary` and `/meals` as
 * a `Card` (16px radius, 16px padding), `/add`'s search results and `/foods`'
 * saved foods as a hand-written `rounded-lg border bg-card p-3` (8 and 12), on
 * stacks 8 and 12px apart (FRONT-22). The radius alone made the two halves of
 * the same screen look like two products.
 *
 * So the row shape is named once, here, in the values the cards already use,
 * and the two hand-written lists read it. It is a class string rather than a
 * component because these rows are a `button`, a `div` and a `form` in their
 * own files, each with its own layout and its own handlers: the only thing
 * they share is the surface.
 */

/** The surface: 16px radius, 16px padding, a card fill and a hairline. */
export const LIST_ROW_CLASS = 'rounded-2xl border bg-card p-4';

/** The distance between two of those rows, the same 12px the settings groups use. */
export const LIST_STACK_CLASS = 'space-y-3';
