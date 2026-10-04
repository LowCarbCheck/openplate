/**
 * No log line, stderr write or console call under `src/` reads a caught
 * value's words.
 *
 * `logger.ts` accepts any string as a field, so the type system cannot see
 * `{ error: cause.message }`. This test can: it reads every source file, finds
 * every call that writes somewhere an operator (or a log shipper) will read,
 * and fails when the arguments mention `.message`, `.stack`, a template that
 * interpolates a caught value, or the retired `describeError`. The only way
 * error detail gets into a log is `errorFields` (a name and a code) or, at
 * boot and in the operator CLI, `scrubbedErrorMessage`; both live in
 * `src/log-error.ts`, which is not itself a log call and so needs no exemption.
 *
 * WHY A SCAN AND NOT A TYPE. A branded string type would have to be threaded
 * through 130 call sites and would stop at the first `as`. A scan is blunt and
 * cannot be talked around by a cast. Its failure mode is a false alarm
 * somebody has to rename away, which is the safe direction.
 *
 * THE SCANNER IS TESTED FIRST, against source text written for the purpose,
 * because a scanner that finds nothing would also pass the real scan. The
 * control for the real tree is in the commit message that added this file: the
 * scan was run with the last `cause.message` site still in place and failed on
 * it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `logger.warn(`, `ctx.logger.error(`, `context.logger?.warn(`, `log.info(`, `process.stderr.write(`, `console.log(`. */
const SINK =
  /\b(?:(?:[A-Za-z_$][\w$]*\.)*(?:logger|log)\??\.(?:debug|info|warn|error)|process\.(?:stderr|stdout)\.write|console\.(?:log|debug|info|warn|error))\(/g;

/** What an argument list must not contain. Each is checked against code only, never string text or comments. */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: '.message', pattern: /\.message\b/ },
  { name: '.stack', pattern: /\.stack\b/ },
  { name: 'describeError', pattern: /\bdescribe(?:Send)?Error\b/ },
  {
    name: 'a caught value in a template',
    pattern: /\$\{\s*(?:cause|err|error|e|reason)(?:\s*\}|\s*\??\.|\s+instanceof)/,
  },
  { name: 'String(caught value)', pattern: /\bString\(\s*(?:cause|err|error|e)\b/ },
];

/** Characters after which a `/` starts a regular expression and not a division. */
const REGEX_PRECEDERS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);

/** A space for every character but a newline, so masked text keeps its line numbers. */
function blank(char: string): string {
  return char === '\n' ? '\n' : ' ';
}

/**
 * The same text with comments and the TEXT of string and template literals
 * replaced by spaces, newlines kept so a line number still points at the
 * source. What stays is code: identifiers, dots, parentheses, and the
 * expressions inside `${...}`.
 */
export function maskNonCode(source: string): string {
  const out: string[] = [];
  let index = 0;
  let lastSignificant = '';

  function skipString(quote: string): void {
    out.push(' ');
    index += 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') {
        out.push(' ');
        index += 1;
      }
      out.push(blank(source[index] ?? ''));
      index += 1;
    }
    out.push(' ');
    index += 1;
  }

  function skipTemplate(): void {
    out.push(' ');
    index += 1;
    while (index < source.length && source[index] !== '`') {
      if (source[index] === '\\') {
        out.push(' ');
        index += 1;
        out.push(blank(source[index] ?? ''));
        index += 1;
        continue;
      }
      if (source[index] === '$' && source[index + 1] === '{') {
        out.push('${');
        index += 2;
        let depth = 1;
        while (index < source.length && depth > 0) {
          const char = source[index] ?? '';
          if (char === '`') {
            skipTemplate();
            continue;
          }
          if (char === "'" || char === '"') {
            skipString(char);
            continue;
          }
          if (char === '{') depth += 1;
          if (char === '}') depth -= 1;
          out.push(char);
          index += 1;
        }
        continue;
      }
      out.push(blank(source[index] ?? ''));
      index += 1;
    }
    out.push(' ');
    index += 1;
  }

  function skipRegex(): void {
    out.push(' ');
    index += 1;
    let isInClass = false;
    while (index < source.length) {
      const char = source[index] ?? '';
      if (char === '\\') {
        out.push('  ');
        index += 2;
        continue;
      }
      if (char === '[') isInClass = true;
      if (char === ']') isInClass = false;
      if (char === '/' && !isInClass) break;
      out.push(blank(char));
      index += 1;
    }
    out.push(' ');
    index += 1;
  }

  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        out.push(' ');
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        out.push(blank(source[index] ?? ''));
        index += 1;
      }
      out.push('  ');
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      skipString(char);
      lastSignificant = 'a';
      continue;
    }
    if (char === '`') {
      skipTemplate();
      lastSignificant = 'a';
      continue;
    }
    if (char === '/' && (lastSignificant === '' || REGEX_PRECEDERS.has(lastSignificant))) {
      skipRegex();
      lastSignificant = 'a';
      continue;
    }
    out.push(char);
    index += 1;
    if (char.trim() !== '') lastSignificant = char;
  }
  return out.join('');
}

