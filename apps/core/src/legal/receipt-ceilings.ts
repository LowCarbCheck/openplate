/**
 * The three daily ceilings on the receipts `POST /v1/legal/declarations`
 * mails, and the one rule that decides between them (M270/11).
 *
 * WHY THREE. The form needs no sign-in (§312k BGB), and each receipt goes out
 * from this instance's sending domain to an address the sender TYPED. One
 * ceiling per kind of abuse:
 *
 *  - PER ADDRESS (`LEGAL_DECLARATION_RECEIPTS_PER_ADDRESS_PER_DAY`, 3): one
 *    stranger cannot be mailed without limit. Counted from the stored rows.
 *  - PER SENDER NETWORK ({@link LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY},
 *    10): one sender cannot reach thousands of DIFFERENT addresses, which the
 *    per-address ceiling alone allowed at the 5-a-minute burst limit. The
 *    network is the burst limiter's own bucket, an IPv4 address or an IPv6
 *    /64 (`lib/ip-rate-limit.ts`).
 *  - PER INSTANCE ({@link LEGAL_DECLARATION_RECEIPTS_PER_DAY}, 200): many
 *    senders together cannot flood the domain whose reputation the password
 *    resets and invitations depend on. Counted from the stored rows.
 *
 * PAST ANY CEILING ONLY THE RECEIPT IS SKIPPED. The declaration is still
 * stored, forwarded and sent to the operator, because the law cares that it
 * was received, and the `202` stays byte identical, so a sender learns nothing.
 *
 * THE NETWORK COUNT IS IN MEMORY, AND THE OTHER TWO ARE NOT. A network key is
 * personal data, and a statutory row is kept for years
 * (`legal-declarations-retention.ts`); storing a sender's network next to it
 * for a 24-hour count would keep it for those years too. So the network
 * ledger lives in this process, like every per-IP limiter here, and resets on
 * a restart. The address and instance counts read the rows, which survive one.
 */

/** Receipts the form may send in any trailing 24 hours across all recipients, when `LEGAL_DECLARATION_RECEIPTS_PER_DAY` does not override it. */
export const LEGAL_DECLARATION_RECEIPTS_PER_DAY = 200;

/** Receipts one sender network may cause in any trailing 24 hours, when `LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY` does not override it. */
export const LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY = 10;

/** The trailing window every ceiling here counts over. */
export const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How often the ledger drops networks whose whole window has passed. Amortised across calls, like `lib/ip-rate-limit.ts`'s sweep. */
const LEDGER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Which ceiling stopped a receipt. The log line names it; the response never does. */
export type ReceiptCeiling = 'address' | 'network' | 'instance';

export type ReceiptDecision = { kind: 'send' } | { kind: 'skip'; ceiling: ReceiptCeiling; cap: number };

/** One count and the ceiling it is held to. A count includes the declaration being decided. */
export interface CountAgainstCap {
  count: number;
  cap: number;
}

/**
 * Whether the receipt for one declaration goes out. PURE.
 *
 * Checked narrowest first, so the log names the ceiling a person is most
 * likely to recognise: their own mailbox, then their own network, then the
 * instance. A count above its cap skips the receipt; a count equal to it
 * still sends, so a cap of 3 means three receipts.
 */
export function decideReceipt(input: {
  address: CountAgainstCap;
  network: CountAgainstCap;
  instance: CountAgainstCap;
}): ReceiptDecision {
  if (input.address.count > input.address.cap) return { kind: 'skip', ceiling: 'address', cap: input.address.cap };
  if (input.network.count > input.network.cap) return { kind: 'skip', ceiling: 'network', cap: input.network.cap };
  if (input.instance.count > input.instance.cap) return { kind: 'skip', ceiling: 'instance', cap: input.instance.cap };
  return { kind: 'send' };
}

export interface NetworkReceiptLedger {
  /**
   * Records one declaration from `network` at `atMs`, and answers how many
   * that network filed in the trailing window, this one included. Every
   * declaration counts, its receipt sent or not, so a network past its
   * ceiling stays past it until its oldest declarations age out.
   */
  record(input: { network: string; atMs: number }): number;
}

/** Drops timestamps at or before `windowStartMs`. The array is oldest first. */
function pruneExpired(input: { timestamps: number[]; windowStartMs: number }): void {
  const firstLive = input.timestamps.findIndex((timestamp) => timestamp > input.windowStartMs);
  input.timestamps.splice(0, firstLive === -1 ? input.timestamps.length : firstLive);
}

/**
 * The per-network count, in memory. See the module header on why not a row.
 *
 * BOUNDED BY `cap`: a network keeps at most `cap + 1` timestamps, the newest,
 * because past that the answer is "over" whatever the older ones were. So a
 * busy network costs a short array, and the map holds only networks seen in
 * the last day.
 */
export function createNetworkReceiptLedger(input: { cap: number; windowMs?: number }): NetworkReceiptLedger {
  const windowMs = input.windowMs ?? RECEIPT_WINDOW_MS;
  const keep = input.cap + 1;
  /** Network key -> its declarations' timestamps in the window, oldest first, at most `keep` of them. */
  const windows = new Map<string, number[]>();
  let lastSweepMs: number | null = null;

  function sweep(currentMs: number): void {
    if (lastSweepMs !== null && currentMs - lastSweepMs < LEDGER_SWEEP_INTERVAL_MS) return;
    lastSweepMs = currentMs;
    const windowStartMs = currentMs - windowMs;
    for (const [network, timestamps] of windows) {
      pruneExpired({ timestamps, windowStartMs });
      if (timestamps.length === 0) windows.delete(network);
    }
  }

  return {
    record({ network, atMs }): number {
      sweep(atMs);
      const timestamps = windows.get(network) ?? [];
      pruneExpired({ timestamps, windowStartMs: atMs - windowMs });
      timestamps.push(atMs);
      if (timestamps.length > keep) timestamps.splice(0, timestamps.length - keep);
      windows.set(network, timestamps);
      return timestamps.length;
    },
  };
}
