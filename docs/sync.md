# Sync across devices (optional)

openplate is a local app by default: your diary lives in the browser's IndexedDB on the
device you use, and nothing leaves it. Moving that diary between devices is the one thing
that needs an account, so it lives in a separate service —
[openplate-sync](https://github.com/LowCarbCheck/openplate-sync) — with its own image,
database and secrets.

Sync is entirely optional. Unset, openplate loses no feature.

## What it needs

- A running **openplate-sync** instance: either the hosted one, your own, or any third-party
  server implementing [the protocol](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md).
  To run your own, use
  [`docker/topologies/compose.sync.yml`](../docker/topologies/compose.sync.yml) — see
  [self-hosting.md](self-hosting.md) and [topologies.md](topologies.md).
- `SYNC_SERVER_URL` set on the app, pointing at that service.

## Turning it on

`SYNC_SERVER_URL` is the entire switch.

- **Unset** (the default): no sync interface renders anywhere, and no sync request ever
  leaves the app.
- **Set**: the sync screens appear and talk to that URL. Its origin is added to the
  production CSP's `connect-src` automatically — you do not need `CSP_CONNECT_EXTRA` for it.

Restart the app after changing it. Unset it again and the sync screens disappear and the app
stops reaching out. Your local diary is untouched either way.

It must be an address a **browser** can reach. The sync client runs in the page, so a compose
hostname like `http://sync:3000` does not work — use the public URL your users' devices
resolve. A malformed value stops the boot on purpose, so a typo cannot look like "sync is
quietly off".

## End-to-end encryption, in one paragraph

Your passphrase never leaves your browser. It is stretched with Argon2id and split by HKDF
into two independent branches: one wraps the data key and stays on the device, the other is
sent to the service as the login credential. The two are cryptographic siblings, not parent
and child — holding one reveals nothing about the other, so the server cannot decrypt a blob
by construction rather than by policy. What the service **can** see is an email address, and
the size and timing of your uploads. What it cannot see is anything you ate.
[PROTOCOL.md](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md) states
this in full, including an honest list of the metadata the server does learn.

**The cost of that design, stated up front:** if you forget your passphrase and lose your
recovery code, your synced data is gone — to us and to you. An email reset restores your
_login_, never your _data_. The app says exactly this before you finish setting sync up, and
shows the recovery code once, behind an explicit acknowledgment.

Plate photos are never part of a sync payload. They stay on the device that took them, and
they are excluded from JSON exports too.
