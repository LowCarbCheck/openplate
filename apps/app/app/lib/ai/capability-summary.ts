/**
 * WHAT A SETTINGS LINE SAYS ABOUT AN ENDPOINT THAT FALLS SHORT, as keys.
 *
 * `describeMissing` answers ids and no words (`provider-capabilities.ts`). This
 * turns those ids into the i18n KEYS of the sentences that name them, so a
 * translator owns every clause and the component only chooses which clauses to
 * show and in which order. Nothing here concatenates English: a missing task
 * is one value handed to a `{{tasks, list}}` placeholder (i18next formats the
 * list in the reader's language), and every other shortfall is one whole
 * sentence under its own key.
 *
 * Pure, no React and no i18n instance, so the whole mapping is a plain unit
 * test.
 */
import {
  PROVIDER_TASKS,
  describeMissing,
  type ProviderCapabilities,
  type ProviderTask,
} from '#app/lib/ai/provider-capabilities';

/** The key of the sentence that opens the summary. */
export const CAPABILITY_LEAD_KEY = 'settingsAi.capabilities.lead';

/** The key of the sentence that names the missing tasks through a list placeholder. */
export const CAPABILITY_TASKS_KEY = 'settingsAi.capabilities.tasks';

/** The key of one task's noun phrase, which fills that list. */
export function capabilityTaskKey(task: ProviderTask): string {
  return `settingsAi.capabilities.task.${task}`;
}

/** What the summary is made of: the tasks the endpoint does not run, and one whole sentence per other shortfall. */
export interface CapabilitySummary {
  /** In `PROVIDER_TASKS` order. Empty when every task runs. */
  tasks: ProviderTask[];
  /** Keys of whole sentences, in the order `describeMissing` lists the shortfalls. */
  sentenceKeys: string[];
}

/**
 * The summary for an endpoint, or `null` when there is nothing to say.
 *
 * @param capabilities - what the endpoint said, or the full default.
 * @returns the pieces of the line, or `null` for an endpoint with nothing missing.
 */
export function summarizeCapabilities(capabilities: ProviderCapabilities): CapabilitySummary | null {
  const missing = describeMissing(capabilities);
  if (missing.length === 0) return null;
  const tasks = PROVIDER_TASKS.filter((task) => missing.includes(task));
  const sentenceKeys: string[] = [];
  for (const id of missing) {
    if (id === 'flags') {
      sentenceKeys.push(
        capabilities.flags === 'none' ? 'settingsAi.capabilities.flagsNone' : 'settingsAi.capabilities.flagsPartial',
      );
    }
    if (id === 'translations') {
      sentenceKeys.push(
        capabilities.translations === 'none' ?
          'settingsAi.capabilities.translationsNone'
        : 'settingsAi.capabilities.translationsRequestLanguage',
      );
    }
    if (id === 'labels') sentenceKeys.push('settingsAi.capabilities.labelsNone');
  }
  return { tasks, sentenceKeys };
}
