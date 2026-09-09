/**
 * release-notes, the GitHub Release page's body, generated from CHANGELOG.md.
 *
 *   pnpm exec tsx scripts/release-notes.ts --version 0.22.0 --repo LowCarbCheck/openplate --tag v0.22.0
 *   pnpm exec tsx scripts/release-notes.ts --version 0.22.0 --repo LowCarbCheck/openplate --tag v0.22.0 \
 *     --previous-tag v0.21.0 --changelog CHANGELOG.md
 *
 * Prints the body to stdout. `.github/workflows/release-image.yml` redirects it into the file
 * `gh release create --notes-file` reads.
 *
 * THE FILE IT READS: a version's section groups its bullets under `### Added`, `### Changed`,
 * `### Fixed` and `### Docs`, and every bullet opens with a bold lead sentence
 * (`- **Lead sentence.** detail ...`). The page lists the leads, one line per bullet, under the
 * group's name, and links the changelog for the detail. That is the whole reason the lead is bold
 * and short: it is the release page's own sentence, written once.
 *
 * NO UPDATE BLOCK. openplate is a self-hosted web application: nobody reading this page runs a
 * command to update, an operator pins a new image tag and the people using that instance get the
 * new bundle. So the page opens on what changed, and carries no instructions.
 *
 * Exits 1, with the reason on stderr, when the section cannot be read that way: no heading for the
 * version, a bullet with no bold lead, a bullet sitting above any group heading, or a group
 * heading that is not one of the four. A release page that silently lists nothing is worse than a
 * workflow step that stops and says which bullet is wrong.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The four group headings, in the order the release page prints them. */
export const GROUPS = ['Added', 'Changed', 'Fixed', 'Docs'] as const;

export type GroupName = (typeof GROUPS)[number];

export interface Group {
  name: GroupName;
  /** One lead per bullet, in the order the changelog lists them, `**` already stripped. */
  leads: string[];
}

export interface Section {
  version: string;
  /** The `YYYY-MM-DD` the heading carries. */
  date: string;
  groups: Group[];
}

function isGroupName(name: string): name is GroupName {
  return GROUPS.some((group) => group === name);
}

/**
 * The file's lines, with a trailing `\r` dropped. A CHANGELOG edited on Windows, or fetched
 * through a tool that normalises line endings on the way in, arrives CRLF; every check below
 * anchors on the end of a line, so one stray `\r` would turn a well-formed bullet into a refusal.
 */
function toLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

interface RawSection {
  /** The `YYYY-MM-DD` the heading carries. */
  date: string;
  /** Every line below the heading, up to the next `## ` heading. */
  lines: string[];
}

/**
 * The lines of `## [version] - date`'s section, and the date out of that heading. The section runs
 * from its own heading to the next `## ` heading, or to the end of the file.
 */
function sectionLines({ changelog, version }: { changelog: string; version: string }): RawSection {
  const lines = toLines(changelog);
  const headingPattern = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const match = headingPattern.exec(lines[i] ?? '');
    if (!match) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (line.startsWith('## ')) break;
      body.push(line);
    }
    return { date: match[1] ?? '', lines: body };
  }
  throw new Error(
    `CHANGELOG has no '## [${version}] - YYYY-MM-DD' heading. ` +
      `The release page is built from that section, so there is nothing to publish.`,
  );
}

/** The bold lead of a bullet line, with the asterisks removed and everything else kept. */
function leadOf({ line, where }: { line: string; where: string }): string {
  if (!line.startsWith('- **')) {
    throw new Error(
      `CHANGELOG ${where}: a bullet has no bold lead sentence.\n  ${line}\n` +
        `  Expected: - **Lead sentence.** detail text ... ([abc1234](link))`,
    );
  }
  const end = line.indexOf('**', 4);
  if (end === -1) {
    throw new Error(
      `CHANGELOG ${where}: a bullet's bold lead is never closed.\n  ${line}\n` +
        `  Expected: - **Lead sentence.** detail text ... ([abc1234](link))`,
    );
  }
  return line.slice(4, end).trim();
}

/**
 * Reads a section's lines into its groups. Throws with the reason when the section is malformed.
 * `where` names the section in the message, so a failure says which one it read.
 */
function groupsOf({ lines, where }: { lines: string[]; where: string }): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      const name = line.slice(4).trim();
      if (!isGroupName(name)) {
        throw new Error(`CHANGELOG ${where}: unknown group heading '### ${name}'. The four are: ${GROUPS.join(', ')}.`);
      }
      current = { name, leads: [] };
      groups.push(current);
      continue;
    }
    if (!line.startsWith('- ')) continue;
    if (!current) {
      throw new Error(
        `CHANGELOG ${where}: a bullet sits above every '### ' group heading.\n  ${line}\n` +
          `  Put it under one of: ${GROUPS.join(', ')}.`,
      );
    }
    current.leads.push(leadOf({ line, where }));
  }

  return groups.toSorted((a, b) => GROUPS.indexOf(a.name) - GROUPS.indexOf(b.name));
}

