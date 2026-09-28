/**
 * The id rule of a YAZIO import (M254/01), on its own so the local store can
 * read it (M254/05) without loading the parser, its Zod schemas and its date
 * helpers. `#app/lib/yazio-import` re-exports both names; this module imports
 * nothing, so neither direction can grow a cycle.
 */

/**
 * The prefix every imported row id carries: `yazio-<consumed item id>` for a
 * diary entry, `yazio-weight-<dayKey>` for a weigh-in. It is how a later
 * import tells its own rows from rows the person logged.
 */
export const YAZIO_ENTRY_ID_PREFIX = 'yazio-';

/**
 * Whether a row id is one a YAZIO import wrote, a diary entry or a weigh-in.
 * Nothing else in the app writes {@link YAZIO_ENTRY_ID_PREFIX}, so this is
 * the whole test "Remove YAZIO entries" (M254/05) applies, and the one
 * `upsertLocalWeightEntryForDay` uses to tell an imported weigh-in from one
 * the person logged.
 */
export function isYazioImportId(id: string): boolean {
  return id.startsWith(YAZIO_ENTRY_ID_PREFIX);
}
