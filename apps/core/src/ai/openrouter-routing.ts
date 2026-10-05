/**
 * `UPSTREAM_ZDR` and `UPSTREAM_PROVIDER_ONLY`, parsed: the two OPTIONAL routing
 * settings for an OpenRouter upstream (M3 spec 02).
 *
 * This module is where the model tier file (`ai/model-tiers.ts`) gets its
 * provider slug rule and its two emergency overrides, so that rule is written
 * once. `config.ts` parses the two variables through it too (it used to carry
 * a private copy), so a typo stops the boot with the same message either way.
 *
 * Pure module: no config, no DB, no clock.
 */
import type { OpenRouterRouting } from './chat-body-policy.js';

/**
 * An OpenRouter provider slug: lowercase letters and digits, joined by `-`,
 * `.`, `_` or `/` (`google-vertex`, `amazon-bedrock`, `deepinfra/turbo`). Not a
 * model id, and not a display name such as "Google Vertex".
 */
export const PROVIDER_SLUG = /^[a-z0-9][a-z0-9._/-]*$/;

/**
 * `UPSTREAM_ZDR` and `UPSTREAM_PROVIDER_ONLY`. Both unset, the default, change
 * nothing: an instance that runs another host or another model is not touched.
 *
 *  - `UPSTREAM_ZDR=true` asks for endpoints with zero data retention. `false`
 *    and empty mean off. Any other spelling (`yes`, `1`) is a boot failure,
 *    because a typo that quietly meant "off" would leave the operator believing
 *    retention is switched off at the provider.
 *  - `UPSTREAM_PROVIDER_ONLY` is a comma separated list of provider slugs. An
 *    empty entry (`a,,b`, a trailing comma) or a name that is not a slug (an
 *    uppercase letter, a space) is a boot failure that names the entry.
 *
 * BOTH ONLY ACT ON AN OPENROUTER HOST. Another host gets no `provider` object
 * at all (`ai/chat-body-policy.ts`), so on one these settings do nothing.
 */
export function parseOpenRouterRouting(env: NodeJS.ProcessEnv): OpenRouterRouting {
  const zdr = env.UPSTREAM_ZDR?.trim().toLowerCase() ?? '';
  if (zdr !== '' && zdr !== 'true' && zdr !== 'false') {
    throw new Error(`Invalid UPSTREAM_ZDR: expected true, or leave it unset, got "${env.UPSTREAM_ZDR?.trim()}"`);
  }

  const rawOnly = env.UPSTREAM_PROVIDER_ONLY?.trim() ?? '';
  const onlyProviders = rawOnly === '' ? [] : rawOnly.split(',').map((entry) => entry.trim());
  for (const slug of onlyProviders) {
    if (!PROVIDER_SLUG.test(slug)) {
      throw new Error(
        `Invalid UPSTREAM_PROVIDER_ONLY entry "${slug}": expected comma separated lowercase provider slugs ` +
          'such as google-vertex, with no empty entry',
      );
    }
  }

  return { zeroDataRetention: zdr === 'true', onlyProviders: [...new Set(onlyProviders)] };
}
