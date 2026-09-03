/**
 * The production Content-Security-Policy.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The CSP is applied in production only, so `pnpm dev` sends no policy at all
 * and `node:test` has no CSP engine — meaning a wrong directive is invisible
 * to every gate this repo has. That is not a hypothetical: shipping
 * `script-src 'self' 'unsafe-inline'` without `'wasm-unsafe-eval'` made Chrome
 * refuse ALL WebAssembly compilation, which killed `hash-wasm`'s Argon2id and
 * therefore killed sync account creation in production — while typecheck,
 * lint, 1453 unit tests, 7 integration tests and the production build were all
 * green. Only a real browser against `pnpm start` found it.
 *
 * So the assertions below are deliberately blunt regression guards rather than
 * a restatement of the implementation. Each one names the feature that dies if
 * the directive is removed, because the failure mode for every one of them is
 * "a whole feature silently stops working in production only".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSecurityPolicy } from '../../app/config/content-security-policy';
import { PROVIDER_REGISTRY } from '../../app/services/vision/registry';

/** Pulls one directive out of the header for assertions that care about scope. */
function directive(policy: string, name: string): string {
  const found = policy.split('; ').find((entry) => entry.startsWith(`${name} `) || entry === name);
  assert.ok(found !== undefined, `expected a ${name} directive in: ${policy}`);
  return found;
}

/**
 * The same registry → origin derivation `server.ts` does (M130/03), so tests
 * exercise the real fixed-base-URL providers rather than a hand-maintained
 * literal list that could silently drift from the registry.
 */
const REGISTRY_PROVIDER_ORIGINS = Object.values(PROVIDER_REGISTRY)
  .map((definition) => (definition.baseUrl === null ? null : new URL(definition.baseUrl).origin))
  .filter((origin): origin is string => origin !== null);

const DEFAULT_POLICY = buildContentSecurityPolicy({
  syncOrigin: null,
  connectExtra: [],
  providerOrigins: REGISTRY_PROVIDER_ORIGINS,
  presetOrigin: null,
  gatewayOrigin: null,
  // M146 spec 02: the newsletter is off on every instance that did not
  // configure one, and this header must be identical to what it was
  // before that feature existed.
  newsletterEnabled: false, analyticsOrigin: null,
});

test("script-src carries 'wasm-unsafe-eval' — without it, sync passphrase derivation is dead in production", () => {
  // hash-wasm compiles Argon2id from WASM bytes inlined in its own bundle.
  // Chrome refuses all WebAssembly compilation under a script-src that lacks
  // this, so account creation dies right after the passphrase step and no
  // request ever reaches the sync service. Do not "tighten" this away.
  assert.match(directive(DEFAULT_POLICY, 'script-src'), /'wasm-unsafe-eval'/);
});

test("script-src does NOT carry full 'unsafe-eval'", () => {
  // The WASM-scoped source is the whole point: it permits WebAssembly
  // compilation and nothing else. Full 'unsafe-eval' would additionally
  // unblock eval(), new Function() and string setTimeout — the parts an
  // injected script actually wants, and the reason this policy exists at all.
  const scriptSrc = directive(DEFAULT_POLICY, 'script-src');
  assert.equal(
    /(^|[\s])'unsafe-eval'/.test(scriptSrc),
    false,
    `script-src must not grant full 'unsafe-eval': ${scriptSrc}`,
  );
});

test('the sync origin is appended to connect-src only when sync is configured', () => {
  assert.equal(
    directive(DEFAULT_POLICY, 'connect-src').includes('sync.example.com'),
    false,
    'an unconfigured instance must keep the default policy exactly as strict',
  );

  const configured = buildContentSecurityPolicy({
    syncOrigin: 'https://sync.example.com',
    connectExtra: [],
    providerOrigins: [],
    presetOrigin: null,
    gatewayOrigin: null,
    // M146 spec 02: the newsletter is off on every instance that did not
    // configure one, and this header must be identical to what it was
    // before that feature existed.
    newsletterEnabled: false, analyticsOrigin: null,
  });
  assert.match(directive(configured, 'connect-src'), /https:\/\/sync\.example\.com/);
});

test('operator-supplied connect-src origins survive alongside the sync origin', () => {
  const policy = buildContentSecurityPolicy({
    syncOrigin: 'https://sync.example.com',
    connectExtra: ['https://ai.example.com'],
    providerOrigins: [],
    presetOrigin: null,
    gatewayOrigin: null,
    // M146 spec 02: the newsletter is off on every instance that did not
    // configure one, and this header must be identical to what it was
    // before that feature existed.
    newsletterEnabled: false, analyticsOrigin: null,
  });
  const connectSrc = directive(policy, 'connect-src');

  assert.match(connectSrc, /https:\/\/sync\.example\.com/);
  assert.match(connectSrc, /https:\/\/ai\.example\.com/);
});

