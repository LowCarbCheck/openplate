/**
 * WHERE THE "WHAT HAPPENS TO YOUR DATA" BOX IS SHOWN (M3/07, 2026-10-04).
 *
 * The box names OpenRouter, Google, a recovery key and a retention period. All
 * four are facts about the managed gateway, so a self-hosted instance must not
 * say them: its photo goes from the browser to a provider the person chose, and
 * its operator holds nothing of the sort.
 *
 * ── Two questions, both answered from the public config ──────────────────
 *
 * 1. `policy.aiComesFromTheInstance`: the photo passes through the operator's
 *    proxy under the operator's key. This is the question behind every
 *    sentence that names a recipient (`instance-policy.ts`), true on a managed
 *    instance and false on an open one, whatever else an open one configures.
 * 2. `hasLegalPages`: the instance publishes a privacy notice. The box ends by
 *    pointing at that notice, and a pointer to a page that is not there is a
 *    broken promise.
 *
 * Both come from the root loader's public config, so they are known on the
 * first render and the box has no second moment at which it can arrive. The
 * two other signals were left out on purpose. `hasPlansDoor` is read from the
 * handshake, which answers after the page is drawn, so a box keyed on it would
 * be a second arrival after the form. `useHasLegalPages` alone is true on a
 * self-hosted instance whose operator mounted an imprint, which would put the
 * OpenRouter sentence on a server that never sends a photo there.
 */
import type { InstancePolicy } from '#app/config/instance-policy';
import { REPO_URL } from '#app/lib/brand';

/**
 * Whether `/sign-up` draws the box.
 *
 * @param input.policy - what this instance's mode answers.
 * @param input.hasLegalPages - whether the instance publishes its legal pages.
 */
export function showsSignUpDataBox({
  policy,
  hasLegalPages,
}: {
  policy: Pick<InstancePolicy, 'aiComesFromTheInstance'>;
  hasLegalPages: boolean;
}): boolean {
  return policy.aiComesFromTheInstance && hasLegalPages;
}

/**
 * The public file that handles the photo, linked from the box so a reader can
 * check the first sentence against the code.
 */
export const PHOTO_PROXY_SOURCE_URL = `${REPO_URL}/blob/main/apps/core/src/ai/proxy.ts`;
