/**
 * The boot screen's "could not load" sentence, and the inline script that shows it (2026-09-27).
 *
 * THE CLAIMS.
 * - `AppLoading` renders the sentence on the server, in the catalog's words, marked with the
 *   attribute the script looks for and hidden with an INLINE style, so it holds its box from
 *   the first paint and needs no stylesheet to stay hidden.
 * - The script shows every marked line when a `<script>` or a `modulepreload` link fails
 *   before the app has started, and marks `<html>` so the stylesheet can stop the wave.
 * - A picture that fails before the app starts is hidden, not drawn broken.
 * - Once the app has started, nothing is shown for a failed script.
 * - A failure that fires before the sentence is parsed is shown once the document is parsed.
 *
 * THE CONTROLS. A stylesheet failure shows nothing, and so does any failure after the start,
 * so "shows the line" is not a script that shows it on every event. The browser tier
 * (`tests/e2e/offline-after-one-visit.spec.ts`) runs the same script in Chromium against the
 * production build.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { z } from 'zod';

import { AppLoading } from '../../app/components/app-loading';
import {
  APP_STARTED_ATTRIBUTE,
  BOOT_FAILED_ATTRIBUTE,
  BOOT_FAILED_LINE_ATTRIBUTE,
  BOOT_FAILURE_SCRIPT,
} from '../../app/lib/boot-failure';
import { withI18n } from './trends-i18n-harness';

/** The one English string this file reads, parsed so a renamed key fails here, on load. */
const englishCatalog = z
  .looseObject({ chrome: z.looseObject({ bootFailed: z.string() }) })
  .parse(JSON.parse(readFileSync(new URL('../../app/i18n/locales/en/common.json', import.meta.url), 'utf8')));

/** The slice of an element the script touches. */
interface FakeElement {
  tagName: string;
  rel?: string;
  style: { visibility: string };
}

type Listener = (event: { target: FakeElement | null }) => void;

/** A document and a window with just what the script reads, and a way to fire their events. */
function loadScript() {
  const windowListeners: Listener[] = [];
  const parsedListeners: Array<() => void> = [];
  const rootAttributes = new Set<string>();
  const lines: FakeElement[] = [];
  const sandbox = {
    window: {
      addEventListener: (type: string, listener: Listener): void => {
        if (type === 'error') windowListeners.push(listener);
      },
    },
    document: {
      documentElement: {
        setAttribute: (name: string): void => {
          rootAttributes.add(name);
        },
        hasAttribute: (name: string): boolean => rootAttributes.has(name),
      },
      querySelectorAll: (selector: string): FakeElement[] => (selector === `[${BOOT_FAILED_LINE_ATTRIBUTE}]` ? lines : []),
      addEventListener: (type: string, listener: () => void): void => {
        if (type === 'DOMContentLoaded') parsedListeners.push(listener);
      },
    },
  };
  runInNewContext(BOOT_FAILURE_SCRIPT, sandbox);
  return {
    rootAttributes,
    addLine: (): FakeElement => {
      const line = { tagName: 'P', style: { visibility: 'hidden' } };
      lines.push(line);
      return line;
    },
    fail: (target: FakeElement): void => {
      for (const listener of windowListeners) listener({ target });
    },
    finishParsing: (): void => {
      for (const listener of parsedListeners) listener();
    },
  };
}

const failedScript = (): FakeElement => ({ tagName: 'SCRIPT', style: { visibility: '' } });

describe('the boot screen sentence', () => {
  const markup = renderToStaticMarkup(withI18n(createElement(AppLoading, { label: 'Loading' })));

  it('is rendered by the server in the catalog words, marked and hidden inline', () => {
    const line = markup.match(new RegExp(`<p ${BOOT_FAILED_LINE_ATTRIBUTE}="" style="visibility:hidden"[^>]*>([^<]*)</p>`));
    assert.ok(line, markup);
    assert.equal(line[1].replaceAll('&#x27;', "'"), englishCatalog.chrome.bootFailed);
  });
});

describe('the boot failure script', () => {
  it('shows the line and marks the page when a script fails before the start', () => {
    const page = loadScript();
    const line = page.addLine();
    page.fail(failedScript());
    assert.equal(line.style.visibility, 'visible');
    assert.ok(page.rootAttributes.has(BOOT_FAILED_ATTRIBUTE));
  });

  it('shows the line for a modulepreload that fails', () => {
    const page = loadScript();
    const line = page.addLine();
    page.fail({ tagName: 'LINK', rel: 'modulepreload', style: { visibility: '' } });
    assert.equal(line.style.visibility, 'visible');
  });

  it('control: a stylesheet that fails shows nothing', () => {
    const page = loadScript();
    const line = page.addLine();
    page.fail({ tagName: 'LINK', rel: 'stylesheet', style: { visibility: '' } });
    assert.equal(line.style.visibility, 'hidden');
    assert.ok(!page.rootAttributes.has(BOOT_FAILED_ATTRIBUTE));
  });

  it('control: a script that fails after the app started shows nothing', () => {
    const page = loadScript();
    const line = page.addLine();
    page.rootAttributes.add(APP_STARTED_ATTRIBUTE);
    page.fail(failedScript());
    assert.equal(line.style.visibility, 'hidden');
  });

  it('hides a picture that fails before the start instead of drawing it broken', () => {
    const page = loadScript();
    const picture = { tagName: 'IMG', style: { visibility: '' } };
    page.fail(picture);
    assert.equal(picture.style.visibility, 'hidden');
  });

  it('shows a line parsed after the failure once the document is parsed', () => {
    const page = loadScript();
    page.fail(failedScript());
    const line = page.addLine();
    assert.equal(line.style.visibility, 'hidden');
    page.finishParsing();
    assert.equal(line.style.visibility, 'visible');
  });
});
