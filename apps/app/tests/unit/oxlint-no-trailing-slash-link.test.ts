/**
 * `openplate/no-trailing-slash-link`: a link to our own sites never ends its path in a slash.
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────
 *
 * openplate.de names the slashless address (canonical link, hreflang, sitemap) and nginx 301s any
 * slash address to it, so a link with a slash costs a hop and names a non-canonical page. The app
 * linked `https://openplate.de/en/` for a week after the site dropped the slash. The rule keeps
 * that from coming back; this file keeps the RULE from going quiet.
 *
 * ── HOW IT IS TESTED ─────────────────────────────────────────────────────
 *
 * Through the real oxlint CLI, with the real plugin, over a fixture written to a temp directory.
 * A rule unit-tested against hand-built AST nodes would pass while the plugin was never loaded, or
 * while the visitor key had a typo. Every case below is ONE line of the fixture, so the assertion
 * is exact: the lines oxlint flags must be the lines marked `bad`, each reported once. A `fine`
 * case is the contrast for its `bad` neighbour (the German home next to `/en/`, `/docs/x` next to
 * `/docs/x/`), so a rule that flagged every URL, or none, fails one half.
 *
 * THE CONTROL is the last suite: a fixture that must produce exactly three diagnostics, and a
 * clean one that must produce none, so the harness itself is proven able to see a violation and
 * able to see none.
 *
 * Nothing runs from inside the temp directory: oxlint is started from the app directory and is
 * handed the fixture path as an argument.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const OXLINT_BIN = join(APP_DIR, 'node_modules', 'oxlint', 'bin', 'oxlint');
const PLUGIN_INDEX = join(APP_DIR, 'tools', 'oxlint', 'openplate', 'index.ts');

/** The part of `oxlint --format json` this file reads. */
const OXLINT_JSON = z.object({
  diagnostics: z.array(
    z.object({
      message: z.string(),
      code: z.string(),
      labels: z.array(z.object({ span: z.object({ line: z.number() }) })),
    }),
  ),
});

interface Diagnostic {
  message: string;
  code: string;
  line: number;
}

interface LintRun {
  status: number | null;
  diagnostics: Diagnostic[];
}

/** One line of a fixture, and whether the rule must flag it. */
interface Case {
  readonly name: string;
  readonly source: string;
  readonly verdict: 'bad' | 'fine';
}

const bad = (name: string, source: string): Case => ({ name, source, verdict: 'bad' });
const fine = (name: string, source: string): Case => ({ name, source, verdict: 'fine' });

let scratchDir = '';
let configPath = '';

