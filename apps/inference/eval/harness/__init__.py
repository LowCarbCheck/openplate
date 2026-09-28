"""Reusable, config-driven plate-identification eval harness.

Python 3 standard library only -- no pip installs, no yaml (configs are JSON).

Modules:
  schema      -- production system prompt, output JSON schema, ensemble prompt
                 variants, judge prompt, tolerant JSON parse + validator.
  providers   -- one OpenAI-compatible chat-completions client covering both
                 OpenRouter and local llama-server/ollama.
  approaches  -- single-call and ensemble+judge approaches.
  runner      -- CLI: run a config over the image corpus, write results.json.
  scorecard   -- CLI: turn results.json into a human scoring worksheet.
"""

__all__ = ["schema", "providers", "approaches", "runner", "scorecard"]
