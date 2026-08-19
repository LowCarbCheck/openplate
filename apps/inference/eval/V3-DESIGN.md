# Pipeline v3 — design: the output-token diet + the vision-stage trap fix

**Status: designed, not measured.** Every latency number below is a *projection* from the
measured throughputs in [PERFORMANCE.md](PERFORMANCE.md) and the measured token counts in
`runs/2026-08-11-local-v2-hardjudge/results.json`. Nothing in v3 has been run. The deliverables
are inert on purpose: `harness/schema_v3.py` and `harness/approaches_v3.py` are imported by
nothing, and `configs/local-cpu-v3.json` does not work until §6's diffs are applied.

> **Update 2026-08-13:** §6 is applied — the modules are wired in and the v3 configs run. The
> *measurements* are still outstanding: no v3 row has been executed, so every latency number below
> remains a projection.

Target: **p95 ≤ 10 s per plate** (the product SLO recorded in PERFORMANCE.md §5).

---

## 1. What v3 changes, and why those three things

PERFORMANCE.md's central measurement is that the pipeline is decode-bound and *predictable*:

```
wall ≈ prompt_tokens / prefill_tps + completion_tokens / decode_tps      (r = 0.973)
```

A predictor that good turns latency work into token accounting. So: count the tokens, find the
ones nobody reads, stop paying for them.

Measured v2 tokens (n=3 lite profile, `runs/2026-08-11-local-v2-hardjudge/results.json`):

| stage | prompt tokens | completion tokens |
|---|---|---|
| vision candidate (n=30) | 548 – 3208, p50 2092 | 126 – **1128**, p50 **549** |
| judge merge (n=10) | 1832 – 3227, p50 2372 | 394 – 771, p50 **685** |

**Most of those completion tokens are discarded by the very next stage.** Each candidate item
carries seven `macrosPer100g` numbers, a `portionHint` sentence and a `confidence` string — and
the judge then takes the *median* of the grams, re-derives confidence *from agreement*, and
rewrites the hint. The vision stage is being billed, at 30 tok/s, to generate inputs to a median.

Three changes follow, in order of impact:

### 1a. Terse candidate format (the diet)

Vision calls emit

```json
{"f":[{"n":"grilled chicken breast","g":140,"bg":0}]}
```

~18 tokens per item against ~95 in the production shape. `maxItems: 8` in the JSON Schema
becomes a GBNF constraint in llama-server, so a candidate **cannot** exceed ~155 completion
tokens — the 1128-token outlier is now unreachable, not merely discouraged. No `notes`: prose
fields are pure decode cost and the judge ignored them.

`maxItems` is 8, not 6, because the vision stage is a *candidate generator* — `c3_detection` is
deliberately over-enumerating and consolidation is the judge's job. This is the same reasoning
`schema.py` records for leaving the vision schema unbounded, plus a ceiling that bounds decode.

### 1b. Background exclusion in the vision stage (the trap fix)

`runs/2026-08-11-local-v2-SCORING.md` finding 2 is unambiguous: **the poster-trap leak cannot be
fixed in the judge, because the judge is blind.** When 2 of 3 candidates report a wall-poster
burrito, a text-only merge stage sees agreement, and hardening its agreement rules makes it
*worse*. v3 fixes it at two levels:

1. **Prompt** — the (now shared) vision system prompt carries the exclusion rule explicitly:
   menus, posters, signs, screens, wall art, packaging illustrations, and other tables' plates.
2. **Mechanical flag** — every item carries `bg: 0|1`, and `bg: 1` items are dropped **in code**
   (`schema_v3.drop_background_items`) before the judge sees the candidate list.

The flag is the load-bearing half. A prompt rule is a request; a boolean the vision model already
set is a filter. The judge keeps rule 8 as a backstop only, and the run records
`background_items_dropped` per candidate so the trap rate becomes a *measurement* instead of a
manual read of the food tables. `bg` is an integer 0/1, not a boolean, because `0` is one token
where `false` is more, and a two-integer enum is a tighter grammar.

Cost: ~5 tokens per item, ~30 per candidate. It buys back far more by suppressing the items the
judge would otherwise merge and emit.

### 1c. Shared image prefix (the free win nobody took)

