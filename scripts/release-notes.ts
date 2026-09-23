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
 * A LEAD KEEPS ITS CREDIT. When a bullet's detail credits someone ("Thanks @x (#12).", "Reported
 * by @y (#34)."), the page line ends with that credit, so a reader sees who did what, and the
 * @mention is what makes GitHub draw the release's Contributors avatars. See `creditsOf` for which
 * @ counts.
 *
 * NO UPDATE BLOCK. openplate is a self-hosted web application: nobody reading this page runs a
 * command to update, an operator pins a new image tag and the people using that instance get the
 * new bundle. So the page opens on what changed, and carries no instructions.
 *
 * Exits 1, with the reason on stderr, when the section cannot be read that way: no heading for the
 * version, a bullet with no bold lead, a bullet sitting above any group heading, or a group
 * heading that is not one of the four. A release page that silently lists nothing is worse than a
 * workflow step that stops and says which bullet is wrong.
 *
 * A SECOND READER. `scripts/sync-release-catalog.ts` builds the in-app release notes from the same
 * leads, through `parseReleases` below. There is one parser for both, so the sentence an operator
 * reads on the release page and the sentence a person reads in the app come from one place.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The four group headings, in the order the release page prints them. */
export const GROUPS = ['Added', 'Changed', 'Fixed', 'Docs'] as const;

export type GroupName = (typeof GROUPS)[number];

/** One credit phrase of a bullet, as the author wrote it: `Thanks`, `Reported by`, ... */
export interface Credit {
  /** The words before the handles, first letter upper-cased: `Thanks`, `Reported by`. */
  phrase: string;
  /** The GitHub logins it names, without the `@`, in the bullet's order. */
  handles: string[];
}

export interface Group {
  name: GroupName;
  /** One lead per bullet, in the order the changelog lists them, `**` already stripped. */
  leads: string[];
  /** Parallel to `leads`: the credits each bullet carries, empty when it names nobody. */
  credits: Credit[][];
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

/** Handles a credit never names: the maintainer, and the org that owns the repo. Their own handle
 *  in a bullet is not a contributor credit. Compared case-insensitively, since GitHub logins are. */
const EXCLUDED_HANDLES = new Set(['altans', 'lowcarbcheck']);

/** A GitHub login: letters, digits and single inner hyphens, at most 39 characters. The lookahead
 *  refuses a match that runs on into a path or a longer word (`@types/node`, `@scope-`). */
const HANDLE = String.raw`@([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(?![A-Za-z0-9/_-])`;

/** A handle as a bullet writes it: bare, `@x`, or linked to its profile, `[@x](https://github.com/x)`. */
const WRITTEN_HANDLE = String.raw`\[?${HANDLE}(?:\]\(https:\/\/github\.com\/[^)\s]*\))?`;

/** A credit: `Thanks`, `thanks to` or `<word> by`, then one or more handles joined by commas or
 *  `and`. The phrase must directly precede the first handle. */
const CREDIT = new RegExp(
  String.raw`(?<![A-Za-z])(thanks(?: to)?|(?:[A-Za-z]+ )?by)\s+(${WRITTEN_HANDLE}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)${WRITTEN_HANDLE})*)`,
  'gi',
);

/**
 * The credits in one bullet line.
 *
 * WHICH @ COUNTS. Only a handle that directly follows a credit phrase: `Thanks @x`,
 * `thanks to @x`, `Reported by @x`, `Suggested by @x and @y`. A bare `@word` anywhere in the
 * bullet does NOT count. The looser rule (every login-shaped `@`) would credit prose like "the
 * `@effort` token" or an npm scope in running text, and every false hit is a stranger's avatar on
 * the release page and a notification in their inbox. A missed credit is a changelog edit; a
 * false one is already sent.
 *
 * A handle linked to its profile (`[@x](https://github.com/x)`) counts too, and the page prints
 * it bare, because GitHub does not mention a user from link text.
 *
 * Code spans are removed before the scan, so `` `Thanks @x` `` inside backticks is text, not a
 * credit. An e-mail address never matches: its `@` follows a letter, not the phrase and a space.
 * The maintainer's and the owning org's own handles are dropped, and a phrase left with no handle
 * is dropped with it.
 */
function creditsOf(line: string): Credit[] {
  const prose = line.replace(/`[^`]*`/g, '');
  const credits: Credit[] = [];
  for (const match of prose.matchAll(CREDIT)) {
    const words = match[1] ?? '';
    const handles = [...(match[2] ?? '').matchAll(new RegExp(HANDLE, 'g'))]
      .map((handle) => handle[1] ?? '')
      .filter((handle) => !EXCLUDED_HANDLES.has(handle.toLowerCase()));
    if (handles.length === 0) continue;
    credits.push({ phrase: words.charAt(0).toUpperCase() + words.slice(1), handles });
  }
  return credits;
}

/** A bullet's credits as the page prints them after the lead: `Thanks @a. Reported by @b.` */
function creditText(credits: Credit[]): string {
  return credits
    .map(({ phrase, handles }) => {
      const names = handles.map((handle) => `@${handle}`);
      const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      return `${phrase} ${joined}.`;
    })
    .join(' ');
}

/**
 * Every handle a section credits, once each, in the order the page first names them. Case is
 * GitHub's business, not ours, so `@Foo` and `@foo` are one person and the first spelling wins.
 */
export function creditedHandles(section: Section): string[] {
  const seen = new Map<string, string>();
  for (const group of section.groups) {
    for (const credits of group.credits) {
      for (const credit of credits) {
        for (const handle of credit.handles) {
          const key = handle.toLowerCase();
          if (!seen.has(key)) seen.set(key, handle);
        }
      }
    }
  }
  return [...seen.values()];
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
      current = { name, leads: [], credits: [] };
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
    current.credits.push(creditsOf(line));
  }

  return groups.toSorted((a, b) => GROUPS.indexOf(a.name) - GROUPS.indexOf(b.name));
}

/** Reads one version's section into its groups. Throws with the reason when it is malformed. */
export function parseSection({ changelog, version }: { changelog: string; version: string }): Section {
  const { date, lines } = sectionLines({ changelog, version });
  return { version, date, groups: groupsOf({ lines, where: version }) };
}

/**
 * The version the grouped, bold-lead format begins at. Below it a section is a flat list, kept
 * verbatim as the record of what shipped, so `groupsOf` would refuse it. Rewriting old prose to
 * satisfy a format introduced later would edit history for the sake of a reader.
 */
export const GROUPED_FORMAT_FROM = '0.20.0';

/** A numbered release heading. `## [Unreleased]` never matches it: it does not open with a digit. */
const NUMBERED_HEADING = /^## \[(\d[^\]]*)\](.*)$/;

/** The `YYYY-MM-DD` tail of a release heading, which is what makes it a released version. */
const DATED_TAIL = / - \d{4}-\d{2}-\d{2}\s*$/;

/** `0.34.1` as `[0, 34, 1]`, with any prerelease suffix dropped. */
function versionParts(version: string): number[] {
  return (version.split('-')[0] ?? '').split('.').map((part) => Number(part));
}

/** Whether `version` is at or above `floor`, compared part by part. */
export function isAtLeast({ version, floor }: { version: string; floor: string }): boolean {
  const mine = versionParts(version);
  const theirs = versionParts(floor);
  for (let i = 0; i < theirs.length; i++) {
    const here = mine[i] ?? 0;
    const there = theirs[i] ?? 0;
    if (here !== there) return here > there;
  }
  return true;
}

/**
 * Every numbered release in the changelog, newest first, each read into its groups.
 *
 * The order is the file's own, which the changelog's opening paragraph fixes as newest first, and
 * the walk STOPS at the first version below `from` for the same reason: everything under it is
 * older still. `[Unreleased]` is never one of these, it carries no version and no date.
 *
 * A numbered heading that carries no date throws rather than being passed over, because a silently
 * skipped release is a release the app would never mention.
 */
export function parseReleases({
  changelog,
  from = GROUPED_FORMAT_FROM,
}: {
  changelog: string;
  from?: string;
}): Section[] {
  const releases: Section[] = [];
  for (const line of toLines(changelog)) {
    const match = NUMBERED_HEADING.exec(line);
    if (!match) continue;
    const version = match[1] ?? '';
    if (!isAtLeast({ version, floor: from })) break;
    if (!DATED_TAIL.test(match[2] ?? '')) {
      throw new Error(
        `CHANGELOG ${version}: the heading carries no ' - YYYY-MM-DD' date.\n  ${line}\n` +
          `  Expected: ## [${version}] - YYYY-MM-DD`,
      );
    }
    releases.push(parseSection({ changelog, version }));
  }
  return releases;
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
    group.leads.forEach((lead, i) => {
      const credits = group.credits[i] ?? [];
      lines.push(credits.length > 0 ? `- ${lead} ${creditText(credits)}` : `- ${lead}`);
    });
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
