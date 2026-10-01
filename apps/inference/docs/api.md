# API

One endpoint that matters, and it is the OpenAI shape:

```
POST /v1/chat/completions      Authorization: Bearer <key>, optional Accept-Language
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
      "macrosPer100g": { "carbs": 1.2, "protein": 10, "fat": 10, "kcal": 140 },
      "translations": { "en": "scrambled eggs", "de": "Rührei" } }
  ],
  "notes": "…"
}
```

This service sets `provenance` to `"corpus"` on a food record when the food database supplies its macros. It adds an `attribution` string when the source requires one, see [Food data](configuration.md#food-data-foodsource). When nothing resolves the item, both fields are omitted and `macrosPer100g` is null. This service never emits `"model"`, as the shared contract reserves that value for a cloud provider. A source failure, such as a timeout, a refusal, or a network error, looks the same as no match: `macrosPer100g` is null, the response is still `200`, and nothing in the response marks which occurred.

This service sets `flags` (allergens and pregnancy categories) on a food when it recognises the food name, and sets `flagsCoverage` to `"partial"` beside it. The flags come from a fixed word list in code, not from the model. A name can show what a food contains, but it cannot show what a food lacks. So treat the lists as a start, not as a check: an allergen missing from them can still be in the food. When the service does not recognise the name, it omits both fields. An absent `flags` means the food was not assessed, never that it is safe.

This service translates food names into the language named in the `Accept-Language` request header, one language per request. It reads the highest-weighted tag whose language is one of the app languages (en, de, fr, it, es, tr) and ignores the region, so `de-DE` means German. When that language is not English, each food gets a `translations` object with two keys: the English name and the name in that language. The example above is a request sent with `Accept-Language: de`. `name` always stays English, because the food database searches with it. The translation is a second, text-only call to the same model. If it fails or takes longer than 20 seconds, the service leaves the names alone: no food in that response has `translations`, and the response is still `200`. Without the header, or with English, `*` or a language outside that list, the service makes no second call and sends no `translations`.

The service accepts one image and answers one question. Your prompt is read for
the image and otherwise discarded.

## Capabilities

`GET /v1/models` lists the one model. Its entry carries a `capabilities` object, which tells a client what this service can and cannot do. Read it before you send a request. The other keys of the entry (`id`, `object`, `created`, `owned_by`) are the OpenAI shape and do not change. An OpenAI client ignores the extra key.

```json
{
  "object": "list",
  "data": [
    {
      "id": "openplate-plate-1",
      "object": "model",
      "created": 0,
      "owned_by": "openplate",
      "capabilities": {
        "tasks": {
          "plateImage": true,
          "describe": false,
          "pantryImage": false,
          "pantryText": false,
          "recipes": false
        },
        "flags": "partial",
        "translations": "request-language",
        "labels": false
      }
    }
  ]
}
```

| key | values | meaning |
|---|---|---|
| `tasks.plateImage` | `true`, `false` | Identify the foods on a plate from one photo. `true` today. |
| `tasks.describe` | `true`, `false` | Turn a typed description of a meal into foods. |
| `tasks.pantryImage` | `true`, `false` | Read a pantry item from a photo. |
| `tasks.pantryText` | `true`, `false` | Read a pantry item from typed text. |
| `tasks.recipes` | `true`, `false` | Suggest recipes. |
| `flags` | `none`, `partial`, `complete` | How many caution flags the service fills on each food. With `none`, an empty flag list does not mean a food is safe. This service is `partial`: it lists what it can recognise from the food name, and an absent `flags` on a food means not assessed. |
| `translations` | `none`, `request-language`, `all` | Which languages the service returns food names in. `none` is one language, `request-language` is the language the request asks for, `all` is every supported language. This service is `request-language`: it reads `Accept-Language`, and a food with no `translations` has only its English `name`. |
| `labels` | `true`, `false` | Whether the service reads a printed nutrition panel on a package and returns its numbers as `macroSource: "label"`. |

The set of keys can grow. A client should treat a missing key as `false` or `none`.

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

The two sibling services grew one in August 2026: `openplate-gateway` has `gw-api` over its member and invite endpoints, and `openplate-core` has `core-api` over an account-metadata surface. This service deliberately grew
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
