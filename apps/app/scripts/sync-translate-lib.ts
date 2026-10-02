/**
 * sync-translate-lib, copy the UI translator out of `openplate-website` into `scripts/lib/`.
 *
 * A DEVELOPER TOOL, run by hand, whose output is COMMITTED, on the same footing as `sync-brand`.
 *
 *   pnpm sync:translate-lib                                         # the website repository at its `main`
 *   OPENPLATE_WEBSITE_REPO=../../../openplate-website pnpm sync:translate-lib  # a local checkout, read where it stands
 *   OPENPLATE_WEBSITE_REF=<sha-or-branch> pnpm sync:translate-lib   # any ref, always cloned
 *
 * ── ONE TRANSLATOR, TWO REPOSITORIES ──
 * The website's `scripts/lib/translate.ts` is the client that buys this workspace's translations:
 * the model, the style contract, the glossary, the dash gate, the budget and the memory format all
 * live there. This app's catalogs want the same treatment, and the two are separate git
 * repositories that a CI runner checks out one at a time. The choice taken (M229 spec 02) is a
 * VENDORED COPY WITH PROVENANCE: the files here are byte copies, this script is the only thing that
 * writes them, and `tests/unit/translate-lib-provenance.test.ts` re-hashes them against
 * `scripts/lib/TRANSLATE_SOURCE.json` on every push. A hand edit to a vendored file is a red test,
 * which is what keeps "a copy" from turning into "a fork" one convenient fix at a time. Fix it in
 * the website, then sync.
 *
 * ── THE REWRITES ARE PART OF THE RECORD ──
 * The copy is not quite byte-identical, because the website's files import from the website's
 * tree. Every import specifier that has to change is listed in `REWRITES` below, applied
 * mechanically, and written into the provenance next to the hash of the file BEFORE the rewrite
 * and the hash AFTER it. An import this table does not know is a hard failure, not a guess: a new
 * upstream dependency is a decision for a person, because the answer may be "shim it" or may be
 * "that module is not portable, cut the library upstream first".
 *
 * ── WHAT IS SHIMMED, AND WHY THE SHIMS' UPSTREAM IS HASHED TOO ──
 * The translator imports the website's documentation tree (`app/lib/docs.ts`) and the module that
 * hashes and rebuilds it (`app/lib/docs-i18n.server.ts`). Those two are the documentation corpus,
 * which this app does not have, and the second one imports two committed translation memories the
 * size of the corpus. They are not copied. `scripts/lib/translate-shims/` declares the names the
 * copy refers to, with real code where the UI path needs it (`hash`, `fits`, the memory types) and
 * a throw where only the docs path would ever arrive. The upstream hash of each shimmed module is
 * recorded under `shimmed`, so a change to the real file is a changed line in the provenance at the
 * next sync, and the person syncing re-reads the shim against it rather than trusting it blind.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * SSH and not HTTPS, because `LowCarbCheck/openplate-website` is PRIVATE: an anonymous HTTPS clone
 * of it answers 404, which reads like a deleted repository rather than a missing credential. The
 * website is its own repository, so its files are named by `REPO` and a commit alone, with the
 * repository root as the folder. This script is hand-run and needs that credential; the provenance
 * test does not, because it only re-hashes the copies that are already committed here.
 */
const REPO = 'LowCarbCheck/openplate-website';
const REMOTE = `git@github.com:${REPO}.git`;
const ENV_REPO = 'OPENPLATE_WEBSITE_REPO';
const ENV_REF = 'OPENPLATE_WEBSITE_REF';
const DEFAULT_REF = 'main';
const ROOT = resolve(import.meta.dirname, '..');
const PROVENANCE = 'scripts/lib/TRANSLATE_SOURCE.json';

/** One vendored file: where it is in the website, and where the copy lands here. Both repo-relative. */
interface Copy {
  from: string;
  to: string;
}

