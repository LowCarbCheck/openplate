/**
 * The reader for a page in the mounted content folder (`CONTENT_DIR`, M246).
 *
 * A deliberately small markdown reader, written for one contract and nothing
 * more: the file format that `openplate-billing/legal/CONTRACT.md` fixes and
 * `docs/content.md` restates for a self-hoster. It follows the hand-written
 * pattern of `openplate-website/scripts/lib/markdown.ts` (no dependency, a
 * typed tree out), with one difference that is the point of this module:
 *
 * ── IT REFUSES, IT NEVER DROPS AND NEVER ESCAPES ──
 * The website's reader drops a construct it does not know and reports it. This
 * one throws. The pages it reads are legal documents, so a stray `<br>` that
 * showed as text, or a table that quietly vanished, would publish a document
 * nobody wrote. `ContentRefusedError` carries every problem with its line, the
 * reader logs them, and the page answers 503 instead of printing half a text.
 *
 * ── PURE ──
 * No `node:` import and no I/O, so the rules are unit-tested on strings
 * (`tests/unit/content-markdown.test.ts`) and the same tree renders on the
 * server and the client. The disk half is `content.server.ts`.
 */

/** A run of text inside a block. `break` is a hard line break (a backslash at the end of a line). */
export type ContentInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: ContentInline[] }
  | { kind: 'emphasis'; children: ContentInline[] }
  | { kind: 'link'; href: string; children: ContentInline[] }
  | { kind: 'break' };

/** One entry of a definition list: a term and the definitions that follow it. */
export interface ContentDefinition {
  term: ContentInline[];
  definitions: ContentInline[][];
}

/** A block of the body. The subset is closed: nothing outside these four kinds can be written. */
export type ContentBlock =
  | { kind: 'heading'; level: 2 | 3; children: ContentInline[] }
  | { kind: 'paragraph'; children: ContentInline[] }
  | { kind: 'list'; isOrdered: boolean; items: ContentInline[][] }
  | { kind: 'definitions'; entries: ContentDefinition[] };

/** A named `:::section` of a file, which the app places around a form it keeps in code. */
export interface ContentSection {
  name: string;
  blocks: ContentBlock[];
}

/** One parsed file. */
export interface ContentDocument {
  /** The page's h1, from front matter. */
  title: string;
  /** The date the document last changed, `YYYY-MM-DD`, from front matter. */
  updated: string;
  /** Every block outside a section. */
  body: ContentBlock[];
  /** Every named section, each exactly once, in file order. */
  sections: ContentSection[];
}

/** One reason a file was refused. `line` is 1-based, or `null` for the whole file. */
export interface ContentProblem {
  line: number | null;
  message: string;
}

/** Thrown for a file that breaks the contract. The message lists every problem, so one log line says it all. */
export class ContentRefusedError extends Error {
  readonly problems: readonly ContentProblem[];

  constructor(problems: readonly ContentProblem[]) {
    super(
      `the content file breaks the contract: ${problems
        .map((problem) => (problem.line === null ? problem.message : `line ${problem.line}: ${problem.message}`))
        .join('; ')}`,
    );
    this.name = 'ContentRefusedError';
    this.problems = problems;
  }
}

// =============================================================================
// Rules shared by the front matter and the body
// =============================================================================

