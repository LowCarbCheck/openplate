/**
 * The sign-out dialog's body stays out of the root chunk.
 *
 * `root.tsx` is on every page, the public landing page included. The dialog
 * body pulls in the sign-out steps, the sync actions, the session cache, the
 * feedback outbox, the photo cache and the alert dialog, about 30 KB gzip that
 * a visitor who is not signed in never uses. The host (`sign-out-dialog.tsx`)
 * therefore loads the body with `React.lazy`, and ONE static import of the body
 * anywhere on the root's import path puts all of it back, with nothing failing:
 * the app still works, it is only heavier. So this reads the sources.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * A source regex that matches nothing passes for ever. The same pattern is
 * therefore run over strings that DO contain a static import, written three
 * ways, and over a dynamic import that must not match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const BODY = 'sign-out-dialog-body';

/** The source of a file under `app/`. */
function readApp(path: string): string {
  return readFileSync(new URL(`../../app/${path}`, import.meta.url), 'utf8');
}

/**
 * A STATIC import or re-export of a module whose path ends in `name`:
 * `import x from '...'`, `import { a, b } from '...'` over any number of lines,
 * `import '...'`, `export * from '...'`. A dynamic `import('...')` has no `from`
 * and no bare string after the keyword, so it does not match.
 */
function staticImportOf(name: string): RegExp {
  const path = String.raw`['"][^'"]*${name}(?:\.tsx?)?['"]`;
  return new RegExp(String.raw`^\s*(?:(?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)${path}`, 'm');
}

const host = readApp('components/sign-out-dialog.tsx');
const root = readApp('root.tsx');

describe('the dialog body is not on the root import path', () => {
  it('root.tsx does not import the body', () => {
    assert.doesNotMatch(root, staticImportOf(BODY));
  });

  it('the host does not import the body statically', () => {
    assert.doesNotMatch(host, staticImportOf(BODY));
  });

  it('the host loads the body with a dynamic import, which is what makes it a chunk', () => {
    assert.match(host, new RegExp(String.raw`import\(\s*['"]\./${BODY}['"]\s*\)`));
    assert.match(host, /\blazy\(/);
  });

  it('the body is a default export, which is what React.lazy takes', () => {
    assert.ok(existsSync(new URL(`../../app/components/${BODY}.tsx`, import.meta.url)));
    assert.match(readApp(`components/${BODY}.tsx`), /^export default function SignOutDialogBody\b/m);
  });

  it('the host imports none of the heavy modules the body needs', () => {
    for (const heavy of [
      'sign-out-flow',
      'erase-notice',
      'sync-actions',
      'session-cache',
      'feedback-outbox',
      'ui/alert-dialog',
    ]) {
      assert.doesNotMatch(host, staticImportOf(heavy), `the host imports ${heavy}`);
    }
  });

  it('the host fetches the body ahead of the tap, when idle, and falls back where there is no idle callback', () => {
    assert.match(host, /requestIdleCallback/);
    assert.match(host, /setTimeout\(/);
  });
});

describe('CONTROL: the import pattern sees what it is meant to forbid', () => {
  const pattern = staticImportOf(BODY);

  it('matches a default import', () => {
    assert.match(`import Body from './${BODY}';\n`, pattern);
  });

  it('matches a named import over several lines, with an alias path', () => {
    assert.match(`import {\n  SignOutDialogBody,\n  other,\n} from '#app/components/${BODY}';\n`, pattern);
  });

  it('matches a bare side-effect import and a re-export', () => {
    assert.match(`import './${BODY}';\n`, pattern);
    assert.match(`export * from './${BODY}';\n`, pattern);
  });

  it('does not match the dynamic import the host is supposed to use', () => {
    assert.doesNotMatch(`const Body = lazy(() => import('./${BODY}'));\n`, pattern);
  });

  it('does not match an unrelated module that merely shares a prefix', () => {
    assert.doesNotMatch(`import { x } from './sign-out-dialog';\n`, pattern);
  });
});
