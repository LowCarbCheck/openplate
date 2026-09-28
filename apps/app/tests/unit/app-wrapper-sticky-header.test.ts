/**
 * The app header pins to the top of the viewport, and it pins BELOW every Radix
 * portal.
 *
 * Two separate things are frozen here, and only the first is obvious:
 *
 * 1. The `<header>` in `InnerContent` carries `sticky` and `top-0`. Drop either
 *    and the header scrolls away, which is the whole defect this round fixed.
 * 2. Its z-index is at most 40. This is the part that would rot quietly. The
 *    diary's calendar popover, every Sheet and every Dialog is a Radix portal at
 *    `z-50`. A future "the header is behind something" report is very easy to
 *    close by bumping this bar to `z-50`, which fixes nothing and puts the
 *    header ON TOP of the open calendar. So the number is PARSED and compared,
 *    not string-matched: `z-50` fails with a message that names the contract.
 *
 * There is no DOM in this suite, so this reads the source. That is fine for a
 * class-string contract: the class string is a literal in the file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP_WRAPPER_PATH = fileURLToPath(new URL('../../app/components/app-wrapper.tsx', import.meta.url));

/** The class string on the one `<header>` element inside `InnerContent`. */
function readHeaderClassName(source: string): string {
  const innerContentAt = source.indexOf('function InnerContent(');
  assert.notEqual(innerContentAt, -1, 'app-wrapper.tsx no longer defines `InnerContent`; this test needs updating.');

  const headerAt = source.indexOf('<header', innerContentAt);
  assert.notEqual(headerAt, -1, 'No `<header` opening tag inside `InnerContent` in app-wrapper.tsx.');

  const openingTag = source.slice(headerAt, source.indexOf('>', headerAt));
  const match = /className="([^"]*)"/.exec(openingTag);
  assert.notEqual(match, null, `The <header> in InnerContent has no literal className: ${openingTag}`);
  // SAFETY: the assertion above rules out null.
  return match![1]!;
}

/** The numeric part of the single `z-<n>` class in a Tailwind class string. */
function readZIndex(className: string): number {
  const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(className);
  assert.notEqual(match, null, `No \`z-<number>\` class found in: ${className}`);
  return Number(match![1]);
}

/** The literal className of the one line opening `<HeaderStatus>`'s direct parent div. */
function readHeaderStatusParentClassName(source: string): string {
  const headerStatusAt = source.indexOf('<HeaderStatus>');
  assert.notEqual(headerStatusAt, -1, 'app-wrapper.tsx no longer mounts <HeaderStatus>; this test needs updating.');

  const parentDivAt = source.lastIndexOf('<div', headerStatusAt);
  assert.notEqual(parentDivAt, -1, '<HeaderStatus> is no longer inside a <div> in app-wrapper.tsx.');

  const openingTag = source.slice(parentDivAt, source.indexOf('>', parentDivAt));
  const match = /className="([^"]*)"/.exec(openingTag);
  assert.notEqual(match, null, `<HeaderStatus>'s parent <div> has no literal className: ${openingTag}`);
  // SAFETY: the assertion above rules out null.
  return match![1]!;
}

const source = readFileSync(APP_WRAPPER_PATH, 'utf8');

describe('the app header sticks to the top of the viewport', () => {
  const className = readHeaderClassName(source);

  it('is position: sticky', () => {
    assert.ok(
      className.split(/\s+/).includes('sticky'),
      `The <header> in app-wrapper.tsx must carry \`sticky\` so it stays on screen while the page scrolls. Got: ${className}`,
    );
  });

  it('anchors at the top of the viewport', () => {
    assert.ok(
      className.split(/\s+/).includes('top-0'),
      `The <header> in app-wrapper.tsx must carry \`top-0\`. The scroll container is the document, so the header pins to the viewport top. Got: ${className}`,
    );
  });

  it('stays at or below z-40, under every Radix portal', () => {
    const z = readZIndex(className);
    assert.ok(
      z <= 40,
      `The app header is z-${z}. It must be at most z-40. Radix portals (Popover, Sheet, Dialog) render at z-50, ` +
        `so a header at z-50 or above would cover the diary's open calendar popover. BottomNav and the scan action ` +
        `bar are z-40; the header belongs on that same layer, not above it.`,
    );
  });
});

describe('the header status row can shrink below its text width', () => {
  it('gives <HeaderStatus>\'s direct parent flex div `min-w-0`', () => {
    const className = readHeaderStatusParentClassName(source);
    // Exact match, not `.includes('min-w-0')`: the old line was
    // `"flex flex-1 items-center justify-between gap-2"`, which contains
    // neither `min-w-0` nor `min-w`, so this fails against it as written.
    assert.equal(
      className,
      'flex min-w-0 flex-1 items-center justify-between gap-2',
      `<HeaderStatus>'s parent div must carry \`min-w-0\` alongside \`flex-1\`, or a long status can't shrink ` +
        `below its text's intrinsic width and the header overflows the viewport. Got: ${className}`,
    );
  });
});
