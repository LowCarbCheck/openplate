/**
 * The two grid recipes the Insights tabs share (2026-09-21).
 *
 * `/trends` is a container and a grid: one column until the page has 48rem of
 * room, two after it (`trends.tsx`). A tab component returns its cards straight
 * into that grid, and each card either takes the whole row (`WIDE_CLASS`) or
 * shares one with a neighbour (`PAIR_CLASS`). Written once here so the Overview,
 * Meals and Goals tabs cannot drift into three slightly different gutters.
 *
 * The `@3xl` variants are CONTAINER queries, so they answer to the room the
 * page has and not to the window: with the sidebar open a 1024 px window gives
 * the page a phone-sized tablet's worth of room, and it stays one column.
 */

/** A card that runs across both columns. */
export const WIDE_CLASS = '@3xl:col-span-2';

/**
 * Two cards side by side across the full row. A lone child (the other one is
 * switched off, or has nothing to say) takes the whole row instead of leaving
 * half of it empty.
 */
export const PAIR_CLASS = 'grid gap-6 @3xl:col-span-2 @3xl:grid-cols-2 @3xl:[&>*:only-child]:col-span-2';
