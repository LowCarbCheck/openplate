# API

One endpoint that matters, and it is the OpenAI shape:

```
POST /v1/chat/completions      Authorization: Bearer <key>
GET  /v1/models                Authorization: Bearer <key>
GET  /readyz                   no auth — can it serve a scan right now?
GET  /healthz                  no auth — is the process alive?
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

Each food also carries a `provenance` field (`"corpus"` or `"model"`) and an
`attribution` string where the food source requires one — see
[Food data](configuration.md#food-data-foodsource).

The service accepts one image and answers one question. Your prompt is read for
the image and otherwise discarded.

## Status codes

| code | meaning |
|---|---|
| `200` | Scan completed. |
| `400` | Malformed request body — the message names the field. |
| `401` | Missing or wrong bearer key. |
| `413` | Image payload larger than the accepted limit. |
| `429` | Queue full (`MAX_QUEUE_DEPTH`) or over `RATE_LIMIT_RPM`. A `Retry-After` header is set. |
| `502` | The model runtime is unreachable, failed, or does not enforce the JSON schema. |
| `503` | Admission refused because the request cannot finish inside `LATENCY_CEILING_MS` (only when that ceiling is enabled). |

## CORS

CORS is wide open (`*`) by design — the browser calls this endpoint directly, so
an origin allowlist would mean every self-hoster editing server config. What
makes that safe is the absence of ambient credentials: this service issues no
cookies and reads none, so a hostile page can make a cross-origin request and get
a `401`, because the browser has nothing to attach automatically.

## Readiness

`/readyz` returns 200 only when a scan will actually run — weights present, model
loaded, runtime answering. `/healthz` only means the process is alive. In
external mode `/readyz` has limits worth knowing; see
[Readiness](runtimes.md#readiness-and-what-it-does-not-tell-you).
