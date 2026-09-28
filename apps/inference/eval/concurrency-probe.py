#!/usr/bin/env python3
"""Concurrency probe: does this server overlap requests, or serialise them?

    cd eval
    ./serve/serve.sh lfm-vl
    python3 concurrency-probe.py --base-url http://127.0.0.1:8081/v1
    ./serve/serve.sh stop all

Single-request latency is the wrong number for a self-hosted target. llama.cpp
puts one generation across every thread it was given, so a second simultaneous
request may find no idle silicon and simply queue -- which means a fan-out of N
can cost N x wall clock instead of hiding behind concurrency. That is the number
that decides ensemble size and the service's in-flight limit, so it gets
measured, not assumed (M138 counsel, spec 01).

What it measures, in order:

  1. `single`        one request alone                      -> the reference
  2. `sequential-2`  two requests back to back              -> 2 x work, serial
  3. `parallel-2`    the same two requests simultaneously   -> the headline
  4. `parallel-3`    three requests simultaneously          -> fan-out 3

The headline number is `parallel-2 / sequential-2`:

    ~0.5  perfect overlap (a second request is free)
    ~1.0  full serialisation (concurrency buys nothing; plan capacity as serial)

**Every request uses a different image on purpose.** llama.cpp's prompt-prefix
cache makes a re-sent image ~10x faster (PERFORMANCE.md §6), so probing with one
image would measure the cache and report fictional parallelism.

Python 3 standard library only, like the rest of this harness. No model is
scored here -- this is a timing instrument.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness import providers  # noqa: E402  (after sys.path bootstrap)
from harness import runner  # noqa: E402  (host_info)

PROMPT = "List the foods on this plate as a short comma-separated list."


def post_chat(
    base_url: str,
    model: str,
    data_url: str,
    *,
    max_tokens: int,
    timeout: float,
    api_key: str | None,
) -> dict:
    """One /chat/completions call, timed. Proxies are bypassed (loopback)."""
    body = json.dumps(
        {
            "model": model,
            "messages": providers.build_vision_messages("", PROMPT, data_url),
            "max_tokens": max_tokens,
            "temperature": 0,
            "stream": False,
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "openplate-eval-probe/1"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=body, headers=headers
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    started = time.monotonic()
    try:
        with opener.open(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        elapsed = time.monotonic() - started
        usage = payload.get("usage") or {}
        return {
            "seconds": elapsed,
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "error": None,
        }
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as e:
        return {"seconds": time.monotonic() - started, "error": str(e)}


def run_scenario(
    label: str,
    data_urls: list[str],
    *,
    parallel: bool,
    base_url: str,
    model: str,
    max_tokens: int,
    timeout: float,
    api_key: str | None,
) -> dict:
    def call(data_url: str) -> dict:
        return post_chat(
            base_url, model, data_url, max_tokens=max_tokens, timeout=timeout, api_key=api_key
        )

    wall_t0 = time.monotonic()
    if parallel:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(data_urls)) as pool:
            results = list(pool.map(call, data_urls))
    else:
        results = [call(url) for url in data_urls]
    wall = time.monotonic() - wall_t0

    latencies = [r["seconds"] for r in results]
    errors = [r["error"] for r in results if r.get("error")]
    print(
        f"  {label:<14} wall {wall:6.2f}s   per-request "
        + ", ".join(f"{s:.2f}s" for s in latencies)
        + (f"   ERRORS: {errors}" if errors else "")
    )
    return {
        "label": label,
        "requests": len(data_urls),
        "parallel": parallel,
        "wall_seconds": round(wall, 3),
        "latencies_seconds": [round(s, 3) for s in latencies],
        "errors": errors,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 concurrency-probe.py",
        description="Measure whether a llama-server (or any OpenAI-compatible endpoint) "
        "overlaps simultaneous requests or serialises them.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8081/v1")
    parser.add_argument(
        "--model", default="local", help="Model id; llama-server ignores it."
    )
    parser.add_argument("--api-key", default=None, help="Only for remote endpoints.")
    parser.add_argument("--images-dir", type=Path, default=Path(__file__).parent / "images")
    parser.add_argument(
        "--max-long-edge",
        type=int,
        default=448,
        help="Downscale images before sending (default 448 -- keep the probe cheap; this is a "
        "concurrency measurement, not a quality one). Needs Pillow; without it full "
        "resolution is sent and the harness warns.",
    )
    parser.add_argument("--max-tokens", type=int, default=64)
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--out", type=Path, default=None, help="Write the raw results as JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    # 6 distinct images: 1 single + 2 sequential + 3 parallel-3; parallel-2 reuses
    # the sequential pair's *positions* but not its images (see module docstring).
    images = sorted(args.images_dir.glob("*.jpg"))[:8]
    if len(images) < 8:
        raise SystemExit(f"ERROR: need >= 8 images in {args.images_dir}, found {len(images)}")
    urls = [providers.image_to_data_url(p, max_long_edge=args.max_long_edge) for p in images]

    host = runner.host_info()
    print(f"endpoint: {args.base_url}  model: {args.model}  max_tokens: {args.max_tokens}")
    print(f"host: {host['cpu_model']} / {host['cpu_count']} threads / {host['mem_total_mb']} MB")
    print(f"images: {[p.name for p in images]} (long edge <= {args.max_long_edge})")
    print()

    common = dict(
        base_url=args.base_url,
        model=args.model,
        max_tokens=args.max_tokens,
        timeout=args.timeout,
        api_key=args.api_key,
    )
    scenarios = [
        run_scenario("single", [urls[0]], parallel=False, **common),
        run_scenario("sequential-2", urls[1:3], parallel=False, **common),
        run_scenario("parallel-2", urls[3:5], parallel=True, **common),
        run_scenario("parallel-3", urls[5:8], parallel=True, **common),
    ]

    by_label = {s["label"]: s for s in scenarios}
    single = by_label["single"]["wall_seconds"]
    seq2 = by_label["sequential-2"]["wall_seconds"]
    par2 = by_label["parallel-2"]["wall_seconds"]
    par3 = by_label["parallel-3"]["wall_seconds"]

    print()
    print("| scenario | wall | vs serial expectation | reading |")
    print("|---|---|---|---|")
    print(f"| single | {single:.2f} s | — | reference |")
    print(f"| sequential-2 | {seq2:.2f} s | {seq2 / single:.2f}x single | the serial cost of 2 |")
    ratio2 = par2 / seq2 if seq2 else float("nan")
    print(
        f"| **parallel-2** | {par2:.2f} s | **{ratio2:.2f}x sequential-2** | "
        f"{'overlaps' if ratio2 < 0.8 else 'serialises'} |"
    )
    ratio3 = par3 / (3 * single) if single else float("nan")
    print(f"| parallel-3 | {par3:.2f} s | {ratio3:.2f}x 3x single | fan-out 3 |")
    print()
    print(
        f"HEADLINE: two simultaneous requests take {ratio2:.2f}x the wall clock of the same two "
        f"run back to back ({par2:.2f} s vs {seq2:.2f} s). "
        + (
            "0.5 would be free concurrency; ~1.0 means plan capacity as if the box were serial."
            if ratio2 >= 0.8
            else "Below 0.8 there is real overlap to exploit."
        )
    )
    slowest = max(max(s["latencies_seconds"]) for s in scenarios)
    print(
        f"Tail cost of sharing: slowest single request across all scenarios {slowest:.2f} s "
        f"vs {single:.2f} s alone — the latency an in-flight limit exists to protect."
    )

    payload = {
        "endpoint": args.base_url,
        "model": args.model,
        "max_tokens": args.max_tokens,
        "max_long_edge": args.max_long_edge,
        "images": [p.name for p in images],
        "host": host,
        "scenarios": scenarios,
        "parallel2_over_sequential2": round(ratio2, 3),
        "parallel3_over_3x_single": round(ratio3, 3),
    }
    if args.out:
        args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Wrote {args.out}")
    failures = [e for s in scenarios for e in s["errors"]]
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
