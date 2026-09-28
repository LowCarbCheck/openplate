/**
 * A read that must not hold a screen or a navigation for ever.
 *
 * Resolves with what the promise resolves, or with `null` once `timeoutMs`
 * has passed, whichever is first. The promise itself is left running: a read
 * that lands late still writes wherever it writes (a module cache), so the
 * NEXT caller gets its answer. Used by the consent gate in `_personal.tsx`,
 * which fails open on a slow read, and by `/join`, which draws the form
 * without the consent box rather than wait on a handshake that does not
 * answer. (`plan-gate-facts.ts` keeps its own copy for now.)
 *
 * @param promise - a read that answers `null` for "not known" itself.
 * @param timeoutMs - the longest the caller waits.
 */
export async function withTimeout<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((settle) => {
    timer = setTimeout(() => settle(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