const COPIES: Copy[] = [
  { from: 'scripts/lib/translate.ts', to: 'scripts/lib/translate.ts' },
  { from: 'scripts/lib/translate-ui.ts', to: 'scripts/lib/translate-ui.ts' },
  // The website's language model, because the glossary's `say` column is keyed by ITS translated
  // languages and the copy would not compile against this app's shorter list. The app's own
  // languages are gated in `scripts/translate-ui.ts` before the library sees a locale.
  { from: 'app/i18n/language.ts', to: 'scripts/lib/translate-language.ts' },
  // The union of two memory directories, which `.github/workflows/translate-ui.yml` runs when its
  // commit conflicts with a moved `main`. The website keeps it at `scripts/merge-memory.ts`; it
  // lands under `scripts/lib/` here so its `./lib/translate` import becomes the sibling
  // `./translate`, and its type import is served by the same shim as the rest of the library.
  { from: 'scripts/merge-memory.ts', to: 'scripts/lib/merge-memory.ts' },
];

/**
 * One import specifier the copy may not keep, and what it becomes. `from` is the specifier exactly
 * as the upstream file spells it; `to` is relative to `scripts/lib/`, where every copy lands.
 */
interface Rewrite {
  from: string;
  to: string;
}

const REWRITES: Rewrite[] = [
  { from: '../../app/i18n/language', to: './translate-language' },
  { from: '../../app/lib/docs-i18n.server', to: './translate-shims/docs-i18n.server' },
  { from: '../../app/lib/docs', to: './translate-shims/docs' },
  // The same upstream module as the entry above, spelled from `scripts/` rather than
  // `scripts/lib/`, because `merge-memory.ts` lives one directory up in the website.
  { from: '../app/lib/docs-i18n.server', to: './translate-shims/docs-i18n.server' },
];

/** The upstream modules the shims stand in for. Hashed, never copied. */
const SHIMMED = ['app/lib/docs-i18n.server.ts', 'app/lib/docs.ts'];

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * A shallow checkout of one ref. `git clone --branch` takes a branch or a tag and FAILS on a commit
 * id, and a commit id is exactly what somebody names when they re-sync at the sha the committed
 * `TRANSLATE_SOURCE.json` already records, so a full sha is fetched by hand instead.
 */
function cloneAt(options: { repo: string; ref: string; dir: string }): void {
  const { repo, ref, dir } = options;
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    execFileSync('git', ['clone', '--depth', '1', '--branch', ref, repo, dir], { stdio: 'inherit' });
    return;
  }
  execFileSync('git', ['init', '--quiet', dir], { stdio: 'inherit' });
  execFileSync('git', ['remote', 'add', 'origin', repo], { cwd: dir, stdio: 'inherit' });
  execFileSync('git', ['fetch', '--depth', '1', '--quiet', 'origin', ref], { cwd: dir, stdio: 'inherit' });
  execFileSync('git', ['checkout', '--quiet', 'FETCH_HEAD'], { cwd: dir, stdio: 'inherit' });
}

/**
 * The sha recorded is only a fact if the files copied are the files at that sha. A checkout with
 * one of them modified would write a commit id that does not describe the bytes, which is the one
 * thing a provenance file must never do. Refused, not warned about. A clone this run made cannot be
 * dirty, so this only ever guards a local checkout.
 */
function refuseDirty(dir: string): void {
  const watched = [...COPIES.map((copy) => copy.from), ...SHIMMED];
  const dirty = git(['status', '--porcelain', '--', ...watched], dir);
  if (dirty === '') return;
  throw new Error(`sync-translate-lib: ${dir} has uncommitted changes in a file this sync copies:\n${dirty}`);
}

interface Tree {
  dir: string;
  /** Whether this directory is ours to delete afterwards. */
  scratch: boolean;
  /** The commit the tree is at, which is the fact a person can re-sync against. */
  commit: string;
}

/**
 * The website repository's tree, at the ref this run copies from.
 *
 * A local checkout named by `OPENPLATE_WEBSITE_REPO` with NO ref pinned is READ WHERE IT STANDS, for
 * the case where the change you want is on the branch in front of you and nowhere else yet. Pin a
 * ref and it always clones, even from a local path. With neither variable set the private repository
 * is cloned over SSH at `main`.
 */
