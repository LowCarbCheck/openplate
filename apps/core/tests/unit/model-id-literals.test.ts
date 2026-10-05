/**
 * No model id is written anywhere in core except the tier file.
 *
 * `ai-tiers.json` is the ONE place that names the production model. This test
 * reads every source file, script and doc that ships (comments included) and
 * fails when one of them writes a model id, so a model swap cannot leave a
 * second copy behind: a price comment, a README example, a stale claim. Tests
 * under `tests/` are not scanned; their ids are opaque fixture strings.
 *
 * Every assertion here can fail. The scanner is proved on a planted file and on
 * the same text at an allowed path, and the real run asserts it read known files
 * and many of them, so a broken walk cannot pass by reading nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findModelIdLiterals, isAllowedPath, type AllowedPath, type ScannedFile } from './model-id-literals.js';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The directories and files that ship, from the app root. */
const SCANNED_ROOTS = ['src', 'scripts', 'README.md', 'PROTOCOL.md', 'ai-tiers.json'];

/** Where a model id may be written, and why. Every entry names its reason. */
const ALLOWED: readonly AllowedPath[] = [
  { path: 'ai-tiers.json', reason: 'the tier file is the ONE place that names the production model' },
  {
    path: 'scripts/lib/translate.ts',
    reason: 'the translator names its own model (MODEL); it is vendored from the website and unrelated to the proxy',
  },
  {
    path: 'src/mail/memory/**',
    reason: 'the translation memory records which model translated each entry, so a swap must not rewrite it',
  },
  {
    path: 'src/mail/strings.*.ts',
    reason: 'the generated letter bundles cite the translator model in their header',
  },
];

function readTree(path: string): ScannedFile[] {
  const absolute = join(APP_ROOT, path);
  const entries = readdirSync(absolute, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((file) => ({ path: relative(APP_ROOT, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
}

function readShippedFiles(): ScannedFile[] {
  return SCANNED_ROOTS.flatMap((root) =>
    root.includes('.') ? [{ path: root, text: readFileSync(join(APP_ROOT, root), 'utf8') }] : readTree(root),
  );
}

test('the scanner finds a planted model id, in code and in a comment', () => {
  const planted = [{ path: 'src/ai/x.ts', text: "const model = 'google/gemini-9-flash';\n" }];
  const findings = findModelIdLiterals({ files: planted, allow: ALLOWED });
  assert.deepEqual(
    findings.map((found) => [found.path, found.line, found.match]),
    [['src/ai/x.ts', 1, 'google/gemini-9-flash']],
  );

  const commented = [{ path: 'src/ai/y.ts', text: '// ok\n/* the price of Gemini-9 is high */\n' }];
  assert.deepEqual(
    findModelIdLiterals({ files: commented, allow: ALLOWED }).map((found) => [found.line, found.match]),
    [[2, 'Gemini-9']],
  );
});

test('the same text at an allowed path gives no finding, and only that path is allowed', () => {
  const text = "const model = 'google/gemini-9-flash';\n";
  const allow: readonly AllowedPath[] = [
    { path: 'ai-tiers.json', reason: 'the one place that names the model' },
    { path: 'src/mail/strings.*.ts', reason: 'translator provenance' },
    { path: 'src/mail/memory/**', reason: 'translator memory' },
  ];
  const allowed = [
    { path: 'ai-tiers.json', text },
    { path: 'src/mail/strings.fr.ts', text },
    { path: 'src/mail/memory/fr.json', text },
    { path: 'src/mail/memory/deep/er.json', text },
  ];
  assert.deepEqual(findModelIdLiterals({ files: allowed, allow }), []);

  // CONTROL: a neighbour of every allowed path is not allowed.
  const neighbours = [
    { path: 'src/mail/strings.ts', text },
    { path: 'src/mail/strings/fr.ts', text },
    { path: 'src/mail/memory.json', text },
    { path: 'xai-tiers.json', text },
  ];
  assert.equal(findModelIdLiterals({ files: neighbours, allow }).length, 4);
});

test('chat-body-policy.ts is scanned: it writes `model`, so a hardcoded id there must be caught', () => {
  const path = 'src/ai/chat-body-policy.ts';
  const real = readShippedFiles().find((file) => file.path === path);
  assert.ok(real !== undefined, `${path} was not read`);
  // The real file names no model id (this is the same scan the tree test below runs).
  assert.deepEqual(findModelIdLiterals({ files: [real], allow: ALLOWED }), []);
  // CONTROL: the same file with one planted id is caught at that line.
  const planted = { path, text: `${real.text}\nconst model = 'google/gemini-9-flash';\n` };
  const findings = findModelIdLiterals({ files: [planted], allow: ALLOWED });
  assert.deepEqual(
    findings.map((found) => [found.path, found.match]),
    [[path, 'google/gemini-9-flash']],
  );
  // And the allow list holds no entry that covers the file.
  assert.equal(isAllowedPath({ path, allow: ALLOWED }), false);
});

test('text that names no model gives no finding', () => {
  const plain = [
    { path: 'src/a.ts', text: 'const vendor = "the model in ai-tiers.json"; // vendor/model-name, a placeholder\n' },
    { path: 'src/b.ts', text: "import x from 'github.com/google/golang';\nconst gptq = 1; // mistral winds\n" },
  ];
  assert.deepEqual(findModelIdLiterals({ files: plain, allow: ALLOWED }), []);
});

test('no source, script or doc of core writes a model id outside the allowed places', () => {
  const files = readShippedFiles();

  // A walk that read nothing, or the wrong tree, would pass the scan below.
  assert.ok(files.length > 50, `read only ${files.length} files`);
  assert.ok(
    files.some((file) => file.path === 'src/ai/proxy.ts'),
    'src/ai/proxy.ts was not read',
  );
  assert.ok(
    files.some((file) => file.path === 'README.md'),
    'README.md was not read',
  );

  const findings = findModelIdLiterals({ files, allow: ALLOWED });
  const report = findings.map((found) => `${found.path}:${found.line} ${found.match}`).join('\n');
  assert.equal(findings.length, 0, `a model id is written outside ai-tiers.json:\n${report}`);
});

test('every allowed path still names a file that exists, and has a reason', () => {
  const files = readShippedFiles();
  for (const entry of ALLOWED) {
    assert.ok(entry.reason.length > 20, `${entry.path} has no real reason`);
    const matches = files.filter((file) => isAllowedPath({ path: file.path, allow: [entry] }));
    assert.ok(matches.length > 0, `${entry.path} matches no file: the file moved, so drop the allowance`);
  }

  // CONTROL: an entry for a file that is not there is caught by the same check.
  const stale: AllowedPath = { path: 'src/ai/renamed-away.ts', reason: 'a file that no longer exists' };
  assert.equal(files.filter((file) => isAllowedPath({ path: file.path, allow: [stale] })).length, 0);
});
