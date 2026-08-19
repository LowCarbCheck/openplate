# openplate-inference eval harness

A gold-labeled plate-photo benchmark with a config-driven runner. Every model and ensemble
decision for this service is settled here by measurement, not impression.

Python 3 **standard library only** — no pip installs, no virtualenv, no yaml (configs are JSON).
Run everything from this `eval/` directory. One *optional* exception: a config that sets
`image_max_long_edge` uses Pillow to downscale client-side, and warns once to stderr and sends full
resolution if Pillow is absent — a missing dependency degrades the run, it never fails it. **That
warning is load-bearing:** it is the only difference between a real 896 px run and a full-resolution
run mislabelled as one.

**The reference rows every later change is measured against live in [BASELINE.md](BASELINE.md)** —
the control row (single-shot Qwen3-VL-8B + pipeline v3 @ 896 px), the adjudicated 50-image matrix
including the `google/gemini-3.1-flash-lite` frontier baseline, the bootstrap confidence intervals,
and what is closed. Specs 02–05 compare against that file, not against a per-run worksheet.

**Latency, throughput, capacity, the p95 ≤ 10 s product SLO, and the closed dead ends live in
[PERFORMANCE.md](PERFORMANCE.md)** — the canonical performance doc, recomputed from `runs/*/results.json`.

## Directory layout

```
eval/
├── harness/                # the harness package (stdlib only)
│   ├── schema.py           # production system prompt + output JSON schema + prompt variants
│   │                       #   + judge prompt + tolerant JSON parse/validate
│   ├── providers.py        # one OpenAI-compatible chat client (OpenRouter AND local llama-server)
│   ├── approaches.py       # single(...) and ensemble_judge(...)
│   ├── runner.py           # CLI: run a config over the corpus -> results.json
│   │                       #   + `check-labels` subcommand (corpus/label self-check)
│   ├── scorecard.py        # CLI: results.json + gold labels -> scoring worksheet
│   │                       #   + portion/macro error, --score, --compare
│   └── stats.py            # filled-worksheet parser + bootstrap CIs + UNDECIDED verdicts
├── concurrency-probe.py    # two-simultaneous-requests / fan-out timing instrument
├── BASELINE.md             # THE reference rows (control row, matrix, CIs, what is closed)
├── configs/
│   ├── openrouter-pilot.json   # the cloud pilot (costs money)
│   ├── local-cpu.json          # local llama-server run (free; latency + RAM are the cost)
│   └── local-cpu-v2.json       # round 2: judge-isolation matrix + Qwen3-VL-8B single-shot
├── images/                 # the corpus + manifest.json (provenance/licenses)
├── gold/gold_labels.json   # hand-authored labels
├── models/                 # downloaded GGUFs (gitignored)
├── serve/                  # local model registry + serve.sh + smoke test
├── SERVING.md              # how to serve a local model, and what failed to serve
└── runs/<name>/            # one directory per run: results.json, results_summary.md, scorecard.md
```

## Quickstart

### 1. Serve a model (local runs only)

See **[SERVING.md](SERVING.md)** for the full procedure and the evidence trail for models that
could not be served. Short version:

```bash
eval/serve/serve.sh lfm-vl      # llama-server on :8081 (vision, needs --mmproj)
eval/serve/serve.sh lfm-judge   # llama-server on :8082 (text-only judge)
python3 eval/serve/smoke_test.py lfm-vl
```

Ports are declared in `serve/models.json` and **must match** the `base_url`s in the local
configs: 8081 lfm-vl, 8082 lfm-judge, 8083 moondream (`local-cpu.json`), plus 8084 qwen-vl,
8085 qwen-judge, 8086 lfm-judge-think (`local-cpu-v2.json`).

For cloud runs, export the key instead — the harness reads it from its own env var and never
falls back to another app's config:

```bash
export OPENROUTER_API_KEY=...   # or: set -a && source .env && set +a
```

### 2. Run a config

```bash
cd eval

# resolve config/images/providers and exit without spending anything
python3 -m harness.runner --config configs/local-cpu.json --dry-run

# one image, one approach (the cheapest useful smoke test)
python3 -m harness.runner --config configs/openrouter-pilot.json --only 01 --approach baseline \
    --out runs/smoke

# the full local run
python3 -m harness.runner --config configs/local-cpu.json --out runs/2026-08-12-local-cpu
```

