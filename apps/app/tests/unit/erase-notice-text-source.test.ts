/**
 * There is one `EraseNoticeText`, and it lives in `erase-notice-text.tsx`.
 *
 * Thread A's sign-out dialog and thread C's account-switch step each carried a
 * copy, written while both were being built in parallel. Two copies drift: a
 * new erase-notice line wired into one component says nothing on the other
 * screen, and the line is silently missing exactly where a person is deciding
 * whether to erase. This reads the sources, so a second definition anywhere
 * under `app/` fails here, and so does a screen that stopped importing the
 * shared one.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * The scan is run over a planted file with a second definition, which it must
 * report, and over a mention in a comment, which it must not. The two screens
 * are checked to import the shared component, so "no second definition" is not
 * satisfied by a screen that renders nothing.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every TypeScript source under `app/`, as `[path relative to the app root, contents]`. */
function readAppSources(): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      files.push([relative(APP_ROOT, path), readFileSync(path, 'utf8')]);
    }
  };
  walk(join(APP_ROOT, 'app'));
  return files;
}

/** The source with its comments blanked out, so a mention in prose is not a definition. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A definition of the component: a function, a const or a class of that name. */
const DEFINITION = /\b(?:function|const|class)\s+EraseNoticeText\b/;

/** The files whose code (not comments) defines the component. */
function definitionsIn(sources: ReadonlyArray<[string, string]>): string[] {
  return sources
    .filter(([, source]) => DEFINITION.test(withoutComments(source)))
    .map(([path]) => path)
    .toSorted();
}

const SOURCES = readAppSources();

describe('EraseNoticeText', () => {
  test('is defined once, in erase-notice-text.tsx', () => {
    assert.deepEqual(definitionsIn(SOURCES), ['app/components/erase-notice-text.tsx']);
  });

  test('is imported by the sign-out dialog and by the account-switch card', () => {
    for (const path of ['app/components/sign-out-dialog-body.tsx', 'app/components/account-switch-card.tsx']) {
      const source = withoutComments(SOURCES.find(([name]) => name === path)?.[1] ?? '');
      assert.match(source, /import \{ EraseNoticeText \} from '#app\/components\/erase-notice-text';/, path);
      assert.match(source, /<EraseNoticeText\b/, `${path} imports it and renders nothing`);
    }
  });

  test('CONTROL: the scan reports a planted second definition, and ignores a mention in a comment', () => {
    const planted: Array<[string, string]> = [
      ['app/components/erase-notice-text.tsx', 'export function EraseNoticeText() { return null; }'],
      ['app/components/copy.tsx', 'function EraseNoticeText({ line }) { return null; }'],
      ['app/components/arrow.tsx', 'const EraseNoticeText = () => null;'],
      ['app/components/prose.tsx', '// function EraseNoticeText is the shared one\n/* const EraseNoticeText */'],
      [
        'app/components/use.tsx',
        "import { EraseNoticeText } from './erase-notice-text';\n<EraseNoticeText line={line} />",
      ],
    ];
    assert.deepEqual(definitionsIn(planted), [
      'app/components/arrow.tsx',
      'app/components/copy.tsx',
      'app/components/erase-notice-text.tsx',
    ]);
  });
});
