/**
 * The instance-provided AI preset (M138 spec 06) — the `DEFAULT_INFERENCE_*`
 * gate, and what a one-click connect actually writes to the device.
 *
 * The requirement these tests hold the line on is the same one `SYNC_SERVER_URL`
 * has: with no preset configured the app is byte-for-byte its old self — nothing
 * renders, nothing ships to the browser, nothing widens in the CSP. And with one
 * configured, the connect writes an ORDINARY `openai-compatible` BYOK row, so a
 * preset connection can be overwritten or disconnected by exactly the same code
 * paths as a hand-typed one. No parallel provider concept anywhere.
 *
 * (The CSP half lives in `content-security-policy.test.ts`, next to the rest of
 * the header assertions.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INSTANCE_INFERENCE_MODEL,
  getInstanceInferencePreset,
  inferenceConnectSrcOrigin,
  parseInstanceInferencePreset,
  type InstanceInferencePreset,
} from '../../app/config/public-config';
import { buildPresetAiSettings } from '../../app/lib/instance-preset';
import { createAiStore } from '../../app/lib/local-store/store';
import { deleteLocalAiSettings, getLocalAiSettings, putLocalAiSettings } from '../../app/lib/local-store/ai-settings';

const PRESET: InstanceInferencePreset = {
  baseUrl: 'https://ai.house.example/v1',
  apiKey: 'instance-key',
  model: 'openplate-plate-1',
};

describe('parseInstanceInferencePreset', () => {
  it('returns null when the preset is absent — the default self-host shape', () => {
    assert.equal(parseInstanceInferencePreset({ baseUrl: undefined, apiKey: undefined, model: undefined }), null);
    assert.equal(parseInstanceInferencePreset({ baseUrl: '', apiKey: undefined, model: undefined }), null);
    assert.equal(parseInstanceInferencePreset({ baseUrl: '   ', apiKey: undefined, model: undefined }), null);
  });

  it('ignores a stray key/model when no base URL is set, so no preset key can reach a browser', () => {
    // The key only ever travels as part of a populated preset. An operator who
    // pasted a key and then removed the URL must not ship the key anyway.
    assert.equal(
      parseInstanceInferencePreset({ baseUrl: undefined, apiKey: 'leaked-key', model: 'openplate-plate-1' }),
      null,
    );
  });

  it('keeps a valid URL, trimming whitespace and any trailing slash', () => {
    const preset = parseInstanceInferencePreset({
      baseUrl: '  https://ai.house.example/v1///  ',
      apiKey: undefined,
      model: undefined,
    });
    assert.equal(preset?.baseUrl, 'https://ai.house.example/v1');
  });

  it('THROWS on a malformed base URL rather than silently disabling the feature', () => {
    assert.throws(
      () => parseInstanceInferencePreset({ baseUrl: 'ai.house.example', apiKey: undefined, model: undefined }),
      /not a valid absolute URL/,
    );
    assert.throws(
      () => parseInstanceInferencePreset({ baseUrl: 'ftp://ai.house.example', apiKey: undefined, model: undefined }),
      /must be an http\(s\) URL/,
    );
  });

  it('treats a blank API key as "this endpoint needs none"', () => {
    const preset = parseInstanceInferencePreset({
      baseUrl: 'http://localhost:8080/v1',
      apiKey: '   ',
      model: undefined,
    });
    assert.equal(preset?.apiKey, null);
  });

  it('defaults the model to openplate-inference’s own served id', () => {
    const preset = parseInstanceInferencePreset({
      baseUrl: 'http://localhost:8080/v1',
      apiKey: undefined,
      model: undefined,
    });
    assert.equal(preset?.model, DEFAULT_INSTANCE_INFERENCE_MODEL);
    assert.equal(preset?.model, 'openplate-plate-1');
  });

  it('keeps an operator-chosen model verbatim', () => {
    const preset = parseInstanceInferencePreset({
      baseUrl: 'http://localhost:8080/v1',
      apiKey: undefined,
      model: ' qwen3-vl-8b ',
    });
    assert.equal(preset?.model, 'qwen3-vl-8b');
  });
});

describe('getInstanceInferencePreset', () => {
  it('is null for every shape of "no preset" — no UI may render on any of them', () => {
    assert.equal(getInstanceInferencePreset(undefined), null, 'error boundaries take this path');
    assert.equal(
      getInstanceInferencePreset({
        syncServerUrl: null,
        instancePreset: null,
        analytics: null,
        managed: false,
      }),
      null,
    );
  });

  it('hands the configured preset through untouched', () => {
    assert.deepEqual(
      getInstanceInferencePreset({
        syncServerUrl: null,
        instancePreset: PRESET,
        analytics: null,
        managed: false,
      }),
      PRESET,
    );
  });
});

describe('inferenceConnectSrcOrigin', () => {
  it('is the ORIGIN only — connect-src ignores paths', () => {
    assert.equal(inferenceConnectSrcOrigin(PRESET), 'https://ai.house.example');
  });

  it('keeps a non-default port, which connect-src matches on', () => {
    assert.equal(
      inferenceConnectSrcOrigin({ ...PRESET, baseUrl: 'http://192.168.1.10:8080/v1' }),
      'http://192.168.1.10:8080',
    );
  });

  it('appends nothing when no preset is configured', () => {
    assert.equal(inferenceConnectSrcOrigin(null), null);
  });
});

describe('preset connect', () => {
  it('writes an ordinary openai-compatible row carrying the preset values', () => {
    const settings = buildPresetAiSettings({ preset: PRESET, now: 1_700_000_000_000 });

    assert.deepEqual(settings, {
      provider: 'openai-compatible',
      model: 'openplate-plate-1',
      baseUrl: 'https://ai.house.example/v1',
      apiKey: 'instance-key',
      connectedVia: 'preset',
      updatedAt: 1_700_000_000_000,
    });
  });

  it('stores an empty key for a keyless endpoint rather than inventing a placeholder', () => {
    const settings = buildPresetAiSettings({ preset: { ...PRESET, apiKey: null }, now: 0 });
    assert.equal(settings.apiKey, '');
  });

  it('saves through the same local-store path a manual connect uses', async () => {
    const store = createAiStore();

    await putLocalAiSettings(buildPresetAiSettings({ preset: PRESET, now: 1 }), { store });

    const loaded = await getLocalAiSettings({ store });
    assert.equal(loaded?.provider, 'openai-compatible');
    assert.equal(loaded?.baseUrl, PRESET.baseUrl);
    assert.equal(loaded?.connectedVia, 'preset');
  });

  it('is overridden by a manual BYOK save, and disconnect clears it like any other row', async () => {
    const store = createAiStore();
    await putLocalAiSettings(buildPresetAiSettings({ preset: PRESET, now: 1 }), { store });

    // Exactly what the settings form writes — nothing about a preset connection
    // locks the page.
    await putLocalAiSettings(
      {
        provider: 'openrouter',
        model: 'google/gemini-3.5-flash-lite',
        baseUrl: null,
        apiKey: 'sk-or-v1-mine',
        connectedVia: 'manual',
        updatedAt: 2,
      },
      { store },
    );

    const overridden = await getLocalAiSettings({ store });
    assert.equal(overridden?.provider, 'openrouter');
    assert.equal(overridden?.connectedVia, 'manual');

    await deleteLocalAiSettings({ store });
    assert.equal(await getLocalAiSettings({ store }), null, 'disconnect reverts to the keyless state');
  });
});
