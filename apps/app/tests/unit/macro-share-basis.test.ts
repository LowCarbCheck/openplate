/**
 * Unit tests for `#app/lib/macro-share-basis`: the device-local kcal/g choice
 * behind every macro share visual. Calories are the default, so the cases that
 * matter are the ones where something other than a clean `'grams'` is stored.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  MACRO_SHARE_BASIS_STORAGE_KEY,
  readStoredMacroShareBasis,
  useMacroShareBasis,
  writeStoredMacroShareBasis,
} from '../../app/lib/macro-share-basis';

/** Installs a bare `window` whose `localStorage` is `storage`, and returns the restore. */
function withWindow(storage: Pick<Storage, 'getItem' | 'setItem'>): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, 'window', before);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}

/** A storage holding one value under the basis key. */
function storing(value: string | null): Pick<Storage, 'getItem' | 'setItem'> & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    getItem: (key) => (key === MACRO_SHARE_BASIS_STORAGE_KEY ? value : null),
    setItem: (_key, next) => void written.push(next),
  };
}

describe('readStoredMacroShareBasis', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('defaults to calories on the server, where there is no window', () => {
    assert.equal(readStoredMacroShareBasis(), 'kcal');
  });

  it('defaults to calories when nothing is stored', () => {
    restore = withWindow(storing(null));
    assert.equal(readStoredMacroShareBasis(), 'kcal');
  });

  it('reads a stored choice of grams', () => {
    restore = withWindow(storing('grams'));
    assert.equal(readStoredMacroShareBasis(), 'grams');
  });

  it('treats any other stored value as the default, never as grams', () => {
    for (const junk of ['', 'lb', 'GRAMS', 'g', '1', 'undefined']) {
      restore = withWindow(storing(junk));
      assert.equal(readStoredMacroShareBasis(), 'kcal', `"${junk}" must fall back to calories`);
      restore();
      restore = null;
    }
  });

  it('defaults to calories when reading storage throws', () => {
    restore = withWindow({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    });
    assert.equal(readStoredMacroShareBasis(), 'kcal');
  });
});

describe('writeStoredMacroShareBasis', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('writes the choice under the documented key', () => {
    const storage = storing(null);
    restore = withWindow(storage);
    writeStoredMacroShareBasis('grams');
    assert.deepEqual(storage.written, ['grams']);
    assert.equal(MACRO_SHARE_BASIS_STORAGE_KEY, 'openplate:macro-share-basis');
  });

  it('swallows a refused write, since a display preference must not take a page down', () => {
    restore = withWindow({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    assert.doesNotThrow(() => writeStoredMacroShareBasis('grams'));
  });
});

/** Draws the basis the hook hands back, so a test can read what a render decided. */
function Probe() {
  const [basis] = useMacroShareBasis();
  return createElement('span', { 'data-basis': basis });
}

describe('useMacroShareBasis', () => {
  it('renders the default on the server whatever is stored, so hydration agrees with the markup', () => {
    const restore = withWindow(storing('grams'));
    try {
      assert.match(renderToStaticMarkup(createElement(Probe)), /data-basis="kcal"/);
      // Control: the stored value really is grams, so the probe above could have said so.
      assert.equal(readStoredMacroShareBasis(), 'grams');
    } finally {
      restore();
    }
  });
});
