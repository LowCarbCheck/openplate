# Architecture

Four programs, one of which is the product and three of which are optional attachments. This
page is about which one holds what, and — more importantly — which one is standing in the
path of your data.

```
                      ┌──────────────────────────────────────────┐
   your device        │  browser                                 │
                      │    diary  ──►  IndexedDB (plaintext,     │
                      │                          never leaves)   │
                      └───┬───────────────────┬──────────────────┘
                          │                   │
              ciphertext  │                   │  photo + your key
                          ▼                   ▼
                 ┌─────────────────┐   ┌──────────────────────────┐
                 │ openplate-sync  │   │ your AI provider,   OR   │
                 │ email + opaque  │   │ openplate-inference      │
                 │ bytes, no key   │   │ on your own hardware     │
                 └─────────────────┘   └──────────────────────────┘

                 ┌─────────────────┐
                 │ openplate app   │   serves HTML and JS. Holds nothing.
                 │ server          │   Not on either arrow above.
                 └─────────────────┘
```

## The client is the product

Everything a user owns — food logs, weights, personal foods, goals, the AI settings — is
written to the browser's IndexedDB on the device it was entered on (`app/lib/local-store/`).
It is stored in the clear there, because it is *your* device, and it never leaves it except
in two forms you choose: a JSON export you download, or an encrypted sync blob.

The app server is a single stateless container. No database, no ORM, no migrations, no
secret read from the environment. Destroying it loses nothing. That is not thrift, it is the
whole promise — see [ADR-0006](../.adr/0006-the-app-server-holds-no-accounts.md).

## Sync is identity, beside the photo path and never inside it

openplate-sync exists to move a diary between devices, which is the one thing that needs an
account. It is a separate deployable with its own image, database and secret, and the browser
talks to it directly. The app server proxies nothing on its behalf and serves no sync route.

**It cannot read your entries.** The client serializes the local store, gzips it, encrypts it
with AES-256-GCM under a key derived from your passphrase, and uploads the result as one
opaque blob. The passphrase is stretched with Argon2id and split by HKDF into two independent
branches: one wraps the data key and stays on the device, the other is sent as the login
credential. They are siblings, not parent and child, so holding the credential reveals nothing
about the key. The server stores bytes it has no key for.

What it *does* see is stated plainly in
[PROTOCOL.md §9](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md):
an email address, blob size, write frequency and timing, version numbers, and KDF parameters.
Not what you ate.

The cost is equally plain: forget the passphrase and lose the recovery code, and the data is
gone — to you and to us. An email reset restores the *login*, never the *data*.

## Inference is compute, and the photo goes to it directly

A plate photo is read in the browser and posted straight to whichever OpenAI-compatible
endpoint you configured. **The openplate server is never in that request.** It is not
uploaded here, not written to disk, not logged. Only the resulting numbers are saved, into
the device's local store; the photo stays on the device that took it, excluded from JSON
exports and from sync payloads alike.

That endpoint is either a cloud provider you pay (the BYOK path) or your own
openplate-inference container. In the self-hosted case the model names the foods on the plate
and estimates grams — and then the **macros are looked up, not invented**: carbs, protein,
fat and kcal are resolved by name against a bundled extract of USDA FoodData Central (8,041
generic foods shipped inside the image, no network call, public domain). The language model
never authors a number.

Because the browser makes that call, the endpoint must be an address a **browser** can reach.
A compose hostname like `http://inference:8300/v1` will not work even though the two
containers can reach each other that way. Use the host's LAN address, a tailnet name, or a
hostname on your reverse proxy.

## The gateway is tenancy, and it sits in front of the compute

[openplate-gateway](https://github.com/LowCarbCheck/openplate-gateway) is optional and most
households never need it. It exists for one case: **one upstream AI key spent on behalf of
several people, with a cap per person.** It is an OpenAI-compatible proxy that holds the
payer's real provider key and hands each member an `opk_…` token with a hard daily request
quota, so a household — or a small hosted operator — shares a bill without sharing a
credential.

To the browser it is just another endpoint: a base URL and a key in **Settings → AI →
OpenAI-compatible**, so nothing changes on the client and no account returns to it. To the
thing behind it, it is a client: `UPSTREAM_BASE_URL` points at either a cloud provider or
your own openplate-inference container. **Inference is the compute layer, the gateway is the
tenancy layer, and they compose** — the gateway carries no model and answers no scan itself.

It is on the photo path, which is the honest cost of it, and the mitigation is a property of
the code rather than a setting: the logger's field type admits primitives only, so a body
cannot reach a log line, upstream error strings are scrubbed of data URIs before they are
logged or returned, and a test drives a real image through a real error to prove both. It has
no sync route and never sees a diary. Members of a household share spend, not data.

Its quota counts requests, not currency, so a spend cap on the upstream key at the provider
is still required. See its
[ADR-0001](https://github.com/LowCarbCheck/openplate-gateway/blob/main/docs/adr/0001-a-separate-gateway-service.md)
for why it is a separate service rather than a mode of the other two.

## BYOK is the zero-server path

With no inference container at all, the browser calls a cloud provider directly with a key
you entered on that device. The key is stored in the device's local store, excluded from the
JSON export, and never sent to the openplate server — there is no server-side copy, encrypted
or otherwise, and no server-side proxy of the call.

The production Content-Security-Policy is part of that promise rather than decoration: the
`connect-src` allowlist is derived from the provider registry, and it is what stops an
injected script exfiltrating a key that lives in the page. See
[configuration.md](configuration.md#the-content-security-policy).

## Who holds what

| Component | What it stores | What it sees in transit |
| --- | --- | --- |
| **Your browser** | The whole diary, in the clear, in IndexedDB. Your AI key. Cached plate photos. | Everything. It is your device. |
| **openplate app server** | Nothing. No database, no secrets, no state. | HTML and JS requests. Never a photo, never a key, never a diary entry, never a sync blob. |
| **openplate-sync** (optional) | An email address, an authentication verifier, KDF parameters, and ciphertext it holds no key for. | Blob size, write timing, session metadata. Not the contents. |
| **openplate-inference** (optional) | Nothing per user — no accounts, no sessions, no cookies. Model weights and a food dataset. | The photo you sent it, for as long as the request takes. It makes no outbound call except the one-time weight download. |
| **openplate-gateway** (optional) | No accounts and no database. One upstream provider key, a members JSON file of token digests, and a quota counter file. | The photo, for as long as it takes to forward it, and which member sent it. Never a body in a log. |
| **Cloud AI provider** (BYOK path) | Whatever their policy says. | The photo, and your key. Their terms apply, not ours. |
