/**
 * Where the HTTP server binds, and what the startup line may honestly claim.
 *
 * This lives here, not in `server.ts`, because importing `server.ts` starts a
 * listener, so nothing declared there can be reached by a test. A bind rule
 * that is subtly wrong is expensive in both directions: too wide and a dev
 * instance with seeded data is reachable from the whole LAN, too narrow and
 * production stops answering. `tests/unit/server-bind.test.ts` pins both ends.
 *
 * THE DEFAULT IS EVERY INTERFACE, AND IT MUST STAY THAT WAY. In production the
 * process runs inside a container behind Traefik, which reaches it over the
 * container network, never over loopback. Binding loopback there, or defaulting
 * `HOST` to `0.0.0.0` (which would also drop IPv6, unlike Node's own no-host
 * behaviour), takes the site down. `HOST` is therefore opt-in: an operator or a
 * developer names an address, and only then is the bind narrowed.
 *
 * THE LOGGED URL IS THE BIND, with one exception. An unset `HOST` prints
 * `localhost`, which is honest because every interface includes loopback.
 * A set `HOST` prints that exact value, with no name substituted for it, so
 * the url is reachable by construction. There is deliberately no "loopback
 * prints localhost" rule: `HOST=::1` binds `::1` alone, and on a machine where
 * `localhost` resolves to `127.0.0.1` first, a printed `http://localhost:3000`
 * would be refused while the server was running perfectly.
 */

/** The slice of `process.env` this module reads. */
export type ServerBindEnv = { HOST?: string | undefined };

export type ServerBind = {
  /**
   * Passed straight to `server.listen({ port, host })`. `undefined` means the
   * key is absent, which is how Node expresses "every interface"; there is no
   * address string that means the same thing across both IP families.
   */
  host: string | undefined;
  /** The address the startup log prints, true for whatever `host` was chosen. */
  url: string;
};

/**
 * An IPv6 literal must be bracketed inside a URL, so `::1` becomes
 * `http://[::1]:3000`. A hostname never contains a colon, which makes the
 * colon the whole test.
 */
function toUrlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/**
 * Resolves the listen host and the startup url from the environment.
 *
 * An empty or whitespace-only `HOST` is treated as unset rather than as a bind
 * to the empty string, because a blank value in a `.env` file means the
 * operator left it alone, not that they asked for something exotic.
 */
export function resolveServerBind({ env, port }: { env: ServerBindEnv; port: number }): ServerBind {
  const configured = (env.HOST ?? '').trim();

  if (configured === '') {
    return { host: undefined, url: `http://localhost:${port}` };
  }

  return { host: configured, url: `http://${toUrlHost(configured)}:${port}` };
}
