/**
 * The two readings DESIGN.md section 7 asks a "no layout shift" check for, in
 * one place: the browser's own `layout-shift` entries, and the tops of the
 * elements on screen before and after a change.
 *
 * EVERY ENTRY COUNTS, including the ones the browser marks `hadRecentInput`.
 * Cumulative Layout Shift leaves those out, because a shift right after a tap
 * is usually the tap's own doing; here the tap or the key IS the thing under
 * test, so leaving them out would make a shift caused by typing invisible.
 *
 * The geometry reading names what moved and by how much, which the score alone
 * cannot: a score of 0.02 says something moved, a line of `button "Continue"
 * moved 24 px` says what to fix.
 */
import type { Page } from '@playwright/test';

/** One `layout-shift` entry, reduced to what a failure message needs. */
export interface ShiftEntry {
  value: number;
  hadRecentInput: boolean;
  /** The elements the browser says moved, each with how far its top moved. */
  sources: string[];
}

/** One element that moved between two readings. */
export interface MovedElement {
  element: string;
  dy: number;
}

/** The part of a `LayoutShiftAttribution` read here; the DOM lib this repo types against has no such type. */
interface ShiftSource {
  node?: Node | null;
  previousRect?: DOMRectReadOnly;
  currentRect?: DOMRectReadOnly;
}

/**
 * Installs the observer BEFORE any page script runs, so a service worker
 * reload or a client navigation cannot start a page without it. Call once,
 * before the first `goto`.
 *
 * @param page - a page that has not navigated yet.
 */
export async function installShiftObserver(page: Page): Promise<void> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this
  // module's scope, so its helpers cannot move out of it, which is exactly
  // what `consistent-function-scoping` asks for.
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript(() => {
    const shifts: ShiftEntry[] = [];
    Object.defineProperty(window, '__noShiftEntries', { value: shifts });
    const describe = (node: Node | null | undefined): string => {
      if (!(node instanceof Element)) return node instanceof Node ? '#text' : 'unknown';
      const slot = node.getAttribute('data-slot');
      const text = (node.textContent ?? '').trim().slice(0, 40);
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${slot ? `[${slot}]` : ''} "${text}"`;
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // `toJSON` is typed `any` and is the one read of a `LayoutShift` that needs no cast.
        const json = entry.toJSON();
        const sources: ShiftSource[] = Array.isArray(json.sources) ? json.sources : [];
        shifts.push({
          value: Number(json.value),
          hadRecentInput: Boolean(json.hadRecentInput),
          sources: sources.map((source) => {
            const before = source.previousRect;
            const after = source.currentRect;
            if (!(before instanceof DOMRectReadOnly) || !(after instanceof DOMRectReadOnly)) {
              return `${describe(source.node)} moved`;
            }
            // All four, because a shift is not only vertical: a button that
            // grows by a pixel pushes its sibling sideways with dy = 0.
            const dx = Math.round(after.x - before.x);
            const dy = Math.round(after.y - before.y);
            const dw = Math.round(after.width - before.width);
            const dh = Math.round(after.height - before.height);
            return `${describe(source.node)} moved dx ${dx} px, dy ${dy} px, width ${dw} px, height ${dh} px`;
          }),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  // oxlint-enable unicorn/consistent-function-scoping
}

/**
 * Every shift recorded so far, in order.
 *
 * @param page - a page with the observer installed.
 * @returns the entries.
 */
export async function readShiftEntries(page: Page): Promise<ShiftEntry[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__noShiftEntries')?.value;
    return Array.isArray(recorded) ? [...recorded] : [];
  });
}

/**
 * The summed score of the entries recorded after the first `since` of them.
 *
 * @param entries - a reading from `readShiftEntries`.
 * @param since - how many entries to skip, the length of an earlier reading.
 * @returns the score.
 */
export function shiftScoreAfter(entries: readonly ShiftEntry[], since: number): number {
  return entries.slice(since).reduce((sum, entry) => sum + entry.value, 0);
}

/**
 * The top of every element a person reads or aims at inside `main`, measured
 * from the top of the PAGE rather than the viewport, and keyed so
 * the same element gets the same key in the next reading. A typed VALUE is
 * never part of a key, or typing would rename the element it moved.
 *
 * @param page - the page to read.
 * @returns top edges in CSS px, keyed by element.
 */
export async function readTops(page: Page): Promise<Record<string, number>> {
  // Serialised into the page, as above: its helper cannot live outside it.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('the page has no main');
    const tops: Record<string, number> = {};
    const seen = new Map<string, number>();
    // A fixed or sticky box (the app header, the tab bar) keeps its place in
    // the VIEWPORT, so its page-relative top changes with every scroll. It
    // cannot be pushed by content, so it is left out rather than read as moved.
    const isPinned = (element: Element): boolean => {
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    };
    for (const element of main.querySelectorAll('input:not([type="hidden"]), button, label, legend, a')) {
      if (isPinned(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const name = element.getAttribute('name') ?? '';
      const radioValue =
        element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox') ?
          `=${element.value}`
        : '';
      const text = element instanceof HTMLInputElement ? '' : (element.textContent ?? '').trim().slice(0, 40);
      const base = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[${name}${radioValue}] "${text}"`;
      const index = seen.get(base) ?? 0;
      seen.set(base, index + 1);
      // PAGE-relative, not viewport-relative: a click scrolls its target into
      // view, and a scroll moves every box on screen without being a shift.
      tops[index === 0 ? base : `${base} (${index + 1})`] = Math.round((rect.top + window.scrollY) * 10) / 10;
    }
    return tops;
  });
  // oxlint-enable unicorn/consistent-function-scoping
}

/**
 * The elements present in both readings whose top moved.
 *
 * @param before - the earlier reading.
 * @param after - the later reading.
 * @returns one entry per moved element.
 */
export function movedBetween(before: Record<string, number>, after: Record<string, number>): MovedElement[] {
  return Object.entries(after)
    .filter(([key, top]) => key in before && before[key] !== top)
    .map(([key, top]) => ({ element: key, dy: Math.round((top - before[key]) * 10) / 10 }));
}

/**
 * Waits two animation frames, so a React commit and the layout after it have
 * both happened before anything is read.
 *
 * @param page - the page to wait on.
 */
export async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Waits until no finite CSS transition or animation is running on the page.
 *
 * Needed before a BASELINE, never instead of a reading: the onboarding
 * progress dots widen with `transition-all` when a step arrives, and a
 * baseline taken inside those 150 ms records a shift the next key did not
 * cause.
 *
 * @param page - the page to wait on.
 */
export async function settleAnimations(page: Page): Promise<void> {
  // FINITE ones only: the global progress bar's runner loops forever, hidden
  // at zero opacity, and would hold this wait open until the test times out.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity),
  );
  await settleFrames(page);
}