Pipeline v3 rows (`single_v3` / `ensemble_judge_v3` — the terse candidate contract the shipped
service uses) run through the same CLI — they are ordinary approach types in a config, e.g. `configs/local-cpu-v3.json`.

#### Remote endpoints and `${VAR}` in configs

Any string value in a config may reference an environment variable as `${VAR}`; `harness.runner`
expands it at load time and **exits with an error if the variable is unset** (never an empty
string, which would produce a nonsense URL that only fails on the first request). Escape a literal
as `$${...}`. This keeps ephemeral hostnames — Runpod pod ids, tunnels — out of git:

```bash
export RUNPOD_QWEN_URL=https://<pod-id>-8000.proxy.runpod.net/v1   # must include /v1
# export RUNPOD_QWEN_API_KEY=...   # only if llama-server was started with --api-key

# confirm the URL resolves before spending pod hours
python3 -m harness.runner --config configs/runpod-gpu-v3.json --dry-run

# one image first, then the corpus (896 px client-side downscale)
python3 -m harness.runner --config configs/runpod-gpu-v3.json --only 03
python3 -m harness.runner --config configs/runpod-gpu-v3.json

# the full-resolution control, into its own out_dir
python3 -m harness.runner --config configs/runpod-gpu-v3-fullres.json
```

Resolution is a property of the run, not a flag: the two variants are two config files
(`runpod-gpu-v3.json` at `image_max_long_edge: 896`, `runpod-gpu-v3-fullres.json` at `null`) with
separate `out_dir`s, so they cannot merge into one `results.json`.

Flags: `--only <id>` and `--approach <key>` are repeatable; `--images-dir` overrides the config;
`--fan-out N` truncates ensemble approaches to their first N prompt variants (ablation);
`--force` allows overwriting an output directory that already holds a `results.json` (the runner
refuses by default so prior runs can't be clobbered).

Output: `runs/<dir>/results.json` (per-image, per-approach: foods, latency, cost, tokens, plus a
`_summary` with cost totals, failures, the resolved config, and the host's CPU/RAM — a latency
number without its machine is not a measurement) and `runs/<dir>/results_summary.md` (per-image
food-name table, including each ensemble candidate).

### 3. Score a run

```bash
python3 -m harness.scorecard runs/2026-08-12-local-cpu/results.json          # -> scorecard.md
python3 -m harness.scorecard runs/2026-08-12-local-cpu/results.json --json   # mechanical metrics only
```

The worksheet auto-computes what is mechanical (item counts, latency mean/median/max, cost total
and cost-per-plate, schema-valid rate) and leaves semantic matching to a human or a reviewing
agent: gold core items become rows, each approach gets an empty cell to mark `Y`/`n`, plus a
hallucinations row.

**Matching is deliberately not automated.** Fuzzy string matching lies precisely where the answer
matters: "Greek salad" legitimately covers three gold rows, while "sashimi" for nigiri hides a rice
miss that changes the carb number. An auto-scorer would have graded both the same way.

### 4. Read a filled worksheet back (statistics)

Save the reviewed worksheet as `scorecard-filled.md` next to the `results.json`. Then:

```bash
python3 -m harness.scorecard --score runs/<dir>/scorecard-filled.md      # recall + 95% CI + error classes
python3 -m harness.scorecard --compare runs/<a>/scorecard-filled.md \
                                       runs/<b>/scorecard-filled.md      # WINNER or UNDECIDED
```

`--score` prints core recall with a **percentile bootstrap 95 % confidence interval** (10 000
resamples, fixed seed, `harness/stats.py`), plus the counted error classes (hallucinations,
over-decompositions). `--compare` prints **UNDECIDED** whenever the two intervals overlap, and only
names a WINNER when they are disjoint — the rule that stops "the harness settled it" from being
rationalisation with extra steps. It also reports a *paired* difference interval (same resampled
plates on both sides), which is more powerful; when the two disagree, both are printed and the
verdict stays UNDECIDED.

The bootstrap resamples **plates, not items**: a plate's items succeed or fail together (misread the
dish, miss all of it), so treating 235 items as independent trials would produce intervals that are
far too narrow. At n=50 the measured interval width is ≈ ±7 points — nothing smaller than that is a
result. Committed CIs are in [BASELINE.md](BASELINE.md) §3.

