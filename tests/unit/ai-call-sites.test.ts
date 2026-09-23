/**
 * Only a person action calls the AI (M253/05).
 *
 * On a scan-trial account every managed AI request spends one of the person's
 * free scans. A background call, a prefetch or a retry loop outside the four
 * person actions would spend them without a tap. So this test lists every file
 * that builds a vision provider or a managed AI credential, and fails when a
 * file appears that is not one of the known person actions: a photo or a label
 * and a typed meal (`add.photo.tsx`), a pantry identify (`pantry.tsx`) and one
 * round of recipes (`pantry.recipes.tsx`). The factory itself is listed too.
 *
 * A new call site is not forbidden. It must be ADDED here, by somebody who has
 * decided that it is a person action and that it makes its own intake id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The app's source root. */
const APP_ROOT = fileURLToPath(new URL('../../app', import.meta.url));

/** A call, not a definition and not a mention in a comment. */
const CALL = /(?<!function )\b(?:createVisionProvider|createOpenAiCompatibleProvider|managedAiCredential)\(/;

/** The files allowed to call, relative to `app/`. */
const PERSON_ACTIONS = new Set([
  'routes/add.photo.tsx',
  'routes/pantry.tsx',
  'routes/pantry.recipes.tsx',
  // The factory that picks the wire adapter. It is called only from the three above.
  'services/vision/index.ts',
]);

/** Every `.ts` and `.tsx` file under a directory. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** A line of code, not of a comment. */
function isCodeLine(line: string): boolean {
  const trimmed = line.trim();
  return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
}

/** The files under `root` that call the AI, relative to it. */
function filesThatCallTheAi(root: string): string[] {
  return sourceFiles(root)
    .filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some((line) => isCodeLine(line) && CALL.test(line)),
    )
    .map((file) => relative(root, file))
    .toSorted();
}

describe('the AI call sites', () => {
  it('are the four person actions and the factory, and nothing else', () => {
    assert.deepEqual(filesThatCallTheAi(APP_ROOT), [...PERSON_ACTIONS].toSorted());
  });

  it('each make a new intake id where they build the managed credential', () => {
    for (const file of PERSON_ACTIONS) {
      const source = readFileSync(join(APP_ROOT, file), 'utf8');
      if (!source.includes('managedAiCredential(')) continue;
      assert.match(source, /managedAiCredential\(\{ intakeId: newIntakeId\(\) \}\)/, `${file} sends no fresh intake id`);
    }
  });

  it('the control: a new call site in a background module is found', () => {
    // The reader above, pointed at a copy with one fake background caller.
    const root = mkdtempSync(join(tmpdir(), 'openplate-ai-call-sites-'));
    try {
      mkdirSync(join(root, 'lib'), { recursive: true });
      writeFileSync(
        join(root, 'lib', 'background-sync.ts'),
        "import { createVisionProvider } from '#app/services/vision';\nexport const p = createVisionProvider(options);\n",
      );
      writeFileSync(join(root, 'lib', 'mention.ts'), '// createVisionProvider(options) in a comment is no call\n');
      assert.deepEqual(filesThatCallTheAi(root), ['lib/background-sync.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
