/**
 * check-doc-claims, a guard on the NAMES a published document uses.
 *
 * WHAT THIS CANNOT CHECK, said first because a guard that is mistaken for more
 * than it is becomes a licence to stop reading. This program CANNOT check
 * whether a paragraph is true. It has no opinion on whether a threat model is
 * honest, whether a benchmark number is current, or whether an explanation
 * explains. It compares three MECHANICAL shapes against the code, and every
 * other sentence in the corpus passes it by construction.
 *
 * TWO LISTS, and they are different kinds of thing. `UNCHECKED_CLAIMS` names
 * claim SHAPES this program does not read, one entry per shape with a reason.
 * `CROSS_REPO_IDENTIFIERS` names SPECIFIC identifiers that are real but live in
 * another repository, each with the file and line where somebody read it there.
 * Keeping them apart matters: a shape is a permanent property of the rules, an
 * identifier is a fact about today's code that can rot.
 *
 * WHY IT EXISTS. `docs/api.md` said every food carries a `provenance` field.
 * The schema marked that field `.optional()`, the only writer emitted one of
 * the two documented values, and the module comment beside the writer SAID SO
 * in plain English. Three artifacts in one repository, one of them wrong, and
 * nothing in the gate could connect them. Then openplate.de published the wrong
 * one in three languages. M199 spec 01.
 *
 * THE THREE RULES. Each is a claim that goes stale silently, because renaming a
 * symbol never touches a markdown file:
 *
 *   1. `identifier-exists`: a SCREAMING_SNAKE name in an inline code span is
 *      an environment variable the reader is told to set. It must appear
 *      somewhere in this repository's source.
 *   2. `enum-set-matches`: a document that enumerates the values of a field
 *      must enumerate the same set the schema does.
 *   3. `field-not-optional`: a document that says an item "carries" a field
 *      must not name a field the schema marks optional.
 *
 * SCOPE. The published corpus is `README.md` and `docs/*.md`, which is what
 * openplate.de syncs (see `scripts/check-docs-manifest.sh` for the manifest
 * side of the same contract). The schema is the wire contract in
 * `src/contract/plate-identification.ts`, read through `z.toJSONSchema` so the
 * rules compare against what the schema DOES rather than what its text looks
 * like.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PlateIdentificationSchema } from '../src/contract/plate-identification.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Claims this program deliberately does not check, and why. A claim that is not
 * checkable belongs here rather than nowhere, so the gap is a document instead
 * of a silence. Adding an entry is a decision; leaving one out is an accident.
 */
export const UNCHECKED_CLAIMS: readonly string[] = [
  'Whether a paragraph is true. No mechanical rule can read a threat model, a licence summary or an explanation and tell you it is honest. Reviewers do that.',
  'Fenced code blocks. They are transcripts and examples, not assertions about this build, and an env file pasted as an illustration would fail rule 1 for being an illustration. Masked before extraction.',
  'Enumerations written without quotes. Rule 2 recognises a value only as `"literal"` in an inline code span. A set written as prose ("high, medium or low") is not recognised, and widening the pattern to catch it would match ordinary lists of field names.',
  'Hedged carries-claims. Rule 3 reads only the field named directly after "carries", and it reads nothing after that field. "carries a `x` plus a `y` where the source requires one" is not read as a promise about `y`, and "carries `x` only when Z" IS still read as a promise about `x`. The rule errs towards failing, because prose that means "sometimes" should not open with a word that means "always".',
  'Numbers. Timeouts, payload ceilings, model sizes and benchmark results are claims about behaviour, not about names, and none of them has a symbol to compare against.',
  'HTTP status codes and response headers. They are produced across the express layer rather than declared in one schema, so there is nothing single to compare a table row against.',
  'camelCase field names in general. Only the two claim shapes above are read. A document that merely mentions `portionHint` is not checked for the existence of that field.',
  'Anchors and cross-document links. openplate-website owns link resolution after the sync; a broken anchor fails there and belongs there.',
  'Prose in `docs/adr/` and any nested directory. Records are deliberately unpublished (M193 spec 05, decision 4), so a stale name in one misleads nobody.',
];

