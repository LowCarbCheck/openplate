/**
 * Both adapters can send a TEXT-ONLY request, and it is the same request
 * everywhere else.
 *
 * The mirror of `vision-request-builders.test.ts`, which covers the photo
 * shape. What matters here is the pair of facts that keep one transport
 * serving two intakes: the user message carries the person's words instead of
 * an image block and NOTHING else moves, and the structured-output wiring
 * (`json_schema` / forced tool-use) is byte-identical to the photo path.
 *
 * A text request that quietly dropped `response_format` would still work most
 * of the time and fail unpredictably on the models that need it, which is
 * exactly the kind of drift a shared transport is supposed to make impossible.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { buildOpenAiCompatibleRequestBody } from '../../app/services/vision/openai-compatible';
import { buildAnthropicRequestBody } from '../../app/services/vision/anthropic';
import { PLATE_IDENTIFICATION_JSON_SCHEMA } from '../../app/services/vision/schema';
import { TEXT_INTAKE_TASK } from '../../app/services/vision/task';

const SPOKEN = '3 eggs, 2 slices of toast, a glass of orange juice';

/** A message whose content is a list of parts. */
const partedMessageSchema = z.object({ role: z.string(), content: z.array(z.unknown()) });
const textPartSchema = z.object({ type: z.literal('text'), text: z.string() });
const responseFormatSchema = z.object({
  type: z.string(),
  json_schema: z.object({ name: z.string(), strict: z.boolean(), schema: z.unknown() }),
});
const anthropicToolSchema = z.object({ name: z.string(), input_schema: z.unknown() });

function openAiTextBody() {
  return buildOpenAiCompatibleRequestBody({
    model: 'gpt-5o',
    input: { kind: 'text', text: SPOKEN },
    task: TEXT_INTAKE_TASK,
    useStructuredOutput: true,
  });
}

describe('buildOpenAiCompatibleRequestBody, text intake', () => {
  it('sends the words as a second text part and no image at all', () => {
    const body = openAiTextBody();

    const userMessage = partedMessageSchema.parse(body.messages[1]);
    assert.strictEqual(userMessage.content.length, 2);
    assert.strictEqual(textPartSchema.parse(userMessage.content[0]).text, TEXT_INTAKE_TASK.userPrompt);
    // The person's own words, unrewritten, in their own part.
    assert.strictEqual(textPartSchema.parse(userMessage.content[1]).text, SPOKEN);
    assert.ok(!JSON.stringify(body).includes('image_url'), 'a text intake sent an image block');
  });

  it('carries the text task system prompt', () => {
    assert.deepStrictEqual(openAiTextBody().messages[0], {
      role: 'system',
      content: TEXT_INTAKE_TASK.systemPrompt,
    });
  });

  it('enforces the same plate schema the photo path does', () => {
    const responseFormat = responseFormatSchema.parse(openAiTextBody().response_format);
    assert.strictEqual(responseFormat.type, 'json_schema');
    assert.strictEqual(responseFormat.json_schema.strict, true);
    assert.strictEqual(responseFormat.json_schema.schema, PLATE_IDENTIFICATION_JSON_SCHEMA);
  });

  it('omits response_format for the retry-without-it variant, exactly as a photo does', () => {
    const body = buildOpenAiCompatibleRequestBody({
      model: 'gpt-5o',
      input: { kind: 'text', text: SPOKEN },
      task: TEXT_INTAKE_TASK,
      useStructuredOutput: false,
    });
    assert.ok(!('response_format' in body));
  });
});

describe('buildAnthropicRequestBody, text intake', () => {
  function anthropicTextBody() {
    return buildAnthropicRequestBody({
      model: 'claude-sonnet-5',
      input: { kind: 'text', text: SPOKEN },
      task: TEXT_INTAKE_TASK,
    });
  }

  it('sends the words as a second text block and no image source', () => {
    const body = anthropicTextBody();

    const userMessage = partedMessageSchema.parse(body.messages[0]);
    assert.strictEqual(userMessage.content.length, 2);
    assert.strictEqual(textPartSchema.parse(userMessage.content[0]).text, TEXT_INTAKE_TASK.userPrompt);
    assert.strictEqual(textPartSchema.parse(userMessage.content[1]).text, SPOKEN);
    assert.ok(!JSON.stringify(body).includes('base64'), 'a text intake sent an image source');
  });

  it('still forces tool-use with the plate input schema', () => {
    const body = anthropicTextBody();

    const tools = z.array(anthropicToolSchema).parse(body.tools);
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].input_schema, PLATE_IDENTIFICATION_JSON_SCHEMA);
    assert.deepStrictEqual(body.tool_choice, { type: 'tool', name: TEXT_INTAKE_TASK.toolName });
  });

  it('puts the text task system prompt where Anthropic wants it', () => {
    assert.strictEqual(anthropicTextBody().system, TEXT_INTAKE_TASK.systemPrompt);
  });
});
