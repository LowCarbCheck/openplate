# Sharing one AI bill across a household

openplate is bring-your-own-key: each person points the app at an AI provider and pays for
their own plate scans. In one household that is silly. Nobody wants four provider accounts,
and one shared key is worse — you cannot tell who spent what, and revoking one person
revokes everybody.

**You do not need a server for this.** The fix lives at the provider: one account, one key
per person, one spend limit per key. Read that section first; the two server-shaped answers
further down are for the cases it does not cover.

**Nothing here shares a diary.** Each person's food log stays in their own browser's storage
on their own device. What crosses the wire is a photo going out and an estimate coming back.
The person paying the bill can see how many requests each person made and what it cost. They
cannot see what anyone ate.

## The short version, with OpenRouter

OpenRouter can mint any number of API keys under one account, each with its own credit limit
and its own usage line. That is precisely the feature a household needs.

1. **One person creates the account** at [openrouter.ai](https://openrouter.ai) and adds
   credit. Only that person ever signs in; nobody else needs an account.
2. **Open the [Keys page](https://openrouter.ai/settings/keys)** and create one key per
   person. Name each key after the person — that name is what you will see in the usage
   breakdown later, so "Sam" beats "key 3".
3. **Set a credit limit on each key as you create it.** This is the cap. A key with no limit
   can spend the account's whole balance, so treat "unlimited" as the thing you are here to
   avoid.
4. **Send each person their own key.** Send it the way you would send a password, not in a
   group chat that lives forever.
5. **Each person pastes it in.** In openplate: **Settings → AI**, choose **OpenRouter**, and
   use the "paste an API key manually" panel. The key is stored in that browser only. It is
   excluded from the JSON export, and it never reaches the openplate server.

That is the whole setup. Five minutes, no container, no maintenance.

## Running it

- **Who spent what:** the OpenRouter dashboard breaks usage down per key. Because each key is
  named after a person, that is your per-person bill.
- **Revoke one person:** delete their key. Nobody else is affected, nobody else changes a
  setting, and the revoked person has no fallback — that key was their only credential.
  Their diary is untouched; it was never on the key.
- **Give someone more:** raise that key's limit. Takes effect immediately, no restart
  anywhere.
- **Someone's key stops working:** they hit their limit, or you deleted it. openplate will
  surface the provider's error; the fix is at the Keys page, not in the app.

**Cap the account too, not just the keys.** Per-key limits bound each person, but the account
balance is what actually gets drained. Keep the balance at a size you would not mind losing,
and top it up deliberately.

**Automating it.** OpenRouter also exposes an API for creating and managing keys
programmatically, which is worth knowing about if you are provisioning for more than a
handful of people. For a family, the dashboard is faster than writing the script.

## The other alternative: run openplate-gateway

If your provider will not issue capped sub-keys — Mistral, most direct provider APIs — the
sub-key recipe above has nothing to work with. That is what
[openplate-gateway](https://github.com/LowCarbCheck/openplate-gateway) is for: a small
OpenAI-compatible proxy that holds your one upstream key and issues each member their own
`opk_…` token with a hard daily request quota.

**Pick it over provider sub-keys when:**

- Your provider has no per-key spend limit, so the cap has to live somewhere you control.
- You want a **daily request** cap per person rather than a credit balance per person.
- You are putting the household in front of your own
  [openplate-inference](https://github.com/LowCarbCheck/openplate-inference) box, where there
  is no provider dashboard at all — the gateway adds the per-person quotas and usage the
  `API_KEYS` allowlist below does not have.
- You want revocation to be one line in a file rather than a shared key everyone re-pastes.

**Stay with provider sub-keys when you can.** If you are on OpenRouter, you are already done
five minutes ago and there is no container to keep alive. The gateway's own README opens by
talking you out of running it, and it is right to.

Setup is in the [gateway README quickstart](https://github.com/LowCarbCheck/openplate-gateway#quickstart):
set `UPSTREAM_BASE_URL`, `UPSTREAM_API_KEY` and `GATEWAY_ADMIN_TOKEN`, and bring up the
compose file. From there it's all in the browser at `/admin/ui`: sign in with the admin
token, create an invite (with its daily quota), and send the member the link it gives you.
The member opens it, taps to join, and openplate configures itself — no fields to type, no
file to paste into. Revocation is one click in `/admin/ui` (or a `DELETE
/admin/members/:id`), takes effect immediately, and needs no restart. See the gateway repo's
own [docs/family-setup.md](https://github.com/LowCarbCheck/openplate-gateway/blob/main/docs/family-setup.md)
for the full walkthrough, including what the invite link and the join screen actually show.

Two things worth knowing before you rely on it. The quota counts **requests, not currency**,
so keep a hard spend cap on the upstream key at the provider as well — only the provider can
stop the money. And a member with no `dailyLimit` gets zero rather than unlimited, which is
the failure mode you want.

Nothing about this shares a diary either. The gateway carries AI requests only; it has no
sync route and no access to anyone's food log.

A member who joins by invite gets a settings row marked `connectedVia: 'invite'` — the same
"someone else configured this for me" shape as an instance preset (`connectedVia: 'preset'`),
just scoped per-member instead of instance-wide. See
[configuration.md#instance-provided-ai](configuration.md#instance-provided-ai) for that
comparison.

## The alternative: a shared inference box

If you own the hardware, the other way to share one bill is to have no bill. Run
[openplate-inference](https://github.com/LowCarbCheck/openplate-inference) on a machine at
home, and every scan in the house is computed locally with no cloud provider involved. See
[topologies.md](topologies.md#rung-3--add-self-hosted-inference) for what that costs you in
hardware and operational work — it is a real step up from pasting five keys into a dashboard.

It has per-person keys too, though they are coarser. `API_KEYS` on the inference container is
a **comma-separated list** of accepted bearer keys:

```bash
-e API_KEYS="opk_alex_...,opk_sam_...,opk_robin_..."
```

Give each person one entry from that list, and each pastes theirs into openplate under
**Settings → AI → OpenAI-compatible** with the instance's base URL (for example
`http://openplate.example.lan:8300/v1`) and the model `openplate-plate-1`. Removing a key
from the list and restarting revokes exactly that person.

Two honest limits compared to provider sub-keys:

- **There is no per-key spend or rate limit.** The list is an allowlist, nothing more. That is
  fine when the resource is your own idle GPU and there is no money attached to a request.
- **The keys are yours to generate and distribute.** Any random string works
  (`openssl rand -base64 24`); there is no dashboard, and no per-person usage report — you get
  the container's logs.

Full variable list:
[openplate-inference docs/configuration.md](https://github.com/LowCarbCheck/openplate-inference/blob/main/docs/configuration.md).

**Do not use the instance-provided-AI shortcut for this.** Setting
`DEFAULT_INFERENCE_API_KEY` on openplate gives everyone one tap and no key to paste, but that
key is embedded in the page HTML and readable with view-source by anyone who can open the
app — so it is one shared credential again, with the same problem you started with. It is
fine for a LAN or tailnet where you trust everyone who can reach it, and wrong anywhere else.
See [configuration.md](configuration.md#instance-provided-ai).
