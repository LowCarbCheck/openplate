# Privacy

**Your photos are processed in memory and never persisted.** Concretely:

- **Never written to disk.** There is no upload directory, no temp file, no
  cache. The image is decoded, downscaled in memory, sent to the model runtime on
  the container's loopback interface, and dropped when the request ends.
- **Never logged.** Not the image, not the base64, not a hash of it. The logs carry request metadata (status, timing, a key *fingerprint*, never a key), and the log formatter scrubs values that could carry payload or credentials. This
  includes the error paths: error responses and error logs are scrubbed, and that
  behaviour is covered by the unit test suite.
- **Never sent anywhere.** The service makes exactly three kinds of outbound
  request: one-time weight downloads at first boot, (only if you enable a
  networked `FOOD_SOURCE`) a *text* food-name lookup, and (only if you set
  `EMBEDDING_RUNTIME_URL`) a *text* embedding call. No image ever leaves the
  container, under any configuration.
- **Names for translation stay with the model runtime.** The translation call sends food names as text to the model runtime. In the bundled container, the runtime uses the loopback interface, so traffic stays local. With `MODEL_PROFILE=external`, names go to your configured runtime URL. That call never includes photos. The service reads `Accept-Language` to select the target language. It does not store or log the header.
- **No accounts, no cookies, no history.** The service stores nothing between
  requests. There is nothing to export, breach, or subpoena.
- **In openplate's flow, the photo goes device → your endpoint directly.** It
  does not pass through openplate's server. You control every hop.

The code is here, it is small, and the network surface is one port.

These statements describe the self-hosted service in this repository. For
vulnerability reporting, see [SECURITY.md](../SECURITY.md).
