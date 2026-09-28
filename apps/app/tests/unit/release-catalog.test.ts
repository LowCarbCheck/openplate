/**
 * Tests for `scripts/sync-release-catalog.ts`, the in-app release notes read out of CHANGELOG.md.
 *
 * The catalog is generated, committed and translated (ADR-0018), which means it can go stale in
 * silence: the changelog moves on, the six `releases.json` files do not, and the app keeps telling
 * people about a release that is two versions old. So the middle block compares the COMMITTED
 * English file against what the REAL CHANGELOG.md produces today, and that is the check the
 * pre-push gate runs.
 *
 * Every assertion over the real files is paired with a CONTROL: the same check over a deliberately
 * changed copy, which must fail. A check that cannot fail records nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { isAtLeast } from '../../scripts/release-notes';
import {
  CATALOG_FILE,
  KEPT_RELEASES,
  type ReleaseCatalog,
  buildReleaseCatalog,
  catalogKey,
} from '../../scripts/sync-release-catalog';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── the parsed fixture ───────────────────────────────────────────────────────

/**
 * Five numbered releases and an Unreleased section, arranged so one fixture proves every rule:
 * `[Unreleased]` is ignored, `### Docs` is dropped from a release that has other groups, a
 * docs-only release is skipped WITHOUT spending one of the three slots, and the fifth release
 * falls outside the cap.
 */
const FIXTURE = `# Changelog

## [Unreleased]

### Added

- **An unreleased lead.** It is not in the catalog.

## [0.40.0] - 2026-11-04

### Added

- **The first added lead.** Detail text.
- **The second added lead.** Detail text.

### Changed

- **A changed lead.** Detail text.

### Docs

- **A docs lead.** Detail text.

## [0.39.1] - 2026-11-03

### Docs

- **Only a document changed.** Detail text.

## [0.39.0] - 2026-11-02

### Fixed

- **A fixed lead.** Detail text.

## [0.38.0] - 2026-11-01

### Added

- **The third kept lead.** Detail text.

## [0.37.0] - 2026-10-31

### Added

- **A lead the cap leaves out.** Detail text.
`;

const EXPECTED = {
  v0_40_0: {
    date: '2026-11-04',
    added: { '01': 'The first added lead.', '02': 'The second added lead.' },
    changed: { '01': 'A changed lead.' },
  },
  v0_39_0: { date: '2026-11-02', fixed: { '01': 'A fixed lead.' } },
  v0_38_0: { date: '2026-11-01', added: { '01': 'The third kept lead.' } },
} satisfies ReleaseCatalog;

describe('buildReleaseCatalog', () => {
  it('reads the fixture into exactly the object the app ships', () => {
    assert.deepEqual(buildReleaseCatalog(FIXTURE), EXPECTED);
  });

  it('keeps the newest three that changed the app, newest first, and the docs-only one costs no slot', () => {
    assert.deepEqual(Object.keys(buildReleaseCatalog(FIXTURE)), ['v0_40_0', 'v0_39_0', 'v0_38_0']);
    assert.equal(Object.keys(buildReleaseCatalog(FIXTURE)).length, KEPT_RELEASES);
  });

  it('leaves out the Docs group, the Unreleased section and everything past the cap', () => {
    const catalog = buildReleaseCatalog(FIXTURE);
    const everyLead = Object.values(catalog).flatMap((entry) =>
      [entry.added, entry.changed, entry.fixed].flatMap((group) => Object.values(group ?? {})),
    );
    assert.ok(!everyLead.includes('A docs lead.'), everyLead.join(' | '));
    assert.ok(!everyLead.includes('An unreleased lead.'), everyLead.join(' | '));
    assert.ok(!everyLead.includes('A lead the cap leaves out.'), everyLead.join(' | '));
    assert.equal(catalog['v0_39_1'], undefined);
    assert.equal(catalog['v0_37_0'], undefined);
  });

  it('pads a lead key to two digits and strips the asterisks off the lead', () => {
    assert.deepEqual(Object.keys(buildReleaseCatalog(FIXTURE)['v0_40_0']?.added ?? {}), ['01', '02']);
    for (const lead of Object.values(buildReleaseCatalog(FIXTURE)['v0_40_0']?.added ?? {})) {
      assert.ok(!lead.includes('*'), lead);
    }
  });

  it('reads a version into a key i18next can address', () => {
    assert.equal(catalogKey('0.40.0'), 'v0_40_0');
    assert.equal(catalogKey('1.0.0-beta.1'), 'v1_0_0-beta_1');
  });
});

describe('a lead the app could not show', () => {
  it('passes the fixture as written, so the refusals below are the check and not the fixture', () => {
    assert.doesNotThrow(() => buildReleaseCatalog(FIXTURE));
  });

  it('refuses a backtick, and the message names the version and the lead', () => {
    const withMarkup = FIXTURE.replace('**A changed lead.**', '**A changed lead about `pnpm dev`.**');
    assert.throws(() => buildReleaseCatalog(withMarkup), /0\.40\.0/);
    assert.throws(() => buildReleaseCatalog(withMarkup), /a backtick/);
    assert.throws(() => buildReleaseCatalog(withMarkup), /A changed lead about/);
  });

  it('refuses a link, an angle bracket, a placeholder and either banned dash', () => {
    const refusals = [
      { lead: 'A lead with a [link](https://example.com).', reason: /a markdown link/ },
      { lead: 'A lead with a <span> in it.', reason: /a less-than sign/ },
      { lead: 'A lead with {{count}} in it.', reason: /an interpolation placeholder/ },
      { lead: `A lead with — in it.`, reason: /an em dash/ },
      { lead: `A lead with – in it.`, reason: /an en dash/ },
    ];
    for (const { lead, reason } of refusals) {
      const broken = FIXTURE.replace('**A changed lead.**', `**${lead}**`);
      assert.throws(() => buildReleaseCatalog(broken), reason, lead);
    }
  });

  it('says nothing about a Docs lead it was never going to ship', () => {
    // The Docs group is dropped before the check, so a backtick there is the changelog's business.
    const backtickInDocs = FIXTURE.replace('**A docs lead.**', '**A docs lead about `docs/sync.md`.**');
    assert.doesNotThrow(() => buildReleaseCatalog(backtickInDocs));
  });
});

