/**
 * Trailing-slash removal in one pass, with no regular expression.
 *
 * WHY NOT `value.replace(/\/+$/, '')`. That search is unanchored at the start,
 * so the engine tries `\/+` from every slash in a run, and only the last run
 * can reach `$`. A value with n slashes followed by any other character costs
 * about n²/2 steps (CodeQL `js/polynomial-redos`). Every value this service
 * strips comes from configuration, a peer or a request, and a quadratic step
 * on any of them is a stall nobody needs to reason about. This walks back from
 * the end once, so its cost is the number of slashes it removes.
 *
 * `tests/unit/trailing-slashes.test.ts` holds the old expression as the
 * reference and checks both agree on every documented input.
 */

/** `value` without its trailing `/` characters. `'/'` and `'///'` become `''`, as the old expression made them. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}
