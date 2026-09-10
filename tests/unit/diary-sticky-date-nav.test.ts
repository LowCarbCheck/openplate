/**
 * The diary is the ONE page whose date navigator pins, and the sticky bar is
 * the diary's alone.
 *
 * Both halves matter. The first is the feature: on a long day the person
 * scrolls past the top of the page, and without a pinned navigator nothing on
 * screen answers "which day am I reading" and nothing steps to the day before.
 * The second is the restraint: `StickySubheader` costs vertical space on every
 * scroll, so a page with no equivalent control gains a bar that says nothing.
 * The dashboard in particular has no date selector and is explicitly excluded.
 * A future route that imports this component fails here and arrives in review
 * as a question, which is the point.
 *
 * There is no DOM in this suite and the diary page component is not exported,
 * so this reads the source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROUTES_DIR = fileURLToPath(new URL('../../app/routes/', import.meta.url));
const DIARY_PATH = join(ROUTES_DIR, 'diary.tsx');

const diarySource = readFileSync(DIARY_PATH, 'utf8');

describe('the diary date navigator pins under the app header', () => {
  it('imports StickySubheader', () => {
    assert.match(
      diarySource,
      /import \{ StickySubheader \} from '#app\/components\/sticky-subheader';/,
      'app/routes/diary.tsx must import `StickySubheader` from `#app/components/sticky-subheader`.',
    );
  });

  it('wraps <DateNav> in <StickySubheader>', () => {
    assert.match(
      diarySource,
      /<StickySubheader>\s*<DateNav\b[^>]*\/>\s*<\/StickySubheader>/,
      'The `<DateNav ... />` in the diary page component must be wrapped in `<StickySubheader>` so it stays on ' +
        'screen while the day scrolls. Found a `<DateNav>` that is not inside one.',
    );
  });

  it('renders exactly one DateNav, and it is the wrapped one', () => {
    const uses = diarySource.match(/<DateNav\b/g) ?? [];
    assert.equal(uses.length, 1, `Expected one <DateNav> in diary.tsx, found ${uses.length}. Wrap each one, or none.`);
  });
});

describe('the sticky subheader belongs to the diary alone', () => {
  it('no other route file imports it', () => {
    const offenders = readdirSync(ROUTES_DIR)
      .filter((name) => name.endsWith('.tsx') && name !== 'diary.tsx')
      .filter((name) => readFileSync(join(ROUTES_DIR, name), 'utf8').includes('sticky-subheader'));

    assert.deepEqual(
      offenders,
      [],
      `Only app/routes/diary.tsx may use StickySubheader; these routes also import it: ${offenders.join(', ')}. ` +
        `The bar exists for a control the page cannot afford to scroll away. The dashboard has no date selector ` +
        `and was deliberately left with the sticky header alone. If a new page really needs a second pinned bar, ` +
        `that is a design decision for a person, so widen this list on purpose rather than to get the gate green.`,
    );
  });
});
