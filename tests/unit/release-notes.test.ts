/**
 * Tests for `scripts/release-notes.ts`, the release page body read out of CHANGELOG.md.
 *
 * The body is what an operator sees on the GitHub Release page, and nothing else writes it, so
 * each case here pins one half of the contract: what a well-formed section renders to, and which
 * malformed section stops the release with a named reason instead of publishing a page that lists
 * nothing.
 *
 * The last block reads the REPOSITORY'S OWN CHANGELOG.md, so a bullet the page could not print
 * turns the pre-push gate red on the commit that wrote it. The tag-time failure is the backstop,
 * not the gate. That block is SCOPED TO 0.20.0 AND NEWER: the grouped, bold-lead format arrived
 * with 0.20.0, and the entries below it are a flat list kept verbatim as the record of what
 * shipped. Rewriting old prose to satisfy a format introduced later would edit history for the
 * sake of a checker, so the checker is told where the format begins instead.
 *
 * Every assertion over the real file is paired with a CONTROL: the same check over a deliberately
 * broken copy, which must fail. A check that cannot fail records nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { changelogAnchor, checkUnreleased, parseSection, renderBody } from '../../scripts/release-notes';

const REPO = 'LowCarbCheck/openplate';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A section with all four groups, one bullet each. */
const FULL = `# Changelog

## [Unreleased]

## [0.23.0] - 2026-10-01

### Added

- **The diary counts fat.** It sits between protein and fiber. ([abc1234](https://github.com/LowCarbCheck/openplate/commit/abc1234))

### Changed

- **The message box grows as you write.** It used to be one line. ([aaa0001](https://github.com/LowCarbCheck/openplate/commit/aaa0001))

### Fixed

- **\`/describe\` works on a managed instance.** It looked for a key the instance keeps none of. ([def5678](https://github.com/LowCarbCheck/openplate/commit/def5678))

### Docs

- **The self-hosting page names the sync variable.** It sits beside the image tag. ([2222333](https://github.com/LowCarbCheck/openplate/commit/2222333))

## [0.22.0] - 2026-09-09

### Added

- **The first one.** ([9999999](https://github.com/LowCarbCheck/openplate/commit/9999999))
`;

