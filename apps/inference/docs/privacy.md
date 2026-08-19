# Privacy

**Your photos are processed in memory and never persisted.** Concretely:

- **Never written to disk.** There is no upload directory, no temp file, no
  cache. The image is decoded, downscaled in memory, sent to the model runtime on
  the container's loopback interface, and dropped when the request ends.
- **Never logged.** Not the image, not the base64, not a hash of it. The logs
  carry request metadata — status, timing, a key *fingerprint*, never a key — and
  the log formatter scrubs values that could carry payload or credentials. This
  includes the error paths: error responses and error logs are scrubbed, and that
  behaviour is covered by the unit test suite.
- **Never sent anywhere.** The service makes exactly two kinds of outbound
  request: one-time weight downloads at first boot, and — only if you enable a
  networked `FOOD_SOURCE` — a *text* food-name lookup. No image ever leaves the
  container, under any configuration.
- **No accounts, no cookies, no history.** The service stores nothing between
  requests. There is nothing to export, breach, or subpoena.
- **In openplate's flow, the photo goes device → your endpoint directly.** It
  does not pass through openplate's server. You control every hop.

The code is here, it is small, and the network surface is one port.

These statements describe the self-hosted service in this repository. For
vulnerability reporting, see [SECURITY.md](../SECURITY.md).
