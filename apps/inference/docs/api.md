# API

One endpoint that matters, and it is the OpenAI shape:

```
POST /v1/chat/completions      Authorization: Bearer <key>
GET  /v1/models                Authorization: Bearer <key>
GET  /readyz                   no auth, can it serve a scan right now?
GET  /healthz                  no auth, is the process alive?
```

Send one text part and one `image_url` data URI, exactly as you would to OpenAI.
The model id is `openplate-plate-1`. `choices[0].message.content` is clean,
unfenced JSON:

```json
{
  "foods": [
    { "name": "scrambled eggs", "estimatedGrams": 80, "confidence": "high",
      "portionHint": "a small scoop",
      "macrosPer100g": { "carbs": 1.2, "protein": 10, "fat": 10, "kcal": 140 } }
  ],
  "notes": "…"
}
```

Each food also carries a `provenance` field (`"corpus"` or `"model"`) and an `attribution` string where the food source requires one: see [Food data](configuration.md#food-data-foodsource).

The service accepts one image and answers one question. Your prompt is read for
the image and otherwise discarded.

## Status codes

| code | meaning |
|---|---|
| `200` | Scan completed. |
| `400` | Malformed request body: the message names the field. |
| `401` | Missing or wrong bearer key. |
| `413` | Image payload larger than the accepted limit. |
| `429` | Queue full (`MAX_QUEUE_DEPTH`) or over `RATE_LIMIT_RPM`. A `Retry-After` header is set. |
| `502` | The model runtime is unreachable, failed, or does not enforce the JSON schema. |
| `503` | Admission refused because the request cannot finish inside `LATENCY_CEILING_MS` (only when that ceiling is enabled). |

## CORS

CORS is wide open (`*`) by design: the browser calls this endpoint directly, so an origin allowlist would mean every self-hoster editing server config. What
makes that safe is the absence of ambient credentials: this service issues no
cookies and reads none, so a hostile page can make a cross-origin request and get
a `401`, because the browser has nothing to attach automatically.

## Readiness

`/readyz` returns 200 only when a scan will actually run: weights present, model loaded, runtime answering. `/healthz` only means the process is alive. In
external mode `/readyz` has limits worth knowing; see
[Readiness](runtimes.md#readiness-and-what-it-does-not-tell-you).

## Why there is no admin API and no CLI

The two sibling services grew one in August 2026: `openplate-gateway` has `gw-api` over its member and invite endpoints, and `openplate-sync` has `sync-api` over an account-metadata surface. This service deliberately grew
neither, and the reason is worth writing down so the absence reads as a decision
rather than an oversight.

**This service implements someone else's specification.** Its surface is the OpenAI chat-completions shape, which is what lets any OpenAI-compatible client, openplate included, point at it with no adapter. An API is "first" here in the
strongest available sense: there is nothing but the API, and its shape is not
ours to extend.

**There is no administrative state to administer.** A gateway has members,
invites and quotas, all of which outlive a request and need listing, revoking
and auditing. A sync server has accounts. This service has a model, a queue and
a rate limiter, and every one of those is either configuration read at boot or
state that dies with the process. `/readyz` already answers the only operational question anyone asks (can it serve a scan right now) and it answers it without a credential, which is what a monitoring probe needs.

Inventing an admin surface here would mean inventing the state to justify it.
The scripts in `scripts/` are build, weight-fetch and smoke tooling: they are
operator ergonomics around the container, not features hiding from the API.

If this service ever grows durable per-caller state (per-key quotas, a usage ledger, anything that must be listed or revoked), this decision should be revisited, and that is the trigger to watch for.
