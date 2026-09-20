# Sync across devices (optional)

openplate is a local app by default: your diary lives in the browser's IndexedDB on the
device you use, and nothing leaves it. Moving that diary between devices is the one thing
that needs an account, so it lives in a separate service,
[openplate-core](https://github.com/LowCarbCheck/openplate-core), with its own image,
database and secrets.

Sync is entirely optional. Unset, openplate loses no feature.

## What travels between your devices

Everything the sync engine calls an entity is merged per row, so a change made on one
device reaches the others and a deletion made on one device removes the row on the
others. As of this version that is your personal foods, your food log, your weight
entries, your profile and goals, your fasts, your pantry, your fasting routine, and the
activity marks and awards behind the streak. Your saved meals travel too, as a whole
list rather than row by row, which is the last part of the diary still waiting for a
per-row merge.

Your sharing and research keys travel as well, in a sealed part of the blob that only
your own devices can open. A clinician you grant a diary to cannot read it.

Three things never travel, whatever you switch on:

- **Plate photos.** They live in a separate database on the device that took them, they
  are excluded from the sync payload and from every backup file, and they clear
  themselves out on a schedule you set.
- **Your AI provider key.** It lives in its own database on the device you entered it
  on, and it goes to nobody but the provider you chose.
- **The record of what you deleted.** Your device writes down the removals it performed
  so it can prove they were deliberate, and that list stays on the device. The removals
  themselves travel; the list does not.

## What it needs

- A running **openplate-core** instance: either the hosted one, your own, or any third-party
  server implementing [the protocol](https://github.com/LowCarbCheck/openplate-core/blob/main/PROTOCOL.md).
  To run your own, use
  [`docker/topologies/compose.sync.yml`](../docker/topologies/compose.sync.yml): see
  [self-hosting.md](self-hosting.md) and [topologies.md](topologies.md).
- `SYNC_SERVER_URL` set on the app, pointing at that service.

## Turning it on

`SYNC_SERVER_URL` is the entire switch.

- **Unset** (the default): no sync interface renders anywhere, and no sync request ever
  leaves the app.
- **Set**: the sync screens appear and talk to that URL. Its origin is added to the
  production CSP's `connect-src` automatically: you do not need `CSP_CONNECT_EXTRA` for it.

Restart the app after changing it. Unset it again and the sync screens disappear and the app
stops reaching out. Your local diary is untouched either way.

**Adding a second device:** point it at the same `SYNC_SERVER_URL` and sign in with the same
email address and password you used on the first one. That is the whole procedure, and nothing
has to be copied off the first device.

It must be an address a **browser** can reach. The sync client runs in the page, so a compose
hostname like `http://sync:3000` does not work: use the public URL your users' devices
resolve. A malformed value stops the boot on purpose, so a typo cannot look like "sync is
quietly off".

## The research console (`/study`)

The app always carries a `/study` route, and it is inert on an ordinary instance. It comes to
life only when the sync service it talks to has `SYNC_RESEARCH=true`, which is **off by
default**: an instance you stand up without touching that flag runs no study, holds no study
graph, and offers nothing to enrol in. Read `openplate-core`'s `.env.example` before turning it
on: it makes the server hold health-adjacent personal data, which is a different undertaking
from holding an encrypted diary.

## Encryption, and what the operator holds

Your password never leaves your browser. It is stretched with Argon2id and split by HKDF into
independent branches. Two branches stay on the device to unwrap the data key and your
private settings. A third branch goes to the service as the login credential. They are
cryptographic siblings, not parent and child, so holding one reveals nothing about the others. Your diary is encrypted on the device before
it is uploaded and stays encrypted in transit; the service stores opaque ciphertext, and what
it sees beside that is an email address plus the size and timing of your uploads.

**The operator holds a recovery key.** At signup the app generates a recovery code, wraps your
data key under it, and sends the code to the server, which keeps it sealed under a secret of
its own. That is what makes "forgot my password" return your diary rather than an empty
account: the mailed link hands the code back to your browser, which uses it to unwrap the data
key and re-wrap it under the new password.

Stated plainly, because it is the trade this design makes: the operator of an instance can
restore, and therefore in principle read, a diary on it. On an instance you host yourself, you
are that operator. On an instance an organization runs for you, they already see every plate
photo that passes through their AI proxy, so this changes the promise less than it looks, and
it is what buys a password reset that does not lose your data.

Before M192 there was no escrow, and the cost was the other way round: a forgotten password
plus a lost recovery code meant the data was gone, to us and to you, and the app had to show
the code once and ask a person to keep it forever. Nobody does.

Plate photos are never part of a sync payload. They stay on the device that took them, they
are excluded from JSON exports, and on a managed instance the copy that reaches the AI proxy
is read once and not stored.

## Sharing a diary with a clinician

On an instance whose sync service sets `SYNC_SHARING=true`, a person can let a clinician, such
as a dietitian, read their diary. The clinician sends the person a connect link. The person opens
it and types the twelve characters the clinician reads aloud, so a wrong key is caught before
anything is shared. The person then grants the share under **Settings → Sharing**: the app wraps the data key once more,
under the clinician's public key, and uploads that wrapped copy. The clinician's browser
unwraps it and shows the diary at `/shared`. The server stores the wrapped copy and never the
key to it. A share can be revoked at any time. A private compartment of the diary holds the
person's own sharing and research keys, and a clinician can never open it. Those keys are in
the JSON export too, unencrypted, so that a restored device can still open what was shared with
it; [self-hosting.md](self-hosting.md#backups) says what that means for the file.

The same screen holds the switch for the pulse, an optional instance-wide count of meals and
scans; [architecture.md](architecture.md#what-else-openplate-core-can-carry) says what it
sends.

## What used to be here: the gateway

Until M192 a person could join a separate AI gateway from the same invite link, and that
connection travelled with the account inside the sealed compartment. There is no gateway any
more: the sync service took over the AI proxy, so on an instance an organization runs, a
signed-in account with an allowance scans through the one server it already talks to, and no
connection step exists to carry anywhere. An instance you host yourself is unchanged: a key
you set up stays on the device you set it up on.
