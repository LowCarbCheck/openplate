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

openplate-sync exists to move a diary between devices, and to hold the separate accounts the
optional study console uses (ADR-0008). Those are the only things that need an account. It is a separate deployable with its own image, database and secret, and the browser
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

## The sync server is tenancy, and it sits in front of the compute on a managed instance

An instance can set `INSTANCE_MODE=managed` (see
[configuration.md](configuration.md#managed-instances)). That declares one thing: **an
organization runs this instance, invites its people by email, and gives each one a daily AI
allowance.** openplate-sync is what carries that, the account it already holds for sync also
holds the allowance, so there is no second connection step and no second credential.

To the browser it is unchanged: a signed-in account with an allowance scans through the AI
proxy openplate-sync exposes, the same service the client already talks to for sync. To the
thing behind it, openplate-sync is a client: it points at either a cloud provider or your own
openplate-inference container. **Inference is the compute layer, openplate-sync is the
tenancy layer on a managed instance, and they compose**: the sync server carries no model and
answers no scan itself.

It is on the photo path, which is the honest cost of it, and the mitigation is a property of
the code rather than a setting: the logger's field type admits primitives only, so a body
cannot reach a log line, and upstream error strings are scrubbed before they are logged or
returned. Members of an organization share spend, not data; a plate photo that reaches the
proxy is read once and not stored.

The allowance counts requests, not currency, so a spend cap on the upstream key at the
provider is still required.

### History

From August to September 2026, this was a separate service, openplate-gateway: a small
OpenAI-compatible proxy holding one upstream key and issuing each member an `opk_…` token
with its own daily quota. M192 (September 2026) merged it into openplate-sync: one account
now carries both the diary and the allowance, so there is no second service, no second
invite link, and no second credential to hand out.

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
| **openplate-sync** (optional) | An email address, an authentication verifier, KDF parameters, and ciphertext it holds no key for. On a managed instance (`INSTANCE_MODE=managed`), also each account's daily allowance and usage count. | Blob size, write timing, session metadata. On a managed instance, also the photo forwarded to the AI proxy, for as long as it takes to forward it, read once, not stored. Not the diary contents. |
| **openplate-inference** (optional) | Nothing per user — no accounts, no sessions, no cookies. Model weights and a food dataset. | The photo you sent it, for as long as the request takes. It makes no outbound call except the one-time weight download. |
| **Cloud AI provider** (BYOK path) | Whatever their policy says. | The photo, and your key. Their terms apply, not ours. |