test('connect-src still allowlists the BYOK provider hosts and loopback', () => {
  // Widening this list needs the same scrutiny as touching the key path
  // itself (AGENTS.md); NARROWING it silently breaks plate scanning for
  // everyone, which is what this assertion is here to catch.
  const connectSrc = directive(DEFAULT_POLICY, 'connect-src');
  for (const origin of ["'self'", 'https://openrouter.ai', 'https://api.anthropic.com', 'http://localhost:*']) {
    assert.ok(connectSrc.includes(origin), `connect-src lost ${origin}: ${connectSrc}`);
  }
});

test('the Argon2id worker can still be loaded', () => {
  // Loading the worker is governed by worker-src; what it may then DO (compile
  // WASM) is governed by script-src, which the worker inherits from this
  // document. Both halves have to hold or sync setup fails.
  assert.equal(directive(DEFAULT_POLICY, 'worker-src'), "worker-src 'self'");
});

test('the policy keeps its non-negotiable hardening directives', () => {
  assert.equal(directive(DEFAULT_POLICY, 'object-src'), "object-src 'none'");
  assert.equal(directive(DEFAULT_POLICY, 'base-uri'), "base-uri 'self'");
  assert.equal(directive(DEFAULT_POLICY, 'frame-ancestors'), "frame-ancestors 'self'");
  assert.equal(directive(DEFAULT_POLICY, 'default-src'), "default-src 'self'");
});

test('the builder is pure — same inputs, identical header', () => {
  const input = {
    syncOrigin: 'https://sync.example.com',
    connectExtra: ['https://ai.example.com'],
    providerOrigins: REGISTRY_PROVIDER_ORIGINS,
    presetOrigin: null,
    gatewayOrigin: null,
    // M146 spec 02: the newsletter is off on every instance that did not
    // configure one, and this header must be identical to what it was
    // before that feature existed.
    newsletterEnabled: false, analyticsOrigin: null,
  };
  assert.equal(buildContentSecurityPolicy(input), buildContentSecurityPolicy(input));
});

test('connect-src carries every provider origin derived from PROVIDER_REGISTRY', () => {
  // Registry-driven on purpose (M130/03): this must fail the moment a new
  // provider lands with a missing or malformed base URL, at `pnpm test:unit`,
  // not silently in a production browser months later.
  const connectSrc = directive(DEFAULT_POLICY, 'connect-src');
  for (const definition of Object.values(PROVIDER_REGISTRY)) {
    if (definition.baseUrl === null) continue;
    const expectedOrigin = new URL(definition.baseUrl).origin;
    assert.ok(
      connectSrc.includes(expectedOrigin),
      `connect-src is missing ${definition.id}'s origin (${expectedOrigin}): ${connectSrc}`,
    );
  }
});

test("connect-src carries the instance preset's origin when one is configured", () => {
  // The trap this guards (M138 spec 06): `providerOrigins` above is derived
  // from the registry's FIXED base URLs, and `openai-compatible` — the entry a
  // preset drives — deliberately has none, so it contributes nothing there. A
  // preset base URL IS known at boot, and if its origin doesn't land here the
  // one-click connect saves fine (a local-store write, no network) and then
  // every scan dies on a CSP violation, in production only, with no
  // server-side symptom. Same failure mode as a missing sync origin.
  const configured = buildContentSecurityPolicy({
    syncOrigin: null,
    connectExtra: [],
    providerOrigins: REGISTRY_PROVIDER_ORIGINS,
    presetOrigin: 'https://ai.house.example:8443',
    gatewayOrigin: null,
    // M146 spec 02: the newsletter is off on every instance that did not
    // configure one, and this header must be identical to what it was
    // before that feature existed.
    newsletterEnabled: false, analyticsOrigin: null,
  });

  assert.match(directive(configured, 'connect-src'), /https:\/\/ai\.house\.example:8443/);
});

test("connect-src carries the gateway's origin when GATEWAY_URL is configured", () => {
  // The trap this guards (M187 spec 03): the operator sets one variable and
  // expects the app to work. If the origin does not land here, the very first
  // join on a managed instance dies inside the browser — `fetch` throws a bare
  // TypeError with no response — and the server logs nothing at all. An
  // operator must not have to repeat the same origin in CSP_CONNECT_EXTRA to
  // make their own instance work.
  const configured = buildContentSecurityPolicy({
    syncOrigin: 'https://sync.example.com',
    connectExtra: [],
    providerOrigins: REGISTRY_PROVIDER_ORIGINS,
    presetOrigin: null,
    gatewayOrigin: 'https://gateway.example.com',
    newsletterEnabled: false,
    analyticsOrigin: null,
  });

  assert.match(directive(configured, 'connect-src'), /https:\/\/gateway\.example\.com/);
});

test('connect-src gains nothing when no gateway is configured', () => {
  // The self-host default must be byte-identical to its pre-spec-03 self.
  assert.doesNotMatch(directive(DEFAULT_POLICY, 'connect-src'), /gateway/);
});

test('connect-src gains nothing when no instance preset is configured', () => {
  // The default deployment must be byte-identical to its pre-spec-06 self.
  const connectSrc = directive(DEFAULT_POLICY, 'connect-src');

  assert.ok(!connectSrc.includes('undefined'), `connect-src: ${connectSrc}`);
  assert.ok(!connectSrc.includes('null'), `connect-src: ${connectSrc}`);
});