/** The only link targets a page may carry (CONTRACT.md section 3). */
const ALLOWED_LINK_PREFIXES = ['/', 'https://', 'mailto:', 'tel:'] as const;
/** A backslash may only escape these. */
const ESCAPABLE = new Set(['\\', '*', '[', ']']);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LINK_AT = /^\[([^\]\\]+)\]\(([^)\s]+)\)/;
const HEADING = /^(#{2,3}) (\S.*)$/;
const BULLET = /^- (.*)$/;
const ORDERED = /^\d+\. (.*)$/;
const DEFINITION = /^: (.*)$/;

/**
 * Whether a link target is one a page may carry.
 *
 * STRICTER THAN "STARTS WITH /" on purpose: `//host` and `/\host` both start
 * with a slash, and a browser reads both as another origin. A path in the app
 * is a slash followed by something that is not a second separator.
 */
export function isAllowedContentHref(href: string): boolean {
  if (href.startsWith('//') || href.startsWith('/\\')) return false;
  return ALLOWED_LINK_PREFIXES.some((prefix) => href.startsWith(prefix) && href.length > prefix.length);
}

/** Whether a link target is a path inside this app, which the renderer hands to the router. */
export function isAppPath(href: string): boolean {
  return isAllowedContentHref(href) && href.startsWith('/');
}

/**
 * Every construct the contract refuses anywhere in a line of text.
 *
 * Raw HTML is "`<` followed by a letter, `/`, `!` or `?`" (CONTRACT.md
 * section 3). A lone `<` before a digit or a space ("< 5 g") stays text.
 */
function forbiddenInText(text: string): string[] {
  const problems: string[] = [];
  if (/<[A-Za-z/!?]/.test(text)) problems.push('raw HTML is not allowed');
  if (/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(text)) problems.push('an HTML character reference is not allowed');
  if (text.includes('![')) problems.push('an image is not allowed');
  if (text.includes('`')) problems.push('a code span is not allowed');
  if (text.includes('{{') || text.includes('}}')) problems.push('a page carries no placeholder');
  return problems;
}

// =============================================================================
// Front matter
// =============================================================================

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

interface FrontMatter {
  title: string;
  updated: string;
  /** Index of the first body line. */
  bodyStart: number;
}

function readFrontMatter(lines: readonly string[], report: (problem: ContentProblem) => void): FrontMatter | null {
  if (lines[0] !== '---') {
    report({ line: 1, message: 'the file must start with a front matter line ---' });
    return null;
  }
  const close = lines.indexOf('---', 1);
  if (close === -1) {
    report({ line: 1, message: 'the front matter is never closed with ---' });
    return null;
  }
  const keys: string[] = [];
  const values = new Map<string, string>();
  for (let index = 1; index < close; index += 1) {
    const match = /^([a-z]+): (.+)$/.exec(lines[index] ?? '');
    if (match === null) {
      report({ line: index + 1, message: 'a front matter line must read <key>: <value>' });
      continue;
    }
    const [, key = '', value = ''] = match;
    keys.push(key);
    values.set(key, value);
    for (const message of forbiddenInText(value)) report({ line: index + 1, message: `${key}: ${message}` });
    if (key === 'title' && /[*[\]\\]/.test(value)) {
      report({ line: index + 1, message: 'title: front matter is plain text, no markup' });
    }
  }
  if (keys.join(',') !== 'title,updated') {
    report({ line: 2, message: `front matter keys must be exactly title, updated, in that order; found ${keys.join(', ') || 'none'}` });
  }
  const title = values.get('title') ?? '';
  const updated = values.get('updated') ?? '';
  if (updated !== '' && !isCalendarDate(updated)) {
    report({ line: null, message: `updated "${updated}" is not a YYYY-MM-DD calendar date` });
  }
  return { title, updated, bodyStart: close + 1 };
}

// =============================================================================
// Inline text
// =============================================================================

type InlineFrameKind = 'root' | 'strong' | 'emphasis';

interface InlineFrame {
  kind: InlineFrameKind;
  children: ContentInline[];
}

/** Appends text, merging it into a text run that is already last. */
function appendText(children: ContentInline[], text: string): void {
  const last = children.at(-1);
  if (last?.kind === 'text') {
    last.text += text;
    return;
  }
  children.push({ kind: 'text', text });
}

/** Opens a `**` or `*` frame, or closes it when it is the innermost one open. */
function toggleFrame(stack: InlineFrame[], kind: 'strong' | 'emphasis', report: (message: string) => void): void {
  const top = stack.at(-1);
  if (top?.kind === kind) {
    stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) throw new Error('the root inline frame was closed');
    parent.children.push({ kind, children: top.children });
    return;
  }
  if (stack.some((frame) => frame.kind === kind)) {
    report(`${kind === 'strong' ? '**' : '*'} closes across another marker; close the inner one first`);
    return;
  }
  stack.push({ kind, children: [] });
}

