/**
 * The doc-claims guard, proven against the sentence that actually shipped.
 *
 * A guard that has never failed is untested, and this one exists because of one
 * specific paragraph: `docs/api.md` promised a `provenance` field on every food
 * while the schema marked it `.optional()`. The first test below feeds that
 * paragraph in verbatim. If it ever stops failing, the guard has been softened
 * and the defect can ship again.
 *
 * The schema side is the real one, not a fixture. Comparing against a copy of
 * the contract would reproduce the original defect one level up.
 */
import { describe, expect, it } from 'vitest';
import type { CrossRepoIdentifier } from '../../scripts/check-doc-claims.js';
import {
  CROSS_REPO_IDENTIFIERS,
  UNCHECKED_CLAIMS,
  assertCrossRepoEvidence,
  checkDocument,
  collectSchemaFields,
  extractClaims,
  maskFencedBlocks,
  readCrossRepoIdentifiers,
} from '../../scripts/check-doc-claims.js';

const fields = collectSchemaFields();

/** Verbatim from `docs/api.md:27` at the release that published it. */
const SHIPPED_API_SENTENCE =
  'Each food also carries a `provenance` field (`"corpus"` or `"model"`) and an `attribution` string where the food source requires one: see [Food data](configuration.md#food-data-foodsource).';

/** Verbatim from `docs/configuration.md:54`, where the same claim is line-broken. */
const SHIPPED_CONFIGURATION_SENTENCE = [
  '**Resolved macros are labelled.** Every food in the response carries a',
  '`provenance` of `"corpus"` (looked up in the food database) or `"model"`, plus an',
  '`attribution` string where the source requires one.',
].join('\n');

function check(
  markdown: string,
  sourceIdentifiers: readonly string[] = [],
  exemptIdentifiers: readonly string[] = [],
) {
  return checkDocument({
    document: 'fixture.md',
    markdown,
    fields,
    sourceIdentifiers: new Set(sourceIdentifiers),
    exemptIdentifiers: new Set(exemptIdentifiers),
  });
}

/** A well-formed entry, so each test below can spoil exactly one part of it. */
function crossRepoEntry(overrides: Partial<CrossRepoIdentifier> = {}): CrossRepoIdentifier {
  return {
    identifier: 'SOME_OTHER_REPO_VARIABLE',
    repository: 'openplate',
    verifiedAt: ['app/config/index.ts:318'],
    verifiedOn: '2026-09-07',
    reason: 'The client reads it, so it can only ever exist in the client repository.',
    ...overrides,
  };
}

describe('doc claims: the shipped provenance sentence', () => {
  it('rejects the sentence published in docs/api.md', () => {
    const failures = check(SHIPPED_API_SENTENCE);

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('field-not-optional');
    expect(failures[0].message).toContain('provenance');
  });

  it('rejects the same claim in docs/configuration.md across a line break', () => {
    const failures = check(SHIPPED_CONFIGURATION_SENTENCE);

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('field-not-optional');
    expect(failures[0].line).toBe(1);
  });

  it('still rejects a carries-claim that hedges after the fact', () => {
    // Deliberate. The rule reads the promise, not the qualification that
    // follows it, and it errs towards failing. Prose that means "sometimes"
    // should not open with a word that means "always".
    const hedged =
      'A food carries a `provenance` field only when the macros were resolved from the food corpus.';

    expect(check(hedged)).toHaveLength(1);
  });

  it('accepts the same fact stated without the promise', () => {
    const corrected =
      'A food resolved from the food corpus has a `provenance` field; a food the model estimated has none.';

    expect(check(corrected)).toHaveLength(0);
  });

  it('accepts a carries-claim about a field the schema requires', () => {
    expect(check('Every food carries a `name`.')).toHaveLength(0);
  });
});

