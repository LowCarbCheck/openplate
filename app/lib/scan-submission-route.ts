/**
 * Pure dispatch decision for `scan.tsx`'s `clientAction` (M117/02 — extracted
 * for unit testing, per review). Every submission to `/scan` is either the
 * `confirm` intent (writes food logs — stays a normal server round trip via
 * `serverAction()`, spec 03 territory, unchanged) or the `identify` intent
 * (the BYOK vision call, which must run entirely client-side and never reach
 * the server). The actual routing side effects (`serverAction()` /
 * `handleClientIdentify`) stay in the route module; this function only
 * decides which one applies.
 */
export type ScanSubmissionRoute = 'server' | 'client';

/**
 * @param intent - the submitted form's `_intent` field value.
 * @returns `'server'` for a `confirm` submission, `'client'` for everything
 *   else (identify, or any unrecognized intent — fails toward the
 *   never-touches-the-server side rather than silently posting to the server).
 */
export function decideScanSubmissionRoute(intent: FormDataEntryValue | null): ScanSubmissionRoute {
  return intent === 'confirm' ? 'server' : 'client';
}