Generating a worksheet for an already-scored run prints the same statistics automatically.

### 5. Check the corpus and labels

```bash
python3 -m harness.runner check-labels        # non-zero exit on any FAIL
```

Image↔gold key parity, manifest licence/`source_url` coverage, `difficulty_tags` count, adversarial
trap count, and weighed-gram coverage — the checks that used to be `python3 -c` one-liners pasted
into a spec. Gram coverage reports `TODO` rather than `FAIL` (grams are a known open item; a
permanently red self-check is one nobody runs); `--require-grams` makes it a hard failure.

### 6. Measure concurrency, not just latency

```bash
eval/serve/serve.sh lfm-vl
python3 concurrency-probe.py --base-url http://127.0.0.1:8081/v1 --out runs/<dir>/probe.json
eval/serve/serve.sh stop all
```

One request, two sequential, **two simultaneous**, and a three-way fan-out — each request sending a
*different* image so the prompt-prefix cache cannot fake parallelism. The headline is
`parallel-2 / sequential-2`: 0.5 would be free concurrency, ~1.0 means plan capacity as if the box
were serial. Measured results and the operational rule they imply are in
[PERFORMANCE.md](PERFORMANCE.md) §7.

## Judge hardening (2026-08-11)

The first local run ([`runs/2026-08-11-local-lfm/SCORING.md`](runs/2026-08-11-local-lfm/SCORING.md))
proved the architecture — ensemble+judge lifted a 1.6B vision model from 71.4% to 90.5% core-item
recall on CPU — and identified the judge as the new bottleneck, failing three distinct ways:

| failure mode | evidence |
|---|---|
| **dedup failures** | `"Pizza"` ×3 on image 09; `"cheeseburger"` + `"Hamburger"` and `"fries"` + `"French Fries"` on 04; 9–10 items emitted on 02 despite the ≤6 rule |
| **hallucination leak-through** | a non-food `"napkin"` (09); `"lime wedges"`/`"guacamole"` read off image 10's **background menu poster** — the adversarial trap firing for the first time |
| **merge variance** | a real, multi-candidate item dropped (`sausages` on 01, `bread` in the smoke run), and inversely in the cloud run a distinctive single-candidate item (`Yorkshire pudding`) folded away |

Three changes, all in the judge stage only:

**1. The ≤6-item rule became a decoding constraint, not a request.** `harness/schema.py` now carries
`JUDGE_PLATE_IDENTIFICATION_JSON_SCHEMA` — a copy of the production schema with
`minItems: 1, maxItems: 6` on `foods` — sent as `plate_identification_merged` in the judge call's
`response_format`. llama-server compiles JSON Schema to GBNF, so the local judge now *cannot* emit a
7th item and has to merge instead. The **vision** call's schema is deliberately left untouched: it is
a faithful port of what openplate ships (`app/services/vision/schema.ts`), the eval must score the
production contract, and an over-enumerating *candidate* is not a defect — consolidating it is the
judge's whole job. The divergence and its rationale are commented at the definition site.
On cloud providers, `strict: true` structured outputs do not support `minItems`/`maxItems`; a 4xx
there makes `providers.chat_once` drop `response_format` and retry, so a cloud judge degrades to
prompt-only enforcement rather than failing.

**2. The judge prompt's bullets became numbered rules**, one per failure mode
(`schema.build_judge_system_prompt`, still parameterised by candidate count `n`):

1. **each real-world food appears EXACTLY ONCE** — merge case variants, synonyms, plural/singular and
   specific-inside-generic, with the measured pairs named literally as examples
2. **output only foods physically on the photographed plate/table setting** — non-food objects
   excluded outright; food visible only in a menu/poster/sign/screen/packaging art is not on the table
   "no matter how many candidates list it" (the old prompt's agreement rule would have *promoted* the
   poster leak)