function writeFixture(fileName: string, lines: readonly string[]): string {
  const path = join(scratchDir, fileName);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function lintFixture(path: string): LintRun {
  const result = spawnSync(
    process.execPath,
    [OXLINT_BIN, '--config', configPath, '--disable-nested-config', '--format', 'json', path],
    { cwd: APP_DIR, encoding: 'utf8' },
  );
  assert.equal(result.error, undefined, 'oxlint did not start');
  const parsed = OXLINT_JSON.parse(JSON.parse(result.stdout));
  const diagnostics = parsed.diagnostics.map((entry) => ({
    message: entry.message,
    code: entry.code,
    line: entry.labels[0]?.span.line ?? 0,
  }));
  return { status: result.status, diagnostics };
}

/** Runs a list of cases as a fixture and checks that exactly the `bad` lines are flagged, once each. */
function describeCases(options: {
  readonly title: string;
  readonly file: string;
  readonly cases: readonly Case[];
}): void {
  const { title, file, cases } = options;
  describe(title, () => {
    let run: LintRun = { status: null, diagnostics: [] };

    before(() => {
      run = lintFixture(
        writeFixture(
          file,
          cases.map((entry) => entry.source),
        ),
      );
    });

    cases.forEach((entry, index) => {
      const line = index + 1;
      it(`${entry.verdict === 'bad' ? 'flags' : 'leaves alone'} ${entry.name}: ${entry.source}`, () => {
        const flagged = run.diagnostics.filter((diagnostic) => diagnostic.line === line);
        assert.deepEqual(
          flagged.map((diagnostic) => diagnostic.code),
          entry.verdict === 'bad' ? ['openplate(no-trailing-slash-link)'] : [],
        );
      });
    });

    it('flags nothing but the bad lines, so no case is hiding in the count', () => {
      const badCount = cases.filter((entry) => entry.verdict === 'bad').length;
      assert.equal(badCount > 0 && badCount < cases.length, true, 'the file needs both kinds of case');
      assert.equal(run.diagnostics.length, badCount);
      assert.equal(run.status, 1);
    });
  });
}

describe('openplate/no-trailing-slash-link', () => {
  before(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'openplate-lint-'));
    configPath = join(scratchDir, 'oxlintrc.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        categories: { correctness: 'off' },
        plugins: [],
        jsPlugins: [{ name: 'openplate', specifier: PLUGIN_INDEX }],
        rules: { 'openplate/no-trailing-slash-link': 'error' },
      }),
    );
  });

  after(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  describeCases({
    title: 'position 1: an absolute URL on one of our hosts, in any string or template',
    file: 'position-1.tsx',
    cases: [
      bad('the English home with a slash', "use('https://openplate.de/en/');"),
      bad('a docs page with a slash and a fragment', "use('https://openplate.de/en/docs/app/x/#frag');"),
      bad('a docs page with a slash and a query', "use('https://openplate.de/en/docs/app/x/?a=1');"),
      bad('the www host', "use('https://www.openplate.de/pricing/');"),
      bad('the app host', "use('https://app.openplate.de/settings/');"),
      bad('the api host', "use('https://api.openplate.de/v1/health/');"),
      bad('plain http', "use('http://openplate.de/en/');"),
      bad('a host in capitals', "use('https://OpenPlate.de/en/');"),
      bad('a static template', 'use(`https://openplate.de/en/`);'),
      bad('a template with an expression and a slash last', 'use(`https://openplate.de/${language}/docs/`);'),
      bad('a template with an expression right after the host', 'use(`https://openplate.de${path}/x/`);'),
      fine('the German home, the bare origin plus a slash', "use('https://openplate.de/');"),
      fine('the prefixed home, the bare prefix', "use('https://openplate.de/en');"),
      fine('the bare origin', "use('https://openplate.de');"),
      fine('a slashless page with a fragment', "use('https://openplate.de/en/docs/app/x#frag');"),
      fine('a slashless page with a query', "use('https://openplate.de/en/docs/app/x?a=1');"),
      fine('a file name', "use('https://openplate.de/latest.json');"),
      fine('a slash that sits in the query', "use('https://openplate.de/en?next=/');"),
      fine('a slash that sits in the fragment', "use('https://openplate.de/en#/');"),
      fine('another host with a slash', "use('https://example.com/en/');"),
      fine('a host that only starts like ours', "use('https://openplate.de.example.com/en/');"),
      fine('a host that only ends like ours', "use('https://notopenplate.de/en/');"),
      fine('a repository link', "use('https://github.com/LowCarbCheck/openplate/');"),
      fine('a protocol-relative URL', "use('//openplate.de/en/');"),
      fine('a root-relative path outside the four positions', "use('/en/');"),
      fine('a file system path', "use('/var/www/openplate.de/');"),
      fine('a relative path', "use('docs/app/');"),
      fine('a template that ends in an expression', 'use(`https://openplate.de/en/${slug}`);'),
      fine('a template whose slash is in the query', 'use(`https://openplate.de/en?next=${next}/`);'),
      fine('a template whose last piece is only a slash', 'use(`https://openplate.de/${language}/`);'),
      fine(
        'a template that starts with an expression, outside the four positions',
        'use(`${PROJECT_SITE_URL}/docs/x/`);',
      ),
      fine('a regular expression', 'use(/https:\\/\\/openplate\\.de\\/en\\//u);'),
      fine('an import specifier', "import 'https://openplate.de/en/';"),
      fine('an export-all specifier', "export * from 'https://openplate.de/en/';"),
      fine('a dynamic import specifier', "use(import('https://openplate.de/en/'));"),
    ],
  });

  describeCases({
    title: 'position 2: to and href on a JSX element',
    file: 'position-2.tsx',
    cases: [
      bad('a quoted `to`', 'use(<A to="/pricing/" />);'),
      bad('a quoted `href` with a fragment', 'use(<a href="/docs/x/#a" />);'),
      bad('a quoted `to` with a query', 'use(<A to="/pricing/?plan=yearly" />);'),
      bad('a string in a container', "use(<A to={'/pricing/'} />);"),
      bad('a static template in a container', 'use(<A to={`/pricing/`} />);'),
      bad('a string under `as const`', "use(<A to={'/pricing/' as const} />);"),
      bad('an absolute URL on our host', 'use(<a href="https://openplate.de/en/" />);'),
      bad('a template that starts with the site address', 'use(<a href={`${PROJECT_SITE_URL}/docs/x/`} />);'),
      bad('a template that starts with a path and ends in a slash', 'use(<A to={`/docs/${slug}/more/`} />);'),
      fine('the home path', 'use(<A to="/" />);'),
      fine('a slashless path', 'use(<A to="/pricing" />);'),
      fine('the home path with a query', 'use(<A to="/?from=a/" />);'),
      fine('the home path with a fragment', 'use(<A to="/#top" />);'),
      fine('a slash that sits in the query', 'use(<A to="/pricing?next=/" />);'),
      fine('a protocol-relative path', 'use(<A to="//cdn.example.com/x/" />);'),
      fine('another host', 'use(<a href="https://example.com/x/" />);'),
      fine('a relative path', 'use(<A to="pricing/" />);'),
      fine('a path that ends in an expression', 'use(<A to={`/docs/${slug}`} />);'),
      fine('a path whose last piece is only a slash', 'use(<A to={`/docs/${slug}/`} />);'),
      fine('an origin that is an expression', 'use(<A to={`${base}/`} />);'),
      fine('a loopback stub that starts with an expression', 'use(<a href={`${localStubOrigin}/matomo/`} />);'),
      fine('a value that is not a string', 'use(<A to={path} />);'),
      fine('another attribute', 'use(<A src="/pricing/" />);'),
      fine('a class name', 'use(<A className="/pricing/" />);'),
    ],
  });

  describeCases({
    title: 'position 3: the path argument of projectSiteUrl and useProjectSiteUrl',
    file: 'position-3.tsx',
    cases: [
      bad('projectSiteUrl, second argument', "use(projectSiteUrl(language, '/docs/x/'));"),
      bad('projectSiteUrl with a fragment', "use(projectSiteUrl(language, '/docs/x/#a'));"),
      bad('projectSiteUrl with a static template', 'use(projectSiteUrl(language, `/docs/x/`));'),
      bad('projectSiteUrl under satisfies', "use(projectSiteUrl(language, '/docs/x/' satisfies ProjectSitePath));"),
      bad('useProjectSiteUrl, first argument', "use(useProjectSiteUrl('/docs/x/'));"),
      fine('projectSiteUrl with the home path', "use(projectSiteUrl(language, '/'));"),
      fine('projectSiteUrl with a slashless path', "use(projectSiteUrl(language, '/docs/x'));"),
      fine('projectSiteUrl with a slashless path and a fragment', "use(projectSiteUrl(language, '/docs/x#a'));"),
      fine('useProjectSiteUrl with the home path', "use(useProjectSiteUrl('/'));"),
      fine('useProjectSiteUrl with a slashless path', "use(useProjectSiteUrl('/docs/x'));"),
      fine('projectSiteUrl, a slash in the FIRST argument', "use(projectSiteUrl('/docs/x/', language));"),
      fine('useProjectSiteUrl, a slash in the SECOND argument', "use(useProjectSiteUrl(language, '/docs/x/'));"),
      fine('another function with a path', "use(otherFunction(language, '/docs/x/'));"),
    ],
  });

  describeCases({
    title: 'position 4: a const or let named _PATH, _URL or _HREF',
    file: 'position-4.tsx',
    cases: [
      bad('a _PATH const', "const A1_PATH = '/docs/x/';"),
      bad('a _URL let with a fragment', "let B1_URL = '/docs/x/#a';"),
      bad('a _HREF const with an absolute URL', "const C1_HREF = 'https://openplate.de/en/';"),
      bad('an exported const on the app host', "export const D1_URL = 'https://app.openplate.de/x/';"),
      bad('a template that starts with the site address', 'const E1_URL = `${PROJECT_SITE_URL}/docs/x/`;'),
      bad('a static template', 'const F1_PATH = `/docs/x/`;'),
      bad('a path under satisfies', "const G1_PATH = '/docs/x/' satisfies ProjectSitePath;"),
      bad('a path under as const', "const H1_PATH = '/docs/x/' as const;"),
      fine('the home path', "const A2_PATH = '/';"),
      fine('a slashless path', "const B2_PATH = '/docs/x';"),
      fine('a slashless path with a fragment', "const C2_PATH = '/docs/x#a';"),
      fine('a var, which is not const or let', "var D2_PATH = '/docs/x/';"),
      fine('a protocol-relative path', "const E2_PATH = '//cdn.example.com/x/';"),
      fine('a name that does not end like an address', "const docsPath = '/docs/x/';"),
      fine('another suffix', "const F2_FILE = '/docs/x/';"),
      fine('another host', "const G2_URL = 'https://example.com/x/';"),
      fine('a loopback stub that starts with an expression', 'const H2_URL = `${localStubOrigin}/matomo/`;'),
      fine('a path whose last piece is only a slash', 'const I2_PATH = `/docs/${slug}/`;'),
      fine('a relative path', "const J2_PATH = 'docs/x/';"),
      fine('a path that is not written out', 'const K2_PATH = buildPath();'),
    ],
  });

  describe('the message', () => {
    it('names the link as written and the slashless form to use', () => {
      const run = lintFixture(
        writeFixture('message.tsx', [
          "use('https://openplate.de/en/docs/app/x/#frag');",
          "use(<A to='/pricing/?plan=yearly' />);",
          'use(<a href={`${PROJECT_SITE_URL}/docs/x/`} />);',
        ]),
      );
      const quoted = run.diagnostics.map((diagnostic) =>
        /`([^`]+)`[^`]*`([^`]+)`\.$/u.exec(diagnostic.message)?.slice(1),
      );
      // The fixed form is asserted outright. The written form is asserted as the fixed form plus the one
      // slash that ends its path, so this file carries no slash-form address as a literal of its own.
      assert.deepEqual(
        quoted.map((pair) => pair?.[1]),
        ['https://openplate.de/en/docs/app/x#frag', '/pricing?plan=yearly', '${...}/docs/x'],
      );
      for (const pair of quoted) {
        const [written = '', fixed = ''] = pair ?? [];
        assert.notEqual(written, fixed);
        assert.equal(written.replace(/\/(?=[?#]|$)/u, ''), fixed);
      }
      for (const diagnostic of run.diagnostics) {
        assert.doesNotMatch(diagnostic.message, /[\u2013\u2014]/u, 'no em or en dash in a message');
      }
    });
  });

  describe('THE CONTROL: the harness can see a violation, and can see none', () => {
    it('reports exactly three diagnostics for a fixture with three violations, and exits 1', () => {
      const run = lintFixture(
        writeFixture('control-bad.tsx', [
          "use('https://openplate.de/a/');",
          'use(<A to="/b/" />);',
          "const C_PATH = '/c/';",
        ]),
      );
      assert.equal(run.diagnostics.length, 3);
      assert.deepEqual(
        run.diagnostics.map((diagnostic) => diagnostic.line),
        [1, 2, 3],
      );
      assert.equal(run.status, 1);
    });

    it('reports nothing for a fixture of correct links, and exits 0', () => {
      const run = lintFixture(
        writeFixture('control-clean.tsx', [
          "use('https://openplate.de/');",
          "use('https://openplate.de/en');",
          'use(<A to="/b" />);',
          "const C_PATH = '/c';",
        ]),
      );
      assert.deepEqual(run.diagnostics, []);
      assert.equal(run.status, 0);
    });
  });
});