describe('doc claims: enumerated sets', () => {
  it('accepts the set the schema declares', () => {
    expect(check('The `provenance` is `"corpus"` or `"model"`.')).toHaveLength(0);
  });

  it('rejects a set the schema does not declare', () => {
    const failures = check('The `provenance` is `"corpus"`, `"model"` or `"guess"`.');

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('enum-set-matches');
    expect(failures[0].message).toContain('guess');
  });

  it('rejects a set that has silently lost a value', () => {
    const failures = check('The `confidence` is `"high"` or `"low"`.');

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('enum-set-matches');
    expect(failures[0].message).toContain('medium');
  });

  it('reads a value glossed in parentheses as part of the set', () => {
    const claims = extractClaims(
      'The `provenance` is `"corpus"` (from the food database) or `"model"`.',
    );

    expect(claims).toContainEqual({
      kind: 'enum-set',
      line: 1,
      field: 'provenance',
      values: ['corpus', 'model'],
    });
  });

  it('does not read a single mentioned value as an enumeration', () => {
    const claims = extractClaims('The `provenance` is `"corpus"` on a resolved food.');

    expect(claims.filter((claim) => claim.kind === 'enum-set')).toHaveLength(0);
  });
});

describe('doc claims: documented identifiers', () => {
  it('rejects an environment variable the source never mentions', () => {
    const failures = check('Set `WEIGHTS_MIRROR_BASE` to a mirror.', ['MODEL_PROFILE']);

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('identifier-exists');
    expect(failures[0].message).toContain('WEIGHTS_MIRROR_BASE');
  });

  it('accepts an environment variable the source mentions', () => {
    expect(check('Set `MODEL_PROFILE` to `lite`.', ['MODEL_PROFILE'])).toHaveLength(0);
  });

  it('accepts an environment variable another repository implements', () => {
    const markdown = 'Set `DEFAULT_INFERENCE_BASE_URL` on the client.';

    expect(check(markdown, [], ['DEFAULT_INFERENCE_BASE_URL'])).toHaveLength(0);
  });

  it('offers the exception list rather than silence when it fails', () => {
    const failures = check('Set `WEIGHTS_MIRROR_BASE` to a mirror.');

    expect(failures[0].message).toContain('CROSS_REPO_IDENTIFIERS');
    expect(failures[0].message).toContain('path:line');
  });

  it('ignores identifiers inside a fenced code block', () => {
    const markdown = ['Run it:', '', '```sh', 'export NOT_A_REAL_VARIABLE=1', '```'].join('\n');

    expect(check(markdown)).toHaveLength(0);
  });
});

describe('doc claims: an exception must carry its evidence', () => {
  it('accepts an entry that says where somebody read the name', () => {
    expect(() => assertCrossRepoEvidence(crossRepoEntry())).not.toThrow();
  });

  it('rejects an entry with no location at all', () => {
    expect(() => assertCrossRepoEvidence(crossRepoEntry({ verifiedAt: [] }))).toThrow(
      /without evidence is a whitelist/,
    );
  });

  it('rejects a bare path, because a path does not say what was read', () => {
    expect(() =>
      assertCrossRepoEvidence(crossRepoEntry({ verifiedAt: ['app/config/index.ts'] })),
    ).toThrow(/path:line/);
  });

  it('rejects an entry with no reading date', () => {
    expect(() => assertCrossRepoEvidence(crossRepoEntry({ verifiedOn: 'recently' }))).toThrow(
      /ISO date/,
    );
  });

  it('rejects an entry that names no repository', () => {
    expect(() => assertCrossRepoEvidence(crossRepoEntry({ repository: '' }))).toThrow(
      /names no repository/,
    );
  });

  it('rejects an entry whose reason is a shrug', () => {
    expect(() => assertCrossRepoEvidence(crossRepoEntry({ reason: 'external' }))).toThrow(
      /no reason/,
    );
  });

  it('holds every shipped entry to the same standard', () => {
    const exempt = readCrossRepoIdentifiers();

    expect(CROSS_REPO_IDENTIFIERS.length).toBeGreaterThan(0);
    for (const entry of CROSS_REPO_IDENTIFIERS) expect(exempt.has(entry.identifier)).toBe(true);
  });
});

describe('doc claims: the guard describes its own limits', () => {
  it('masks fences without moving any byte', () => {
    const markdown = ['a', '```', 'hidden', '```', 'b'].join('\n');

    expect(maskFencedBlocks(markdown)).toHaveLength(markdown.length);
    expect(maskFencedBlocks(markdown)).not.toContain('hidden');
  });

  it('lists what it cannot check rather than leaving the gap silent', () => {
    expect(UNCHECKED_CLAIMS.length).toBeGreaterThan(0);
    for (const entry of UNCHECKED_CLAIMS) expect(entry.length).toBeGreaterThan(40);
  });
});
