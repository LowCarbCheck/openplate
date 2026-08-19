"""One OpenAI-compatible chat-completions client for cloud and local servers.

Covers both:
  * OpenRouter  -- base_url https://openrouter.ai/api/v1, Bearer key from an env
    var, honours `https_proxy` via urllib's default proxy handling.
  * local llama-server / ollama -- base_url http://127.0.0.1:<port>/v1, no auth,
    and proxies are BYPASSED for loopback hosts (an exported `http_proxy` would
    otherwise send localhost traffic to the sandbox proxy and fail).

Stdlib only. Retries on 429/5xx/timeouts with exponential backoff, falls back
gracefully when a server rejects `response_format: json_schema`, tolerantly
parses the JSON out of the reply, and captures latency + usage. Local servers
frequently omit `usage` entirely -- that is handled as zero tokens / zero cost
rather than an error.
"""

from __future__ import annotations

import base64
import io
import json
import mimetypes
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import schema as plate_schema

DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_BACKOFF_BASE_SECONDS = 2.0

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


class ProviderHttpError(Exception):
    """A non-retryable HTTP error, carrying the body so callers can react
    (e.g. detect an unsupported response_format and retry without it)."""

    def __init__(self, status: int, body_text: str):
        super().__init__(f"HTTP {status}: {body_text}")
        self.status = status
        self.body_text = body_text


_RESIZE_UNAVAILABLE_WARNED = False

#: Downscale target alignment. 112 == lcm(16, 28): LFM2.5-VL uses 16 px patches,
#: Qwen3-VL 14 px with a 2x2 merge (28), so a multiple of 112 lands on an exact
#: patch boundary for both and avoids a padded partial patch.
_PATCH_ALIGNMENT = 112


def _downscale_to_jpeg(raw: bytes, max_long_edge: int, quality: int = 85) -> bytes | None:
    """Shrink an image so the vision tower emits fewer image tokens.

    Returns None when no resize happened (already small enough, or Pillow is not
    installed) so the caller keeps the original bytes and mime type. Pillow is
    deliberately optional: a full-resolution run is a slow run, but a missing
    dependency must not be a failed run.
    """
    global _RESIZE_UNAVAILABLE_WARNED
    try:
        from PIL import Image
    except ImportError:
        if not _RESIZE_UNAVAILABLE_WARNED:
            print(
                "WARN: image_max_long_edge is set but Pillow is not installed; "
                "sending full-resolution images (latency projections assume the downscale)",
                file=sys.stderr,
            )
            _RESIZE_UNAVAILABLE_WARNED = True
        return None
    with Image.open(io.BytesIO(raw)) as image:
        if max(image.size) <= max_long_edge:
            return None
        scale = max_long_edge / max(image.size)
        size = tuple(
            max(_PATCH_ALIGNMENT, round(dim * scale / _PATCH_ALIGNMENT) * _PATCH_ALIGNMENT)
            for dim in image.size
        )
        resized = image.convert("RGB").resize(size, Image.LANCZOS)
    buffer = io.BytesIO()
    resized.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def image_to_data_url(image_path: Path, max_long_edge: int | None = None) -> str:
    """Base64 data URL for an image, optionally downscaled first.

    `max_long_edge` comes from a config's `image_max_long_edge`. It is a run-level
    knob: it changes prompt_tokens for every model in the run, so a run that
    enables it is not single-variable against a run that does not.
    """
    mime_type, _ = mimetypes.guess_type(str(image_path))
    if mime_type is None:
        mime_type = "image/jpeg"
    raw = image_path.read_bytes()
    if max_long_edge:
        downscaled = _downscale_to_jpeg(raw, int(max_long_edge))
        if downscaled is not None:
            raw, mime_type = downscaled, "image/jpeg"
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{mime_type};base64,{b64}"


def build_vision_messages(system_prompt: str, user_text: str, image_data_url: str) -> list:
    return [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        },
    ]


def build_text_messages(system_prompt: str, user_text: str) -> list:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]