/** Reads one version's section into its groups. Throws with the reason when it is malformed. */
export function parseSection({ changelog, version }: { changelog: string; version: string }): Section {
  const { date, lines } = sectionLines({ changelog, version });
  return { version, date, groups: groupsOf({ lines, where: version }) };
}

/**
 * The same check over `## [Unreleased]`, which has no date and so no `parseSection`. This is what
 * the pre-push gate runs, so a bullet the release page could not print turns the push red on the
 * commit that wrote it, days before anyone pushes a tag. Throws with the reason, returns the
 * parsed groups when the section is well formed (an empty section is well formed).
 */
export function checkUnreleased(changelog: string): Group[] {
  const lines = toLines(changelog);
  const body: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.startsWith('## [Unreleased]')) {
      inside = true;
      continue;
    }
    if (line.startsWith('## ')) inside = false;
    if (inside) body.push(line);
  }
  return groupsOf({ lines: body, where: '[Unreleased]' });
}

/**
 * GitHub's anchor for a `## [x.y.z] - YYYY-MM-DD` heading. Its slugger lowercases the heading
 * text, removes every character that is not a letter, a digit, a space or a hyphen, and then
 * turns each remaining space into a hyphen. So `[0.22.0] - 2026-09-09` loses its brackets and its
 * dots, and its three spaces become three hyphens: `0220---2026-09-09`. A prerelease keeps the
 * hyphen it already carries and loses only the dot, so `[0.23.0-beta.1] - 2026-10-01` becomes
 * `0230-beta1---2026-10-01`.
 */
export function changelogAnchor({ version, date }: { version: string; date: string }): string {
  return `${version.replaceAll('.', '')}---${date}`;
}

export interface ReleaseBodyRequest {
  changelog: string;
  version: string;
  /** `owner/name`, as `GITHUB_REPOSITORY` spells it. */
  repo: string;
  tag: string;
  /**
   * A real tag on the remote, or nothing. It is NOT derived from the CHANGELOG: a heading can
   * exist for a version that was cut and never tagged, and a heading-derived compare link would
   * then point at a ref that does not exist and 404. The workflow asks git for the tag before this
   * commit and passes what git answers.
   */
  previousTag?: string | null;
}

/** The whole release page body for one version. */
export function renderBody({ changelog, version, repo, tag, previousTag = null }: ReleaseBodyRequest): string {
  const section = parseSection({ changelog, version });
  const anchor = changelogAnchor({ version, date: section.date });
  const lines: string[] = ['## What changed', ''];

  for (const group of section.groups) {
    if (group.leads.length === 0) continue;
    lines.push(`**${group.name}**`, '');
    for (const lead of group.leads) lines.push(`- ${lead}`);
    lines.push('');
  }

  lines.push(
    `Full detail with commits: [${version} in the changelog](https://github.com/${repo}/blob/${tag}/CHANGELOG.md#${anchor})`,
    '',
  );

  if (previousTag) {
    lines.push(`Compare: [${previousTag}...${tag}](https://github.com/${repo}/compare/${previousTag}...${tag})`, '');
  }

  return lines.join('\n');
}

// ---- CLI ---------------------------------------------------------------------------------------

function flag(argv: string[], name: string): string | null {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return null;
  return argv[at + 1] ?? null;
}

function main(argv: string[]): void {
  const version = flag(argv, 'version');
  const repo = flag(argv, 'repo');
  const tag = flag(argv, 'tag');
  const previousTag = flag(argv, 'previous-tag');
  const changelogPath = flag(argv, 'changelog') ?? 'CHANGELOG.md';

  if (!version || !repo || !tag) {
    console.error(
      'usage: tsx scripts/release-notes.ts --version 0.22.0 --repo LowCarbCheck/openplate --tag v0.22.0 ' +
        '[--previous-tag v0.21.0] [--changelog CHANGELOG.md]',
    );
    process.exit(1);
  }

  try {
    const changelog = readFileSync(changelogPath, 'utf8');
    process.stdout.write(renderBody({ changelog, version, repo, tag, previousTag: previousTag || null }));
  } catch (error) {
    console.error(`release-notes failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Run only when this file is the entry point. The test imports the exports above, and an
 * unconditional `main()` would exit(1) the test run on its usage check.
 */
const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
