/**
 * THE COMMITTED VISION CONTRACT STAYS THE CONTRACT THE APP BUILDS.
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────
 *
 * `apps/inference/eval/generated/vision-contract.json` is what the eval harness sends and scores. If it
 * drifts from the app's real prompt builders, the eval measures a request nobody makes, which is exactly how
 * the August 2026 harness went stale. This test regenerates the contract in memory from the real builders and
 * fails when the committed file differs, naming the paths that moved.
 *
 * ── THE CONTROLS ─────────────────────────────────────────────────────────
 *
 * A comparison that can never fail proves nothing. Three plants make it fail: a changed prompt string (injected
 * through the function input, the real source is never edited), a changed schema, and a changed source file's
 * bytes. Each asserts the plant really changed something before it asserts the comparison noticed.
 *
 * TO FIX A FAILURE: run `pnpm vision:export-contract` in apps/app and commit the file it wrote.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import {
  CONTRACT_SOURCE_FILES,
  CONTRACT_TASK_KEYS,
  REAL_SOURCES,
  buildVisionContract,
  describeContractDifferences,
  gitBlobSha1,
  readCommittedContract,
  recipeUserTextFromApp,
  serializeVisionContract,
  tasksFromApp,
  type VisionContract,
  type VisionContractSources,
} from '../../scripts/lib/vision-contract';

const REGENERATE = 'run `pnpm vision:export-contract` in apps/app and commit the result';

function regenerated(sources: VisionContractSources = REAL_SOURCES): string {
  return serializeVisionContract(buildVisionContract(sources));
}

function parsedCommitted(): VisionContract {
  // SAFETY: the committed file is the serialisation of a VisionContract; the first test below compares it to a
  // fresh one byte for byte, so a file of any other shape fails there.
  return JSON.parse(readCommittedContract()) as VisionContract;
}

describe('the committed contract against the app builders', () => {
  it('is byte-identical to what the real builders produce now', () => {
    const committed = readCommittedContract();
    const fresh = regenerated();
    const where = describeContractDifferences({ committed, regenerated: fresh });
    assert.deepEqual(where, [], `the committed vision contract is stale at ${where.join(', ')}: ${REGENERATE}`);
    assert.equal(committed, fresh);
  });

  it('pins the git blob hash of every source file it is built from', () => {
    const files = parsedCommitted().generatedFrom.files;
    assert.deepEqual(Object.keys(files), [...CONTRACT_SOURCE_FILES]);
    for (const hash of Object.values(files)) assert.match(hash, /^[0-9a-f]{40}$/);
  });
});

describe('what the contract holds (so the checks above are not vacuous)', () => {
  const contract = parsedCommitted();

  it('has the five tasks for the six UI languages, each with both prompts', () => {
    assert.deepEqual(contract.languages, [...SUPPORTED_LANGUAGES]);
    assert.deepEqual(Object.keys(contract.tasks), [...CONTRACT_TASK_KEYS]);
    for (const key of CONTRACT_TASK_KEYS) {
      for (const language of SUPPORTED_LANGUAGES) {
        const entry = contract.tasks[key].languages[language];
        assert.ok(entry.systemPrompt.length > 500, `${key}/${language} system prompt is too short`);
        assert.ok(entry.userPrompt.length > 20, `${key}/${language} user prompt is too short`);
      }
    }
  });

  it('control: the language really reaches the prompt builders', () => {
    for (const key of ['plate_photo', 'plate_text', 'pantry_photo', 'pantry_text'] as const) {
      const { en, de } = contract.tasks[key].languages;
      assert.notEqual(en.systemPrompt, de.systemPrompt, `${key} reads no language`);
    }
  });

  it('holds a strict schema for every task: no extra properties, everything required', () => {
    for (const key of CONTRACT_TASK_KEYS) {
      const { jsonSchema, strict, responseFormatType } = contract.tasks[key];
      assert.equal(strict, true);
      assert.equal(responseFormatType, 'json_schema');
      assert.equal(jsonSchema.additionalProperties, false, key);
      assert.deepEqual(
        [...(jsonSchema.required ?? [])].toSorted(),
        Object.keys(jsonSchema.properties ?? {}).toSorted(),
      );
    }
  });

  it('records the upload constraints the client uses', () => {
    assert.equal(contract.photoConstraints.maxLongSidePx, 1600);
    assert.equal(contract.photoConstraints.jpegQuality, 0.85);
    assert.equal(contract.photoConstraints.outputMimeType, 'image/jpeg');
  });

  it('rebuilds the recipe user text exactly from its template, so the harness can too', () => {
    const { template, pantryLineWithAmount, pantryLineWithoutAmount, markers } = contract.recipeUserText;
    const lines = [
      pantryLineWithAmount
        .replace(markers.name ?? '', 'eggs')
        .replace(markers.amount ?? '', '6')
        .replace(markers.unit ?? '', 'piece'),
      pantryLineWithoutAmount.replace(markers.name ?? '', 'spinach'),
      pantryLineWithAmount
        .replace(markers.name ?? '', 'rolled oats')
        .replace(markers.amount ?? '', '500')
        .replace(markers.unit ?? '', 'g'),
    ];
    const rebuilt = template
      .replace(markers.pantryLines ?? '', lines.join('\n'))
      .replace(markers.slot ?? '', 'dinner')
      .replace(markers.language ?? '', 'en')
      .replace(markers.remainingDayBlock ?? '', () => {
        const userText = recipeUserTextFromApp('en');
        const start = userText.indexOf('Rest of the day');
        const end = userText.indexOf('\n\nMeal slot to cook for');
        return userText.slice(start, end);
      });
    assert.equal(rebuilt, recipeUserTextFromApp('en'));
    assert.equal(rebuilt, contract.tasks.recipe.languages.en.userText);
  });
});

describe('control: the comparison fails when the contract and the app disagree', () => {
  const real = REAL_SOURCES;

  it('a planted change to one prompt string is reported at its path', () => {
    const planted: VisionContractSources = {
      ...real,
      tasksFor: (language) => {
        const tasks = tasksFromApp(language);
        const changed = tasks.plate_photo.systemPrompt.replace('nutrition assistant', 'nutrition assistant PLANTED');
        assert.notEqual(changed, tasks.plate_photo.systemPrompt, 'the plant must change the prompt');
        return { ...tasks, plate_photo: { ...tasks.plate_photo, systemPrompt: changed } };
      },
    };
    const committed = readCommittedContract();
    const fresh = regenerated(planted);
    assert.notEqual(fresh, committed);
    const where = describeContractDifferences({ committed, regenerated: fresh });
    assert.ok(where.includes('$.tasks.plate_photo.languages.en.systemPrompt'), where.join(', '));
    assert.ok(
      where.every((path) => path.startsWith('$.tasks.plate_photo.languages.')),
      where.join(', '),
    );
  });

  it('a planted change to a schema is reported', () => {
    const planted: VisionContractSources = {
      ...real,
      tasksFor: (language) => {
        const tasks = tasksFromApp(language);
        const schema = { ...tasks.pantry_text.jsonSchema, required: ['items'] };
        return { ...tasks, pantry_text: { ...tasks.pantry_text, jsonSchema: schema } };
      },
    };
    const where = describeContractDifferences({
      committed: readCommittedContract(),
      regenerated: regenerated(planted),
    });
    assert.ok(
      where.some((path) => path.startsWith('$.tasks.pantry_text.jsonSchema')),
      where.join(', '),
    );
  });

  it('a planted change to a source file moves its hash', () => {
    const target = 'apps/app/app/services/vision/prompt.ts';
    const planted: VisionContractSources = {
      ...real,
      readSource: (repoPath) => {
        const bytes = real.readSource(repoPath);
        return repoPath === target ? Buffer.concat([bytes, Buffer.from('\n// planted\n')]) : bytes;
      },
    };
    const where = describeContractDifferences({
      committed: readCommittedContract(),
      regenerated: regenerated(planted),
    });
    assert.deepEqual(where, [`$.generatedFrom.files.${target}`]);
  });

  it('a plant that changes nothing is NOT reported, so equal means equal', () => {
    const same: VisionContractSources = { ...real, tasksFor: (language) => ({ ...tasksFromApp(language) }) };
    assert.deepEqual(
      describeContractDifferences({ committed: readCommittedContract(), regenerated: regenerated(same) }),
      [],
    );
  });

  it('describes two equal texts as no difference and two unequal texts as at least one', () => {
    assert.deepEqual(describeContractDifferences({ committed: '{"a":1}', regenerated: '{"a":1}' }), []);
    assert.deepEqual(describeContractDifferences({ committed: '{"a":1}', regenerated: '{"a":2}' }), ['$.a']);
  });
});

describe('gitBlobSha1', () => {
  it('matches the ids git prints for known blobs', () => {
    assert.equal(gitBlobSha1(Buffer.from('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    assert.equal(gitBlobSha1(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('control: one changed byte changes the id', () => {
    assert.notEqual(gitBlobSha1(Buffer.from('hello\n')), gitBlobSha1(Buffer.from('hellp\n')));
  });
});