class ChatClient:
    """OpenAI-compatible /chat/completions client.

    Provider config keys (all optional except base_url):
      base_url          e.g. "https://openrouter.ai/api/v1" or "http://127.0.0.1:8081/v1"
      api_key_env       env var holding the bearer token; omit for local servers
      api_key_required   default True when api_key_env is set
      headers            extra request headers (OpenRouter attribution etc.)
      timeout_seconds    default 120
      max_retries        default 3
      retry_backoff_base_seconds  default 2.0
      no_proxy           force proxy bypass (auto-true for loopback hosts)
    """

    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        base_url = config.get("base_url")
        if not base_url:
            raise ValueError(f"provider {name!r} is missing 'base_url'")
        self.base_url = base_url.rstrip("/")
        self.url = f"{self.base_url}/chat/completions"
        self.timeout_seconds = config.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
        self.max_retries = config.get("max_retries", DEFAULT_MAX_RETRIES)
        self.retry_backoff_base_seconds = config.get(
            "retry_backoff_base_seconds", DEFAULT_RETRY_BACKOFF_BASE_SECONDS
        )
        self._headers = self._build_headers()
        self._opener = self._build_opener()

    # -- setup ------------------------------------------------------------

    def _build_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        headers.update(self.config.get("headers") or {})
        api_key_env = self.config.get("api_key_env")
        if api_key_env:
            key = os.environ.get(api_key_env)
            if not key:
                if self.config.get("api_key_required", True):
                    raise SystemExit(
                        f"ERROR: provider {self.name!r} needs {api_key_env} in the "
                        "environment. Source it before running, e.g.:\n"
                        "  export {}=...".format(api_key_env)
                    )
            else:
                headers["Authorization"] = f"Bearer {key}"
        return headers

    def _is_loopback(self) -> bool:
        host = (urllib.parse.urlparse(self.base_url).hostname or "").lower()
        return host in _LOOPBACK_HOSTS

    def _build_opener(self) -> urllib.request.OpenerDirector:
        bypass_proxy = self.config.get("no_proxy")
        if bypass_proxy is None:
            bypass_proxy = self._is_loopback()
        if bypass_proxy:
            # Empty ProxyHandler == "no proxies", so loopback traffic goes direct.
            return urllib.request.build_opener(urllib.request.ProxyHandler({}))
        # Default handlers pick up https_proxy/http_proxy from the environment.
        return urllib.request.build_opener()

    # -- transport --------------------------------------------------------

    def post(self, payload: dict) -> dict:
        """POST with retry on 429/5xx and transient network errors."""
        data = json.dumps(payload).encode("utf-8")
        last_error: Exception | None = None

        for attempt in range(self.max_retries + 1):
            req = urllib.request.Request(
                self.url, data=data, headers=self._headers, method="POST"
            )
            try:
                with self._opener.open(req, timeout=self.timeout_seconds) as resp:
                    return json.loads(resp.read())
            except urllib.error.HTTPError as e:
                body_text = e.read().decode("utf-8", errors="replace")[:800]
                if e.code == 429 or e.code >= 500:
                    last_error = RuntimeError(f"HTTP {e.code}: {body_text}")
                    if attempt < self.max_retries:
                        time.sleep(self.retry_backoff_base_seconds * (2**attempt))
                        continue
                    raise last_error
                raise ProviderHttpError(e.code, body_text) from e
            except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
                last_error = e
                if attempt < self.max_retries:
                    time.sleep(self.retry_backoff_base_seconds * (2**attempt))
                    continue
                raise

        assert last_error is not None
        raise last_error

    def chat_once(
        self,
        model: str,
        messages: list,
        temperature: float | None = None,
        use_json_schema: bool = True,
        max_tokens: int | None = None,
        extra_body: dict | None = None,
        response_format: dict | None = None,
    ) -> tuple[dict, float]:
        """One HTTP call. Returns (response_json, latency_ms).

        `response_format` defaults to the production plate schema; the judge
        call passes the stricter merged-output schema (bounded `foods` array).

        Retries once without `response_format` if the server rejects the
        json_schema (llama-server builds and some OpenRouter providers 400 on
        strict schemas; the reply is tolerant-parsed either way).
        """
        payload: dict = {"model": model, "messages": messages}
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if extra_body:
            payload.update(extra_body)
        if use_json_schema:
            payload["response_format"] = (
                response_format
                if response_format is not None
                else plate_schema.JSON_SCHEMA_RESPONSE_FORMAT
            )

        t0 = time.monotonic()
        try:
            resp = self.post(payload)
        except ProviderHttpError as e:
            if use_json_schema and 400 <= e.status < 500:
                payload.pop("response_format", None)
                resp = self.post(payload)
            else:
                raise
        return resp, (time.monotonic() - t0) * 1000


# ---------------------------------------------------------------------------
# Usage / cost
# ---------------------------------------------------------------------------


