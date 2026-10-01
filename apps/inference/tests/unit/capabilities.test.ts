/**
 * The capabilities object on `GET /v1/models`: the service tells a client what it
 * can and cannot do.
 *
 * Two things are pinned. The response still has the OpenAI model-entry keys, so an
 * OpenAI client keeps working. And the schema is a real gate: the control cases
 * prove it rejects a bad object, because a schema that accepts everything would
 * make the positive test pass while saying nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../support/app-harness.js';
import { CapabilitiesSchema, PLATE_MODEL_CAPABILITIES } from '../../src/capabilities.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

let runtime: FakeRuntime;
let app: TestApp;

beforeEach(async () => {
  runtime = await startFakeRuntime();
  app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });
});

afterEach(async () => {
  await app.close();
  await runtime.close();
});

describe('GET /v1/models capabilities', () => {
  it('returns a capabilities object that parses with the schema', async () => {
    const response = await app.get('/v1/models');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);

    const parsed = CapabilitiesSchema.safeParse(response.body.data[0].capabilities);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(PLATE_MODEL_CAPABILITIES);
  });

  it('says today that only plate photos are served, with partial flags, request-language translations and no labels', async () => {
    const response = await app.get('/v1/models');
    expect(response.body.data[0].capabilities).toEqual({
      tasks: { plateImage: true, describe: false, pantryImage: false, pantryText: false, recipes: false },
      flags: 'partial',
      translations: 'request-language',
      labels: false,
    });
  });

  it('keeps the OpenAI model-entry keys so an OpenAI client still works', async () => {
    const response = await app.get('/v1/models');
    expect(response.body.object).toBe('list');
    expect(response.body.data[0]).toMatchObject({
      id: 'openplate-plate-1',
      object: 'model',
      created: 0,
      owned_by: 'openplate',
    });
  });

  it('still answers 401 without a key', async () => {
    const response = await app.get('/v1/models', { apiKey: null });
    expect(response.status).toBe(401);
    expect(response.text).not.toContain('capabilities');
  });
});

describe('CapabilitiesSchema', () => {
  it('accepts the constant it describes', () => {
    expect(CapabilitiesSchema.safeParse(PLATE_MODEL_CAPABILITIES).success).toBe(true);
  });

  it('rejects an unknown flags value', () => {
    const result = CapabilitiesSchema.safeParse({ ...PLATE_MODEL_CAPABILITIES, flags: 'all' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown translations value', () => {
    const result = CapabilitiesSchema.safeParse({ ...PLATE_MODEL_CAPABILITIES, translations: 'some' });
    expect(result.success).toBe(false);
  });

  it('rejects an object with no tasks', () => {
    const { tasks: _tasks, ...withoutTasks } = PLATE_MODEL_CAPABILITIES;
    const result = CapabilitiesSchema.safeParse(withoutTasks);
    expect(result.success).toBe(false);
  });

  it('rejects a tasks object that is missing a task', () => {
    const { recipes: _recipes, ...someTasks } = PLATE_MODEL_CAPABILITIES.tasks;
    const result = CapabilitiesSchema.safeParse({ ...PLATE_MODEL_CAPABILITIES, tasks: someTasks });
    expect(result.success).toBe(false);
  });
});
