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
export interface InstanceStanding {
  /**
   * `DEFAULT_FREE_DAILY_AI_LIMIT`: the AI requests per UTC day an account gets
   * when its own `free_daily_ai_limit` is `0`. `0` is off, and what an
   * instance that did not set it has. See `accounts/ai-allowance.ts`.
   */
  defaultFreeDailyAiLimit: number;
}

/** The standing of an instance that configured none: no default free limit. */
export const NO_INSTANCE_STANDING: InstanceStanding = {
  defaultFreeDailyAiLimit: 0,
};