3. **single-candidate items are kept only if visually distinctive and major** (Yorkshire pudding, the
   main protein, a whole side dish); minor single-candidate items are dropped as noise — this is the
   one rule that addresses merge variance in both directions
4. **never invent an item** absent from all candidates
5. confidence from agreement (unchanged, buckets still `n`-parameterised)
6. grams and macros from medians (unchanged, now explicit that merged rows count)
7. at most 6 items, mirroring the schema bound, with an explicit tie-break

**3. The judge call is deterministic by default.** `DEFAULT_JUDGE_TEMPERATURE = 0` — merging is
bookkeeping, diversity is the fan-out's job, and merge variance is pure downside at this stage. Two
per-approach knobs override it: `judge_temperature` and `judge_max_tokens`. The effective values are
recorded in each ensemble result so a run's judge settings are recoverable from `results.json`.

`configs/local-cpu-v2.json` measures the result. It holds vision constant (LFM2.5-VL ×3, variants
a/c/d — the n=3 lite profile) and varies *only* the judge across three approaches: the hardened
prompt+schema on the same LFM2.5-2.6B (`:8082`), a Qwen3-4B judge (`:8085`), and the same LFM judge
served with bounded reasoning enabled (`:8086`) — the three levers from SCORING finding 2, in order
of cost. A `Qwen3-VL-8B` single-shot row (`:8084`) puts a strong local single-shot next to the cloud
pilot's best.

## Extending it

**Add a model** — add an entry to a config's `models`:

```json
"qwen3_vl_8b": {
  "id": "qwen/qwen3-vl-8b-instruct",   // the id sent to the endpoint (llama-server ignores it)
  "provider": "openrouter",            // must name a key in the config's "providers"
  "price_per_mtok_in": 0.117,          // USD per million tokens; 0 (or omitted) for local
  "price_per_mtok_out": 0.455,
  "use_json_schema": true,             // false to never send response_format
  "max_tokens": null,                  // optional
  "extra_body": {}                     // optional passthrough into the request body
}
```

**Add a provider** — any OpenAI-compatible `/chat/completions` endpoint:

```json
"local_lfm_vl": {
  "base_url": "http://127.0.0.1:8081/v1",
  "api_key_env": "SOME_KEY",   // omit entirely for local servers (no auth header sent)
  "headers": {},               // e.g. OpenRouter attribution headers
  "timeout_seconds": 600,
  "max_retries": 2,
  "no_proxy": true             // auto-true for loopback; keeps http_proxy out of the way
}
```

**Add an approach** — a key under `approaches` (and, to run it by default, in `approach_order`):

```json
"single_lfm_vl":  { "type": "single", "model": "lfm_vl" },
"ensemble_lfm":   { "type": "ensemble_judge",
                    "vision_model": "lfm_vl", "judge_model": "lfm_judge",
                    "variants": ["a_production", "b_production_hot", "c_detection"],
                    "max_parallel": 2,
                    "judge_temperature": 0,      // optional, default 0
                    "judge_max_tokens": 1024 }   // optional, overrides the judge model's max_tokens
```

`variants` are ids from `harness/schema.py:ENSEMBLE_VARIANTS` (a_production, b_production_hot,
c_detection, d_taxonomy_first, e_skeptic) or inline objects carrying their own `system_prompt`.
The judge prompt is generated for the actual candidate count, so an n=3 ensemble gets correct
agreement buckets (`3/3` high, `2/3` medium, `1/3` low) rather than hardcoded fifths.

`max_parallel` matters on CPU: llama.cpp effectively serialises concurrent generations against one
model instance, so a 5-way fan-out can cost 5× wall clock instead of hiding behind concurrency.
Cloud configs use 5; local uses 1–2. Combine with `--fan-out N` to measure the
recall/latency trade of ensemble size on the same served model.

An approach type beyond `single` / `ensemble_judge` means adding a branch to
`approaches.run_approach` plus a function alongside `single()` — nothing else needs to change.

**Add a config** — copy an existing file in `configs/`. `name` seeds the default run directory,
`out_dir` overrides it, `images_dir`/`gold` are relative to `eval/` unless `base_dir` is set.

## Corpus provenance

