# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | :white_check_mark: |

Pre-1.0: security fixes land on `main` and the latest `0.1.x` tag. No older
line is maintained.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/LowCarbCheck/openplate-inference/security/advisories/new)
— **not** a public issue. That draft advisory is visible only to maintainers
until a fix ships, which keeps an exploit private while it's live.

Include what you'd want in a bug report generally: the affected version/commit,
how you're running it (build-from-source, published image, CPU or GPU), the
minimal request or config that triggers it, and impact as you see it.

This is a small self-hosted OSS project with no bounty program. Expect an
acknowledgment within a few days and a fix or mitigation plan once triaged —
no SLA beyond "we take it seriously." Credit in the release notes if you want it.

## Security model

openplate-inference is a self-hosted harness in front of a model runtime
(bundled llama.cpp, or an operator's own llama.cpp/Ollama/vLLM). It has no
database, no accounts, no cookies, and no server-side state beyond the current
request. That shrinks the attack surface to three things: the front door,
what gets logged, and how photo bytes and runtime credentials flow through the
pipeline.

**Front door (`/v1/*`).** Bearer API-key auth (`src/server/api-key-auth.ts`).
Keys are compared with `timingSafeEqual` over a SHA-256 digest, not `===` —
raw-string comparison would leak a prefix-match timing oracle, and comparing
raw buffers would leak key length. Missing, malformed, and unknown keys all
get the same `401` message, so a response never confirms a guess was close to
a valid key. Only an 8-hex-char, non-reversible fingerprint of a key (never
the key itself) is ever logged.

**CORS is intentionally `Access-Control-Allow-Origin: *`** (`src/server/cors.ts`).
This is deliberate, not an oversight: openplate's browser posts the photo
straight to this service with no server in between, so an origin allowlist
would break every self-hoster's client. It's safe specifically because there
are no ambient credentials to ride along — no cookies are issued or read, and
`Access-Control-Allow-Credentials` is never sent. A hostile page can trigger a
cross-origin request but has nothing a browser will attach automatically, so
it gets a `401` like anyone else without the key.

**Image intake is not SSRF-capable.** The only way to submit a photo is a
base64 `data:` URI in the request body (`src/pipeline/image.ts`); an
`http(s)://` image URL is explicitly rejected with a 400
(`unsupported_image_source`) rather than fetched. The service never makes an
outbound request driven by request-supplied input — the model-runtime URL
(`MODEL_RUNTIME_URL`) and the OpenFoodFacts host are both fixed at operator
configuration or build time, never taken from a client request.

**Credential handling.** Two kinds of secret pass through this process: the
`API_KEYS` this service checks incoming requests against, and (optionally)
`MODEL_RUNTIME_API_KEY` / `EMBEDDING_RUNTIME_API_KEY` it presents to an
external runtime. Neither is ever written to a log line: `src/logger.ts`'s
`LogFields` type accepts primitives only (no `object`/`unknown` branch), so a
key, request, or Buffer cannot be passed to it without a type error. Free-text
strings that could carry an echoed secret or payload — a dependency's
`Error.message`, a wrapped library error — are run through
`src/server/scrub.ts#scrubPayloads` first, which redacts data URIs and any
base64-shaped run of 48+ characters before it reaches a log line or an error
response. `tests/unit/no-image-in-error-paths.test.ts` exists specifically to
throw an error carrying a base64 payload and assert it appears in neither logs
nor the response body — a regression there is a real finding.

**Photo bytes never touch disk.** `src/pipeline/image.ts` decodes and
downscales entirely in memory; the module deliberately does not import `fs`,
so adding disk I/O there requires visibly adding that import. Bytes live in a
`Buffer` scoped to the request and are gone when it ends.

**Prompt injection does not apply here** in the "injection → tool
escalation" sense that matters for agents: the model has no tools, no
function-calling surface, and no ability to take actions — it answers one
structured vision query per request via grammar-constrained decoding
(`response_format: json_schema`), and the response is validated against a
fixed schema before use. A malicious image could try to influence what foods
the model claims are on the plate, but that's a data-quality/robustness
concern (wrong scan result), not a security boundary — there is nothing
downstream for an "instruction" to escalate into.

**Interesting to us:**
- Any way to bypass `/v1/*` auth, or to distinguish "valid key" from "invalid
  key" via timing or response shape.
- SSRF — any path that turns a client-supplied value (image URL, header,
  filename) into an outbound request the server makes on the client's behalf.
- Any way an image, an error message, or a runtime response ends up in a log
  line, an error body, or anywhere else observable without the caller
  supplying it back themselves — i.e., a leak of `API_KEYS`,
  `MODEL_RUNTIME_API_KEY`, `EMBEDDING_RUNTIME_API_KEY`, or photo bytes.
- Denial of service against `CONCURRENCY`/admission control (`src/server/admission.ts`)
  that isn't already covered by the documented latency-ceiling behavior.

**Not a security boundary, and not useful reports:** the wide-open CORS policy
by itself (see above); the model returning an implausible or wrong food
identification; issues that only manifest by running an untrusted, attacker-
controlled model runtime behind this service (the operator chooses their own
runtime and is trusted to run it).