/**
 * An identifier a document is right to name even though this repository never
 * implements it. The self-hoster wires the CLIENT with these, so they belong in
 * this repository's documentation and can only ever live in openplate's source.
 *
 * WHY THIS IS NOT A LIST OF NAMES. A bare `['DEFAULT_INFERENCE_API_KEY']` would
 * be indistinguishable from a name somebody added to stop a red gate, and it
 * would stay green forever after the other repository deleted the variable.
 * Nothing in it would say who checked, or where, or when. So the entry carries
 * the evidence instead: the repository, at least one `path:line` somebody read
 * first hand, and the date they read it. `assertCrossRepoEvidence` below rejects an
 * entry that omits any of it, which makes the cheap way of silencing a failure
 * the one way that does not compile past the first run.
 *
 * A location goes stale. That is the intended cost: re-reading four lines every
 * few months is the price of not whitelisting a name forever.
 */
export interface CrossRepoIdentifier {
  readonly identifier: string;
  /** The repository that implements it, as `owner/name` or the workspace directory. */
  readonly repository: string;
  /** One or more `path:line` locations inside `repository`, read first hand. */
  readonly verifiedAt: readonly string[];
  /** ISO date the locations above were read. */
  readonly verifiedOn: string;
  readonly reason: string;
}

export const CROSS_REPO_IDENTIFIERS: readonly CrossRepoIdentifier[] = [
  {
    identifier: 'DEFAULT_INFERENCE_BASE_URL',
    repository: 'openplate',
    verifiedAt: [
      'app/config/content-security-policy.ts:62',
      'app/components/instance-preset-connect.tsx:5',
    ],
    verifiedOn: '2026-09-07',
    reason:
      'The client reads it to allow this endpoint in its content security policy and to gate the connect component. README.md and docs/troubleshooting.md tell a self-hoster to set it on the client, not here.',
  },
  {
    identifier: 'DEFAULT_INFERENCE_API_KEY',
    repository: 'openplate',
    verifiedAt: ['app/config/index.ts:318', 'app/config/public-config.ts:45'],
    verifiedOn: '2026-09-07',
    reason:
      'The client reads it and ships it to the browser, which is why README.md documents it as public. This service only ever sees the value as a bearer token it was configured with separately.',
  },
];

/** A `path:line` reference. A path alone is not evidence: it does not say what was read. */
const EVIDENCE_LOCATION = /^[\w.@/-]+:\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertCrossRepoEvidence(entry: CrossRepoIdentifier): void {
  const where = `CROSS_REPO_IDENTIFIERS entry \`${entry.identifier}\``;
  if (!SCREAMING_SNAKE.test(entry.identifier)) {
    throw new Error(`${where} is not an identifier rule 1 can ever raise.`);
  }
  if (entry.repository.length === 0) {
    throw new Error(`${where} names no repository, so nobody can go and look.`);
  }
  if (entry.verifiedAt.length === 0) {
    throw new Error(`${where} carries no location. An exception without evidence is a whitelist.`);
  }
  for (const location of entry.verifiedAt) {
    if (EVIDENCE_LOCATION.test(location)) continue;
    throw new Error(`${where} cites "${location}", which is not a \`path:line\` somebody can open.`);
  }
  if (!ISO_DATE.test(entry.verifiedOn)) {
    throw new Error(`${where} has no ISO date, so nobody can tell how stale the reading is.`);
  }
  if (entry.reason.length < 40) {
    throw new Error(`${where} gives no reason a reader could disagree with.`);
  }
}

/**
 * The exempt names, but only after every entry has produced its evidence. This
 * throws rather than skipping a malformed entry: a half-checked exception list
 * is the failure mode the list exists to prevent.
 */
export function readCrossRepoIdentifiers(): ReadonlySet<string> {
  for (const entry of CROSS_REPO_IDENTIFIERS) assertCrossRepoEvidence(entry);
  return new Set(CROSS_REPO_IDENTIFIERS.map((entry) => entry.identifier));
}

/** The repository source rule 1 searches. */
const SOURCE_ROOTS: readonly string[] = ['src', 'scripts', 'eval', 'docker', 'Dockerfile'];

/**
 * Directories under a source root that hold data or build output rather than
 * source, and this file, which must not satisfy rule 1 by quoting a name.
 */
