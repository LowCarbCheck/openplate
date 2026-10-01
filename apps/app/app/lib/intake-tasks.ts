/**
 * WHICH PROVIDER TASK A SCREEN SENDS, named once, so the screen that offers an
 * intake and the screen that runs it cannot disagree about what a server is
 * asked to do.
 *
 * `/add/describe` parks words for whoever asked for them (`intake-consumers.ts`),
 * and the two consumers run different tasks: the diary's `/add/photo` reads a
 * sentence as a MEAL (`describe`), the pantry reads it as a SHELF
 * (`pantryText`). An endpoint can run one and not the other, so the composer
 * asks about the task of the consumer it is writing for, never about "typing"
 * in general.
 *
 * Total over `IntakeConsumer`, so a consumer added to the allowlist without a
 * task here is a compile error rather than a composer that silently asks about
 * the wrong one.
 */
import type { IntakeConsumer } from '#app/lib/intake-consumers';
import type { ProviderTask } from '#app/lib/ai/provider-capabilities';

const TYPED_TASK_BY_CONSUMER = {
  '/add/photo': 'describe',
  '/pantry': 'pantryText',
} as const satisfies Record<IntakeConsumer, ProviderTask>;

/**
 * The task the words typed on `/add/describe` become, for one consumer.
 *
 * @param consumer - who the words are for, from `parseIntakeConsumer`.
 * @returns the provider task the receiving screen will run.
 */
export function typedTaskFor(consumer: IntakeConsumer): ProviderTask {
  return TYPED_TASK_BY_CONSUMER[consumer];
}
