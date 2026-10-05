/**
 * The app holds no managed model id.
 *
 * On a managed instance the app sends no model of its own. It learns the model
 * from `/health` (`instance.ai.model`, read by `app/lib/ai/managed-ai-settings.ts`)
 * and names it on the shutter screen. The instance decides that model in the
 * core's tier file (`ai-tiers.json`), so a production model swap must never need
 * an app release. This test reads every source file, script and string bundle of
 * the app (comments included) and fails when one writes a model id outside the
 * allow list below. The only ids the app may hold are a person's own choices on
 * their own key (BYOK), plus the translator's.
 *
 * The app shares no code with core (M269), so this scanner is a local copy of
 * the idea in `apps/core/tests/unit/model-id-literals.ts`. Tests under `tests/`
 * are not scanned: their ids are opaque fixture strings.
 *
 * Every assertion here can fail. The scanner is proved on a planted file and on
 * the same text at an allowed path, and the real run asserts it read known
 * files and many of them, so a broken walk cannot pass by reading nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The directories of the app that ship or build it. */
const SCANNED_ROOTS = ['app', 'scripts'];

/** The kinds of file that can hold a literal. Pictures and fonts are binary. */
const TEXT_FILE = /\.(?:tsx?|json|md|css|sh|container)$/;

/**
 * A vendor prefix, then `/` and the first character of an id. Not preceded by a path or a word character.
 * Lowercase only: a model id is lowercase, and prose such as "Google/GitHub" is not one.
 */
const VENDOR_PREFIXED =
  /(?<![\w./-])(?:google|openai|anthropic|mistralai|meta-llama|qwen|x-ai|deepseek)\/[a-z0-9][\w.:-]*/g;

/** A family name, a dash and a digit. Not preceded by a word character. */
const FAMILY_NAME = /(?<![\w-])(?:gemini|gpt|claude|mistral|ministral|llama|qwen)-\d[\w.:-]*/gi;

interface ScannedFile {
  /** From the app root, with `/` separators. */
  path: string;
  text: string;
}

interface AllowedPath {
  /** `*` matches within one segment, `**` across segments. */
  path: string;
  reason: string;
}

interface ModelIdFinding {
  path: string;
  line: number;
  match: string;
}

/** Where a model id may be written, and why. Every entry names its reason. */
const ALLOWED: readonly AllowedPath[] = [
  {
    path: 'app/services/vision/catalog.ts',
    reason: 'the BYOK catalog: the models a person picks for their own key, and pays for themselves',
  },
  {
    path: 'app/routes/oauth.openrouter.callback.tsx',
    reason: 'the BYOK default picked after a person connects their own OpenRouter account (OAUTH_DEFAULT_MODEL)',
  },
  {
    path: 'app/i18n/**',
    reason: 'the blurb keys are derived from catalog ids, and the translation memory records the translator model',
  },
  {
    path: 'scripts/lib/**',
    reason: 'the translator names its own model; it is vendored from the website and unrelated to the managed model',
  },
];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*\*|\*/g, (stars) => (stars === '**' ? '.*' : '[^/]*'));
  return new RegExp(`^${pattern}$`);
}

function isAllowedPath(input: { path: string; allow: readonly AllowedPath[] }): boolean {
  return input.allow.some((entry) => globToRegExp(entry.path).test(input.path));
}

function lineOf(input: { text: string; index: number }): number {
  return input.text.slice(0, input.index).split('\n').length;
}

