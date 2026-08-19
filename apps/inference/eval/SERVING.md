# Local model serving (CPU-only)

Runbook for serving the local candidate models behind an OpenAI-compatible HTTP endpoint so
the eval harness can hit them the same way it hits OpenRouter.

> **Per-model latency figures below are smoke-test numbers (short free-text prompts) and run
> optimistic.** For production-prompt latency, throughput, capacity planning, and the SLO gap, use
> **[PERFORMANCE.md](PERFORMANCE.md)** — it is the canonical source and supersedes any figure here
> that conflicts (notably `qwen-vl`'s "~37 s / image": the real production-prompt p50 is ~105 s).

**Host:** Fedora, 16 cores, AVX2 + AVX512, **no GPU**, 400 GB free disk.
Budget: keep resident models under ~8 GB — load one (at most two) at a time.

## Status summary

| key | model | runtime | status | port | RSS | gen tok/s | per-call latency |
|-----|-------|---------|--------|------|-----|-----------|------------------|
| `lfm-vl` | LiquidAI LFM2.5-VL-1.6B (vision) | llama.cpp | **WORKS** | 8081 | 1.55 GB | 29.9 | ~16 s / image |
| `lfm-judge` | LiquidAI LFM2.5-2.6B (text judge) | llama.cpp | **WORKS** | 8082 | 3.03 GB | 16.1 | ~4.5 s |
| `qwen-vl` | Qwen3-VL-8B-Instruct Q4_K_M (vision, quality) | llama.cpp | **WORKS** | 8084 | 6.31 GB | 7.5 | **~37 s / image** |
| `qwen-vl-q8` | Qwen3-VL-8B-Instruct **Q8_0** (quant A/B) | llama.cpp | **WORKS** | 8087 | 9.7-11.4 GB | 3.4 | **~66 s / image** |
| `qwen-judge` | Qwen3-4B-Instruct-2507 (alt judge) | llama.cpp | **WORKS** | 8085 | 3.68 GB | 11.6 | ~6.5 s |
| `lfm-judge-think` | LFM2.5-2.6B, bounded CoT (budget 256) | llama.cpp | **WORKS** | 8086 | 3.03 GB | 14.2 | ~22.5 s |
| `moondream` | Moondream 3 preview (MoE 9B/A2B) | — | **FAILED** | — | — | — | — |

`lfm-vl` + `lfm-judge` co-resident measured at **4.4 GB total** — comfortably inside the
~8 GB budget, so the fast extractor and the judge can be served side by side. Load time is
2-8 s each (warm page cache), so `serve.sh` start/stop between phases is cheap.

**`qwen-vl` is the exception: at 6.31 GB it cannot share the box with any judge**
(6.31 + 3.03 = 9.3 GB, over budget). The quality profile has to serialize — extract with
`qwen-vl`, stop it, then start the judge. Everything else can be paired freely.

**`qwen-vl-q8` is stricter still: 9.7 GB after load, growing to 11.4 GB peak.** It cannot share
the box with *anything*, including `lfm-vl`. Same serialize-the-phases requirement as `qwen-vl`.

Disk: `lfm-vl` 1.16 + 0.79 GB mmproj, `lfm-judge` 2.68 GB, `qwen-vl` 4.68 + 1.08 GB mmproj,
`qwen-vl-q8` 8.11 GB (**mmproj shared with `qwen-vl`** — 0 extra), `qwen-judge` 2.33 GB.
`lfm-judge-think` adds **0 bytes** — it re-serves the `lfm-judge` GGUF with different flags.
Total 20.8 GB.

## Install

```bash
brew install llama.cpp          # llama-server b10330 (687e77892), GNU 13.3.0, x86_64
llama-server --version
```

The bottle is a prebuilt CPU binary (no CUDA); `-ngl 0` keeps everything on CPU.
`ollama` 0.30.7 is also on the box at `/home/linuxbrew/.linuxbrew/bin/ollama` but is
**not used** — nothing here needs it (see Moondream below).

Model weights are fetched with plain `curl -L` into `eval/models/` (gitignored, plus a
`*.gguf` ignore rule). `hf`/`huggingface-cli` is not installed and is not needed:

```bash
curl -L -o eval/models/<file> https://huggingface.co/<repo>/resolve/main/<file>
```

## Usage

```bash
eval/serve/serve.sh lfm-judge          # start (idempotent, waits for /health)
eval/serve/serve.sh lfm-vl 8081        # explicit port
eval/serve/serve.sh status             # what's up, with RSS
eval/serve/serve.sh stop lfm-judge     # stop one
eval/serve/serve.sh stop all           # stop everything
```

Keys: `lfm-vl` (8081), `lfm-judge` (8082), `qwen-vl` (8084), `qwen-judge` (8085),
`lfm-judge-think` (8086), `qwen-vl-q8` (8087). Ports above are the defaults from `models.json`.

Logs and pid/port files land in `eval/serve/logs/<key>.{log,pid,port}`.
Overridable env: `THREADS` (default 14), `CTX` (default 8192), `HOST_ADDR` (127.0.0.1),
`REASONING_BUDGET` (per-key default: 0 for `lfm-judge`, 256 for `lfm-judge-think`).

Smoke test:

```bash
python3 eval/serve/smoke_test.py lfm-vl     --port 8081               # sends eval/images/01.jpg
python3 eval/serve/smoke_test.py qwen-vl    --port 8084               # any key ending -vl goes vision
python3 eval/serve/smoke_test.py lfm-judge  --port 8082
python3 eval/serve/smoke_test.py qwen-judge --port 8085 --json-schema  # response_format test
python3 eval/serve/smoke_test.py lfm-judge-think --port 8086 --json-schema --max-tokens 2048
```

```bash
python3 eval/serve/smoke_test.py qwen-vl-q8 --port 8087 --vision   # NOTE: --vision required
```

`smoke_test.py` picks vision mode from a `-vl` key **suffix**, so `qwen-vl` works with no extra
flag but **`qwen-vl-q8` does not** — its key ends in `-q8`, so pass `--vision` explicitly or it
will silently send the text judge prompt to a vision model and you will get a nonsense
"extraction" with no error. For `lfm-judge-think`, keep `--max-tokens` above
`reasoning budget + answer` (the 512 default is fine at budget 256, but not at 384+).

## Per-model notes

### `lfm-vl` — LiquidAI LFM2.5-VL-1.6B — WORKS

Files (`LiquidAI/LFM2.5-VL-1.6B-GGUF`): `LFM2.5-VL-1.6B-Q8_0.gguf` (1188 MB) +
`mmproj-LFM2.5-VL-1.6b-F16.gguf` (814 MB). Q8_0 chosen — the whole model is small enough
that there is no reason to quantize harder.

Smoke test on `eval/images/01.jpg` ("list every food item on this plate"):

> Ham, bacon, sausage, eggs, beans, cucumber, bread, butter

…and with `response_format: json_schema`:

> `{"foods": ["ham","bacon","sausages","eggs","beans","cucumber","bread"]}`

Both PASS — real breakfast foods, no hallucinated plate. Numbers: **1.55 GB RSS**,
**29.9 gen tok/s**, prefill **120 tok/s**.

Quirks:
- **`--mmproj` is mandatory.** Without it llama-server rejects `image_url` content parts.
- Images cost ~**1813 prompt tokens** each, and prefill dominates: a cold request is
  **~16 s** wall, of which ~15 s is image prefill and <1 s is generation. Budget the
  benchmark timeout accordingly (≥60 s/image is safe) — this is the single biggest
  wall-clock driver of the run.
- llama-server caches the prompt prefix, so a repeat request against the *same* image drops
  to ~1.5 s. Do **not** mistake that for real throughput when timing the benchmark.
- No reasoning behaviour — `content` is populated directly. Small `max_tokens` is fine.

### `lfm-judge` — LiquidAI LFM2.5-2.6B — WORKS (with one required flag)

File: `LFM2.5-2.6B-Q8_0.gguf` (2741 MB, under the 3.5 GB bar so Q8_0 over Q4_K_M).
**3.03 GB RSS**, **16.1 gen tok/s**, prefill ~35 tok/s.

Smoke test (extract foods from a full-English-breakfast description, `json_schema`):

> `{"foods": ["fried eggs","baked beans","grilled sausage","bacon","toast"]}`

PASS — 40 completion tokens in **4.5 s**, schema-conformant.

**The trap that cost the most time here:** LFM2.5-2.6B is a *hybrid reasoning* model. Served
plainly it emits 200-950 tokens of chain-of-thought into `message.reasoning_content` and
leaves `message.content` as the **empty string** until the think block closes. So a request
with a modest `max_tokens` returns a perfectly successful HTTP 200 whose content is `""` —
no error, no warning. First smoke run at `max_tokens: 160` looked like a broken model; it
was just budget starvation. Unbounded, a single judge call took **66.8 s**.

Fix: **`--reasoning-budget 0`**, which `serve.sh` now passes for this key by default. It
force-closes the think block, giving **4.5 s instead of 66.8 s (27x)** with an identical
answer on the smoke prompt. Set `REASONING_BUDGET=-1` to restore full CoT if judge quality
turns out to need it — measure before trading 15x latency for it.

Two things that do **not** work, both tried and confirmed:
- `--reasoning off` — ignored; still reasons.
- per-request `chat_template_kwargs: {"enable_thinking": false}` and `reasoning_budget` in
  the JSON body — ignored; the LFM2.5 template has no thinking-toggle branch, so only the
  server-side `--reasoning-budget` has any effect.

If you ever run this model with reasoning enabled, note the CoT length is *prompt-dependent*:
the terse smoke prompt needed 233 tokens, the more elaborate one blew past 900. Either budget
0, or use a **bounded** budget — see `lfm-judge-think` below, which supersedes the earlier
assumption that `--reasoning-budget` was effectively a 0/-1 toggle. It is not; `N>0` works.

### `qwen-vl` — Qwen3-VL-8B-Instruct — WORKS (the CPU feasibility answer is "yes")

Files (**official** `Qwen/Qwen3-VL-8B-Instruct-GGUF` — it does exist, so no third-party quant
was needed): `Qwen3VL-8B-Instruct-Q4_K_M.gguf` (4794 MB) + `mmproj-Qwen3VL-8B-Instruct-F16.gguf`
(1105 MB). Q4_K_M per spec; the repo also offers Q8_0/F16 for the LM (Q8_0 is now served as
`qwen-vl-q8`, below).

> **The mmproj here is F16 — the highest precision the repo offers.** The repo publishes exactly
> two vision encoders, `mmproj-Qwen3VL-8B-Instruct-F16.gguf` (1159029824 B) and
> `-Q8_0.gguf` (752289728 B). There is no BF16. So this Q4_K_M setup was **never running a
> quantized vision tower** — the `-Q4_K_M` in the filename describes the *language model only*.
> Anyone reaching for "maybe the vision tower quant is hurting accuracy" should stop here: it
> was already unquantized.

> **Filename gotcha:** the repo drops the second hyphen in the *file* names —
> `Qwen3VL-8B-Instruct-*`, not `Qwen3-VL-8B-Instruct-*` (which is the *repo* name).
> Guessing the obvious name gets a 404 that looks like "the quant doesn't exist".

**6.31 GB RSS**, **7.5 gen tok/s**, prefill ~32 tok/s, 8 s load.

Smoke test on `eval/images/01.jpg`:

> bread, sausages, ham, baked beans, scrambled eggs, cucumber

…and with `response_format: json_schema`, plus three more plates:

| image | extraction |
|-------|-----------|
| 01 | bread, sausage, ham, baked beans, scrambled eggs, cucumber |
| 02 | Yorkshire pudding, roast beef, broccoli, cabbage, potatoes, gravy |
| 03 | salmon, lettuce, cucumber, tomato, avocado, feta cheese, olives, red onion, lemon wedge |
| 04 | hamburger, cheese, tomato, onion, pickles, fries, ketchup |

PASS, and **noticeably sharper than `lfm-vl`** — it distinguishes scrambled from fried eggs
and names Yorkshire pudding, feta, and avocado rather than generic categories.

**The headline number: ~37 s per fresh image** (mean of 4; 29.0 / 34.4 / 40.3 / 46.4 s). That
is well inside the 90 s "brutally slow" bar, so the M138 quality profile **is** CPU-viable —
roughly 2.3x the cost of `lfm-vl`'s ~16 s for a real accuracy gain. A 10-image run is ~6 min.

Quirks:
- `--mmproj` mandatory, same as `lfm-vl`.
- **Not a reasoning model.** The `-Instruct` line emits `content` directly, so none of the
  `--reasoning-budget` treatment applies. No empty-content trap here.
- Image prompt tokens **vary with resolution** (681-1301 observed) because Qwen3-VL uses
  dynamic patching — unlike `lfm-vl`'s fixed 1813. Per-image latency therefore varies ~1.6x
  across a corpus; budget on the max, not the mean.
- Prompt-prefix caching applies: the same image re-sent dropped 40.3 s → 6.6 s. Same timing
  trap as `lfm-vl`.

### `qwen-vl-q8` — Qwen3-VL-8B-Instruct at Q8_0 — WORKS, but buys nothing

Added to isolate **LM-weight quantization** as a suspected accuracy culprit. Same repo, same
`--mmproj` file *byte for byte* as `qwen-vl` (`mmproj-Qwen3VL-8B-Instruct-F16.gguf`), only the
LM tensor file changes: `Qwen3VL-8B-Instruct-Q8_0.gguf` (8709519456 B = 8.11 GiB). Because the
vision tower is held constant at its maximum available precision, `qwen-vl` vs `qwen-vl-q8` is a
clean single-variable A/B on LM quant.

**9.69 GB RSS after load, 11.36 GB peak (VmHWM)**, **3.4 gen tok/s**, prefill ~25 tok/s
(18-30), 10 s load.

Smoke test on `eval/images/01.jpg`:

> bread, sausages, ham, baked beans, scrambled eggs, cucumber

…and with `response_format: json_schema`:
`{"foods": ["bread","sausage","ham","baked beans","scrambled eggs","cucumber"]}`

PASS — real, distinct breakfast items. Both outputs are **identical to what `qwen-vl` produced**.

**The A/B result: Q8_0 is not more accurate than Q4_K_M here.** On the four plates both quants
have seen:

| image | `qwen-vl` (Q4_K_M) | `qwen-vl-q8` (Q8_0) | delta |
|---|---|---|---|
| 01 | bread, sausage, ham, baked beans, scrambled eggs, cucumber | *identical* | none |
| 02 | Yorkshire pudding, roast beef, broccoli, cabbage, potatoes, gravy | *same set* | none |
| 03 | salmon, lettuce, cucumber, tomato, avocado, feta, olives, red onion, **lemon wedge** | same **minus lemon wedge** | **Q8 is worse by one item** |
| 04 | hamburger, cheese, tomato, onion, pickles, fries, ketchup | burger, cheese, tomato, onion, pickle, fries, ketchup | singular/plural only |

Four more plates for the record (Q8 only): 05 rice, chicken, vegetables, carrots · 06 sushi,
sashimi, wasabi, pickled ginger, soy sauce · 07 spaghetti, ground meat, green beans, corn,
carrots · 08 yogurt, granola, apple.

So the upgrade costs **2.2x slower generation, ~1.3x slower prefill, +3.4 GB RAM, +8.11 GB disk**
for zero measurable extraction gain — and one regression. **Combined with the F16-mmproj finding
above, quantization is ruled out on both axes** (LM *and* vision tower) as the explanation for
`qwen-vl`'s accuracy ceiling. Look at prompt, image resolution/patching, or model scale instead.

Quirks:
- **Latency is worse than the `qwen-vl` figure suggests, and the old figure was optimistic.**
  Fresh-image wall time over 8 images: mean **65.9 s**, range 42.5-100.4 s
  (01 47.4 · 02 85.1 · 03 42.5 · 04 46.2 · 05 57.0 · 06 99.4 · 07 100.4 · 08 48.8).
  It tracks prompt tokens near-linearly, and the 2152-token images (06, 07) **breach the 90 s
  "brutally slow" bar**. Note `qwen-vl`'s ~37 s mean came from only images 01-04, which happen
  to be the cheap end of the corpus (681-1301 tokens) — the wider 692-2152 range measured here
  means **`qwen-vl`'s real corpus mean is also higher than 37 s**. Re-measure it on 01-10 before
  quoting a per-image budget.
- **RSS grows after load.** 9.69 GB post-first-image → 11.36 GB after ~8 images, as llama-server
  fills all 4 KV slots at `n_ctx_slot 8192`. Budget on the peak, not the load-time number.
- `--mmproj` mandatory; not a reasoning model; `json_schema` works — all identical to `qwen-vl`.
- `smoke_test.py` needs an explicit **`--vision`** for this key (see Usage above).
- One 85.1 s outlier (image 02, only 1312 prompt tokens, vs 08's 48.8 s at 1232) coincided with
  the host at 0 GB free and swap fully consumed. Host memory pressure, not a model property —
  but it is a reason to keep this key off a busy box.

### `qwen-judge` — Qwen3-4B-Instruct-2507 — WORKS (no flags needed)

File: `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (2382 MB) from **`unsloth/Qwen3-4B-Instruct-2507-GGUF`**.
There is **no official `Qwen/Qwen3-4B-Instruct-2507-GGUF`** repo (the HF API returns an auth
error / not-found), so a reputable third-party quant was required;
`bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF` is an equivalent fallback.

**3.68 GB RSS**, **11.6 gen tok/s** (measured over a 421-token generation, not the 36-token
smoke output — short samples are timing noise), prefill ~60 tok/s, 3 s load.

Smoke test (same JSON-extraction prompt as `lfm-judge`, `json_schema`):

> `{"foods": ["fried eggs","baked beans","grilled sausage","bacon","toast"]}`

PASS — 36 completion tokens in **6.5 s** cold, 3.0 s warm. Note it **preserved the descriptive
modifiers** ("fried eggs", "grilled sausage") where `lfm-judge` reduced them to bare nouns
("eggs", "sausage"). For a judge that has to match extracted strings against gold labels, that
difference is worth knowing about in either direction.

**Why the `-2507` suffix matters:** plain `Qwen3-4B` is a *hybrid-reasoning* model and would
need the whole `--reasoning-budget` dance. The 2507 refresh split that into separate `-Instruct`
and `-Thinking` lines, so `-Instruct-2507` is **non-thinking by construction** — it needs no
reasoning flags and can never strand the answer in `reasoning_content`. Verified: no
`reasoning_content` in any response. Pick `-2507` deliberately, not incidentally.

Also: in free-text mode it returned **bare JSON with no ```json fences**, unlike `lfm-judge`.
Don't rely on fence-stripping being needed *or* not needed — use `json_schema`.

### `lfm-judge-think` — LFM2.5-2.6B with bounded CoT — WORKS (~22 s/call)

Same GGUF as `lfm-judge` (zero extra disk), served with reasoning **enabled and bounded**.

**The earlier "0 or -1, nothing in between" reading was wrong.** `--reasoning-budget N` for
`N>0` is honoured exactly as its `--help` claims: the think block is force-closed after N
reasoning tokens and `content` is then emitted normally, schema-conformant. Measured curve
(same prompt + schema, `max_tokens` 2048, ~14.5 gen tok/s throughout):

| `--reasoning-budget` | completion tokens | wall | `content` usable? |
|---|---|---|---|
| `0` | 40 | 4.5 s | yes (no thinking) |
| `128` | 157 | 13.1 s | yes |
| **`256`** | **283** | **21.6 s** | **yes ← chosen default** |
| `384` | 411 | 30.3 s | yes |
| `-1` (unbounded) | 982 | 79.1 s | yes |
| `-1` + `max_tokens: 160` | 160 | 11.6 s | **NO — `content: ""`, `finish_reason: "length"`** |

Cost is linear: `completion_tokens ≈ budget + ~28` answer tokens. So the goal is met —
**`--reasoning-budget 256` gives a thinking judge at 22.5 s/call**, inside the ~≤30 s target,
versus 79 s unbounded. Serve it higher (384 ≈ 30 s) if judge quality needs more room.

Two further findings:
- **The `max_tokens` ceiling is NOT a substitute for a budget.** Last row above: capping
  `max_tokens` truncates mid-thought and returns HTTP 200 with empty `content`. It bounds
  *latency* while destroying the *answer*. Bound the budget, and keep `max_tokens` comfortably
  above `budget + answer`.
- **`--reasoning-budget-message`** (injected at the cut point, default none) works and does
  **not** disable the budget — 286 tokens / 22.4 s with the message visible at the end of the
  reasoning trace. `serve.sh` passes `"Answer now."` so the handoff to the answer is an
  explicit instruction rather than a mid-sentence truncation.

Smoke test (`json_schema`, budget 256): `{"foods": ["eggs","baked beans","sausage","bacon","toast"]}`
— PASS, 286 tokens in 22.5 s, **3.03 GB RSS**, 14.2 gen tok/s.

> Because this shares its weights with `lfm-judge`, running both simultaneously costs 2x 3 GB
> for the same model. Pick one per run unless you are explicitly A/B-ing thinking vs not.

## Benchmark-run implications

Things that will bite the harness if unhandled:

1. **Timeouts.** Vision calls are ~16 s/image cold on `lfm-vl` and **~29-46 s on `qwen-vl`**.
   Judge calls range from ~4.5 s (`lfm-judge`, budget 0) through ~6.5 s (`qwen-judge`) and
   ~22 s (`lfm-judge-think`, budget 256) to ~79 s (unbounded CoT). Set the client timeout to
   300 s and never assume a call is hung before that. `smoke_test.py` uses 900 s.
2. **Empty `content` is a real failure mode, not a crash.** Any reasoning-capable local model
   can return HTTP 200 with `content: ""` and the answer stranded in `reasoning_content`.
   The harness should treat empty content as an error *and* log `finish_reason` — `"length"`
   there means "raise max_tokens", not "model can't do it".
3. **`response_format: json_schema` works on both models** — llama-server converts JSON Schema
   to GBNF internally. Verified end-to-end on `lfm-vl` and `lfm-judge` with a `strict`
   object schema. This means the harness does not need markdown-fence-stripping fallbacks
   for local models, though note free-text mode *does* wrap JSON in ```json fences.
4. **Prompt caching skews timing.** Re-running the same image against a live server is ~10x
   faster than the first call. Time a cold call, or restart the server, when reporting
   latency.
5. **`max_tokens` must be generous even with budget 0** — the schema-constrained JSON itself
   is cheap, but leave headroom; `smoke_test.py` defaults to 512.
6. **Threads.** `-t 14` on 16 cores leaves 2 for everything else; the host has other
   workloads. Going to 16 did not help and starves the rest of the box.
7. **`qwen-vl` cannot be co-resident with a judge, and `qwen-vl-q8` cannot be co-resident with
   anything.** 6.31 GB + 3.03 GB busts the ~8 GB budget.
   Any profile using `qwen-vl` must run extraction and judging as *sequential phases* with a
   `serve.sh stop` between them, rather than keeping both endpoints hot. The cheaper models
   don't have this constraint, so this is a `qwen-vl`-specific scheduling requirement.
   `qwen-vl-q8` peaks at 11.4 GB, so it needs the box to itself outright.
9. **Timeouts, again, for the big Qwen.** `qwen-vl-q8` hits **100 s** on the high-resolution
   plates (2152 prompt tokens). A 90 s client timeout would fail those images while the model is
   working fine. Keep the 300 s client timeout.
8. **Reasoning-model empty-content risk is now confined to the LFM judges.** `qwen-vl` and
   `qwen-judge` are both non-thinking `-Instruct` builds and populate `content` directly.
   `lfm-judge`(0) and `lfm-judge-think`(256) are bounded. Only an unbounded `REASONING_BUDGET=-1`
   reintroduces the failure mode.

## Download gotcha

A long single `curl` connection to HuggingFace **degraded from ~2.9 MB/s to ~0.5 MB/s** partway
through and stayed there, turning a 5 GB fetch into an hour. A fresh connection immediately
got full speed. If a GGUF download crawls, kill it and resume with `curl -C -` rather than
waiting it out:

```bash
curl -sSL -C - -o eval/models/<file> https://huggingface.co/<repo>/resolve/main/<file>
```

Verify completeness against the real size instead of eyeballing it — a truncated GGUF fails
at load with a confusing tensor error:

```bash
curl -sSLI "https://huggingface.co/<repo>/resolve/main/<file>" | grep -i '^content-length'
```

Also: `pkill -f 'port 8099'` **matches the shell running it** and kills your own command
(exit 144). Use a pidfile. (Confirmed again: `pkill -f 'llama-server -m'` killed the invoking
bash and returned 144 before reaping anything.)

### A stale server on the port will silently impersonate your model

This produced a **flatly wrong finding** mid-session and is worth guarding against. Sequence:

1. A `--reasoning-budget -1` server was left orphaned on 8086 — launched via
   `setsid nohup llama-server … &`, where **`$!` is setsid's pid, not llama-server's**, so the
   later `kill $(cat pidfile)` reaped nothing.
2. The next server, started with *different* flags on the same port, lost the race for it.
3. The orphan happily answered `/health`, so the readiness check passed, and every subsequent
   measurement was attributed to the **new** flags while actually being produced by the **old**
   server. It looked exactly like "`--reasoning-budget-message` disables the budget" — a
   plausible, entirely fictitious conclusion, retracted only after `pgrep -a llama-server`
   showed the argv on the port was not the argv that had been set.

**Why "just check for a bind error" is not enough:** llama-server sets `SO_REUSEPORT`, so a
second server **can bind a port that is already in use**. Verified both outcomes on this host —
sometimes the loser logs `couldn't bind HTTP server socket` and exits, and sometimes *both*
processes bind successfully and the kernel splits incoming requests between them. The second
case is the dangerous one: nothing fails, nothing logs, and results interleave between two
models.

Defences now in place in `serve.sh`, and habits to keep:
- **Pre-flight port check.** `serve.sh` resolves the listener pid via
  `ss -ltnHp "sport = :$port"` *before* launching and refuses to start if anything holds the
  port. This is the check that actually prevents the bug.
- **Post-start ownership check.** After `/health` passes, `serve.sh` confirms the listening pid
  *is* the pid it just spawned, and kills its own process and dies if not. A green `ready` now
  means "your model, on your port".
- It still greps its log for `couldn't bind`, but only as a backstop for the other outcome.
- Never launch llama-server through `setsid` if you intend to capture `$!`. Plain
  `nohup … &` gives the real pid.
- Before trusting a surprising per-model number, run `pgrep -a llama-server` and confirm the
  argv on the port is the argv you think you set. One command, and it invalidates or confirms
  the whole measurement.

## Moondream 3 — FAILED (not servable on this host)

Dead end, established from three independent checks:

1. **No GGUF exists.** `moondream/moondream3-preview` ships only safetensors plus custom
   Python modeling code (`hf_moondream.py`, `moondream.py`, `vision.py`, …);
   `moondream/moondream3.1-9B-A2B` ships a single `model.safetensors`. A HF API sweep over
   every `moondream*` model (including `filter=gguf`) returns GGUF builds for **moondream2
   only** (`ggml-org/moondream2-20250414-GGUF`, `moondream/moondream2-gguf`, …) — zero for v3.
2. **llama.cpp does not implement the architecture.** `config.json` declares
   `"architectures": ["HfMoondream"]`, `"model_type": "moondream3"`, loaded via
   `auto_map`/`trust_remote_code`. Upstream `src/llama-arch.cpp`, `tools/mtmd/clip.cpp` and
   `tools/mtmd/clip-impl.h` contain no `moondream` entry at all, and the installed
   `llama-server` binary has zero `moondream` strings. There is no converter path either, so
   "just quantize it yourself" is not available — `convert_hf_to_gguf.py` would need a new
   model class for the MoE + custom vision tower first.
   (moondream2 worked historically because it mapped onto the `phi2` arch; v3 is a different
   MoE design and does not.)
3. **ollama has no v3 model.** `https://ollama.com/library/moondream3` → HTTP 404 and
   `registry.ollama.ai/v2/library/moondream3/tags/list` → `404 page not found`. The
   `moondream` library entry is moondream2. Nothing to pull.

The only CPU-only route left would be raw PyTorch + `trust_remote_code` on bf16 safetensors
(~18 GB for the 9B, over budget, no OpenAI-compatible server, and MoE bf16 CPU decode would
be seconds-per-token). Per the ~30 min time box, Moondream is **out of scope for this
benchmark round**. Revisit if/when a `moondream3` GGUF or an upstream llama.cpp arch lands.
