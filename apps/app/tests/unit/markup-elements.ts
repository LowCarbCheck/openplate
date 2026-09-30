/**
 * Reads whole elements out of `renderToStaticMarkup` output, for the tests
 * that have to tell a SHOWN layer from a reserved, hidden one.
 *
 * There is no DOM in this repo's unit tier, and a reserved layer carries the
 * same copy as the shown one, so "is this sentence in the markup" no longer
 * answers "does a person read it". These two helpers cut the markup into the
 * elements a needle marks, and take the hidden ones out.
 */

/** How many marked elements one call may return before the markup is called malformed. */
const MAX_ELEMENTS = 1000;

/**
 * Every element whose opening tag contains `needle`, as its outer markup, in
 * document order. An element nested inside an earlier match is not returned
 * on its own.
 *
 * @param markup - static markup from `renderToStaticMarkup`.
 * @param needle - text that appears in the opening tag, such as an attribute.
 * @returns the outer markup of each marked element.
 * @throws when a marked element is never closed.
 */
export function outerElements(markup: string, needle: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (let count = 1; count <= MAX_ELEMENTS; count += 1) {
    const hit = markup.indexOf(needle, from);
    if (hit === -1) return found;
    const start = markup.lastIndexOf('<', hit);
    const tag = /^<([a-z][a-z0-9]*)/.exec(markup.slice(start))?.[1];
    if (tag === undefined) throw new Error(`no opening tag carries ${needle}`);
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    pattern.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let match = pattern.exec(markup); match !== null; match = pattern.exec(markup)) {
      depth += match[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = pattern.lastIndex;
        break;
      }
    }
    if (end === -1) throw new Error(`the <${tag}> carrying ${needle} is never closed`);
    found.push(markup.slice(start, end));
    from = end;
  }
  throw new Error(`more than ${MAX_ELEMENTS} elements carry ${needle}`);
}

/**
 * Whether an element's OPENING tag marks it hidden from a person: `aria-hidden`
 * and the `invisible` class, the pair every reserved layer carries.
 *
 * @param element - outer markup from {@link outerElements}.
 * @returns true for a reserved, hidden layer.
 */
export function isHiddenLayer(element: string): boolean {
  const opening = element.slice(0, element.indexOf('>') + 1);
  const classes = /class="([^"]*)"/.exec(opening)?.[1]?.split(/\s+/) ?? [];
  return opening.includes('aria-hidden="true"') && classes.includes('invisible');
}

/**
 * The markup with every hidden layer marked by `needle` cut out: what a
 * person can read.
 *
 * @param markup - static markup.
 * @param needle - the attribute that marks a layer.
 * @returns the markup without its hidden layers.
 */
export function withoutHiddenLayers(markup: string, needle: string): string {
  let shown = markup;
  for (const element of outerElements(markup, needle)) {
    if (isHiddenLayer(element)) shown = shown.replace(element, '');
  }
  return shown;
}
