# Food database API contract (experimental)

> **Experimental.** This page describes what the app server asks of a food database today. It is
> not a stable API. A minor release can change it, and the changelog will say so. The only
> server that implements it is [lowcarbcheck.org](https://lowcarbcheck.org). No open source
> server exists yet, and there is no conformance test. If you build one, tell us in an issue,
> so the contract can grow with a second user.

openplate looks foods up by name through its own server. By default that server asks
lowcarbcheck.org. `FOOD_DB_API_URL` points it at another server that answers the same
requests. [configuration.md](configuration.md#the-food-database-key) explains the key and the
allowance. This page explains the requests and the answers.

## What is in the contract

The app server makes four kinds of request. Only the first is required.

| Request | Used for | If your server lacks it |
| --- | --- | --- |
| `POST /api/v1/foods/search` | Food search, and the vitamins and minerals of a new entry | Food search is empty. Scans keep the AI's own numbers. |
| `GET /api/v1/foods/{slug}` | Vitamins for old diary entries (the backfill) | Old entries stay without vitamins. |
| `GET /api/v1/nutrients` | Reference intakes, so the app can show gaps | The app shows what a day contains and no gaps. |
| `GET /api/v1/nutrients/{slug}/foods` | "Foods rich in this nutrient" on the nutrient screen | The list is empty. |

The app server treats every failure as an empty answer. A missing endpoint, a timeout, a
non-2xx status or a body that does not match never stops a scan or a diary page. This is called
fail-open.

## Rules for every request

- **The base address** is `FOOD_DB_API_URL`. The paths above are appended to it.
- **JSON only.** Requests send `accept: application/json`. Answers are UTF-8 JSON.
- **The key.** When `FOOD_DB_API_KEY` is set, each request carries
  `authorization: Bearer <key>`. Your server decides what a key means. With no key set, the
  header is absent.
- **The timeout** is 4 seconds per request. A slower answer counts as a failure.
- **Unknown fields are ignored.** You can add fields freely. A missing optional field reads as
  "no figure".
- **Per 100 g.** All food figures are per 100 g of the food. Energy is in kcal. Macros are in
  grams.
- **`null` is not `0`.** `null` means "this source has no figure". `0` means "measured, and it
  is zero". The app counts only measured figures, so never send `0` for an unknown value.
- **Privacy.** The search request carries the food name in a `POST` body, not in the address,
  so that a name does not land in an access log. Keep that property: do not log request bodies.
  The app sends no account, no diary and no body data. See
  [architecture.md](architecture.md#the-food-database-is-a-lookup-by-name-through-the-app-server).

## Search

`POST /api/v1/foods/search`

Request body:

```json
{ "q": "hähnchenbrust", "locale": "de", "limit": 10 }
```

- `q` is the food name the person typed or the AI identified.
- `locale` is one of `en`, `de`, `fr`, `it`, `es`, `tr`. Return titles in that language where
  you have them.
- `limit` is 10 today.

Answer:

```json
{
  "results": [
    {
      "slug": "haehnchenbrust-roh",
      "locale": "de",
      "title": "Hähnchenbrust, roh",
      "canonicalName": "Chicken breast, raw",
      "url": null,
      "imageUrl": null,
      "macrosPer100g": {
        "kcal": 106, "protein": 23.1, "fat": 1.2,
        "carbs": 0, "fiber": 0, "sugars": 0, "polyols": 0
      },
      "netCarbsPer100g": 0,
      "attribution": "BLS 4.0, CC BY 4.0",
      "score": 0.92,
      "origin": "bls",
      "portionSize": null,
      "vitamins": { "vitaminA": 9, "vitaminC": 0, "vitaminB12": 0.3 },
      "minerals": { "sodium": 60, "potassium": 370 }
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `slug` | string, required | A stable id for the food. The app stores it and asks for it again later in the detail request. |
| `locale` | string, required | The language of `title`. |
| `title` | string, required | The name to show. |
| `canonicalName` | string, required | An English name, used as a stable label. |
| `url` | string or null | A page for the food. `null` when none exists. Absent reads as `null`. |
| `imageUrl` | string or null, required | A picture, or `null`. |
| `macrosPer100g` | object, required | `kcal`, `protein`, `fat`, `carbs`, `fiber`, `sugars`, `polyols`. Each is a number or `null`. All seven keys must be present. |
| `netCarbsPer100g` | number or null, required | Carbs without fibre. See [Carbs](#carbs). |
| `attribution` | string or null | The licence credit for imported data. The app shows it. |
| `score` | number, required | Relevance, 0 to 1. See [Ranking](#ranking). |
| `origin` | string or null | Where the food came from. It decides how the app reads `carbs`. See [Carbs](#carbs). |
| `portionSize` | number or null | A typical portion in grams. |
| `vitamins` | object or null | See [Vitamins and minerals](#vitamins-and-minerals). Omit it when the food has no vitamin data at all. |
| `minerals` | object or null | The same, for minerals. |

### Carbs

Two sources print carbs in two ways, and the app must know which one a food uses. The `origin`
field tells it:

| `origin` | Basis | What `macrosPer100g.carbs` means |
| --- | --- | --- |
| `bls`, `curated` | available (EU) | Carbs **without** fibre. Fibre is a separate row. |
| `fdc`, `user`, `proposal` | total (US) | Carbs **with** fibre. Net carbs are carbs minus fibre. |
| absent or any other value | unknown | The app treats it as total, and the person can change it by hand. |

If your data is in the EU form, send `origin: "curated"`. If it is in the US form, send
`origin: "fdc"`. A wrong value here moves the carb and calorie numbers of every food it
touches, so check it with a food you know.

`netCarbsPer100g` is your own net carbs figure per 100 g, and the app trusts it over its own
calculation. `null` means "unknown for this food". The app then calculates net carbs from the
macros and the basis above. Never send `0` for an unknown figure.

### Ranking

Sort `results` by relevance, best first. The app keeps your order. It drops weak matches by
`score`:

- A `score` of 0.4 or more must mean a real text match (exact, prefix, word or substring). The
  app drops it below 0.45.
- A `score` below 0.4 must mean a typo-only match. The app drops it below 0.3.
- A typo match must never score at or above 0.4, or it outranks a real match.

## Vitamins and minerals

Each food object carries two optional blocks, `vitamins` and `minerals`. A block has these keys
and no others that the app reads:

| Block | Keys | Unit |
| --- | --- | --- |
| `vitamins` | `betaCarotene`, `vitaminA`, `vitaminD`, `vitaminB9`, `vitaminB12` | µg |
| `vitamins` | `vitaminC`, `vitaminE`, `vitaminB1`, `vitaminB2`, `vitaminB6` | mg |
| `minerals` | `nacl`, `potassium`, `sodium`, `calcium`, `magnesium`, `zinc`, `phosphorus`, `iron` | mg |

Each value is a number or `null`. A key you leave out reads as `null`. The block itself has
three states, and they are not the same:

1. **Block absent** (or `null`): this food has no vitamin or mineral data at all.
2. **Key is `null`**: the block exists and this one figure is unknown.
3. **Key is a number**: a measured figure. `0` is real data.

The app counts a nutrient as covered for a day only when enough of the food by weight carries a
measured figure (60 percent today). Wrong zeros make a person look like they ate nothing of a
vitamin, so send `null` when you are not sure.

**Vitamin A is in retinol activity equivalents (RAE)**, which already includes the carotenoids.
`betaCarotene` is context, not an addition. If your source gives retinol equivalents (RE) or
international units, convert before you send, or the totals will be wrong.

## Food detail

`GET /api/v1/foods/{slug}?locale=de`

The app asks for the vitamins of a food a person logged before the vitamin feature existed. It
sends the `slug` from an old search result.

- Found: status 200 and a food object with `slug`, `vitamins` and `minerals`. The same blocks as
  in search. Other fields are ignored.
- Not found in that locale: status **404** with exactly this body: `{ "error": "not_found" }`.
  The app then tries the other locales (`de`, `en`, `fr`, `it`, `es`, with the person's
  language first), so a food known in one locale only is still found. Any other 404 body counts
  as a failure, not as "not found".
- Found, and no blocks: 200 with both blocks absent. The app records "checked, no data" and does
  not ask again.

Each lookup can cost one credit on your side, up to five for a slug no locale knows. The app
asks once per distinct food per device.

## Reference intakes

`GET /api/v1/nutrients`

The values below are for shape only. They are not real reference intakes.

```json
{
  "nutrients": [
    {
      "slug": "vitamin-c",
      "unit": "mg",
      "kind": "target",
      "rdaDe": {
        "source": "DGE 2024",
        "male":   { "14-18": 105, "19-30": 110, "31-50": 110, "51-70": 110, "over_70": 110 },
        "female": { "14-18": 90,  "19-30": 95,  "31-50": 95,  "51-70": 95,  "over_70": 95 },
        "pregnancy": 105,
        "lactation": 125
      },
      "rdaEu": null,
      "rdaUs": null
    }
  ]
}
```

- `slug` must be one of the slugs below. The app ignores others.
- `kind` is `target` ("have you had enough?") or `ceiling` ("have you stayed under?"). Today
  only sodium is a `ceiling`. An unknown or missing value reads as `target`.
- `rdaDe`, `rdaEu` and `rdaUs` are three separate published documents: DGE, EFSA and the US
  (NASEM). Send the ones you have and `null` for the rest. The app shows one basis at a time,
  chosen by the instance setting, and never mixes two.
- The age bands are exactly `14-18`, `19-30`, `31-50`, `51-70` and `over_70`. All five are
  needed for both sexes. There is no younger band. The app shows no reference for a person
  under 14.
- `pregnancy` and `lactation` are optional numbers. The app uses them locally only. Nothing
  about a person is ever sent to you.

Nutrient slugs:

| App key | Slug |
| --- | --- |
| `vitaminA` | `vitamin-a-retinol` |
| `vitaminC` | `vitamin-c` |
| `vitaminD` | `vitamin-d` |
| `vitaminE` | `vitamin-e-tocopherole` |
| `vitaminB1` | `vitamin-b-1-thiamine` |
| `vitaminB2` | `vitamin-b-2-riboflavin` |
| `vitaminB6` | `vitamin-b-6-pyridoxine` |
| `vitaminB9` | `folic-acid-folate` |
| `vitaminB12` | `vitamin-b-12-cobalamin` |
| `potassium` | `potassium` |
| `sodium` | `sodium` |
| `calcium` | `calcium` |
| `magnesium` | `magnesium` |
| `zinc` | `zinc` |
| `phosphorus` | `phosphorus` |
| `iron` | `iron` |

`betaCarotene` has no reference of its own, because it is part of vitamin A.

## Foods rich in a nutrient

`GET /api/v1/nutrients/{slug}/foods?locale=en&limit=8`

```json
{
  "nutrient": "vitamin-c",
  "unit": "mg",
  "foods": [
    { "slug": "acerola-raw", "title": "Acerola, raw", "url": null, "imageUrl": null,
      "netCarbsPer100g": 7.7, "attribution": null, "value": 1677.6 }
  ]
}
```

Order `foods` richest first. `value` is the amount per 100 g and is never `null`. Leave out
foods with no figure instead of sending them as 0.

## Errors

| Status | Meaning | What the app does |
| --- | --- | --- |
| 401 | The key is wrong or missing | Records `invalid_key`, shows a notice, keeps working with AI numbers |
| 429 | Over the allowance or the rate | Records `rate_limited`, or `allowance_exhausted` when the body says so |
| anything else | Failure | Treated as "no answer", with no notice |

For 401 and 429, you can send a body of the form `{ "error": { "code": "allowance_exhausted" } }`.
The recognised codes are `invalid_key`, `rate_limited` and `allowance_exhausted`. An unknown
code falls back to the reason that the status implies. The app never caches a refusal.

## Try your server

Run these against your server. Each should return JSON that matches the sections above.

```bash
BASE=https://food.example.org
curl -s -X POST "$BASE/api/v1/foods/search" -H 'content-type: application/json' \
  -d '{"q":"apple","locale":"en","limit":3}'
curl -s "$BASE/api/v1/foods/apple-raw?locale=en"
curl -s "$BASE/api/v1/foods/does-not-exist?locale=en" -w '\n%{http_code}\n'   # 404, {"error":"not_found"}
curl -s "$BASE/api/v1/nutrients"
```

Then set `FOOD_DB_API_URL` on the app server, restart it, and search for a food in the app. A
logged food with a `vitamins` block then counts in the vitamins and minerals card of its diary day. If it does not, read the
app server log: a refusal is logged at warning level with the first 16 characters of the key
and never the key itself.

## What is not covered

- **No server is provided.** You build one, or you use lowcarbcheck.org.
- **Food proposals** (`POST /api/v1/foods/proposals`, `FOOD_DB_BACKFILL`) are a separate,
  LowCarbCheck-specific feature and are not part of this contract.
- **No versioning yet.** The paths carry `/v1`, but the shape can still change while this
  page says "experimental".
- **The wire schemas live in the code.** The normative source today is
  `app/services/food-resolution/schema.ts` (search and detail),
  `app/lib/nutrient-reference.ts` (reference intakes and rich foods) and
  `app/services/food-db/micronutrients-wire.ts` (the app's own backfill route, which is not
  part of this contract).