const SOURCE_SKIP: readonly string[] = [
  'node_modules',
  'dist',
  'data',
  'eval/models',
  'eval/runs',
  'eval/.venv',
  '.fdc-work',
  'scripts/check-doc-claims.ts',
];

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '',
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.sh',
  '.json',
  '.yml',
  '.yaml',
  '.py',
  '.toml',
]);

// ── the schema side ─────────────────────────────────────────────────────────

interface DocSchemaNode {
  readonly properties?: Record<string, DocSchemaNode>;
  readonly items?: DocSchemaNode;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
  readonly anyOf?: readonly DocSchemaNode[];
}

const DocSchemaNodeSchema: z.ZodType<DocSchemaNode> = z.lazy(() =>
  z
    .looseObject({
      properties: z.record(z.string(), DocSchemaNodeSchema).optional(),
      items: DocSchemaNodeSchema.optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(z.string()).optional(),
      anyOf: z.array(DocSchemaNodeSchema).optional(),
    })
    .readonly(),
);

export interface SchemaField {
  readonly name: string;
  /** True when the schema does not list the field in its parent's `required`. */
  readonly isOptional: boolean;
  /** The declared value set, or null when the field is not an enum. */
  readonly enumValues: readonly string[] | null;
  /**
   * True when two schemas declare this name differently. An ambiguous field is
   * reported and then skipped: a rule that guesses which one a document meant
   * is worse than no rule.
   */
  readonly isAmbiguous: boolean;
}

export type SchemaFields = ReadonlyMap<string, SchemaField>;

function enumValuesOf(node: DocSchemaNode): readonly string[] | null {
  if (node.enum) return node.enum;
  for (const branch of node.anyOf ?? []) {
    if (branch.enum) return branch.enum;
  }
  return null;
}

function fingerprint(field: SchemaField): string {
  return `${String(field.isOptional)}:${field.enumValues?.join('|') ?? 'none'}`;
}

function recordField(into: Map<string, SchemaField>, field: SchemaField): void {
  const existing = into.get(field.name);
  if (!existing) {
    into.set(field.name, field);
    return;
  }
  if (fingerprint(existing) === fingerprint(field)) return;
  into.set(field.name, { ...existing, isAmbiguous: true });
}

function walkSchema(node: DocSchemaNode, into: Map<string, SchemaField>): void {
  if (node.properties) {
    const required = new Set(node.required ?? []);
    for (const [name, child] of Object.entries(node.properties)) {
      recordField(into, {
        name,
        isOptional: !required.has(name),
        enumValues: enumValuesOf(child),
        isAmbiguous: false,
      });
      walkSchema(child, into);
    }
  }
  if (node.items) walkSchema(node.items, into);
  for (const branch of node.anyOf ?? []) walkSchema(branch, into);
}

/** Every field the wire contract declares, keyed by name. */
export function collectSchemaFields(): SchemaFields {
  const jsonSchema = DocSchemaNodeSchema.parse(
    z.toJSONSchema(PlateIdentificationSchema, { io: 'output' }),
  );
  const fields = new Map<string, SchemaField>();
  walkSchema(jsonSchema, fields);
  return fields;
}

// ── the document side ───────────────────────────────────────────────────────

interface CodeSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface IdentifierClaim {
  readonly kind: 'identifier';
  readonly line: number;
  readonly name: string;
}

export interface EnumSetClaim {
  readonly kind: 'enum-set';
  readonly line: number;
  readonly field: string;
  readonly values: readonly string[];
}

export interface CarriesClaim {
  readonly kind: 'carries';
  readonly line: number;
  readonly field: string;
}

export type DocClaim = IdentifierClaim | EnumSetClaim | CarriesClaim;

const SCREAMING_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9]*$/;
const QUOTED_LITERAL = /^"([^"]*)"$/;

/**
 * Text allowed between a field name and the first value of its enumeration:
 * "`provenance` field (" and "`provenance` of ".
 */
const ENUM_LEAD_IN = /^(?:\s|field|value|values|is|are|of|one|either|or|[:(,])*$/;

/**
 * Text allowed between two values of an enumeration. A whole parenthetical is
 * allowed because a gloss on one value does not end the list:
 * "`\"corpus\"` (looked up in the food database) or `\"model\"`".
 */
const ENUM_SEPARATOR = /^(?:\s|,|or|and|\)|\([^)]*\))*$/;

