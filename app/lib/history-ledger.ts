import { z } from 'zod';

/**
 * WHAT PATHNAME SITS AT EACH HISTORY INDEX.
 *
 * `useAppNavigate` needs to answer one question the History API refuses to
 * answer: "is the screen I am going to already behind me, and how far?" The
 * browser exposes `history.length` and nothing else, you cannot read an entry
 * you are not standing on. So we keep our own note.
 *
 * The index we key on is React Router's own. `createBrowserHistory` stores it
 * on `window.history.state` under `idx`:
 *
 *   node_modules/react-router/dist/development/lib/router/history.js:205-215
 *     function getHistoryState(location, index) {
 *       return { usr: ..., key: ..., idx: index, masked: ... };
 *     }
 *
 * and reads it back at line 276-278:
 *
 *     function getIndex() {
 *       return (globalHistory.state || { idx: null }).idx;
 *     }
 *
 * Using the router's own counter rather than one of ours is what keeps the
 * ledger true across a reload: `sessionStorage` and `history.state` survive a
 * refresh together, so the note and the stack come back agreeing.
 *
 * Every function here is PURE over an injected storage, so the whole module is
 * testable in Node with a hand-written object and no DOM.
 */

/** The two `Storage` methods this module uses. `sessionStorage` satisfies it. */
export interface LedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One `sessionStorage` key. Session-scoped on purpose: so is the history stack. */
export const HISTORY_LEDGER_KEY = 'openplate.history-ledger.v1';

/**
 * A stack note: `entries[i]` is the pathname at history index `i`.
 *
 * `null` means "an index we have never stood on", possible when a browser
 * restores a session and drops us in at index 4 with nothing recorded below.
 * A hole is never a match, so it can only ever cost a pop we would not take.
 */
export interface HistoryLedger {
  entries: readonly (string | null)[];
}

/** The empty note, used for a first load and for any unreadable stored value. */
export const EMPTY_LEDGER: HistoryLedger = { entries: [] };

/**
 * The stored form: a flat array of pathnames, `null` for a hole. Decoded with
 * zod because this is I/O, and a note written by an older build (or by hand in
 * a devtools console) has to degrade to "I do not know", never throw.
 */
const storedLedgerSchema = z.array(z.union([z.string().min(1), z.null()]));

/**
 * Decode a stored ledger. Anything that is not an array of strings-or-nulls is
 * treated as absent rather than thrown on: this is a hint, and a corrupt hint
 * must degrade to "I do not know", which makes every navigation a replace.
 */
function decodeLedger(raw: string | null): HistoryLedger {
  if (raw === null) return EMPTY_LEDGER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_LEDGER;
  }
  const result = storedLedgerSchema.safeParse(parsed);
  if (!result.success) return EMPTY_LEDGER;
  return { entries: result.data };
}

/** Read the note out of the injected storage. */
export function readLedger(storage: LedgerStorage): HistoryLedger {
  return decodeLedger(storage.getItem(HISTORY_LEDGER_KEY));
}

/** Write the note back. */
export function writeLedger(storage: LedgerStorage, ledger: HistoryLedger): void {
  storage.setItem(HISTORY_LEDGER_KEY, JSON.stringify(ledger.entries));
}

export interface RecordLocationInput {
  ledger: HistoryLedger;
  /** React Router's `history.state.idx` for the location that just landed. */
  idx: number;
  /** That location's pathname, with no search and no hash. */
  pathname: string;
}

/**
 * Note that `pathname` is now standing at `idx`, and FORGET everything above
 * it.
 *
 * The truncation is the whole point. Going Back twice and then pushing a new
 * screen rewrites the future: the two entries that used to sit above are gone
 * from the browser's stack, and a note that still claimed them would send a
 * later `navigate(-n)` into an entry that no longer exists. `pushState` on the
 * browser side does exactly this, so the note copies it.
 *
 * @returns a new ledger; the input is not mutated.
 */
export function recordLocation({ ledger, idx, pathname }: RecordLocationInput): HistoryLedger {
  if (idx < 0) return ledger;
  const entries: (string | null)[] = ledger.entries.slice(0, idx);
  while (entries.length < idx) entries.push(null);
  entries.push(pathname);
  return { entries };
}

export interface FindEarlierInput {
  ledger: HistoryLedger;
  /** Where we are standing now. */
  idx: number;
  /** The pathname we would like to reach. */
  pathname: string;
}

/**
 * How many steps BACK the nearest earlier entry with this pathname is.
 *
 * Nearest, not first: we scan down from `idx - 1`, so a stack of
 * `/diary /settings /diary /settings/ai` standing at index 3 and asking for
 * `/diary` answers `2` (the second `/diary`), never `3`. Popping to the
 * furthest copy would throw away screens the person can still reach.
 *
 * @returns a POSITIVE step count to hand to `navigate(-n)`, or `null` when the
 *   pathname is nowhere behind us.
 */
export function findEarlier({ ledger, idx, pathname }: FindEarlierInput): number | null {
  const highest = Math.min(idx - 1, ledger.entries.length - 1);
  for (let candidate = highest; candidate >= 0; candidate -= 1) {
    if (ledger.entries[candidate] === pathname) return idx - candidate;
  }
  return null;
}