/** The text of a line as inline runs, with every problem reported and nothing dropped silently. */
function parseInline(text: string, report: (message: string) => void): ContentInline[] {
  const stack: InlineFrame[] = [{ kind: 'root', children: [] }];
  let index = 0;
  while (index < text.length) {
    const frame = stack.at(-1);
    if (frame === undefined) throw new Error('the inline stack is empty');
    const char = text.charAt(index);
    if (char === '\\') {
      const next = text.charAt(index + 1);
      if (!ESCAPABLE.has(next)) report(`a backslash may only escape \\ * [ ], found \\${next}`);
      else appendText(frame.children, next);
      index += 2;
      continue;
    }
    if (char === '[') {
      const link = LINK_AT.exec(text.slice(index));
      if (link === null) {
        report('a [ that starts no [text](target) link; write \\[ for a literal one');
        index += 1;
        continue;
      }
      const [whole, label = '', href = ''] = link;
      if (!isAllowedContentHref(href)) {
        report(`link target "${href}" must be an app path, https://, mailto: or tel:`);
      }
      frame.children.push({ kind: 'link', href, children: parseInline(label, report) });
      index += whole.length;
      continue;
    }
    if (char === ']') {
      report('a ] outside a link; write \\] for a literal one');
      index += 1;
      continue;
    }
    if (char === '*') {
      let run = 1;
      while (text.charAt(index + run) === '*') run += 1;
      if (run === 2) toggleFrame(stack, 'strong', report);
      else if (run === 1) toggleFrame(stack, 'emphasis', report);
      else report(`a run of ${run} asterisks is not allowed`);
      index += run;
      continue;
    }
    appendText(frame.children, char);
    index += 1;
  }
  for (const open of stack.slice(1)) {
    report(`${open.kind === 'strong' ? '**strong**' : '*emphasis*'} is opened and never closed; write \\* for a literal asterisk`);
  }
  return stack[0]?.children ?? [];
}

/**
 * Whether a line ends in a hard line break: an ODD run of trailing
 * backslashes. `\\` at the end is an escaped, literal backslash.
 */
function endsWithHardBreak(text: string): boolean {
  const trailing = /\\+$/.exec(text)?.[0].length ?? 0;
  return trailing % 2 === 1;
}

// =============================================================================
// Blocks
// =============================================================================

interface BodyLine {
  text: string;
  /** 1-based line number in the file. */
  line: number;
}