10 meal photos from Wikimedia Commons, all under CC licenses (CC BY 4.0, CC BY-SA 4.0, CC BY-SA
3.0). Per-image `commons_title`, `source_url`, `license` and a short description live in
[`images/manifest.json`](images/manifest.json) — no image of unclear provenance is admitted, and
the manifest is the record for the attribution requirement.

The corpus is deliberately skewed toward the failure modes that matter rather than being pretty:
composite dishes (a stew is not five foods), sauces and condiments, a sushi platter that tests
nigiri-vs-sashimi (a rice miss changes the carbs), a partially generic vegetable medley, and one
adversarial image (10) with a background menu poster showing dishes that are not on the table.

The full gold set targets ~50 images; these 10 are the pilot slice.

## Gold-labeling protocol

[`gold/gold_labels.json`](gold/gold_labels.json) is hand-authored from direct image inspection
(see its `_note`). Per image:

- `meal` — a short description of the plate.
- `core` — items a correct identification **must** include. Synonyms and reasonable consolidations
  count (`"Greek salad"` may cover lettuce + cucumber + tomato), but a consolidation that loses a
  distinctive component is a granularity note, not a free pass.
- `optional` — visible but acceptable to omit: garnishes, condiments, off-plate drinks. No recall
  credit; reporting them is not an error.

A **hallucination** is any reported food not visible in the image at all. Recall is counted over
`core` only.

Two optional fields unlock the portion and macro metric families — both **absent today, on all 50
entries**, which is why `scorecard.py` reports them as `unscorable (0/50 covered)` instead of
omitting them:

- `gram_ranges` — `{"<core item>": [min_g, max_g]}`, per item.
- `kcal_range` — `[min, max]` for the whole plate.

**These must come from a scale.** A gram range guessed off a photo would make portion error measure
the labeller rather than the model, which is worse than leaving the metric visibly unfilled. Name
matching against `gram_ranges` is exact-after-normalisation and unmatched items are counted and
reported — the fix for a mismatch is a gold alias, never a fuzzy guess about which row 250 g belongs
to.

Labels are data, not code: adding an image means adding a manifest row and a gold entry, and the
worksheet will show `_No gold entry for this image_` until you do.
`python3 -m harness.runner check-labels` is the mechanical check that all of the above holds.

### Worksheet protocol (what a reviewer fills in)

Per image, per approach: `Y` when the approach covered that gold core item, `n` when it missed it,
`Y?`/`n?` for a judgment call worth escalating. Then three summary rows:

| row | what goes in it |
|---|---|
| `core recall (/N)` | `hits/N` (a bare `hits` is accepted too) |
| `hallucinations` | a count, or the offending item names — the parser counts either |
| `over-decomposed` | **count of composite dishes the approach split into parts** |

**`over-decomposed` is a counted error class, not a deduction.** A stew reported as five ingredients
may well cover its gold rows — mark those `Y` *and* record the split here, so "it scored well by
enumerating a casserole" shows up as a number instead of a footnote. Writing the literal word
`over-decomposed` inside a gold-item cell counts as one occurrence too, for reviewers who prefer to
annotate in place. It is reported per approach by `--score`.

Free-text `## Findings` at the end of the worksheet remain the place for anything that is not a
count. The four 2026-08-12 worksheets predate the `over-decomposed` row, so they report 0 — read
that as "not yet recorded", not as "did not happen".

## Provenance of the harness

The harness is a refactor of `runs/2026-08-11-openrouter-pilot/run_bench.py.ref`, the one-shot
pilot script. The system prompt, output JSON schema, prompt variants, tolerant JSON parsing and
validator are byte-identical to it — and it in turn was a faithful port of openplate's
`app/services/vision/{prompt,schema}.ts`, so the benchmark scores what ships.
`runs/2026-08-11-openrouter-pilot/` holds that pilot's results and hand-scored `SCORING.md`.

One deliberate departure: the **judge** prompt and response schema were hardened on 2026-08-11 (see
[Judge hardening](#judge-hardening-2026-08-11)) and no longer match the pilot's wording. The judge is
harness-internal ensemble machinery, not part of openplate's shipped contract, so it is free to
improve; runs before that date were scored against the pilot's judge prompt and are not directly
comparable on the judge-specific metrics (dedup failures, trap leaks).
