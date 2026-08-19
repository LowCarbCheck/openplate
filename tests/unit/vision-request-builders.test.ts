/**
 * Unit tests for the pure request-body builders extracted from the vision
 * adapters. These assert the enforced-structured-output wiring (OpenAI
 * `json_schema` response_format, Anthropic forced tool-use) without mocking
 * `fetch` — the builders are side-effect-free.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { buildOpenAiCompatibleRequestBody } from '../../app/services/vision/openai-compatible';
import { buildAnthropicRequestBody } from '../../app/services/vision/anthropic';
import { PLATE_IDENTIFICATION_JSON_SCHEMA } from '../../app/services/vision/schema';

/*
 * The builders return an untyped wire body (`Record<string, unknown>`), so the
 * assertions below parse the branch they are about out of it. A parse failure
 * is itself the failure the test is looking for: the body no longer carries
 * the block the adapter promises.
 */

/** Any message list, before the individual message is parsed. */
const listSchema = z.array(z.unknown());

/** A message whose content is a list of parts (the user message in both layouts). */
const partedMessageSchema = z.object({ role: z.string(), content: z.array(z.unknown()) });

/** The `json_schema` response_format the OpenAI-compatible adapter attaches. */
const responseFormatSchema = z.object({
  type: z.string(),
  json_schema: z.object({ name: z.string(), strict: z.boolean(), schema: z.unknown() }),
});

/** The OpenAI image part: an `image_url` block carrying the data URL. */
const imageUrlPartSchema = z.object({ type: z.string(), image_url: z.object({ url: z.string() }) });

/** An Anthropic tool declaration. */
const anthropicToolSchema = z.object({ name: z.string(), input_schema: z.unknown() });

/** The Anthropic image block: a base64 source. */
const imageSourcePartSchema = z.object({
  type: z.string(),
  source: z.object({ type: z.string(), media_type: z.string(), data: z.string() }),
});

describe('buildOpenAiCompatibleRequestBody', () => {
  it('attaches the derived json_schema response_format when structured output is enabled', () => {
    const body = buildOpenAiCompatibleRequestBody({
      model: 'gpt-5o',
      dataUrl: 'data:image/png;base64,AAAA',
      useStructuredOutput: true,
    });

    assert.strictEqual(body.model, 'gpt-5o');
    const responseFormat = responseFormatSchema.parse(body.response_format);
    assert.strictEqual(responseFormat.type, 'json_schema');
    assert.strictEqual(responseFormat.json_schema.name, 'plate_identification');
    assert.strictEqual(responseFormat.json_schema.strict, true);
    // The single maintainable source of truth is passed by reference.
    assert.strictEqual(responseFormat.json_schema.schema, PLATE_IDENTIFICATION_JSON_SCHEMA);
  });

  it('omits response_format entirely for the retry-without-it variant', () => {
    const body = buildOpenAiCompatibleRequestBody({
      model: 'gpt-5o',
      dataUrl: 'data:image/png;base64,AAAA',
      useStructuredOutput: false,
    });

    assert.ok(!('response_format' in body));
  });

  it('turns reasoning off for a model the catalog flags', () => {
    // gpt-5.6-luna reasons at `medium` unless told otherwise, and a plate
    // photo needs none of it — the tokens would bill at the completion rate.
    const body = buildOpenAiCompatibleRequestBody({
      model: 'openai/gpt-5.6-luna',
      dataUrl: 'data:image/png;base64,AAAA',
      useStructuredOutput: true,
      disableReasoning: true,
    });

    assert.deepStrictEqual(body.reasoning, { effort: 'none' });
  });

  it('omits reasoning entirely for a model without the flag', () => {
    // The key must be ABSENT, not null/false: this adapter also talks to
    // Mistral and self-hosted endpoints that reject unknown body fields.
    const withoutFlag = buildOpenAiCompatibleRequestBody({
      model: 'llama3',
      dataUrl: 'data:image/png;base64,AAAA',
      useStructuredOutput: true,
    });
    assert.ok(!('reasoning' in withoutFlag));

    const explicitlyFalse = buildOpenAiCompatibleRequestBody({
      model: 'llama3',
      dataUrl: 'data:image/png;base64,AAAA',
      useStructuredOutput: false,
      disableReasoning: false,
    });
    assert.ok(!('reasoning' in explicitlyFalse));
  });

  it('carries the image as an image_url data URL in the user message', () => {
    const body = buildOpenAiCompatibleRequestBody({
      model: 'gpt-5o',
      dataUrl: 'data:image/png;base64,AAAA',
      useStructuredOutput: true,
    });

    const messages = listSchema.parse(body.messages);
    const userMessage = partedMessageSchema.parse(messages[1]);
    const imagePart = imageUrlPartSchema.parse(userMessage.content[1]);
    assert.strictEqual(imagePart.type, 'image_url');
    assert.deepStrictEqual(imagePart.image_url, { url: 'data:image/png;base64,AAAA' });
  });
});

describe('buildAnthropicRequestBody', () => {
  it('forces tool-use of record_plate_identification with the derived input schema', () => {
    const body = buildAnthropicRequestBody({
      model: 'claude-sonnet-5',
      image: { base64: 'AAAA', mimeType: 'image/png' },
    });

    assert.strictEqual(body.model, 'claude-sonnet-5');
    const tools = z.array(anthropicToolSchema).parse(body.tools);
    assert.strictEqual(tools.length, 1);
    const [tool] = tools;
    assert.strictEqual(tool.name, 'record_plate_identification');
    assert.strictEqual(tool.input_schema, PLATE_IDENTIFICATION_JSON_SCHEMA);
    assert.deepStrictEqual(body.tool_choice, { type: 'tool', name: 'record_plate_identification' });
  });

  it('sends the image as a base64 source block', () => {
    const body = buildAnthropicRequestBody({
      model: 'claude-sonnet-5',
      image: { base64: 'AAAA', mimeType: 'image/png' },
    });

    const messages = listSchema.parse(body.messages);
    const userMessage = partedMessageSchema.parse(messages[0]);
    const imageBlock = imageSourcePartSchema.parse(userMessage.content[1]);
    assert.strictEqual(imageBlock.type, 'image');
    assert.deepStrictEqual(imageBlock.source, { type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });
});
