/**
 * The scanner behind `model-id-literals.test.ts`: finds a model id written as a
 * literal in text, comments included. Pure: it takes file contents and an allow
 * list and returns findings. Reading the tree is the test's job.
 *
 * TWO PATTERNS, because a model is named two ways:
 *  - a vendor prefix, a slash and an id (`google/gemini-3.7-flash`), the form
 *    OpenRouter takes;
 *  - a bare family name, a dash and a digit (`Gemini-3`, `gpt-5`), the form a
 *    comment or a doc uses.
 */

/**
 * A vendor prefix, then `/` and the first character of an id. Not preceded by a path or a word character.
 * Lowercase only: a model id is lowercase, and prose such as "Google/GitHub" is not one.
 */
const VENDOR_PREFIXED =
  /(?<![\w./-])(?:google|openai|anthropic|mistralai|meta-llama|qwen|x-ai|deepseek)\/[a-z0-9][\w.:-]*/g;

/** A family name, a dash and a digit. Not preceded by a word character. */
const FAMILY_NAME = /(?<![\w-])(?:gemini|gpt|claude|mistral|ministral|llama|qwen)-\d[\w.:-]*/gi;

/** One file to scan: its path from the app root with `/` separators, and its text. */
export interface ScannedFile {
  path: string;
  text: string;
}

/** A place where a model id may be written, and why. A reason is required: an allowance nobody can explain is a leak. */
export interface AllowedPath {
  /** A path from the app root. `*` matches within one segment, `**` matches across segments. */
  path: string;
  reason: string;
}

/** One model id found in one file. */
export interface ModelIdFinding {
  path: string;
  line: number;
  /** The text that matched. */
  match: string;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*\*|\*/g, (stars) => (stars === '**' ? '.*' : '[^/]*'));
  return new RegExp(`^${pattern}$`);
}

/** True when `path` is covered by one of the allowed entries. */
export function isAllowedPath(input: { path: string; allow: readonly AllowedPath[] }): boolean {
  return input.allow.some((entry) => globToRegExp(entry.path).test(input.path));
}

function lineOf(input: { text: string; index: number }): number {
  let line = 1;
  for (let at = 0; at < input.index; at += 1) {
    if (input.text.charCodeAt(at) === 10) line += 1;
  }
  return line;
}

/**
 * Every model id literal in `files`, except in an allowed path.
 *
 * @param input.files - the files to read, comments included.
 * @param input.allow - the paths that may hold a model id, each with its reason.
 * @returns one finding per match, in file order and then text order.
 */
export function findModelIdLiterals(input: {
  files: readonly ScannedFile[];
  allow: readonly AllowedPath[];
}): ModelIdFinding[] {
  const findings: ModelIdFinding[] = [];
  for (const file of input.files) {
    if (isAllowedPath({ path: file.path, allow: input.allow })) continue;
    // `vendor/family-9` matches both patterns. It is ONE literal, so a family
    // match that starts inside a vendor match is dropped.
    const vendorSpans: Array<{ start: number; end: number }> = [];
    for (const found of file.text.matchAll(VENDOR_PREFIXED)) {
      vendorSpans.push({ start: found.index, end: found.index + found[0].length });
      findings.push({ path: file.path, line: lineOf({ text: file.text, index: found.index }), match: found[0] });
    }
    for (const found of file.text.matchAll(FAMILY_NAME)) {
      const isInsideVendorMatch = vendorSpans.some((span) => found.index >= span.start && found.index < span.end);
      if (isInsideVendorMatch) continue;
      findings.push({ path: file.path, line: lineOf({ text: file.text, index: found.index }), match: found[0] });
    }
  }
  return findings.toSorted((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}
