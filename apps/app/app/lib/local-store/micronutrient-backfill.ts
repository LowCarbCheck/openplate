/**
 * The micronutrient backfill LEDGER on the device: one row per LowCarbCheck
 * slug, holding what the lookup answered (2026-10-13).
 *
 * See `MICRONUTRIENT_BACKFILL_TABLE` in `schema.ts` for why it is a table of
 * its own that never syncs, and `#app/lib/micronutrient-backfill` for what a
 * row means. This module only reads and writes the rows.
 *
 * ── COMPARE-AND-SET ──────────────────────────────────────────────────────
 *
 * The job reads the ledger, waits on the network, then writes. Another tab may
 * have settled a slug in that gap. {@link recordMicronutrientBackfill} writes a
 * row only when its STORED TEXT is still exactly what the job read (or still
 * absent), all inside one TinyBase transaction, so a late answer can never
 * overwrite a newer one. The comparison is on the raw cell, not the parsed
 * row, so a row that no longer parses is still replaced by the next answer
 * instead of blocking its slug for ever.
 *
 * It never writes any other table. The diary's own rows are read by the job,
 * never written, which is the guarantee the whole design rests on.
 */
import { z } from 'zod';
import type { Store } from 'tinybase';
import {
  backfillLedgerEntrySchema,
  type BackfillLedger,
  type BackfillLedgerEntry,
} from '#app/lib/micronutrient-backfill';
import { getPrimaryStore } from './persist';
import { MICRONUTRIENT_BACKFILL_CELL, MICRONUTRIENT_BACKFILL_TABLE } from './schema';

/** Options accepted by every verb here; the store defaults to the primary singleton. */
interface StoreOption {
  store?: Store;
}

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getPrimaryStore());
}

/** The cell as it comes back off the store, a TinyBase cell, not yet JSON text. */
const ledgerCellSchema = z.string();

/** Parses one stored cell, or `null` for a cell that is missing or no longer parses. */
function parseLedgerCell(cell: string): BackfillLedgerEntry | null {
  let json: z.infer<ReturnType<typeof z.json>>;
  try {
    json = JSON.parse(cell);
  } catch {
    return null;
  }
  const parsed = backfillLedgerEntrySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Every ledger row's stored text, by slug: what a compare-and-set compares against.
 *
 * @param options.store - the primary store, or the singleton.
 * @returns the raw cell of every row.
 */
export async function readMicronutrientBackfillCells({ store }: StoreOption = {}): Promise<Map<string, string>> {
  const resolved = await resolveStore(store);
  const cells = new Map<string, string>();
  for (const slug of resolved.getRowIds(MICRONUTRIENT_BACKFILL_TABLE)) {
    const cell = ledgerCellSchema.safeParse(
      resolved.getCell(MICRONUTRIENT_BACKFILL_TABLE, slug, MICRONUTRIENT_BACKFILL_CELL),
    );
    if (cell.success) cells.set(slug, cell.data);
  }
  return cells;
}

/**
 * The parsed ledger. A row that no longer parses reads as never asked.
 *
 * @param cells - the raw cells, from {@link readMicronutrientBackfillCells}.
 * @returns the rows that parse, by slug.
 */
export function parseMicronutrientBackfillCells(cells: ReadonlyMap<string, string>): Map<string, BackfillLedgerEntry> {
  const ledger = new Map<string, BackfillLedgerEntry>();
  for (const [slug, cell] of cells) {
    const entry = parseLedgerCell(cell);
    if (entry !== null) ledger.set(slug, entry);
  }
  return ledger;
}

/**
 * The device's ledger, for a screen that reads the log.
 *
 * @param options.store - the primary store, or the singleton.
 * @returns every parsed row, by slug.
 */
export async function readMicronutrientBackfillLedger({ store }: StoreOption = {}): Promise<BackfillLedger> {
  return parseMicronutrientBackfillCells(await readMicronutrientBackfillCells({ store }));
}

/** One row the job wants to write, and the stored text it read before it asked. */
export interface LedgerWrite {
  slug: string;
  /** The cell the job read, or `null` when the slug had no row. The write happens only if this still holds. */
  expectedCell: string | null;
  entry: BackfillLedgerEntry;
}

/**
 * Writes the rows whose stored text has not changed since the job read it,
 * in ONE transaction, and skips the rest.
 *
 * @param options.writes - the rows to write.
 * @param options.store - the primary store, or the singleton.
 * @returns the slugs actually written; a slug missing from it was changed by somebody else first.
 */
export async function recordMicronutrientBackfill({
  writes,
  store,
}: StoreOption & { writes: readonly LedgerWrite[] }): Promise<string[]> {
  const resolved = await resolveStore(store);
  const written: string[] = [];
  resolved.transaction(() => {
    for (const { slug, expectedCell, entry } of writes) {
      const current = resolved.getCell(MICRONUTRIENT_BACKFILL_TABLE, slug, MICRONUTRIENT_BACKFILL_CELL) ?? null;
      if (current !== expectedCell) continue;
      resolved.setRow(MICRONUTRIENT_BACKFILL_TABLE, slug, { [MICRONUTRIENT_BACKFILL_CELL]: JSON.stringify(entry) });
      written.push(slug);
    }
  });
  return written;
}
