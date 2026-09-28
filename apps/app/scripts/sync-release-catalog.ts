/**
 * sync-release-catalog, the in-app release notes, generated from CHANGELOG.md.
 *
 *   pnpm release-catalog            writes app/i18n/locales/en/releases.json
 *   pnpm release-catalog --check    writes nothing, exits 1 when that file is stale
 *
 * WHAT IT WRITES. One entry per release, keyed `v0_35_0`, holding the release date and the bold
 * lead of each bullet under Added, Changed and Fixed. The leads are the same sentences
 * `scripts/release-notes.ts` puts on the GitHub Release page, read by the same parser, so the app
 * and the release page cannot describe one version differently.
 *
 * WHY A FILE AND NOT A FETCH. The production `connect-src` is a closed allowlist (ADR-0012), and
 * widening it so a card could read GitHub is the one thing that list exists to prevent. The
 * catalog is an ordinary i18n namespace instead: part of the bundle, readable offline, and
 * translated by `pnpm translate:ui` like every other string the app ships. ADR-0018 records it.
 *
 * WHY THREE, AND WHY NOT `Docs`. Three releases is what a person who skipped an update or two
 * needs; older ones are on the GitHub release page, which is where the detail lives anyway. `Docs`
 * records a change to a document, not to the application, so it would tell a reader of the app
 * about work they cannot see.
 *
 * NOTHING IN `app/` IMPORTS THIS FILE. It reads the file system. The app reads the generated JSON
 * through i18next, as `t('v0_35_0.added.01', { ns: 'releases' })`.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type GroupName, type Section, parseReleases } from './release-notes';

/** How many releases the app carries. A release with nothing under the three groups is not one. */
export const KEPT_RELEASES = 3;

/** The generated catalog, relative to the repository root. */
export const CATALOG_FILE = 'app/i18n/locales/en/releases.json';

/** The groups the app shows, in the order the catalog writes them, with the key each one takes. */
const CATALOG_GROUPS = [
  { name: 'Added', key: 'added' },
  { name: 'Changed', key: 'changed' },
  { name: 'Fixed', key: 'fixed' },
] as const satisfies readonly { name: GroupName; key: 'added' | 'changed' | 'fixed' }[];

/**
 * What a lead may not carry.
 *
 * The first five are markdown or markup: the app renders a lead as text, so a backtick or a link
 * would reach the reader as its own characters. `{{` is i18next's interpolation, which would make
 * the string a template with no value to fill it. The two dashes are the house style ban, and the
 * translator is told the same rule for what it writes back.
 */
const FORBIDDEN_IN_A_LEAD = [
  { needle: '`', what: 'a backtick' },
  { needle: '](', what: 'a markdown link' },
  { needle: '[', what: 'a square bracket' },
  { needle: '<', what: 'a less-than sign' },
  { needle: '>', what: 'a greater-than sign' },
  { needle: '{{', what: 'an interpolation placeholder' },
  { needle: '—', what: 'an em dash' },
  { needle: '–', what: 'an en dash' },
] as const;

/** One release, as the catalog holds it. A group key is present only when it has a lead. */
export interface ReleaseEntry {
  date: string;
  added?: Record<string, string>;
  changed?: Record<string, string>;
  fixed?: Record<string, string>;
}

/** The whole catalog, keyed `v0_35_0`, newest release first. */
export type ReleaseCatalog = Record<string, ReleaseEntry>;

/** `0.35.0` as `v0_35_0`: a dot is i18next's group separator, so a version cannot carry one. */
export function catalogKey(version: string): string {
  return `v${version.replaceAll('.', '_')}`;
}

/** Throws when a lead carries something the card cannot show or the translator must not be handed. */
function checkLead({ version, lead }: { version: string; lead: string }): void {
  for (const { needle, what } of FORBIDDEN_IN_A_LEAD) {
    if (!lead.includes(needle)) continue;
    throw new Error(
      `CHANGELOG ${version}: a lead carries ${what}, which the in-app release notes cannot show.\n` +
        `  ${lead}\n` +
        `  Rewrite the lead in plain words and leave the detail to the rest of the bullet.`,
    );
  }
}

/** One group's leads, keyed "01".."NN" in changelog order, zero padded so a sort keeps that order. */
function leadsOf(leads: string[]): Record<string, string> {
  return Object.fromEntries(leads.map((lead, index) => [String(index + 1).padStart(2, '0'), lead]));
}

/** The catalog entry for one release, or null when it changed nothing a reader of the app can see. */
function entryOf(section: Section): ReleaseEntry | null {
  const entry: ReleaseEntry = { date: section.date };
  let carriesSomething = false;
  for (const { name, key } of CATALOG_GROUPS) {
    const leads = section.groups.find((group) => group.name === name)?.leads ?? [];
    for (const lead of leads) checkLead({ version: section.version, lead });
    if (leads.length === 0) continue;
    entry[key] = leadsOf(leads);
    carriesSomething = true;
  }
  return carriesSomething ? entry : null;
}

/**
 * The catalog for a changelog: the newest `KEPT_RELEASES` releases that changed the application.
 *
 * Pure, so `tests/unit/release-catalog.test.ts` can hand it a fixture and the real file alike.
 * Throws, naming the version and the lead, when a lead carries something the app cannot show.
 */
export function buildReleaseCatalog(changelog: string): ReleaseCatalog {
  const kept: [string, ReleaseEntry][] = [];
  for (const section of parseReleases({ changelog })) {
    const entry = entryOf(section);
    if (entry === null) continue;
    kept.push([catalogKey(section.version), entry]);
    if (kept.length === KEPT_RELEASES) break;
  }
  return Object.fromEntries(kept);
}

// ---- CLI ---------------------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '..');

/** The catalog as a file: two space indent and a trailing newline, which is what prettier writes. */
function render(catalog: ReleaseCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function main(argv: string[]): void {
  const checkOnly = argv.includes('--check');
  const wanted = render(buildReleaseCatalog(readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8')));

  if (!checkOnly) {
    writeFileSync(resolve(ROOT, CATALOG_FILE), wanted);
    console.log(`release-catalog: wrote ${CATALOG_FILE}`);
    return;
  }

  if (readFileSync(resolve(ROOT, CATALOG_FILE), 'utf8') === wanted) {
    console.log(`release-catalog: ${CATALOG_FILE} matches CHANGELOG.md`);
    return;
  }
  console.error(
    `release-catalog: ${CATALOG_FILE} does not match CHANGELOG.md.\n` +
      `  Run 'pnpm release-catalog', then buy the five translations, and commit all six files.`,
  );
  process.exit(1);
}

/** Run only when this file is the entry point, so the test can import the exports above. */
const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-catalog failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