def extract_content(resp: dict) -> str | None:
    try:
        return resp["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None


def extract_usage(resp: dict) -> dict:
    """Usage, normalised. Local servers may omit it entirely -> zeros."""
    usage = resp.get("usage") if isinstance(resp, dict) else None
    if not isinstance(usage, dict):
        return {"prompt_tokens": 0, "completion_tokens": 0}
    return {
        "prompt_tokens": usage.get("prompt_tokens") or 0,
        "completion_tokens": usage.get("completion_tokens") or 0,
    }


def merge_usage(a: dict, b: dict) -> dict:
    return {
        "prompt_tokens": (a.get("prompt_tokens") or 0) + (b.get("prompt_tokens") or 0),
        "completion_tokens": (a.get("completion_tokens") or 0) + (b.get("completion_tokens") or 0),
    }


def compute_cost_usd(model_cfg: dict, usage: dict) -> float:
    """Cost from per-million-token prices in the model config. Local models
    declare 0 (or omit the fields) -- latency and RAM are their currency."""
    price_in = model_cfg.get("price_per_mtok_in") or 0.0
    price_out = model_cfg.get("price_per_mtok_out") or 0.0
    prompt_tokens = usage.get("prompt_tokens") or 0
    completion_tokens = usage.get("completion_tokens") or 0
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000


# ---------------------------------------------------------------------------
# One logical "get me a PlateIdentification" call
# ---------------------------------------------------------------------------


def failed_result(error: str) -> dict:
    return {
        "foods": [],
        "notes": None,
        "latency_ms": 0.0,
        "cost_usd": 0.0,
        "raw_ok": False,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "raw_text": None,
        "error": error,
    }


def complete_plate_identification(
    client: ChatClient,
    model_cfg: dict,
    messages: list,
    temperature: float | None = None,
    max_tokens: int | None = None,
    response_format: dict | None = None,
) -> dict:
    """Initial call plus one schema-nudge retry when the reply doesn't validate.

    `temperature`, `max_tokens` and `response_format` are per-call overrides
    (the judge stage uses all three); when omitted, `temperature`/`max_tokens`
    fall back to the model config and `response_format` to the production plate
    schema.

    Returns the pilot script's normalized result shape:
    foods, notes, latency_ms, cost_usd, raw_ok, prompt_tokens,
    completion_tokens, raw_text, [error].
    """
    model = model_cfg["id"]
    use_json_schema = model_cfg.get("use_json_schema", True)
    if max_tokens is None:
        max_tokens = model_cfg.get("max_tokens")
    extra_body = model_cfg.get("extra_body")
    if temperature is None:
        temperature = model_cfg.get("temperature")

    error: str | None = None
    try:
        resp, latency_ms = client.chat_once(
            model, messages, temperature, use_json_schema, max_tokens, extra_body, response_format
        )
    except Exception as e:  # noqa: BLE001 - eval harness: surface every failure
        return failed_result(f"call failed: {e}")

    content = extract_content(resp)
    usage = extract_usage(resp)
    parsed = plate_schema.tolerant_parse_json(content) if content else None
    ok, _errors = (
        (False, ["empty content"])
        if not content
        else plate_schema.validate_plate_identification(parsed)
    )

    if not ok:
        nudge_messages = list(messages) + [
            {"role": "assistant", "content": content or ""},
            {"role": "user", "content": plate_schema.SCHEMA_NUDGE_USER_MESSAGE},
        ]
        try:
            resp2, latency_ms2 = client.chat_once(
                model,
                nudge_messages,
                temperature,
                use_json_schema,
                max_tokens,
                extra_body,
                response_format,
            )
            latency_ms += latency_ms2
            content2 = extract_content(resp2)
            usage = merge_usage(usage, extract_usage(resp2))
            parsed2 = plate_schema.tolerant_parse_json(content2) if content2 else None
            ok2, errors2 = (
                (False, ["empty content"])
                if not content2
                else plate_schema.validate_plate_identification(parsed2)
            )
            if ok2:
                content, parsed, ok = content2, parsed2, ok2
            else:
                # keep the first attempt's content for debugging
                error = f"schema validation failed twice: {errors2}"
        except Exception as e:  # noqa: BLE001
            error = f"nudge retry failed: {e}"

    result = {
        "foods": (parsed or {}).get("foods", []) if ok else [],
        "notes": (parsed or {}).get("notes") if ok else None,
        "latency_ms": latency_ms,
        "cost_usd": compute_cost_usd(model_cfg, usage),
        "raw_ok": ok,
        "prompt_tokens": usage.get("prompt_tokens", 0) or 0,
        "completion_tokens": usage.get("completion_tokens", 0) or 0,
        "raw_text": None if ok else content,
    }
    if error and not ok:
        result["error"] = error
    return result


def build_clients(provider_configs: dict) -> dict:
    """Instantiate one ChatClient per declared provider (fail fast on bad env)."""
    clients: dict = {}
    for name, cfg in (provider_configs or {}).items():
        clients[name] = ChatClient(name, cfg)
    return clients


def preflight(clients: dict) -> None:
    """Print what each client will talk to -- catches a wrong port early."""
    for name, client in clients.items():
        auth = "bearer" if "Authorization" in client._headers else "none"
        print(f"provider {name}: {client.url} (auth: {auth})", file=sys.stderr)