const SMALL = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- **openplate ships.** The first release. ([1111111](https://github.com/LowCarbCheck/openplate/commit/1111111))
`;

describe('parseSection', () => {
  it('reads the four groups in their fixed order, whatever order the file lists them in', () => {
    const scrambled = `# Changelog

## [0.23.0] - 2026-10-01

### Docs

- **A doc line.** Detail. ([1111111](x))

### Fixed

- **A fix line.** Detail. ([2222222](x))

### Added

- **An added line.** Detail. ([3333333](x))
`;
    const section = parseSection({ changelog: scrambled, version: '0.23.0' });
    assert.equal(section.date, '2026-10-01');
    assert.deepEqual(
      section.groups.map((group) => group.name),
      ['Added', 'Fixed', 'Docs'],
    );
  });

  it('reads every group of a full section', () => {
    const section = parseSection({ changelog: FULL, version: '0.23.0' });
    assert.deepEqual(
      section.groups.map((group) => group.name),
      ['Added', 'Changed', 'Fixed', 'Docs'],
    );
  });

  it('a lead keeps its backticks and loses its asterisks', () => {
    const section = parseSection({ changelog: FULL, version: '0.23.0' });
    const fixed = section.groups.find((group) => group.name === 'Fixed');
    assert.deepEqual(fixed?.leads, ['`/describe` works on a managed instance.']);
    for (const group of section.groups) {
      for (const lead of group.leads) assert.ok(!lead.includes('**'), `lead still bold: ${lead}`);
    }
  });

  it('a missing version heading fails', () => {
    assert.throws(() => parseSection({ changelog: FULL, version: '3.0.0' }), /no '## \[3\.0\.0\]/);
  });

  it('a heading with no date is not a section', () => {
    const undated = FULL.replace('## [0.23.0] - 2026-10-01', '## [0.23.0]');
    assert.throws(() => parseSection({ changelog: undated, version: '0.23.0' }), /no '## \[0\.23\.0\]/);
  });

  it('a bullet with no bold lead fails', () => {
    const bad = FULL.replace('- **The diary counts fat.**', '- The diary counts fat.');
    assert.throws(() => parseSection({ changelog: bad, version: '0.23.0' }), /no bold lead sentence/);
  });

  it('a bold lead that is never closed fails', () => {
    const bad = FULL.replace('- **The diary counts fat.**', '- **The diary counts fat.');
    assert.throws(() => parseSection({ changelog: bad, version: '0.23.0' }), /never closed/);
  });

  it('a bullet above every group heading fails', () => {
    const bad = FULL.replace(
      '### Added\n\n- **The diary counts fat.**',
      '- **A stray bullet.** No group owns it.\n\n### Added\n\n- **The diary counts fat.**',
    );
    assert.throws(() => parseSection({ changelog: bad, version: '0.23.0' }), /above every '### ' group heading/);
  });

  it('an unknown group heading fails', () => {
    const bad = FULL.replace('### Docs', '### Security');
    assert.throws(() => parseSection({ changelog: bad, version: '0.23.0' }), /unknown group heading '### Security'/);
  });

  it('a CRLF file reads exactly like an LF one', () => {
    const crlf = FULL.replaceAll('\n', '\r\n');
    assert.deepEqual(
      parseSection({ changelog: crlf, version: '0.23.0' }),
      parseSection({ changelog: FULL, version: '0.23.0' }),
    );
  });

  it('a prerelease heading is found and dated', () => {
    const beta = SMALL.replace('## [1.0.0] - 2026-01-01', '## [0.23.0-beta.1] - 2026-10-01');
    const section = parseSection({ changelog: beta, version: '0.23.0-beta.1' });
    assert.equal(section.date, '2026-10-01');
    assert.deepEqual(section.groups[0]?.leads, ['openplate ships.']);
  });
});

describe('checkUnreleased', () => {
  it('an empty Unreleased section is well formed', () => {
    assert.deepEqual(checkUnreleased(FULL), []);
  });

  it('a well-formed bullet under a group passes', () => {
    const filled = FULL.replace(
      '## [Unreleased]\n',
      '## [Unreleased]\n\n### Fixed\n\n- **A thing is fixed.** The detail follows here.\n',
    );
    assert.deepEqual(checkUnreleased(filled), [{ name: 'Fixed', leads: ['A thing is fixed.'] }]);
  });

  it('a bullet with no bold lead fails, and the message names the section', () => {
    const bad = FULL.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- a thing is fixed\n');
    assert.throws(() => checkUnreleased(bad), /\[Unreleased\]/);
    assert.throws(() => checkUnreleased(bad), /no bold lead sentence/);
  });

  it('a bullet above every group heading fails', () => {
    const bad = FULL.replace('## [Unreleased]\n', '## [Unreleased]\n\n- **A thing is fixed.** No group owns it.\n');
    assert.throws(() => checkUnreleased(bad), /above every '### ' group heading/);
  });

  it('an unknown group heading fails', () => {
    const bad = FULL.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Removed\n');
    assert.throws(() => checkUnreleased(bad), /unknown group heading '### Removed'/);
  });
});

describe('changelogAnchor', () => {
  // GitHub's slugger lowercases, drops every character that is not a letter, a digit, a space or
  // a hyphen, then turns each remaining space into a hyphen. The heading text is
  // `[x.y.z] - YYYY-MM-DD`, so the brackets and the dots go and the three spaces become three
  // hyphens. A prerelease loses only its dot; the hyphen in `-beta.1` was already legal.
  it('drops the dots and joins the date with three hyphens', () => {
    assert.equal(changelogAnchor({ version: '0.22.0', date: '2026-09-09' }), '0220---2026-09-09');
  });

  it('a prerelease keeps its hyphen and loses its dots', () => {
    assert.equal(changelogAnchor({ version: '0.23.0-beta.1', date: '2026-10-01' }), '0230-beta1---2026-10-01');
  });
});

describe('renderBody', () => {
  it('the whole body for a version with all four groups and a previous tag', () => {
    const body = renderBody({
      changelog: FULL,
      version: '0.23.0',
      repo: REPO,
      tag: 'v0.23.0',
      previousTag: 'v0.22.0',
    });
    assert.equal(
      body,
      `## What changed

**Added**

- The diary counts fat.

**Changed**

- The message box grows as you write.

**Fixed**

- \`/describe\` works on a managed instance.

**Docs**

- The self-hosting page names the sync variable.

Full detail with commits: [0.23.0 in the changelog](https://github.com/LowCarbCheck/openplate/blob/v0.23.0/CHANGELOG.md#0230---2026-10-01)

Compare: [v0.22.0...v0.23.0](https://github.com/LowCarbCheck/openplate/compare/v0.22.0...v0.23.0)
`,
    );
  });

  it('no previous tag means no compare line', () => {
    const body = renderBody({ changelog: SMALL, version: '1.0.0', repo: REPO, tag: 'v1.0.0' });
    assert.ok(!body.includes('Compare:'), body);
    assert.ok(body.includes('Full detail with commits: [1.0.0 in the changelog]'), body);
  });

  it('the page opens on what changed, with no update instructions', () => {
    // openplate is self-hosted: nobody reading this page runs a command to update. The control is
    // the assertion below it, which would catch an intro line creeping back in above the heading.
    const body = renderBody({ changelog: FULL, version: '0.23.0', repo: REPO, tag: 'v0.23.0' });
    assert.ok(body.startsWith('## What changed\n'), body.slice(0, 80));
    assert.ok(!body.includes('## Update'), body);
  });

  it('only the groups that have content are printed', () => {
    const body = renderBody({ changelog: SMALL, version: '1.0.0', repo: REPO, tag: 'v1.0.0' });
    assert.ok(body.includes('**Added**'), body);
    for (const absent of ['**Changed**', '**Fixed**', '**Docs**']) {
      assert.ok(!body.includes(absent), `${absent} printed with no bullets`);
    }
  });
});

