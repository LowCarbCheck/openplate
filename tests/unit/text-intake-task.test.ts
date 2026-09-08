/**
 * The text intake is the plate task's twin, and the pairing is the point.
 *
 * A person who types "3 eggs, 2 slices of toast" must land on the SAME review
 * screen as somebody who photographed the same meal. That only holds while the
 * text task returns the same shape, so this file pins the two facts that make
 * it true: the task table pairs the text prompt with the PLATE schema, and the
 * prompt asks for the amounts the person gave rather than a fresh estimate.
 *
 * It also pins what the prompt must never do. "Never invent a brand" is not a
 * style note: it is ADR-0005's rule ("packaged-food macros come from the
 * label") applied to a sentence, and a model that answers a bare "protein bar"
 * from memory is the exact failure that ADR exists to prevent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { INTAKE_MODES, INTAKE_TASK_BY_MODE, PHOTO_INTAKE_TASK, TEXT_INTAKE_TASK } from '../../app/services/vision/task';
import type { IntakeMode } from '../../app/services/vision/task';
import { PLATE_IDENTIFICATION_JSON_SCHEMA } from '../../app/services/vision/schema';
import { TEXT_INTAKE_SYSTEM_PROMPT } from '../../app/services/vision/prompt';

describe('the text intake task', () => {
  it('is paired with its own prompt and the PLATE schema, in the task table', () => {
    assert.strictEqual(INTAKE_TASK_BY_MODE.text, TEXT_INTAKE_TASK);
    assert.strictEqual(TEXT_INTAKE_TASK.systemPrompt, TEXT_INTAKE_SYSTEM_PROMPT);
    // By reference: a second JSON Schema for the same shape is how the two
    // paths would start to drift.
    assert.strictEqual(TEXT_INTAKE_TASK.jsonSchema, PLATE_IDENTIFICATION_JSON_SCHEMA);
  });

  it('parses and validates through the plate path, so the results are one shape', () => {
    assert.strictEqual(TEXT_INTAKE_TASK.parse, PHOTO_INTAKE_TASK.parse);
    assert.strictEqual(TEXT_INTAKE_TASK.validate, PHOTO_INTAKE_TASK.validate);
  });

  it('carries no capture ceiling, because there is no capture', () => {
    assert.ok(!('captureMaxDimension' in TEXT_INTAKE_TASK));
  });

  it('leaves exactly two intakes: a picture, or words', () => {
    // The third, `label`, went with the mode the person had to choose before
    // the shutter (amends ADR-0005, 2026-09-08). A third member reappearing
    // here would mean somebody is being asked to classify their own photo
    // again.
    assert.deepStrictEqual([...INTAKE_MODES], ['photo', 'text']);
  });

  it('has a task for every intake mode', () => {
    for (const mode of INTAKE_MODES) {
      const task: { mode: IntakeMode } = INTAKE_TASK_BY_MODE[mode];
      assert.strictEqual(task.mode, mode);
    }
  });

  it('neither photo task nor text task carries a capture ceiling any more', () => {
    // There is one `MAX_IMAGE_DIMENSION` now, so a per-task ceiling would be a
    // field that always answers the same thing: a drift trap wearing the look
    // of a decision.
    assert.ok(!('captureMaxDimension' in PHOTO_INTAKE_TASK));
  });
});

describe('the text intake prompt', () => {
  it('treats the amount the person gave as the answer', () => {
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /AMOUNT THE PERSON GAVE IS THE ANSWER/);
    // The worked examples the operator asked for, so a model that rounds
    // "3 eggs" into one generic portion has been told otherwise in words.
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /3 eggs/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /2 slices of toast/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /a glass of orange juice/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /portionHint/);
  });

  it('estimates a serving ONLY when no amount was given', () => {
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /Only when they gave no amount at all/);
  });

  it('accepts any language and answers in the same one', () => {
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /may be in any language/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /SAME language the person used/);
  });

  it('refuses to invent a brand, and drops to low confidence instead', () => {
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /NEVER invent a brand/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /low confidence/);
  });

  it('keeps the never-guess-a-macro rule the plate prompt already holds', () => {
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /set it to null/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /never use 0 to mean "unknown"/);
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /polyols/);
  });

  it('returns an empty list rather than guessing at a food that was not named', () => {
    assert.match(TEXT_INTAKE_SYSTEM_PROMPT, /return an empty "foods" list/);
  });
});
