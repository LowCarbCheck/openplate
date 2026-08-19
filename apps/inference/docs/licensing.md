# Licensing

**The code in this repository is MIT** ([LICENSE](../LICENSE)).

**The model weights are not.** They are third-party works, downloaded at runtime
rather than shipped inside the image, and each carries its own licence. Those
terms attach to you, the operator.

## Qwen3-VL-8B-Instruct — `quality` profile

**Apache-2.0.** No revenue cap, no field-of-use restriction, commercial use fine.
Source:
[`Qwen/Qwen3-VL-8B-Instruct-GGUF`](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF).
This is the recommended path for commercial use.

## Qwen3-VL-2B-Instruct — `lite-apache` profile

**Apache-2.0.** Source:
[`Qwen/Qwen3-VL-2B-Instruct-GGUF`](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF).

## LFM2.5-VL-1.6B — `lite` profile — revenue-capped

`lite` uses **LiquidAI LFM2.5-VL-1.6B** under the **LFM Open License v1.0**
([licence text, in the model repo](https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B-GGUF/blob/main/LICENSE)).
It is Apache-2.0-shaped with one added condition, verbatim:

> **5. Commercial Use Limitation.**
>
> (a) The rights granted under this License for Commercial Use are conditioned
> upon You or Your Legal Entity not exceeding the Threshold.
>
> (b) Any Commercial Use of the Work or a Derivative Work by a Legal Entity that
> exceeds the Threshold is not licensed under this Agreement.
>
> (c) The Threshold shall not apply to a Qualified Non-Profit Organization's use
> of the Work or a Derivative Work for Non-Commercial or Research Purposes.

and the definition it turns on:

> **"Threshold"** shall mean annual revenue of 10 million United States dollars
> ($10,000,000) or more.

with "Commercial Use" defined as *"any use of the Work for direct or indirect
commercial advantage or monetary compensation"*, and "Legal Entity" including
parents, subsidiaries and anything under common control.

**The $10M revenue cap binds the operator, not this project:**

- Running `lite` at home, for a household, or for research: no cap issue — that
  is not Commercial Use.
- A company under **$10M annual revenue** using it commercially: permitted.
- A company at or over **$10M annual revenue**: **`lite` is not licensed to
  you.** Nothing in this repository changes that; the condition attaches to your
  use of the weights.
- A 501(c)(3) (or foreign equivalent) using it non-commercially: exempt from the
  Threshold by clause 5(c).

This is a licence summary, not legal advice. If the cap might bind you, read the
licence and ask your own lawyer.

## The Apache-2.0 swap-in

Every model slot has an Apache-2.0 alternative:

| slot | revenue-capped default | Apache-2.0 alternative |
|---|---|---|
| `quality` (GPU flagship) | — | already Apache-2.0 (Qwen3-VL-8B-Instruct) |
| `lite` (small/CPU) | LFM2.5-VL-1.6B | **Qwen3-VL-2B-Instruct** → `MODEL_PROFILE=lite-apache` |

```bash
-e MODEL_PROFILE=lite-apache     # the entire migration
```

Note on that swap: **we measured LFM2.5-VL-1.6B and we did not measure
Qwen3-VL-2B.** It is the official Apache-2.0 Qwen3-VL sibling in the same size
class, from the same family as the `quality` model, with first-class llama.cpp
support and an official GGUF release. We expect it to be at least comparable and
we have not proven it. If accuracy matters more than the small-model convenience,
`quality` is the measured Apache-2.0 answer.

## Other components

llama.cpp (MIT) — used as the official upstream container image, not vendored.

Food data licences: USDA FoodData Central is public domain; Open Food Facts is
ODbL and share-alike; the lowcarbcheck API is remote-only because BLS 4.0 forbids
redistribution. See [Food data](configuration.md#food-data-foodsource).