const CARRIES = /\b(?:carries|carry)\s+(?:a|an|the|its|one)?\s*`([^`]+)`/g;

/**
 * Blanks fenced code blocks while preserving every byte position, so an offset
 * into the result still names the same line in the original.
 */
export function maskFencedBlocks(text: string): string {
  let insideFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        insideFence = !insideFence;
        return ' '.repeat(line.length);
      }
      return insideFence ? ' '.repeat(line.length) : line;
    })
    .join('\n');
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

function findCodeSpans(flattened: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  const pattern = /`([^`]+)`/g;
  let match = pattern.exec(flattened);
  while (match !== null) {
    spans.push({ text: match[1], start: match.index, end: match.index + match[0].length });
    match = pattern.exec(flattened);
  }
  return spans;
}

function readEnumeration(flattened: string, spans: readonly CodeSpan[], from: number): string[] {
  const values: string[] = [];
  let cursor = spans[from].end;
  let index = from + 1;
  while (index < spans.length) {
    const gap = flattened.slice(cursor, spans[index].start);
    const allowed = values.length === 0 ? ENUM_LEAD_IN : ENUM_SEPARATOR;
    if (!allowed.test(gap)) break;
    const literal = QUOTED_LITERAL.exec(spans[index].text);
    if (!literal) break;
    values.push(literal[1]);
    cursor = spans[index].end;
    index += 1;
  }
  return values;
}

/**
 * Reads the three claim shapes out of one document. A sentence is allowed to
 * span lines, so newlines become spaces first. That substitution is
 * length-preserving, which is what keeps the reported line numbers honest.
 */
export function extractClaims(markdown: string): DocClaim[] {
  const masked = maskFencedBlocks(markdown);
  const flattened = masked.replaceAll('\n', ' ');
  const spans = findCodeSpans(flattened);
  const claims: DocClaim[] = [];

  for (const [index, span] of spans.entries()) {
    if (SCREAMING_SNAKE.test(span.text)) {
      claims.push({ kind: 'identifier', line: lineAt(masked, span.start), name: span.text });
      continue;
    }
    if (!FIELD_NAME.test(span.text)) continue;
    const values = readEnumeration(flattened, spans, index);
    // One value is a mention, not an enumeration. Two is a claimed set.
    if (values.length < 2) continue;
    claims.push({
      kind: 'enum-set',
      line: lineAt(masked, span.start),
      field: span.text,
      values,
    });
  }

  CARRIES.lastIndex = 0;
  let carried = CARRIES.exec(flattened);
  while (carried !== null) {
    claims.push({ kind: 'carries', line: lineAt(masked, carried.index), field: carried[1] });
    carried = CARRIES.exec(flattened);
  }

  return claims;
}

// ── the verdict ─────────────────────────────────────────────────────────────

export type ClaimRule = 'identifier-exists' | 'enum-set-matches' | 'field-not-optional';

export interface ClaimFailure {
  readonly document: string;
  readonly line: number;
  readonly rule: ClaimRule;
  readonly message: string;
}

export interface CheckInput {
  readonly document: string;
  readonly markdown: string;
  readonly fields: SchemaFields;
  /** Every SCREAMING_SNAKE name that occurs anywhere in the repository source. */
  readonly sourceIdentifiers: ReadonlySet<string>;
  /**
   * Names another repository implements, from `readCrossRepoIdentifiers()`.
   * Kept apart from `sourceIdentifiers` so the code never blurs "this repo
   * implements it" into "somebody signed off on it".
   */
  readonly exemptIdentifiers: ReadonlySet<string>;
}

export function checkDocument(input: CheckInput): ClaimFailure[] {
  const failures: ClaimFailure[] = [];

  for (const claim of extractClaims(input.markdown)) {
    if (claim.kind === 'identifier') {
      if (input.sourceIdentifiers.has(claim.name)) continue;
      if (input.exemptIdentifiers.has(claim.name)) continue;
      failures.push({
        document: input.document,
        line: claim.line,
        rule: 'identifier-exists',
        message: `\`${claim.name}\` is documented but appears nowhere in this repository's source. There are two honest answers and silence is not one of them: fix the name, or, if another repository implements it, add it to CROSS_REPO_IDENTIFIERS in scripts/check-doc-claims.ts with that repository and the \`path:line\` you read it at.`,
      });
      continue;
    }

    const field = input.fields.get(claim.field);
    if (!field || field.isAmbiguous) continue;

    if (claim.kind === 'enum-set') {
      if (!field.enumValues) continue;
      const documented = claim.values.toSorted().join(', ');
      const declared = field.enumValues.toSorted().join(', ');
      if (documented === declared) continue;
      failures.push({
        document: input.document,
        line: claim.line,
        rule: 'enum-set-matches',
        message: `\`${claim.field}\` is documented as (${documented}) but the schema declares (${declared}).`,
      });
      continue;
    }

    if (!field.isOptional) continue;
    failures.push({
      document: input.document,
      line: claim.line,
      rule: 'field-not-optional',
      message: `the document says an item carries \`${claim.field}\`, but the schema marks that field optional, so a response without it is valid.`,
    });
  }

  return failures;
}

// ── the shell ───────────────────────────────────────────────────────────────

function listPublishedDocuments(): string[] {
  const docs = readdirSync(join(REPO_ROOT, 'docs'))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => `docs/${name}`)
    .toSorted();
  return ['README.md', ...docs];
}