/** Every model id literal in `files`, except in an allowed path. `vendor/family-9` is ONE literal. */
function findModelIdLiterals(input: {
  files: readonly ScannedFile[];
  allow: readonly AllowedPath[];
}): ModelIdFinding[] {
  const findings: ModelIdFinding[] = [];
  for (const file of input.files) {
    if (isAllowedPath({ path: file.path, allow: input.allow })) continue;
    const vendorSpans: Array<{ start: number; end: number }> = [];
    for (const found of file.text.matchAll(VENDOR_PREFIXED)) {
      vendorSpans.push({ start: found.index, end: found.index + found[0].length });
      findings.push({ path: file.path, line: lineOf({ text: file.text, index: found.index }), match: found[0] });
    }
    for (const found of file.text.matchAll(FAMILY_NAME)) {
      const isInsideVendorMatch = vendorSpans.some((span) => found.index >= span.start && found.index < span.end);
      if (isInsideVendorMatch) continue;
      findings.push({ path: file.path, line: lineOf({ text: file.text, index: found.index }), match: found[0] });
    }
  }
  return findings.toSorted((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function readShippedFiles(): ScannedFile[] {
  return SCANNED_ROOTS.flatMap((root) =>
    readdirSync(join(APP_ROOT, root), { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name))
      .map((file) => ({ path: relative(APP_ROOT, file).split(sep).join('/'), text: readFileSync(file, 'utf8') })),
  );
}

describe('the app holds no managed model id', () => {
  it('finds a planted model id, in code and in a comment', () => {
    const planted = [{ path: 'app/lib/x.ts', text: "const model = 'google/gemini-9-flash';\n" }];
    assert.deepEqual(
      findModelIdLiterals({ files: planted, allow: ALLOWED }).map((found) => [found.path, found.line, found.match]),
      [['app/lib/x.ts', 1, 'google/gemini-9-flash']],
    );

    const commented = [{ path: 'app/lib/y.ts', text: '// ok\n/* the price of Gemini-9 is high */\n' }];
    assert.deepEqual(
      findModelIdLiterals({ files: commented, allow: ALLOWED }).map((found) => [found.line, found.match]),
      [[2, 'Gemini-9']],
    );
  });

  it('finds nothing in text that names no model', () => {
    const plain = [
      { path: 'app/a.ts', text: 'const label = "the model /health names"; // vendor/model-name, a placeholder\n' },
      { path: 'app/b.ts', text: "import x from 'github.com/google/golang';\nconst gptq = 1; // mistral winds\n" },
    ];
    assert.deepEqual(findModelIdLiterals({ files: plain, allow: ALLOWED }), []);
  });

  it('gives no finding for the same text at an allowed path, and only at that path', () => {
    const text = "const model = 'google/gemini-9-flash';\n";
    const allowed = ALLOWED.map((entry) => ({ path: entry.path.replace('**', 'deep/er.ts'), text }));
    assert.deepEqual(findModelIdLiterals({ files: allowed, allow: ALLOWED }), []);

    // CONTROL: a neighbour of every allowed path is not allowed.
    const neighbours = [
      { path: 'app/services/vision/catalog.tsx', text },
      { path: 'app/services/vision/registry.ts', text },
      { path: 'app/routes/oauth.openrouter.callback.ts', text },
      { path: 'app/i18nx/memory/de.json', text },
      { path: 'scripts/translate-ui.ts', text },
    ];
    assert.equal(findModelIdLiterals({ files: neighbours, allow: ALLOWED }).length, neighbours.length);
  });

  it('writes no model id outside the allowed places', () => {
    const files = readShippedFiles();

    // A walk that read nothing, or the wrong tree, would pass the scan below.
    assert.ok(files.length > 50, `read only ${files.length} files`);
    for (const known of [
      'app/services/vision/catalog.ts',
      'app/lib/ai/managed-ai-settings.ts',
      'app/routes/add.photo.tsx',
    ]) {
      assert.ok(
        files.some((file) => file.path === known),
        `${known} was not read`,
      );
    }

    const findings = findModelIdLiterals({ files, allow: ALLOWED });
    const report = findings.map((found) => `${found.path}:${found.line} ${found.match}`).join('\n');
    assert.equal(findings.length, 0, `a managed model id is written in the app:\n${report}`);
  });

  it('keeps only allowances that still match a file, each with a reason', () => {
    const files = readShippedFiles();
    for (const entry of ALLOWED) {
      assert.ok(entry.reason.length > 20, `${entry.path} has no real reason`);
      const matches = files.filter((file) => isAllowedPath({ path: file.path, allow: [entry] }));
      assert.ok(matches.length > 0, `${entry.path} matches no file: the file moved, so drop the allowance`);
    }

    // CONTROL: an entry for a file that is not there is caught by the same check.
    const stale: AllowedPath = { path: 'app/services/vision/renamed-away.ts', reason: 'a file that is gone' };
    assert.equal(files.filter((file) => isAllowedPath({ path: file.path, allow: [stale] })).length, 0);
  });
});
