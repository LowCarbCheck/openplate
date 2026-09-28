/**
 * One row at the top of the personal app for the whole update subject.
 *
 * ── THE TWO THINGS IT CAN SAY ───────────────────────────────────────────────
 *
 * 1. **A newer bundle is on this server.** Actionable: the assets are already
 *    being served, so "Reload" adopts them. This one wins when both are true.
 * 2. **A newer release exists on GitHub.** Informational, with a link. There is
 *    deliberately NO button: openplate is one stateless container, the server
 *    cannot upgrade itself, and a self-hoster pulls a new image while the hosted
 *    instance is deployed by an operator. A button that pretended otherwise
 *    would be a lie with a spinner on it.
 *
 * Anything else renders nothing.
 *
 * ── HOW IT SITS ─────────────────────────────────────────────────────────────
 *
 * In flow, above the header, so it RESERVES space rather than overlaying: a
 * banner that covered the app header would hide the page title and the device
 * menu at the one moment the person is being asked to do something. No `fixed`,
 * no `absolute`, no z-index.
 *
 * One row when the sentence and its keys fit side by side, a second row when they
 * do not. It was one `truncate`d line, and in Victor Mono at a phone's width that
 * cut "openplate 0.35.1 is available" to "openplate 0.35.1 is ava...", in Inter
 * too for four of the six languages (measured M243 spec 08). The sentence is what
 * the row is for, so it wraps instead of losing its tail. The ribbon moves the
 * page under a thumb whenever it appears, so a second row costs nothing the first
 * did not. The keys sit in ONE group, so a row break never leaves the dismiss key
 * alone on a line of its own.
 *
 * Both keys are 44 px tall on a phone (`h-11`), the app's tap floor. The dismiss
 * key was 28 px and the link a bare 20 px line of text.
 *
 * ── NO COLOUR-ONLY MEANING, NO MOTION ───────────────────────────────────────
 *
 * Every state carries an icon and a sentence; the tint is decoration on top of
 * both. Nothing animates, so `prefers-reduced-motion` has nothing to suppress,
 * and the hover transition is a colour change only.
 *
 * The row is an `output` rather than a div carrying `role="status"`: it is the
 * semantic element for a live result, and it announces itself to a screen reader
 * without a redundant role attribute.
 */
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, RefreshCw, X } from 'lucide-react';

import { useUpdateStatus } from '#app/hooks/use-update-status';
import { Button } from '#app/components/ui/button';

/**
 * The row, in both of its states. `flex-wrap` is what lets the keys drop under the
 * sentence when the two do not fit; `gap-y-1` keeps the two rows from touching.
 */
const RIBBON_CLASS =
  'flex min-h-10 w-full shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-primary/20 bg-primary/10 px-4 py-1 text-sm';

/**
 * The sentence. `basis-40` is its smallest useful width, 160 px: the row breaks in
 * front of the keys before it squeezes the sentence any narrower, and a sentence
 * with the whole row to itself wraps only if it must.
 */
const SENTENCE_CLASS = 'min-w-0 flex-1 basis-40';

export function UpdateRibbon() {
  const { t } = useTranslation();
  const { status, ribbon, updateNow, dismiss } = useUpdateStatus();

  if (ribbon === 'none') return null;

  if (ribbon === 'newer-bundle') {
    return (
      <output className={RIBBON_CLASS}>
        <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className={SENTENCE_CLASS}>{t('chrome.update.bundleReady')}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-11 shrink-0 md:h-7"
          onClick={updateNow}
        >
          {t('chrome.update.reload')}
        </Button>
      </output>
    );
  }

  const latest = status.status?.latest ?? '';
  const releaseUrl = status.status?.releaseUrl ?? null;

  return (
    <output className={RIBBON_CLASS}>
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className={SENTENCE_CLASS}>{t('chrome.update.releaseAvailable', { version: latest })}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {releaseUrl !== null && (
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0"
          >
            {t('chrome.update.view')}
          </a>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11 shrink-0 md:h-7 md:w-7"
          aria-label={t('chrome.update.dismiss')}
          onClick={dismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </span>
    </output>
  );
}