/** A structural problem with the start of a line, or `null` when the line may start that way. */
function lineStartProblem(text: string): string | null {
  if (/^\s/.test(text)) return 'an indented line is not allowed (no code blocks, no nested lists)';
  if (/^(?:```|~~~)/.test(text)) return 'a code fence is not allowed';
  if (text.startsWith('>')) return 'a block quote is not allowed';
  if (text.startsWith('|')) return 'a table is not allowed';
  if (/^[*+] /.test(text)) return 'a bullet is written with - ';
  if (text.startsWith('#') && !HEADING.test(text)) return 'only ## and ### headings are allowed';
  if (text.startsWith(':::')) return 'a section line reads :::section <name> or :::';
  return null;
}

/** Inline runs for one line, refusing a hard break where the contract has no paragraph to continue. */
function inlineOf(input: { entry: BodyLine; text: string; report: (problem: ContentProblem) => void }): ContentInline[] {
  const { entry, text, report } = input;
  if (!endsWithHardBreak(text)) return parseInline(text, (message) => report({ line: entry.line, message }));
  report({ line: entry.line, message: 'a hard line break belongs inside a paragraph, before its next line' });
  return parseInline(text.slice(0, -1), (message) => report({ line: entry.line, message }));
}

/** A block of `Term` and `: definition` lines. */
function readDefinitions(chunk: readonly BodyLine[], report: (problem: ContentProblem) => void): ContentBlock {
  const entries: ContentDefinition[] = [];
  for (const entry of chunk) {
    const definition = DEFINITION.exec(entry.text);
    const current = entries.at(-1);
    if (definition !== null) {
      if (current === undefined) {
        report({ line: entry.line, message: 'a : definition line must follow a term line' });
        continue;
      }
      current.definitions.push(inlineOf({ entry, text: definition[1] ?? '', report }));
      continue;
    }
    if (current !== undefined && current.definitions.length === 0) {
      report({ line: entry.line, message: 'a definition list term must be followed by a : definition line' });
    }
    if (HEADING.test(entry.text) || BULLET.test(entry.text) || ORDERED.test(entry.text)) {
      report({ line: entry.line, message: 'a definition list term cannot be a heading or a list item' });
    }
    entries.push({ term: inlineOf({ entry, text: entry.text, report }), definitions: [] });
  }
  const last = entries.at(-1);
  if (last !== undefined && last.definitions.length === 0) {
    report({ line: chunk.at(-1)?.line ?? null, message: 'a definition list term must be followed by a : definition line' });
  }
  return { kind: 'definitions', entries };
}

/** The lines of one paragraph, joined with a space or a hard break. */
function paragraphOf(lines: readonly BodyLine[], report: (problem: ContentProblem) => void): ContentBlock {
  const children: ContentInline[] = [];
  lines.forEach((entry, position) => {
    const isLast = position === lines.length - 1;
    const isBreak = endsWithHardBreak(entry.text);
    const text = isBreak ? entry.text.slice(0, -1) : entry.text;
    if (isBreak && isLast) {
      report({ line: entry.line, message: 'a hard line break must be followed by a line of the same paragraph' });
    }
    for (const run of parseInline(text, (message) => report({ line: entry.line, message }))) {
      if (run.kind === 'text') appendText(children, run.text);
      else children.push(run);
    }
    if (isLast) return;
    if (isBreak) children.push({ kind: 'break' });
    else appendText(children, ' ');
  });
  return { kind: 'paragraph', children };
}

/** One run of non-blank lines, as the blocks it holds. */
function blocksOfChunk(chunk: readonly BodyLine[], report: (problem: ContentProblem) => void): ContentBlock[] {
  if (chunk.some((entry) => DEFINITION.test(entry.text))) return [readDefinitions(chunk, report)];

  const blocks: ContentBlock[] = [];
  let paragraph: BodyLine[] = [];
  let list: { isOrdered: boolean; items: ContentInline[][] } | null = null;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push(paragraphOf(paragraph, report));
    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== null) blocks.push({ kind: 'list', isOrdered: list.isOrdered, items: list.items });
    list = null;
  };

  for (const entry of chunk) {
    const heading = HEADING.exec(entry.text);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1] === '##' ? 2 : 3;
      blocks.push({ kind: 'heading', level, children: inlineOf({ entry, text: heading[2] ?? '', report }) });
      continue;
    }
    const bullet = BULLET.exec(entry.text);
    const ordered = ORDERED.exec(entry.text);
    const item = bullet ?? ordered;
    if (item !== null) {
      flushParagraph();
      const isOrdered = bullet === null;
      if (list !== null && list.isOrdered !== isOrdered) flushList();
      list ??= { isOrdered, items: [] };
      list.items.push(inlineOf({ entry, text: item[1] ?? '', report }));
      continue;
    }
    if (list !== null) {
      report({ line: entry.line, message: 'a list item continues on its own line; end the list with a blank line first' });
      continue;
    }
    paragraph.push(entry);
  }
  flushParagraph();
  flushList();
  return blocks;
}

// =============================================================================
// The whole file
// =============================================================================

interface BodyWalk {
  body: BodyLine[][];
  sections: Map<string, BodyLine[][]>;
}

/** Splits the body into chunks of non-blank lines, each filed under the body or its open section. */
function walkBody(input: {
  lines: readonly string[];
  start: number;
  expectedSections: readonly string[];
  report: (problem: ContentProblem) => void;
}): BodyWalk {
  const { lines, start, expectedSections, report } = input;
  const walk: BodyWalk = { body: [], sections: new Map() };
  let open: { name: string; line: number } | null = null;
  let chunk: BodyLine[] = [];
  const target = (): BodyLine[][] => (open === null ? walk.body : (walk.sections.get(open.name) ?? walk.body));
  const flush = (): void => {
    if (chunk.length > 0) target().push(chunk);
    chunk = [];
  };

  for (let index = start; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    const line = index + 1;
    if (text === '') {
      flush();
      continue;
    }
    const opening = /^:::section (\S+)$/.exec(text);
    if (opening !== null) {
      flush();
      const name = opening[1] ?? '';
      if (open !== null) report({ line, message: `section "${name}" opens inside section "${open.name}"` });
      if (!KEBAB.test(name)) report({ line, message: `section name "${name}" is not lowercase kebab-case` });
      if (walk.sections.has(name)) report({ line, message: `section "${name}" appears twice` });
      if (!expectedSections.includes(name)) report({ line, message: `section "${name}" is not one this page carries` });
      walk.sections.set(name, walk.sections.get(name) ?? []);
      open = { name, line };
      continue;
    }
    if (text === ':::') {
      flush();
      if (open === null) report({ line, message: '::: closes no open section' });
      open = null;
      continue;
    }
    const startProblem = lineStartProblem(text);
    if (startProblem !== null) report({ line, message: startProblem });
    for (const message of forbiddenInText(text)) report({ line, message });
    chunk.push({ text, line });
  }
  flush();
  if (open !== null) report({ line: open.line, message: `section "${open.name}" is never closed` });
  for (const name of expectedSections) {
    if (!walk.sections.has(name)) report({ line: null, message: `section "${name}" is missing` });
  }
  return walk;
}

/**
 * Parses one content file, or throws `ContentRefusedError` listing every
 * problem in it.
 *
 * @param input.source - the file's text, decoded as UTF-8.
 * @param input.sections - the named sections this page must carry, each exactly once. Empty for a page with none.
 */
export function parseContentDocument(input: { source: string; sections: readonly string[] }): ContentDocument {
  const problems: ContentProblem[] = [];
  const report = (problem: ContentProblem): void => {
    problems.push(problem);
  };
  if (input.source.startsWith('﻿')) report({ line: 1, message: 'the file starts with a byte order mark' });
  if (input.source.includes('\r')) report({ line: null, message: 'the file has CR line ends; use LF' });

  const lines = input.source.replace(/^﻿/, '').split('\n');
  const frontMatter = readFrontMatter(lines, report);
  if (frontMatter === null) throw new ContentRefusedError(problems);

  const walk = walkBody({ lines, start: frontMatter.bodyStart, expectedSections: input.sections, report });
  const body = walk.body.flatMap((chunk) => blocksOfChunk(chunk, report));
  const sections = [...walk.sections].map(([name, chunks]) => ({
    name,
    blocks: chunks.flatMap((chunk) => blocksOfChunk(chunk, report)),
  }));

  if (problems.length > 0) throw new ContentRefusedError(problems);
  return { title: frontMatter.title, updated: frontMatter.updated, body, sections };
}

/**
 * The blocks of one named section.
 *
 * @throws an `Error` when the document has no such section. The parser refuses
 * a file that lacks a section its page expects, so this is a caller asking for
 * a name it never declared, which is a bug in code and not in a file.
 */
export function sectionBlocks(document: Pick<ContentDocument, 'sections'>, name: string): ContentBlock[] {
  const section = document.sections.find((candidate) => candidate.name === name);
  if (section === undefined) throw new Error(`the content page has no section "${name}"`);
  return section.blocks;
}