function isSkipped(relativePath: string): boolean {
  return SOURCE_SKIP.some(
    (skip) => relativePath === skip || relativePath.startsWith(`${skip}/`),
  );
}

function collectSourceFiles(relativePath: string, into: string[]): void {
  if (isSkipped(relativePath)) return;
  const absolute = join(REPO_ROOT, relativePath);
  const stats = statSync(absolute, { throwIfNoEntry: false });
  if (!stats) return;
  if (stats.isDirectory()) {
    for (const entry of readdirSync(absolute).toSorted()) {
      collectSourceFiles(join(relativePath, entry), into);
    }
    return;
  }
  if (!SOURCE_EXTENSIONS.has(extname(relativePath))) return;
  into.push(relativePath);
}

/**
 * Every SCREAMING_SNAKE name the source mentions. Deliberately a plain text
 * sweep and not a parse: a name is documented as a string the reader types, and
 * it is equally real in `process.env.X`, in a shell `${X:-default}` and in a
 * Dockerfile `ENV X=`. Restricting the sweep to `src/` would fail the container
 * layer's own variables, which are implemented in shell and are correct.
 */
function readSourceIdentifiers(): ReadonlySet<string> {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) collectSourceFiles(root, files);
  const found = new Set<string>();
  const pattern = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  return found;
}

function main(): void {
  const fields = collectSchemaFields();
  const sourceIdentifiers = readSourceIdentifiers();
  const exemptIdentifiers = readCrossRepoIdentifiers();
  const documents = listPublishedDocuments();

  const failures: ClaimFailure[] = [];
  for (const document of documents) {
    const markdown = readFileSync(join(REPO_ROOT, document), 'utf8');
    failures.push(
      ...checkDocument({ document, markdown, fields, sourceIdentifiers, exemptIdentifiers }),
    );
  }

  const ambiguous = [...fields.values()].filter((field) => field.isAmbiguous);
  for (const field of ambiguous) {
    console.error(
      `  note: \`${field.name}\` is declared differently by two schemas, so claims about it are not checked.`,
    );
  }

  if (failures.length === 0) {
    console.log(
      `  the docs and the schema agree (${String(documents.length)} documents, ${String(fields.size)} fields, ${String(UNCHECKED_CLAIMS.length)} claim shapes deliberately unchecked)`,
    );
    for (const entry of CROSS_REPO_IDENTIFIERS) {
      console.log(
        `  cross-repo: \`${entry.identifier}\` is ${entry.repository}'s, read at ${entry.verifiedAt.join(' and ')} on ${entry.verifiedOn}`,
      );
    }
    return;
  }

  for (const failure of failures) {
    console.error(`✖ doc claims: ${failure.document}:${String(failure.line)} [${failure.rule}] ${failure.message}`);
  }
  console.error(
    `  ${String(failures.length)} documented claim(s) the code contradicts. Fix the document or fix the code; do not relax the rule.`,
  );
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && relative(fileURLToPath(import.meta.url), invokedPath) === '') {
  main();
}