export interface LogLeakFinding {
  line: number;
  reason: string;
  call: string;
}

/** The text of the call whose opening parenthesis is at `open`, up to and including its closing one. */
function callText(code: string, open: number): string {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '(') depth += 1;
    if (code[index] === ')') depth -= 1;
    if (depth === 0) return code.slice(open, index + 1);
  }
  return code.slice(open);
}

/** Every logging call in `source` whose arguments read a caught value's words. */
export function findLogLeaks(source: string): LogLeakFinding[] {
  const code = maskNonCode(source);
  const findings: LogLeakFinding[] = [];
  for (const match of code.matchAll(SINK)) {
    const open = match.index + match[0].length - 1;
    const call = callText(code, open);
    for (const rule of FORBIDDEN) {
      if (!rule.pattern.test(call)) continue;
      const line = code.slice(0, match.index).split('\n').length;
      findings.push({ line, reason: rule.name, call: call.replaceAll(/\s+/g, ' ').slice(0, 140) });
    }
  }
  return findings;
}

// ── The scanner, on text written to exercise it ────────────────────────────

test('the scanner flags each way a message reaches a log call', () => {
  const leaks = {
    '.message in a field': `logger.warn('x', { error: cause instanceof Error ? cause.message : 'unknown error' });`,
    'a multi-line call': `options.logger.error('x', {\n  accountId: 1,\n  error: failure.message,\n});`,
    'an optional-chained logger': `context.logger?.warn('x', { error: cause.message });`,
    '.stack': `ctx.logger.error('x', { stack: cause.stack });`,
    'a template': 'logger.warn(`failed: ${cause}`);',
    'a template with a member': 'logger.warn(`failed: ${error.name} ${cause}`);',
    'String(cause)': `logger.warn('x', { error: String(cause) });`,
    describeError: `logger.warn('x', { error: describeError(cause) });`,
    stderr: 'process.stderr.write(`${cause.message}\\n`);',
    console: `console.error('x', err.message);`,
    'a nested call': `logger.warn('x', { error: fallback(cause.message) });`,
  } satisfies Record<string, string>;
  for (const [label, source] of Object.entries(leaks)) {
    assert.ok(findLogLeaks(source).length > 0, `the scanner missed: ${label}`);
  }
});

test('the scanner passes the allowed doors, and text that only mentions a message', () => {
  const clean = {
    errorFields: `logger.warn('x', { ...errorFields(cause) });`,
    'scrubbed message': 'process.stderr.write(`${scrubbedErrorMessage(cause)}\\n`);',
    'a status': `logger.warn('x', { status: response.status, accountId: 1 });`,
    'a word in a string': `logger.warn('The .message of the cause is never logged', { a: 1 });`,
    'a word in a comment': `// logger.warn('x', { error: cause.message });\nlogger.warn('x');`,
    'a word in a block comment': `/* logger.warn(cause.message) */ logger.info('y');`,
    'a message outside any log call': `const text = cause.message;\nreturn text;`,
    'a regex before the call': `const re = /['"]/;\nlogger.warn('x', { ...errorFields(cause) });`,
    'a template that names a number': 'logger.warn(`tick ${attempt} of ${maxAttempts}`);',
  } satisfies Record<string, string>;
  for (const [label, source] of Object.entries(clean)) {
    assert.deepEqual(findLogLeaks(source), [], `false alarm: ${label}`);
  }
});

test('the scanner reports the line of the call', () => {
  const findings = findLogLeaks(`const a = 1;\nconst b = 2;\nlogger.warn('x', { error: cause.message });`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.line, 3);
});

// ── The tree ───────────────────────────────────────────────────────────────

const SRC = join(import.meta.dirname, '..', '..', 'src');

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => join(SRC, path));
}

test('the scan reads the tree it claims to read, and finds the call sites it should', () => {
  // Without this, an empty directory listing or a broken sink pattern would
  // make the next test pass for the wrong reason.
  const files = sourceFiles();
  assert.ok(files.length > 100, `expected the whole of src/, found ${files.length} files`);
  let sinks = 0;
  for (const file of files) {
    sinks += [...maskNonCode(readFileSync(file, 'utf8')).matchAll(SINK)].length;
  }
  assert.ok(sinks > 100, `expected over a hundred log calls, found ${sinks}`);
});

test('no log call under src/ reads .message, .stack or a caught value; errors go through log-error.ts', () => {
  const found: string[] = [];
  for (const file of sourceFiles()) {
    for (const finding of findLogLeaks(readFileSync(file, 'utf8'))) {
      found.push(`${relative(SRC, file)}:${finding.line} (${finding.reason}) ${finding.call}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    "These log calls pass a caught value's words to a log. Spread errorFields(cause) instead, or at boot or in a CLI use scrubbedErrorMessage(cause), both from src/log-error.ts.",
  );
});
