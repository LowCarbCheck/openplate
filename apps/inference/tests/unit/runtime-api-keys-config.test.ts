/**
 * Config parsing for the two BYO-runtime bearer variables.
 *
 * The blank cases are the point. `compactEnv` exists so a `FOO=` line in a
 * `.env` file means "unset" rather than "the empty string" — and an empty-string
 * key would be worse here than elsewhere, because it would make the client send
 * `Authorization: Bearer ` on every call: a header that is present, wrong, and
 * rejected by exactly the authed runtimes these variables exist to reach.
 */
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';

const BASE = { MODEL_RUNTIME_URL: 'http://127.0.0.1:8080' };

describe('MODEL_RUNTIME_API_KEY / EMBEDDING_RUNTIME_API_KEY', () => {
  it('is null when the variable is absent', () => {
    const config = parseConfig({ ...BASE });

    expect(config.modelRuntimeApiKey).toBeNull();
    expect(config.embeddingRuntimeApiKey).toBeNull();
  });

  it('carries the key through when set', () => {
    const config = parseConfig({
      ...BASE,
      MODEL_RUNTIME_API_KEY: 'sk_model',
      EMBEDDING_RUNTIME_URL: 'http://127.0.0.1:8081',
      EMBEDDING_RUNTIME_API_KEY: 'sk_embed',
    });

    expect(config.modelRuntimeApiKey).toBe('sk_model');
    expect(config.embeddingRuntimeApiKey).toBe('sk_embed');
  });

  it('treats a blank value as unset, not as the empty string', () => {
    const config = parseConfig({
      ...BASE,
      MODEL_RUNTIME_API_KEY: '',
      EMBEDDING_RUNTIME_API_KEY: '   ',
    });

    expect(config.modelRuntimeApiKey).toBeNull();
    expect(config.embeddingRuntimeApiKey).toBeNull();
  });

  it('trims surrounding whitespace rather than signing requests with it', () => {
    const config = parseConfig({ ...BASE, MODEL_RUNTIME_API_KEY: '  sk_model  ' });

    expect(config.modelRuntimeApiKey).toBe('sk_model');
  });
});
