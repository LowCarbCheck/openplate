/**
 * ONE SHORT LINE under a connected provider that says what its server does not
 * do, in a box that is there before the line is.
 *
 * ── THE BOX IS RESERVED, THE LINE IS NOT ────────────────────────────────
 *
 * The line arrives when the endpoint's `/models` answers, a moment after the
 * page has drawn, and the form under it must not move for it (DESIGN.md
 * section 7). So the slot has a fixed `min-h-20`, five lines of the 12 px
 * text, from the first paint, and the sentence fills it. An endpoint with
 * nothing missing leaves the same box empty, which is why two providers' pages
 * are the same height.
 *
 * ── THE WORDS ARE THE TRANSLATORS' ──────────────────────────────────────
 *
 * The line opens with ONE sentence: the one listing the tasks the server does
 * not run (a `{{tasks, list}}` placeholder, formatted by i18next in the
 * reader's language), or, for a server that runs every task and falls short
 * only elsewhere, the lead sentence. One whole sentence follows for each other
 * shortfall. They are joined with a space, never built from English
 * fragments. Which keys apply is `summarizeCapabilities`' answer.
 */
import { useTranslation } from 'react-i18next';

import {
  capabilityTaskKey,
  summarizeCapabilities,
  CAPABILITY_LEAD_KEY,
  CAPABILITY_TASKS_KEY,
} from '#app/lib/ai/capability-summary';
import type { ProviderCapabilities } from '#app/lib/ai/provider-capabilities';

export function ProviderCapabilitySummary({ capabilities }: { capabilities: ProviderCapabilities }) {
  const { t } = useTranslation();
  const summary = summarizeCapabilities(capabilities);
  const sentences: string[] = [];
  if (summary !== null) {
    // THE TASKS SENTENCE OPENS THE LINE when there is one: it names the
    // server itself, so a lead in front of it would only spend a line. The
    // lead stands in for it when every task runs.
    sentences.push(
      summary.tasks.length > 0 ?
        t(CAPABILITY_TASKS_KEY, { tasks: summary.tasks.map((task) => t(capabilityTaskKey(task))) })
      : t(CAPABILITY_LEAD_KEY),
    );
    for (const key of summary.sentenceKeys) sentences.push(t(key));
  }
  return (
    <div data-slot="provider-capability-summary" className="min-h-20 text-xs text-muted-foreground">
      {sentences.length > 0 && <p>{sentences.join(' ')}</p>}
    </div>
  );
}