// ---- The repository's own CHANGELOG -------------------------------------------------------------
// Not a fixture: the real file, so a badly formed bullet is red on the commit that wrote it rather
// than at tag time, when the release is already being published.

/** The lowest version the grouped, bold-lead format applies to. Everything below it is history. */
const FORMAT_BEGINS_AT = [0, 20, 0];

interface VersionHeading {
  version: string;
  date: string;
}

function versionParts(version: string): number[] {
  return (
    version
      .split('-')[0]
      ?.split('.')
      .map((part) => Number(part)) ?? []
  );
}

function isAtLeastFormatStart(version: string): boolean {
  const parts = versionParts(version);
  for (let i = 0; i < FORMAT_BEGINS_AT.length; i++) {
    const mine = parts[i] ?? 0;
    const floor = FORMAT_BEGINS_AT[i] ?? 0;
    if (mine !== floor) return mine > floor;
  }
  return true;
}

/** Every `## [x.y.z] - YYYY-MM-DD` heading in a changelog, newest first, as the file lists them. */
function versionHeadings(changelog: string): VersionHeading[] {
  const found: VersionHeading[] = [];
  for (const line of changelog.split('\n')) {
    const match = /^## \[(\d[^\]]*)\](.*)$/.exec(line);
    if (!match) continue;
    const rest = match[2] ?? '';
    const dated = / - (\d{4}-\d{2}-\d{2})\s*$/.exec(rest);
    found.push({ version: match[1] ?? '', date: dated?.[1] ?? '' });
  }
  return found;
}

/** Every complaint about a changelog, from 0.20.0 up. An empty list is a well-formed file. */
function complaintsAboutRecentVersions(changelog: string): string[] {
  const complaints: string[] = [];
  const headings = versionHeadings(changelog).filter((heading) => isAtLeastFormatStart(heading.version));
  if (headings.length === 0) complaints.push('no version heading at or above 0.20.0');

  for (const heading of headings) {
    if (heading.date === '') {
      complaints.push(`${heading.version}: the heading carries no YYYY-MM-DD date`);
      continue;
    }
    try {
      const section = parseSection({ changelog, version: heading.version });
      if (section.groups.length === 0) complaints.push(`${heading.version}: no '### ' group at all`);
      for (const group of section.groups) {
        if (group.leads.length === 0) complaints.push(`${heading.version}: '### ${group.name}' has no bullet`);
        for (const lead of group.leads) {
          if (!lead.endsWith('.')) complaints.push(`${heading.version}: a lead does not end in a period: ${lead}`);
        }
      }
    } catch (error) {
      complaints.push(`${heading.version}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return complaints;
}

describe("the repository's CHANGELOG.md", () => {
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');

  it('carries exactly one [Unreleased] heading', () => {
    assert.equal(changelog.split('\n').filter((line) => line.startsWith('## [Unreleased]')).length, 1);
  });

  it('every bullet under [Unreleased] is grouped and has a bold lead', () => {
    assert.doesNotThrow(() => checkUnreleased(changelog));
  });

  it('every version from 0.20.0 up is dated, grouped, and opens each bullet with a bold lead', () => {
    assert.deepEqual(complaintsAboutRecentVersions(changelog), []);
  });

  it('the check it just passed can fail: four ways of breaking the real file', () => {
    // The control for the assertion above. Without it, a checker that silently found no version to
    // inspect, or swallowed its own error, would report a green file forever.
    const newest = versionHeadings(changelog).find((heading) => isAtLeastFormatStart(heading.version));
    assert.ok(newest, 'no version at or above 0.20.0 to break');

    // Break the file BELOW the [Unreleased] heading. The mutations here each hit the first match in
    // the string, and the checker under test deliberately ignores [Unreleased], so a mutation
    // anchored at the top of the whole file would land on an Unreleased bullet as soon as one
    // exists, change nothing the checker looks at, and this control would fail while the checker
    // was fine. Every version at or above 0.20.0 is still inside this slice.
    const recent = changelog.slice(changelog.indexOf(`## [${newest.version}]`));

    const undated = recent.replace(`## [${newest.version}] - ${newest.date}`, `## [${newest.version}]`);
    assert.notDeepEqual(complaintsAboutRecentVersions(undated), []);

    const unled = recent.replace(/^- \*\*/m, '- ');
    assert.notDeepEqual(complaintsAboutRecentVersions(unled), []);

    const ungrouped = recent.replace(/^### Added$/m, '### Security');
    assert.notDeepEqual(complaintsAboutRecentVersions(ungrouped), []);

    const unpunctuated = recent.replace(/^- \*\*([^*]+)\.\*\*/m, '- **$1**');
    assert.notDeepEqual(complaintsAboutRecentVersions(unpunctuated), []);
  });

  it("the newest version's body renders and links its own anchor", () => {
    const newest = versionHeadings(changelog).find((heading) => isAtLeastFormatStart(heading.version));
    assert.ok(newest);
    const body = renderBody({ changelog, version: newest.version, repo: REPO, tag: `v${newest.version}` });
    assert.ok(body.includes(`CHANGELOG.md#${changelogAnchor({ version: newest.version, date: newest.date })}`), body);
  });
});