v2 varied the **system prompt** per variant. The system prompt precedes the image in the rendered
chat template, so every candidate's prompt diverges *before* the 1813 image tokens — defeating
every prefix cache there is. v3 uses **one shared system prompt** and moves the variant's
instruction into the user turn **after** the image part:

```
system:  V3_VISION_SYSTEM_PROMPT          (identical for every variant)
user:    [image_url]  then  variant instruction
```

Now `system + image` is a byte-identical prefix across the fan-out, and candidates 2..n re-prefill
only ~70 tokens instead of ~2100. On CPU that is ~15 s per extra candidate. On vLLM it is what
makes automatic prefix caching apply to the ensemble at all.

**Consequence: `max_parallel` drops from 2 to 1.** llama.cpp's prompt cache is per KV slot;
sequential requests reuse the cached image, concurrent ones land in different slots and re-prefill
it. The projection below shows sequential-with-cache beating parallel-without by ~10 s/plate — the
first time in this project that reducing concurrency reduces latency, and the reason it is a
config-level default rather than a tunable.

> ⚠ **This deliberately makes prefix caching load-bearing** — the same mechanism PERFORMANCE.md
> §6 warns "will silently flatter any timing run". The discipline: never re-run the same image
> twice inside a timing run, because the *second* run is cache-warm on the whole prompt, not just
> the shared prefix. The v3 config repeats this warning in `_run_notes`.

### 1d. Macros: the judge emits `null` by default

The wire contract declares every macro nullable, and openplate resolves nutrition downstream from
a real food database (USDA FDC / BLS). Numbers a 1.6B model invents are strictly worse than a
lookup, and they cost ~140 judge completion tokens ≈ **+8.9 s per plate** on `lfm-judge`. So v3's
default judge grammar pins `macrosPer100g` to `{"type": "null"}` — the judge physically cannot
spend tokens on it.

This is a product call, not a harness call, so both paths ship: `judge_macros: true` restores the
v2 behaviour byte-for-byte (`V3_JUDGE_JSON_SCHEMA_WITH_MACROS`), and `local-cpu-v3.json` includes
an `ensemble_lfm_v3_macros` row purely to price it. If openplate's nutrition resolution owns
macros, delete that row.

---

## 2. Token budget math

Prompt-token estimates use `chars / 4`, **calibrated against measured counts**: v2's
`a_production` system+user prompt is 2480 chars and llama.cpp reported 620 prompt tokens for it
(2433-token request − 1813 image tokens); `c_detection` is 1084 chars / 279 measured. `chars/4`
reproduces both within 3 %.

### Vision call

| component | v2 measured | v3 designed |
|---|---|---|
| system prompt | 620 (a) / 279 (c) / 277 (d) | **287, shared** |
| user instruction | 25 | 28 (a3) / 70 (c3) / 61 (d3) |
| image | 271 – 2588 (unchanged by the diet) | same, or ×0.49 with the downscale |
| **completion** | **p50 549, max 1128** | **p50 ~110, hard ceiling 155** |

Per-item arithmetic for the terse form: `{"n":"` 3 + name ~4 + `","g":` 3 + number 2 + `,"bg":0}` 5
+ separator 1 ≈ **18 tokens**. Six items = 108 + wrapper 8 = **116**. Eight items (the grammar
ceiling) = 152. The ≤150 target is met at the realistic item count and bounded at 155 in the worst
case.

### Judge call

| component | v2 measured | v3 designed |
|---|---|---|
| system prompt | 931 | **604** |
| candidate payload | full JSON per candidate, ~130 tok each | `name=grams` lines, **~45 tok each** |
| prompt total (n=3) | p50 2372 | **~765** |
| **completion** | **p50 685** | **~190** (macros null) / ~330 (macros on) |

Two things shrank the judge prompt. The candidate encoding is now one line per candidate —
`C1: grilled chicken breast=140g; white rice=180g` — which is ~3× cheaper than the JSON blocks and
easier to count agreement over. And the prompt itself lost the poster/background rule (now enforced
in code) and the schema restatement. **Rules 1/3/4/7 of the v2 hardened prompt survive in
substance**, because the SCORING verdict was that they are sound and the 2.6B judge is
capability-bound rather than prompt-bound — v3 does not re-litigate judge quality, it only stops
paying for tokens.