// ── the committed catalog against the real CHANGELOG ─────────────────────────
// Not a fixture: the real files, so a changelog that moved on without the catalog is red on the
// commit that moved it rather than on the release that shipped the stale card.

/** One release as the file holds it. `strictObject` so an extra key is a failure, not a silence. */
const entrySchema = z.strictObject({
  date: z.string(),
  added: z.record(z.string(), z.string()).optional(),
  changed: z.record(z.string(), z.string()).optional(),
  fixed: z.record(z.string(), z.string()).optional(),
});

const catalogSchema = z.record(z.string(), entrySchema);

function loadCatalog(locale: string): ReleaseCatalog {
  const file = join(REPO_ROOT, 'app', 'i18n', 'locales', locale, 'releases.json');
  return catalogSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** Every dotted leaf path in a catalog, which is what the six locales must agree on. */
function keyPaths(catalog: ReleaseCatalog): string[] {
  const paths: string[] = [];
  for (const [version, entry] of Object.entries(catalog)) {
    paths.push(`${version}.date`);
    for (const group of ['added', 'changed', 'fixed'] as const) {
      for (const index of Object.keys(entry[group] ?? {})) paths.push(`${version}.${group}.${index}`);
    }
  }
  return paths.toSorted();
}

describe(`the committed ${CATALOG_FILE}`, () => {
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  const committed = loadCatalog('en');

  it('is exactly what the real CHANGELOG.md produces today', () => {
    assert.deepEqual(committed, buildReleaseCatalog(changelog), `run 'pnpm release-catalog' and commit the result`);
  });

  it('would notice a release the catalog has not been told about', () => {
    // The control for the assertion above: without it, a comparison of two empty objects, or of a
    // generator against a file it had just written in this process, would pass forever. The
    // newlines around the needle matter: the changelog's opening paragraph names `## [Unreleased]`
    // in prose, and a match there would edit a line no heading pattern ever reads.
    const grown = changelog.replace(
      '\n## [Unreleased]\n',
      '\n## [99.0.0] - 2026-12-31\n\n### Added\n\n- **A release that was never cut.** Detail text.\n\n## [Unreleased]\n',
    );
    assert.ok(grown.includes('\n## [99.0.0] - 2026-12-31\n'), 'the control did not reach a heading line');
    assert.notDeepEqual(committed, buildReleaseCatalog(grown));
  });

  it('carries between one and three releases, so the comparison above is not over an empty file', () => {
    assert.ok(Object.keys(committed).length >= 1, 'the catalog is empty');
    assert.ok(Object.keys(committed).length <= KEPT_RELEASES, Object.keys(committed).join(', '));
  });

  it('never names a version newer than the one package.json says this is', () => {
    const manifest = z
      .object({ version: z.string() })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')));
    const newest = Object.keys(committed)[0] ?? '';
    const version = newest.slice(1).replaceAll('_', '.');
    assert.ok(
      isAtLeast({ version: manifest.version, floor: version }),
      `the catalog names ${version}, package.json says ${manifest.version}`,
    );
    // The control: a version above the manifest's fails the same comparison.
    assert.ok(!isAtLeast({ version: manifest.version, floor: '99.0.0' }));
  });
});

describe('every locale carries the same catalog keys', () => {
  const english = keyPaths(loadCatalog('en'));

  it('walks a populated set of keys, so the comparison below is not over an empty file', () => {
    assert.ok(english.length >= 4, `only ${english.length} key paths in en/releases.json`);
    assert.ok(SUPPORTED_LANGUAGES.length >= 6, `only ${SUPPORTED_LANGUAGES.length} languages`);
  });

  for (const locale of SUPPORTED_LANGUAGES) {
    it(`${locale}/releases.json answers every English key and no other`, () => {
      assert.deepEqual(keyPaths(loadCatalog(locale)), english);
    });
  }

  it('would notice a key missing from one of them, and one nobody asked for', () => {
    // The control: two catalogs that differ by one key path must not compare equal.
    const full = { v1_0_0: { date: '2026-01-01', added: { '01': 'A lead.', '02': 'Another lead.' } } };
    const short = { v1_0_0: { date: '2026-01-01', added: { '01': 'A lead.' } } };
    const extra = { v1_0_0: { date: '2026-01-01', added: { '01': 'A lead.', '02': 'B.' }, fixed: { '01': 'C.' } } };
    assert.notDeepEqual(keyPaths(short), keyPaths(full));
    assert.notDeepEqual(keyPaths(extra), keyPaths(full));
    assert.deepEqual(keyPaths(full), keyPaths(full));
  });
});
