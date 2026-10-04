/**
 * NO TIER NAME IN THE APP'S STRING LITERALS (M2/05).
 *
 * This repository is public. What a tier is called is the biller's to say and
 * arrives as data (`PlanOffer.tiers`); the app displays it and compiles in
 * none. A name typed into a string here would be a second source of truth and
 * a leak of a commercial decision into a public repo.
 *
 * WHAT IS SCANNED: every string literal and template literal text in
 * `app/**` `.ts` and `.tsx`, for the four names as WHOLE WORDS with their
 * capital letter. Comments are skipped: a comment may say what a gate is for.
 * Lower case is not scanned, because `max` is a CSS utility prefix and a
 * function name, and the names are never written that way in copy.
 *
 * THE SCANNER IS A SMALL LEXER, NOT A REGEX OVER THE FILE, so a quote inside a
 * comment or a regex does not swallow the code after it. It is itself tested
 * below against planted violations and against the four lookalikes it must
 * not flag (a comment, a longer word, a lower-case word, a name inside code).
 *
 * THE FEATURE WORDS ARE NOT TIER NAMES: `fasting`, `pantry`, `voice`, `chat`
 * are what a person can do, and the app names them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The four names the biller owns. Held here as parts, so this file does not carry them as a word. */
const TIER_NAMES: readonly string[] = [['F', 'ree'], ['B', 'asic'], ['P', 'lus'], ['M', 'ax']].map((parts) => parts.join(''));

const NAME_PATTERN = new RegExp(`\\b(?:${TIER_NAMES.join('|')})\\b`, 'g');

/** A hit: which name, and where. */
interface Hit {
  name: string;
  line: number;
}

/**
 * Characters after which a `/` starts a regular expression and not a division.
 * NOT `<`, `>` or `}`: in a `.tsx` file a `/` after them is the slash of a
 * closing tag (`</div>`) or of a self-closing one (`<A x={y} />`), and reading
 * it as a regex swallows the markup after it.
 */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^']);

/**
 * Every tier name inside a string or template literal of `source`.
 *
 * @param source - the text of one `.ts` or `.tsx` file.
 */
export function findTierNames(source: string): Hit[] {
  const hits: Hit[] = [];
  let line = 1;
  let index = 0;
  /** `${` depths of the template literals the lexer is inside, so `}` can resume the template. */
  const templateDepths: number[] = [];
  let braceDepth = 0;
  let previous = '';

  const scanText = (text: string, startLine: number): void => {
    for (const match of text.matchAll(NAME_PATTERN)) {
      const before = text.slice(0, match.index);
      hits.push({ name: match[0], line: startLine + [...before].filter((char) => char === '\n').length });
    }
  };

  /** Reads a quoted string from `index` (on the opening quote) and returns its text. */
  const readQuoted = (quote: string): string => {
    const start = index + 1;
    index += 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') index += 1;
      if (source[index] === '\n') line += 1;
      index += 1;
    }
    const text = source.slice(start, index);
    index += 1;
    return text;
  };

  /** Reads template text from `index` up to the closing backtick or the next `${`, and reports whether it stopped at `${`. */
  const readTemplateChunk = (): boolean => {
    const startLine = line;
    const start = index;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '\n') line += 1;
      if (char === '`') {
        scanText(source.slice(start, index), startLine);
        index += 1;
        return false;
      }
      if (char === '$' && source[index + 1] === '{') {
        scanText(source.slice(start, index), startLine);
        index += 2;
        return true;
      }
      index += 1;
    }
    return false;
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const startLine = line;
      scanText(readQuoted(char), startLine);
      previous = char;
      continue;
    }
    if (char === '`') {
      index += 1;
      if (readTemplateChunk()) {
        templateDepths.push(braceDepth);
        braceDepth += 1;
      }
      previous = '`';
      continue;
    }
    if (char === '/' && (previous === '' || REGEX_PRECEDERS.has(previous))) {
      // A regular expression literal: skip it whole, classes included.
      index += 1;
      let isInClass = false;
      while (index < source.length && (isInClass || source[index] !== '/')) {
        if (source[index] === '\\') index += 1;
        else if (source[index] === '[') isInClass = true;
        else if (source[index] === ']') isInClass = false;
        index += 1;
      }
      index += 1;
      previous = '/';
      continue;
    }
    if (char === '{') braceDepth += 1;
    if (char === '}') {
      braceDepth -= 1;
      if (templateDepths.at(-1) === braceDepth) {
        templateDepths.pop();
        index += 1;
        if (readTemplateChunk()) {
          templateDepths.push(braceDepth);
          braceDepth += 1;
        }
        previous = '`';
        continue;
      }
    }
    if (!/\s/.test(char ?? '')) previous = char ?? '';
    index += 1;
  }
  return hits;
}

/** Every `.ts` and `.tsx` file under `dir`, as paths relative to the app. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFilesUnder(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

const [FREE, BASIC, PLUS, MAX] = TIER_NAMES;

describe('the scanner', () => {
  it('flags each name inside each kind of string literal', () => {
    assert.deepEqual(findTierNames(`const a = '${FREE} plan';`).map((hit) => hit.name), [FREE]);
    assert.deepEqual(findTierNames(`const a = "the ${BASIC} one";`).map((hit) => hit.name), [BASIC]);
    assert.deepEqual(findTierNames(`const a = \`${PLUS} \${x} ${MAX}\`;`).map((hit) => hit.name), [PLUS, MAX]);
  });

  it('reports the line of the hit', () => {
    assert.deepEqual(findTierNames(`const a = 1;\n\nconst b = '${MAX}';`).map((hit) => hit.line), [3]);
  });

  it('control: does not flag a comment, a longer word, a lower-case word or a name in code', () => {
    assert.deepEqual(findTierNames(`// ${FREE} is a word in a comment\nconst a = 1;`), []);
    assert.deepEqual(findTierNames(`/* ${PLUS}\n${MAX} */ const a = 1;`), []);
    assert.deepEqual(findTierNames(`const a = '${BASIC}ally fine, ${PLUS}ses and ${FREE.toLowerCase()}';`), []);
    assert.deepEqual(findTierNames(`const ${FREE}Thing = 1;`), []);
  });

  it('is not thrown off by a quote inside a comment or a regular expression', () => {
    assert.deepEqual(findTierNames(`// it's a comment\nconst a = '${MAX}';`).map((hit) => hit.name), [MAX]);
    assert.deepEqual(findTierNames(`const re = /['"]/g;\nconst a = '${MAX}';`).map((hit) => hit.name), [MAX]);
  });

  it('is not thrown off by closing and self-closing JSX tags', () => {
    const jsx = `const a = <div><span>x</span><B y={z} /><C /></div>;\nconst b = '${MAX}';`;
    assert.deepEqual(findTierNames(jsx).map((hit) => hit.name), [MAX]);
  });

  it('reads the text of a template after an expression in it', () => {
    assert.deepEqual(findTierNames(`const a = \`\${ {x: 1}.x } ${FREE}\`;`).map((hit) => hit.name), [FREE]);
  });
});

describe('the app source', () => {
  const files = sourceFilesUnder(join(process.cwd(), 'app'));

  it('is scanning a real, populated tree', () => {
    assert.ok(files.length > 300, `only ${files.length} source files were found`);
  });

  it('carries no tier name in a string literal', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of findTierNames(readFileSync(file, 'utf8'))) {
        offenders.push(`${file}:${hit.line} ${hit.name}`);
      }
    }
    assert.deepEqual(offenders, [], 'tier names come from the biller as data and are never typed here');
  });
});