### Recommended token caps

| call | `max_tokens` | why |
|---|---|---|
| vision (v3 terse) | **256** | grammar bounds output at ~155; 256 is headroom |
| judge, macros null | **512** | 190 designed, 6-item worst case with hints ~300 |
| judge, macros on | **768** | ~330 designed |

A cap set *at* the budget is a trap: llama.cpp returns HTTP 200 with `finish_reason: length` and a
truncated body, and the tolerant parser then fails on half a JSON object. And per
`serve/models.json`'s `reasoning_budget_curve`, **never use `max_tokens` as a thinking budget** —
on a model served with `--reasoning-budget N > 0` a token ceiling truncates mid-thought and returns
`content: ""`. Any v3 approach pointed at `lfm-judge-think` must add N to the cap.

---

## 3. Image-resolution cap

The output diet does nothing for prefill, and prefill is 40–100 s of the qwen numbers. Two levers
exist; they are not equivalent.

**Server-side (llama.cpp).** `llama-server` exposes `--image-max-tokens` and `--image-min-tokens`
(env `LLAMA_ARG_IMAGE_MAX_TOKENS`), plus `--mtmd-batch-max-tokens` (default 1024) for the encode
batch. Two caveats: they are documented as *"only used by vision models with dynamic resolution
(default: read from model)"* — so they apply to `qwen-vl`, whose image tokens are measured to vary
681–3507 with resolution — and there are open llama.cpp reports of these flags **aborting the
server** on some models ([#21461](https://github.com/ggml-org/llama.cpp/issues/21461),
[#21550](https://github.com/ggml-org/llama.cpp/issues/21550)), plus a report that they do not
reliably tame very large images ([#17172](https://github.com/ggml-org/llama.cpp/discussions/17172)).
Recommendation: serve `qwen-vl` with `--image-max-tokens 1024` and verify the *reported*
`prompt_tokens` actually fall — do not assume the flag took.

**Client-side (recommended primary lever).** Downscale in `providers.image_to_data_url` before
base64. It is portable (works for `lfm-vl`, for cloud providers, and for the openplate app itself),
it is verifiable in one line of Python, and it cannot crash the server.

**Recommended cap: long edge 896 px, JPEG q85.** 896 is a multiple of 112 = lcm(16, 28) — an exact
patch boundary for both LFM2.5-VL (16 px patches) and Qwen3-VL (14 px, 2×2 merged ⇒ 28). The corpus
is mostly 1280 px on the long edge, so image tokens scale by ~(896/1280)² ≈ **0.49×**: lfm-vl p50
1813 → ~500, qwen-vl p50 1247 → ~586.

> **This is a recall risk, not a free win.** `runs/2026-08-11-local-v2-SCORING.md` finding 3 names
> image resolution as a live suspect for Qwen Q4's lost 12 points — halving it pushes on exactly
> that. **Protocol: run v3 with `image_max_long_edge: null` first**, so the terse-format change is
> measured as a single variable against v2, then re-run at 896 to price the downscale separately.
> Both projections are given below for that reason.

Pillow is an optional dependency: the diff warns once and sends full-resolution images if it is
missing, rather than failing the run.

---

## 4. Latency projections

**Measured rates used** (per-request least-squares fits over the run data, plus PERFORMANCE.md):

| model | prefill tok/s | decode tok/s | source |
|---|---|---|---|
| `lfm-vl` | **135.4** | **34.4** | fit over the 10 single-shot calls in `2026-08-11-local-lfm`, r = 0.994 (models.json smoke: 120.1 / 29.9) |
| `lfm-judge` | **93.3** | **15.7** | fit over the 10 judge calls in `2026-08-11-local-v2-hardjudge`, r = 0.999 (models.json's 34.5 prefill is a smoke artifact; its 16.1 decode agrees) |
| `qwen-vl` | 32.5 | 7.5 | PERFORMANCE.md §1 |

Projections apply those rates to per-image measured image-token counts, with completion tokens set
to the v3 design targets (vision p50 110 / p95 155; judge p50 190 / p95 245). Percentiles are over
the same 10 plates, so they inherit PERFORMANCE.md's caveat: **read "p95" as observed tail.**

### Full resolution (`image_max_long_edge: null`) — the clean terse-vs-verbose comparison

| approach | v2 measured p50 | **v3 projected p50** | v3 projected p95 | vs SLO |
|---|---|---|---|---|
| single `lfm-vl` | 28.7 s | **19.0 s** | 23.9 s (25.2 s at p95 completion) | 2.4× over |
| ensemble n=3 (shared prefix, seq) | 119.0 s | **47.4 s** | 52.2 s (59.7 s all-p95) | 5.2× over |
| ensemble n=3, no shared prefix, mp=2 | 119.0 s | 65.2 s | 76.6 s | — |
| ensemble n=3 + judge macros | 119.0 s | 56.3 s | 61.2 s | — |
| ensemble n=4 (+`e3_skeptic`) | — | 51.9 s | 56.8 s | — |
| single `qwen-vl` Q4 | 105.0 s | **62.7 s** | 102.7 s | 10× over |

### With the 896 px downscale

| approach | **v3 projected p50** | v3 projected p95 | vs SLO |
|---|---|---|---|
| single `lfm-vl` | **9.3 s** | 13.7 s (15.0 s at p95 completion) | **p50 inside, p95 ~1.4× over** |
| ensemble n=3 (shared prefix, seq) | **37.7 s** | 42.1 s | 4.2× over |
| ensemble n=3, no shared prefix, mp=2 | 42.4 s | 52.8 s | — |
| ensemble n=4 (+`e3_skeptic`) | 42.2 s | 46.6 s | — |
| single `qwen-vl` Q4 | 42.4 s | 43.2 s | 4.3× over |

**Readings that matter:**

- **The diet is worth 2.5× on the ensemble** (119 → 47 s) and 1.5× on single-shot, with zero model
  changes. Most of it is the shared prefix and the vision decode cap.
- **`single lfm-vl` v3 at 896 px is the first CPU configuration that touches the SLO at the
  median** (9.3 s) and misses it in the tail (~14 s). It is also the 71.4 %-recall tier — this is a
  latency result, not a quality one, and the honest framing is "the SLO is reachable on CPU only at
  the accuracy we already rejected."
- **The judge is now 43 % of the v3 ensemble** (20.3 s of 47.4 s: 8.2 s prefill + 12.1 s decode) —
  the same structural fact PERFORMANCE.md flagged at n=3, unchanged by the diet. Further ensemble
  latency work has to attack the judge itself: merge in code, or a smaller/faster judge, or fold
  the merge into one of the vision calls. Prompt trimming has ~8 s left in it at most.
- **Ensemble n=3 does not reach the SLO on this CPU under any token budget.** 47 s → 10 s is 4.7×,
  and prefill+decode floors account for essentially all of it. PERFORMANCE.md §5's verdict stands:
  the ensemble tier needs a GPU.

### (c) Estimated: shared-prefill vLLM, n=5, 4090-class GPU

**ESTIMATE. No GPU has been measured in this project.** Mechanism and inputs stated so it is
falsifiable: Qwen3-VL-8B at FP8/AWQ on a 24 GB 4090, ViT encode 0.3–0.6 s per image, LM prefill
3000–5000 tok/s, single-stream decode 55–80 tok/s, five candidates decoded in one batch (per-token
cost rises only slightly), automatic prefix caching serving the shared `system + image` prefix to
candidates 2–5.

| stage | estimate |
|---|---|
| ViT encode + shared prefill (1024 img + 315 tok) | ~0.8 s |
| 4 × variant-suffix prefill (~70 tok each) | ~0.1 s |
| 5 × 110–155 completion tokens, batched | ~2.7 s |
| judge (765 prompt + 245 completion, same GPU) | ~3.8 s |
| **total** | **~7.3 s** |
| same, merge done in code instead of an LLM judge | **~3.5 s** |
| pessimistic (ViT 0.9 s, prefill 2000, decode 45) | ~11.8 s |

So: **n=5 with the v3 token budget plausibly lands inside the 10 s SLO on one 4090, and the judge
is over half of it.** That inverts the CPU-tier conclusion (PERFORMANCE.md §4: "n=3 is the CPU
default, n=5 is GPU-tier") into a concrete next measurement — and it says the highest-value GPU
experiment is *judge-free merging*, because a code-side merge would buy ~3.8 s of a ~7.3 s budget.
Without the shared prefix this row would pay the ViT encode five times, which is why 1c is a
prerequisite for the GPU plan and not a CPU micro-optimization.

---

## 5. What v3 does NOT claim

- **No accuracy claim.** Terser candidates may cost recall (fewer tokens of "thinking out loud"
  before the JSON), and the 896 px downscale may cost more. Both must be measured. The eval's
  core-item recall is computed from names, so both changes are measurable on the existing
  scorecard — and, per PERFORMANCE.md §6, **only the 50-image gold set can resolve differences
  smaller than ~5 points.** Do not run v3 on n=10 and declare a winner.
- **No judge-quality claim.** v3 keeps the v2 hardened judge rules deliberately. Judge model choice
  stays parked until the 50-image harness exists.
- **Macros are dropped by default**, which is a product decision (openplate's food DB owns
  nutrition). Reversible via one config flag.

---

## 6. Exact diffs to apply — ~~AFTER the running benchmark finishes~~ **APPLIED 2026-08-13**

Three files, 3 hunks, ~60 lines. Nothing else in the harness changes; v2 rows stay byte-identical
so v2-vs-v3 comparisons remain valid.

> **Status: applied.** `single_v3` / `ensemble_judge_v3` are live dispatch keys, `image_max_long_edge`
> is threaded through, and `providers._downscale_to_jpeg` exists. `eval/v3-registration.patch` is
> kept as the record of what changed; **it will no longer apply cleanly** (6b's runner.py hunk was
> hand-applied — the mid-run memory guard moved `image_to_data_url` from line 164 to ~363). The
> diffs below are historical; read the files, not the patch. Also added at the same time, not in the
> patch: `${VAR}` expansion in `runner.load_config` (see README) and
> `configs/runpod-gpu-v3{,-fullres}.json` for remote GPU runs.

```bash
cd "$(git rev-parse --show-toplevel)"
git apply --check eval/v3-registration.patch && git apply eval/v3-registration.patch
```

### 6a. `eval/harness/approaches.py` — dispatch only

```diff
--- a/eval/harness/approaches.py
+++ b/eval/harness/approaches.py
@@ -22,6 +22,7 @@ import concurrent.futures
 import time
 
 from . import providers
+from . import approaches_v3
 from . import schema as plate_schema
 
 
@@ -201,6 +202,11 @@ def run_approach(
             judge_temperature=approach_cfg.get("judge_temperature"),
             judge_max_tokens=approach_cfg.get("judge_max_tokens"),
         )
 
+    if kind in ("single_v3", "ensemble_judge_v3"):
+        return approaches_v3.run_approach_v3(
+            kind, approach_cfg, image_data_url, models, clients, fan_out_override
+        )
+
     raise ValueError(f"approach {approach_key!r} has unknown type {kind!r}")
```

### 6b. `eval/harness/runner.py` — thread the image cap through

```diff
--- a/eval/harness/runner.py
+++ b/eval/harness/runner.py
@@ -164,7 +164,9 @@ def run_for_image(
 ) -> dict:
     image_id = image_path.stem
     print(f"[{image_id}] loading image...")
-    image_data_url = providers.image_to_data_url(image_path)
+    image_data_url = providers.image_to_data_url(
+        image_path, max_long_edge=config.get("image_max_long_edge")
+    )
 
     models = config.get("models") or {}
     declared = config.get("approaches") or {}
```

### 6c. `eval/harness/providers.py` — optional client-side downscale

```diff
--- a/eval/harness/providers.py
+++ b/eval/harness/providers.py
@@ -17,6 +17,7 @@ from __future__ import annotations
 
 import base64
+import io
 import json
 import mimetypes
 import os
@@ -35,13 +36,60 @@ DEFAULT_RETRY_BACKOFF_BASE_SECONDS = 2.0
 
 _LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}
 
+_RESIZE_UNAVAILABLE_WARNED = False
+
+#: Downscale target alignment. 112 == lcm(16, 28): LFM2.5-VL uses 16 px patches,
+#: Qwen3-VL 14 px with a 2x2 merge (28), so a multiple of 112 lands on an exact
+#: patch boundary for both and avoids a padded partial patch.
+_PATCH_ALIGNMENT = 112
+
+
+def _downscale_to_jpeg(raw: bytes, max_long_edge: int, quality: int = 85) -> bytes | None:
+    """Shrink an image so the vision tower emits fewer image tokens.
+
+    Returns None when no resize happened (already small enough, or Pillow is not
+    installed) so the caller keeps the original bytes and mime type. Pillow is
+    deliberately optional: a full-resolution run is a slow run, but a missing
+    dependency must not be a failed run.
+    """
+    global _RESIZE_UNAVAILABLE_WARNED
+    try:
+        from PIL import Image
+    except ImportError:
+        if not _RESIZE_UNAVAILABLE_WARNED:
+            print(
+                "WARN: image_max_long_edge is set but Pillow is not installed; "
+                "sending full-resolution images (latency projections assume the downscale)",
+                file=sys.stderr,
+            )
+            _RESIZE_UNAVAILABLE_WARNED = True
+        return None
+    with Image.open(io.BytesIO(raw)) as image:
+        if max(image.size) <= max_long_edge:
+            return None
+        scale = max_long_edge / max(image.size)
+        size = tuple(
+            max(_PATCH_ALIGNMENT, round(dim * scale / _PATCH_ALIGNMENT) * _PATCH_ALIGNMENT)
+            for dim in image.size
+        )
+        resized = image.convert("RGB").resize(size, Image.LANCZOS)
+    buffer = io.BytesIO()
+    resized.save(buffer, format="JPEG", quality=quality)
+    return buffer.getvalue()
+
 
-def image_to_data_url(image_path: Path) -> str:
+def image_to_data_url(image_path: Path, max_long_edge: int | None = None) -> str:
+    """Base64 data URL for an image, optionally downscaled first.
+
+    `max_long_edge` comes from a config's `image_max_long_edge`. It is a run-level
+    knob: it changes prompt_tokens for every model in the run, so a run that
+    enables it is not single-variable against a run that does not.
+    """
     mime_type, _ = mimetypes.guess_type(str(image_path))
     if mime_type is None:
         mime_type = "image/jpeg"
-    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
+    raw = image_path.read_bytes()
+    if max_long_edge:
+        downscaled = _downscale_to_jpeg(raw, int(max_long_edge))
+        if downscaled is not None:
+            raw, mime_type = downscaled, "image/jpeg"
+    b64 = base64.b64encode(raw).decode("ascii")
     return f"data:{mime_type};base64,{b64}"
```

### 6d. Verify, then run

```bash
cd eval
python3 -m harness.schema_v3                     # prints prompt-token estimates, calls no model
python3 -m harness.runner --config configs/local-cpu-v3.json --dry-run
eval/serve/serve.sh lfm-vl && eval/serve/serve.sh lfm-judge
python3 -m harness.runner --config configs/local-cpu-v3.json \
    --approach single_lfm_vl_v3 --approach ensemble_lfm_v3 \
    --out runs/<date>-local-v3
```

Then `qwen-vl` separately — 6.31 GB will not co-reside with `lfm-vl` + `lfm-judge` inside ~8 GB
free (PERFORMANCE.md §4), and the one measured swap event cost 1.7×.

### 6e. First thing to check in the results

The projections stand or fall on four numbers in `results.json`; check them before reading any
recall table:

1. `candidates[].completion_tokens` — must be ≤ ~155, p50 near 110. If not, the grammar is not
   being applied (check for a dropped `response_format` after a 4xx retry).
2. `candidates[1..n].prompt_tokens` — must be *far* below `candidates[0].prompt_tokens`. If they
   are equal, the shared prefix is not being cached and `ensemble_judge_v3` is paying full price
   per candidate.
3. judge `prompt_tokens` ≈ 765, `completion_tokens` ≈ 190. A judge completion near 685 means the
   macros grammar did not take.
4. `background_items_dropped` — the trap rate, now a number rather than a manual read. Zero across
   50 images means either the flag works or the model never sets it; image 10 (the poster plate) is
   the discriminating case.
