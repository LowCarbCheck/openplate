#!/usr/bin/env python3
"""Smoke-test a locally served model over its OpenAI-compatible endpoint.

  python3 smoke_test.py lfm-vl    --port 8081   # vision: describe eval/images/01.jpg
  python3 smoke_test.py lfm-judge --port 8082   # text: trivial JSON extraction
  python3 smoke_test.py lfm-judge --port 8082 --json-schema   # response_format json_schema

Reports the completion text, timing, and tokens/sec from llama-server's usage/timings
block, plus the server process RSS. stdlib only, no proxy (localhost).
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
IMAGE = REPO_ROOT / "eval" / "images" / "01.jpg"
LOGS = pathlib.Path(__file__).resolve().parent / "logs"

VISION_PROMPT = (
    "List every food item you can see on this plate. "
    "Answer with a short comma-separated list, nothing else."
)
JUDGE_PROMPT = (
    "Extract the foods from this meal description into JSON with a single key "
    '"foods" holding an array of lowercase strings. Reply with JSON only.\n\n'
    "Meal: a full English breakfast — two fried eggs, baked beans, "
    "grilled sausage, bacon, and a slice of toast."
)
JUDGE_SCHEMA = {
    "type": "object",
    "properties": {"foods": {"type": "array", "items": {"type": "string"}}},
    "required": ["foods"],
    "additionalProperties": False,
}


def post(url: str, payload: dict, timeout: int) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # Bypass any ambient proxy — this is strictly localhost.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def server_rss_gb(key: str) -> float | None:
    pidfile = LOGS / f"{key}.pid"
    if not pidfile.exists():
        return None
    pid = pidfile.read_text().strip()
    out = subprocess.run(
        ["ps", "-o", "rss=", "-p", pid], capture_output=True, text=True
    ).stdout.strip()
    return round(int(out) / 1048576, 2) if out else None


def build_payload(key: str, vision: bool, use_schema: bool, max_tokens: int) -> dict:
    if vision:
        b64 = base64.b64encode(IMAGE.read_bytes()).decode()
        content = [
            {"type": "text", "text": VISION_PROMPT},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            },
        ]
    else:
        content = JUDGE_PROMPT

    payload: dict = {
        "model": key,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
    }
    if use_schema:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "foods", "strict": True, "schema": JUDGE_SCHEMA},
        }
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--vision", action="store_true", help="send eval/images/01.jpg")
    ap.add_argument("--json-schema", action="store_true", dest="use_schema")
    # 512 is deliberate: lfm-judge is a reasoning model whose chain-of-thought counts
    # against max_tokens, so a small budget yields an empty `content` (see SERVING.md).
    ap.add_argument("--max-tokens", type=int, default=512)
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    vision = args.vision or args.key.endswith("-vl")
    url = f"http://127.0.0.1:{args.port}/v1/chat/completions"
    payload = build_payload(args.key, vision, args.use_schema, args.max_tokens)

    t0 = time.monotonic()
    data = post(url, payload, args.timeout)
    wall = time.monotonic() - t0

    text = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    timings = data.get("timings", {})
    completion_tokens = usage.get("completion_tokens")
    prompt_tokens = usage.get("prompt_tokens")

    gen_tps = timings.get("predicted_per_second")
    if gen_tps is None and completion_tokens:
        gen_tps = completion_tokens / wall
    pp_tps = timings.get("prompt_per_second")

    print(f"--- {args.key} (port {args.port}, vision={vision}, json_schema={args.use_schema}) ---")
    print("response:", text.strip()[:1200])
    print()
    print(f"wall_s            : {wall:.1f}")
    print(f"prompt_tokens     : {prompt_tokens}")
    print(f"completion_tokens : {completion_tokens}")
    print(f"prompt_tok_s      : {pp_tps if pp_tps is None else round(pp_tps, 1)}")
    print(f"gen_tok_s         : {gen_tps if gen_tps is None else round(gen_tps, 1)}")
    print(f"server_rss_gb     : {server_rss_gb(args.key)}")

    if args.use_schema:
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            print(f"SCHEMA FAIL: response is not valid JSON ({exc})")
            return 1
        print(f"schema_ok         : {isinstance(parsed.get('foods'), list)} -> {parsed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
