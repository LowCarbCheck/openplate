/**
 * The one query parameter that lets another screen open `/scan` on a chosen
 * scanner instead of the plate default.
 *
 * WHY IT EXISTS. Onboarding teaches three ways to log, and one of them is the
 * label scan (`LABEL_SCAN_TASK`). A card that lands on `/scan` in plate mode
 * would be teaching the wrong thing, so the card carries the mode in the URL
 * and the scan screen honours it on mount.
 *
 * WHY IT IS NOT THE INITIAL STATE. `/scan` deliberately starts on `plate`, and
 * `tests/unit/scan-mode-event.test.ts` pins that literal because the
 * `Scan / mode-chosen` event counts a SWITCH away from it. Reading the URL is
 * therefore a mount-time `setMode`, exactly like the tab bar's hand-off, and
 * it fires nothing, because an arrival is not a person finding the scanner.
 *
 * Pure and string-only, so it is unit-testable without a browser.
 */
import { VISION_MODES } from '#app/services/vision/task';
import type { VisionMode } from '#app/services/vision/task';

/** The query parameter carrying a requested scanner, as in `/scan?mode=label`. */
export const SCAN_MODE_PARAM = 'mode';

/**
 * The scanner a URL asks for, or `null` when it asks for nothing recognizable.
 *
 * `null` rather than a `'plate'` default on purpose: the caller must be able to
 * tell "no opinion" from "asked for the plate scan", because the first leaves
 * the screen's own state alone.
 *
 * @param search - a `location.search` string, with or without its leading `?`.
 * @returns the requested scanner, or `null`.
 */
export function requestedScanMode(search: string): VisionMode | null {
  const raw = new URLSearchParams(search).get(SCAN_MODE_PARAM);
  return VISION_MODES.find((mode) => mode === raw) ?? null;
}
