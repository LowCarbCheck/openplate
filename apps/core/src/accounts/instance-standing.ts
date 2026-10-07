/**
 * What the instance grants an account that has no record of its own, read once
 * from the environment and handed to every place that needs it.
 *
 * ONE OBJECT, NOT A SETTING PER CONSUMER. The AI proxy enforces these values,
 * the account view reports them, and `/health` publishes them, and a number
 * that three places read from three bindings is a number that one day differs.
 * `main.ts` builds this once from the parsed config.
 *
 * EVERY FIELD'S OFF STATE IS TODAY'S BEHAVIOUR. An instance that sets none of
 * the variables behind these fields behaves exactly as it did before they
 * existed, and that includes every self-hosted instance. {@link NO_INSTANCE_STANDING}
 * is that state, for a test or a wiring that has nothing to say.
 */
import { NO_FREE_AI_LIMIT, type AiLimitWindow } from './ai-allowance.js';

export interface InstanceStanding {
  /**
   * The free AI limit an account gets when its own `free_daily_ai_limit` is
   * `0`, with its window: `DEFAULT_FREE_DAILY_AI_LIMIT` per UTC day, or
   * `DEFAULT_FREE_WEEKLY_AI_LIMIT` per ISO week in UTC (2026-10-07). The two
   * cannot both be set. A limit of `0` is off, and what an instance that set
   * neither has. See `accounts/ai-allowance.ts`.
   */
  defaultFreeAiLimit: AiLimitWindow;
  /**
   * `DEFAULT_CAPABILITIES`: the capabilities an account has when it holds no
   * record of its own. `null` is no check at all, which is what an instance
   * that set nothing has. `[]` grants nothing. See `lib/capabilities.ts`.
   */
  defaultCapabilities: readonly string[] | null;
  /** `CAPABILITY_SCHEMA_MAP`: a structured-output schema name to the capability its use needs. Empty is none. */
  capabilitySchemaMap: ReadonlyMap<string, string>;
}

/** The standing of an instance that configured none: no default free limit. */
export const NO_INSTANCE_STANDING: InstanceStanding = {
  defaultFreeAiLimit: NO_FREE_AI_LIMIT,
  defaultCapabilities: null,
  capabilitySchemaMap: new Map(),
};
