# 0025, the managed model stays on Gemini 3.8 Flash on the global host

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** Altan Sarisin (owner), with an architecture brief from Fable
- **Relates to:** [0024](0024-a-feature-gate-is-a-door-and-the-proxy-is-the-only-lock.md)

## Context

The owner signed the OpenRouter data processing agreement (Business plan). The
owner then asked for the managed AI to run in the EU region: the host
`eu.openrouter.ai`, zero retention, and the Vertex EU pin. The aim was a green
slate on data privacy.

The EU host has no Gemini 3.7 Flash and no Gemini 3.8 Flash. The managed model
today is `google/gemini-3.8-flash` on the global host, pinned to
`google-vertex`, with zero retention. So a switch means a different model, and a
different model must prove it is as safe.

A decision rule was written BEFORE any measurement. It has six blocking rules.
Any one failure means no switch.

1. Schema validity: zero schema-invalid answers, zero false "unreadable" plates.
2. Pregnancy misses on clear cases: zero, in every repeat.
3. Pregnancy misses overall: no higher than the reference.
4. Allergen misses overall: no higher than the reference.
5. Recall: the upper bound of the paired 95 percent bootstrap interval of
   (reference recall minus candidate recall) is at most 8 points.
6. Hallucinations: at most the reference count plus 1.

Six EU candidates were measured in two rounds. Each ran the production request:
50 licensed plates (235 gold items), the 91 typed meals three times, and the
kcal rows. Round two used the v4 prompt and added a held-out typed set of 36
cases. That set names no food that the prompt names, so a pass shows that a model
applies a category to a food it was never shown.

Plate recall is the mean over runs, against 3.8 on the same prompt (84.7 on v3,
88.5 on v4). Prices are USD per million tokens, input / output, at the EU host
price (3.8 Flash on the global host: 0.75 / 3.75).

| model, provider pin | price | plates recall | holdout pregnancy misses per repeat | rule 1 failures | verdict |
| --- | --- | --- | --- | --- | --- |
| `gemini-3.5-flash-lite`, `google-vertex/eu` | 0.33 / 2.75 | 82.1 vs 84.7 | not run | 1 typed call | fails 1, 3, 4, 5 |
| `gemini-2.5-flash-lite`, `google-vertex/eu` | 0.10 / 0.40 | 66.8 vs 84.7 | not run (main set: [5, 2, 4]) | 7 typed calls, 11 plates | fails 1, 2, 3, 4, 5 |
| `gemini-2.5-flash`, `google-vertex/eu` | 0.30 / 2.50 | 83.8 vs 88.5 (v4) | [5, 5, 5] | 1 call (token cap) | fails 1, 2, 4, 5 |
| `gemini-3.1-flash-lite`, `google-vertex/eu` | 0.275 / 1.65 | 77.9 vs 88.5 | [5, 4, 6] | 0 | fails 2, 3, 4, 5 |
| `mistral-medium-3.1`, `mistral/eu` | 0.44 / 2.20 | 80.0 vs 84.7 | not run (main set: [0, 0, 0]) | 0 | fails 3, 4, 5, 6 |
| `gpt-6-luna`, `azure/eu` | 0.11 / 0.55 | 63.7 vs 88.5 | [4, 3, 2] and one case refused | 4 calls | fails 1, 2, 3, 4, 5, 6 |

The reference, 3.8 with the v4 prompt, misses the holdout pregnancy cases
[1, 1, 2] per repeat. It misses pike quenelles every time, so even the reference
is not clean on that set. The gap is still large: 1 to 2 misses against 4 to 6.

The reports hold the full numbers:
`apps/inference/eval/runs/EU-CANDIDATES-SCORING-2026-10-06.md` (round one, v3
prompt) and `apps/inference/eval/runs/EU-CANDIDATES-V4-SCORING-2026-10-06.md`
(round two, v4 prompt).

## Decision

**The managed model stays `google/gemini-3.8-flash` on the global OpenRouter
host, with the `google-vertex` pin and zero retention.** It runs with
`reasoningEffort: minimal` and the v4 prompt. The v4 prompt lifted 3.8 itself
from 84.7 to 88.5 plate recall.

No EU model passes the rule. Safety outranks region. The reasons, by model:

- **The cheaper Google models lack regional fish knowledge.** On the holdout they
  miss the pregnancy flags for matjes herring, orange roughy, seared ahi tuna and
  smoked saithe. 3.1 Flash Lite also misses the liver in haggis.
- **2.5 Flash is the closest on plates, and it still fails.** After the prompt
  uplift of 3.8 it misses the recall bound by 2.5 points (upper bound 10.5
  against a limit of 8). It also misses 5 pregnancy flags per repeat on the
  holdout, and it spends about 750 reasoning tokens per call although `minimal`
  was asked.
- **Azure filters a food name.** The content filter of `gpt-6-luna` refuses
  "faggots", a liver dish, in every repeat. It also hallucinates above the limit.
- **Mistral raises many false pregnancy alarms and hallucinates.** It raised 53
  false alarms on the controls against 7 for 3.8, and it fails rule 6.

## Alternatives Considered

- **Switch to 3.5 Flash Lite on the EU host.** It is the closest to 3.8 in the
  first round (82.1 against 84.7). It still failed the pregnancy, allergen and
  recall rules, and one typed call failed.
- **2.5 Flash on the EU host with the v4 prompt.** It fails the holdout
  pregnancy rule, the allergen rule and the recall rule, and one plate ran into
  the token cap.
- **Routes by schema name.** `ai-tiers.json` can send only recipes or only the
  pantry to another model. This does not help. The failing calls are plates and
  typed meals, and the EU host has no stronger Gemini for the other calls.
- **Split hosting.** Plates on the global host and typed text on the EU host.
  Rejected. The privacy text would name two regions of processing for one
  feature.

## Consequences

- The privacy text keeps naming the Gemini family and Google Cloud Vertex AI. No
  legal change follows from this record.
- A Mistral or Azure switch would have needed new sub-processor text in six
  languages. That cost is avoided.
- The EU host carries about a 10 percent price surcharge. That is a further cost
  of any later switch.
- **Revisit when** the EU host lists a Gemini 3.x Flash, or when the prompt names
  the regional fish explicitly. Then run the holdout set again. It costs about
  0.4 USD per cell.
- The test bed stays and is reusable: the eval harness, the prefill tool, the
  holdout gold with its aliases, the decision rule, and the two reports named
  above. All of it lives in `apps/inference/eval`.
- **Budget.** The two rounds spent about 9 USD of the production OpenRouter key.
  That key has a monthly limit of 20 USD, and 2.87 USD was left on 2026-10-06.
  This left production short. The production key limit must never throttle
  customers, so the owner raises the key limit. Future eval runs use a separate
  key with its own cap, and never the production key.

## References

- `apps/inference/eval/runs/EU-CANDIDATES-SCORING-2026-10-06.md`,
  `apps/inference/eval/runs/EU-CANDIDATES-V4-SCORING-2026-10-06.md`.
- `apps/inference/eval/gold/gold_text_holdout.jsonl`,
  `apps/inference/eval/gold/GOLD-NOTES.md`.
- `apps/core/ai-tiers.json`, the one file that names the managed model.
- The decision rule: `.tracker/worklog/eu-switch-decision-rule.md` in the
  umbrella workspace.