function websiteTree(): Tree {
  const repo = process.env[ENV_REPO] ?? REMOTE;
  const pinned = process.env[ENV_REF] ?? '';
  const isLocal = existsSync(join(repo, '.git'));

  if (isLocal && pinned === '') {
    const dir = resolve(repo);
    refuseDirty(dir);
    console.log(`sync-translate-lib: reading the checkout at ${dir}`);
    return { dir, scratch: false, commit: git(['rev-parse', 'HEAD'], dir) };
  }

  const ref = pinned === '' ? DEFAULT_REF : pinned;
  const dir = mkdtempSync(join(tmpdir(), 'openplate-website-'));
  console.log(`sync-translate-lib: cloning ${repo} at ${ref}`);
  try {
    cloneAt({ repo: isLocal ? resolve(repo) : repo, ref, dir });
    return { dir, scratch: true, commit: git(['rev-parse', 'HEAD'], dir) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** A line that imports something: `import x from '...'`, `} from '...'`, `export { x } from '...'`. */
const IMPORT_LINE = /^(\s*(?:import\b[^']*|\}|export\s*\{[^}]*\})\s+from\s+')([^']+)(';?)$/;

/**
 * The file with every import pointed at where the thing now is.
 *
 * Three kinds of specifier, and a fourth that stops the run: a `node:` builtin stays; a specifier
 * in `REWRITES` becomes its replacement; a relative import of ANOTHER COPIED FILE is re-pointed at
 * that file's new home; anything else is an import this table has never seen, and the copy would
 * not compile, so the sync says which line and exits rather than write it.
 */
function rewriteImports(options: { website: string; copy: Copy; text: string }): string {
  const { website, copy, text } = options;
  const fromDir = dirname(resolve(website, copy.from));
  const toDir = dirname(resolve(ROOT, copy.to));
  return text
    .split('\n')
    .map((line, index) => {
      const match = IMPORT_LINE.exec(line);
      if (match === null) return line;
      const [, head, specifier, tail] = match;
      if (specifier === undefined || head === undefined || tail === undefined) return line;
      if (specifier.startsWith('node:')) return line;
      const rewrite = REWRITES.find((entry) => entry.from === specifier);
      if (rewrite !== undefined) return `${head}${rewrite.to}${tail}`;
      const sibling = COPIES.find((entry) => resolve(website, entry.from) === `${resolve(fromDir, specifier)}.ts`);
      if (sibling !== undefined) return `${head}${dotted(relative(toDir, resolve(ROOT, sibling.to)))}${tail}`;
      throw new Error(
        `sync-translate-lib: ${copy.from}:${index + 1} imports '${specifier}', which REWRITES does not know. ` +
          'Decide whether it is shimmed, copied or cut upstream, then add it to the table.',
      );
    })
    .join('\n');
}

/** `translate.ts` as `./translate`: a relative specifier, with the extension off and a leading dot on. */
function dotted(path: string): string {
  const bare = path.replace(/\.ts$/, '');
  return bare.startsWith('.') ? bare : `./${bare}`;
}

interface VendoredFile {
  from: string;
  upstream: string;
  vendored: string;
}

function vendor(options: { website: string; copy: Copy }): VendoredFile {
  const { website, copy } = options;
  const source = readFileSync(resolve(website, copy.from), 'utf8');
  const rewritten = rewriteImports({ website, copy, text: source });
  mkdirSync(dirname(resolve(ROOT, copy.to)), { recursive: true });
  writeFileSync(resolve(ROOT, copy.to), rewritten, 'utf8');
  console.log(`sync-translate-lib: ${copy.from} -> ${copy.to}${rewritten === source ? '' : ' (imports rewritten)'}`);
  return { from: copy.from, upstream: sha256(source), vendored: sha256(rewritten) };
}

const tree = websiteTree();
try {
  if (!/^[0-9a-f]{40}$/.test(tree.commit)) throw new Error(`sync-translate-lib: ${tree.dir} is not a git checkout`);
  const provenance = {
    repo: REPO,
    commit: tree.commit,
    producedBy: 'openplate, scripts/sync-translate-lib.ts',
    rewrites: REWRITES,
    files: Object.fromEntries(COPIES.map((copy) => [copy.to, vendor({ website: tree.dir, copy })])),
    shimmed: Object.fromEntries(SHIMMED.map((path) => [path, sha256(readFileSync(resolve(tree.dir, path), 'utf8'))])),
  };
  writeFileSync(resolve(ROOT, PROVENANCE), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  console.log(`sync-translate-lib: ${PROVENANCE} records ${REPO}@${tree.commit.slice(0, 12)}.`);
} finally {
  if (tree.scratch) rmSync(tree.dir, { recursive: true, force: true });
}
